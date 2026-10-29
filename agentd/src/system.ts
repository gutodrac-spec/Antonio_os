import { hostname } from "node:os";
import { config } from "./config.js";
import { run, tail } from "./util.js";
import { audit } from "./audit.js";
import type { Hub } from "./hub.js";

const git = (args: string[]) => run("git", ["-C", config.configRepo, ...args], { timeoutMs: 60_000 });
const flakeRef = () => `path:${config.configRepo}#${config.flakeHost}`;

export async function configDiff(): Promise<string> {
  await git(["add", "-A", "--intent-to-add"]);
  const diff = await git(["diff", "HEAD", "--stat", "--patch"]);
  return diff.stdout.trim();
}

export async function systemStatus(): Promise<string> {
  const parts: string[] = [`Host: ${hostname()}`];
  const add = async (label: string, cmd: string, args: string[]) => {
    const r = await run(cmd, args, { timeoutMs: 15_000 });
    parts.push(`## ${label}\n${(r.stdout || r.stderr).trim()}`);
  };
  await add("Versão", "nixos-version", []);
  await add("Uptime", "uptime", []);
  await add("Serviços com falha", "systemctl", ["--failed", "--no-legend", "--plain"]);
  await add("Disco", "df", ["-h", "/"]);
  await add("Memória", "free", ["-h"]);
  await add(`Configuração (${config.configRepo})`, "git", ["-C", config.configRepo, "status", "--short", "--branch"]);
  return parts.join("\n\n");
}

export async function build(): Promise<{ ok: boolean; output: string }> {
  if (config.dryRunSystem) return { ok: true, output: "(modo de teste: build ignorado)" };
  const r = await run("nixos-rebuild", ["build", "--flake", flakeRef()], { cwd: config.workspace, timeoutMs: 60 * 60_000 });
  return { ok: r.code === 0, output: tail(r.stdout + r.stderr) };
}

async function unit(name: string): Promise<{ ok: boolean; output: string }> {
  if (config.dryRunSystem) return { ok: true, output: `(modo de teste: systemctl start ${name})` };
  const r = await run("systemctl", ["start", name], { timeoutMs: 60 * 60_000 });
  if (r.code === 0) return { ok: true, output: "" };
  const log = await run("journalctl", ["-u", name, "-n", "80", "--no-pager", "-o", "cat"]);
  return { ok: false, output: tail(r.stderr + "\n" + log.stdout) };
}

export interface ApplyOutcome {
  status: "kept" | "reverted" | "denied" | "build_failed" | "apply_failed" | "no_changes";
  message: string;
}

/**
 * Builds, asks for approval, activates with `nixos-rebuild test` and waits for
 * the user to keep the change. The root-side revert timer rolls back on its
 * own if this daemon dies before the user answers.
 */
export async function applyChange(hub: Hub, summary: string, opts: { onReject?: () => Promise<void> } = {}): Promise<ApplyOutcome> {
  const diff = await configDiff();
  if (!diff) return { status: "no_changes", message: `Nenhuma mudança em ${config.configRepo}. Edite os arquivos primeiro.` };

  hub.notice(`Compilando a nova configuração: ${summary}`);
  const b = await build();
  if (!b.ok) {
    audit("system_build_failed", { summary });
    return { status: "build_failed", message: `A compilação falhou. Corrija e tente de novo.\n${b.output}` };
  }

  const decision = await hub.requestApproval({
    title: `Mudança no sistema: ${summary}`,
    detail: tail(diff, 20000),
    level: 2,
    diff: true,
    canAlways: false,
  });
  audit("system_change_approval", { summary, decision });
  if (decision === "deny") {
    await opts.onReject?.();
    return { status: "denied", message: "O usuário negou a mudança. Os arquivos editados continuam no repositório sem aplicar." };
  }

  const applied = await unit("antonio-apply.service");
  if (!applied.ok) {
    await unit("antonio-revert.service");
    await opts.onReject?.();
    audit("system_apply_failed", { summary });
    return { status: "apply_failed", message: `A ativação falhou e o sistema foi revertido.\n${applied.output}` };
  }

  const keep = await hub.requestConfirm(summary, config.confirmSeconds);
  if (!keep) {
    await unit("antonio-revert.service");
    await opts.onReject?.();
    audit("system_change_reverted", { summary });
    return { status: "reverted", message: "O usuário não confirmou a tempo (ou pediu para reverter). O sistema voltou à versão anterior." };
  }

  const confirmed = await unit("antonio-confirm.service");
  await git(["add", "-A"]);
  const commit = await git(["-c", "user.name=Antonio (Claude)", "-c", "user.email=antonio@localhost", "commit", "-q", "-m", summary]);
  audit("system_change_kept", { summary, commit: commit.code === 0 });
  return {
    status: "kept",
    message: confirmed.ok ? "Mudança aplicada, confirmada e salva no histórico." : `Mudança ativa, mas não ficou como padrão de boot:\n${confirmed.output}`,
  };
}

export async function history(limit = 20): Promise<string> {
  const r = await git(["log", `-${limit}`, "--date=short", "--pretty=format:%h %ad %s"]);
  return r.stdout.trim() || "(sem histórico)";
}

export async function undo(hub: Hub, commit = "HEAD"): Promise<ApplyOutcome> {
  const subject = (await git(["log", "-1", "--pretty=%s", commit])).stdout.trim();
  const r = await git(["revert", "--no-commit", commit]);
  if (r.code !== 0) {
    await git(["revert", "--abort"]);
    return { status: "apply_failed", message: `Não foi possível desfazer ${commit}: ${r.stderr}` };
  }
  return applyChange(hub, `Desfazer: ${subject}`, {
    onReject: async () => { await git(["revert", "--abort"]); },
  });
}

/** Runs a command on the user's own Sway session (only after approval). */
export async function userSway(command: string): Promise<string> {
  const r = await run("swaymsg", [command], { timeoutMs: 10_000 });
  return (r.stdout + r.stderr).trim();
}
