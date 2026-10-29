import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { config, paths } from "./config.js";
import type { Hub } from "./hub.js";
import { audit } from "./audit.js";

export type Level = 0 | 1 | 2 | 3;

export interface Verdict {
  decision: "allow" | "ask" | "deny";
  level: Level;
  title: string;
  detail: string;
  /** Key stored when the user picks "always allow"; absent when not offered. */
  key?: string;
  reason?: string;
}

const ALWAYS_ALLOWED = new Set([
  "Read", "Glob", "Grep", "LS", "WebSearch", "WebFetch", "TodoWrite", "ToolSearch",
  "TaskCreate", "TaskGet", "TaskList", "TaskUpdate", "TaskStop", "TaskOutput",
]);

/** Tools on Claude's own desktop or read-only system tools: never touch the user's input. */
const SAFE_MCP = /^mcp__(desktop__.+|system__(status|config_diff|build|history|apply|undo))$/;

const READONLY_COMMANDS = new Set([
  "ls", "cat", "head", "tail", "wc", "pwd", "whoami", "id", "uname", "uptime", "date", "df", "du", "free",
  "lsblk", "lscpu", "lspci", "lsusb", "ip", "hostname", "nixos-version", "which", "file", "stat", "find",
  "grep", "rg", "ps", "env", "printenv", "echo", "journalctl", "nmcli", "swaymsg", "nix-store", "readlink",
]);
const READONLY_SUBCOMMANDS: Record<string, RegExp> = {
  git: /^(status|diff|log|show|branch)\b/,
  systemctl: /^(status|list-units|list-timers|--failed|is-active|is-enabled|show)\b/,
  nix: /^(search|eval|flake (show|metadata)|path-info|log)\b/,
};

const home = homedir();
const SENSITIVE = [".ssh", ".gnupg", ".password-store", ".local/share/keyrings", ".mozilla/firefox", ".config/chromium", ".claude/.credentials.json", ".local/state/antonio"]
  .map((p) => resolve(home, p));

function isUnder(path: string, dir: string) {
  const p = resolve(path);
  return p === dir || p.startsWith(dir + "/");
}

function isSensitive(path: string) {
  return SENSITIVE.some((s) => isUnder(path, s));
}

function short(value: unknown, max = 600): string {
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export function classify(toolName: string, input: Record<string, unknown>): Verdict {
  const base = { title: toolName, detail: short(input) };

  if (ALWAYS_ALLOWED.has(toolName)) {
    const p = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : null;
    if (p && isSensitive(p)) return { ...base, decision: "deny", level: 3, reason: "Área sensível bloqueada (chaves, senhas, credenciais)." };
    return { ...base, decision: "allow", level: 0 };
  }

  if (SAFE_MCP.test(toolName)) return { ...base, decision: "allow", level: 0 };

  if (toolName === "Write" || toolName === "Edit" || toolName === "NotebookEdit" || toolName === "MultiEdit") {
    const p = String(input.file_path ?? input.notebook_path ?? "");
    const title = `Editar ${p}`;
    if (isSensitive(p)) return { ...base, title, decision: "deny", level: 3, reason: "Área sensível bloqueada." };
    if (isUnder(p, config.configRepo) || isUnder(p, config.workspace)) return { ...base, title, decision: "allow", level: 1 };
    return { ...base, title, decision: "ask", level: 2, key: `${toolName}:${resolve(dirname(p))}` };
  }

  if (toolName === "Bash") {
    const cmd = String(input.command ?? "").trim();
    const title = "Executar comando";
    if (SENSITIVE.some((s) => cmd.includes(s)) || /\.ssh|\.gnupg|password-store/.test(cmd)) {
      return { ...base, title, detail: cmd, decision: "ask", level: 3 };
    }
    if (isReadOnlyCommand(cmd)) return { ...base, title, detail: cmd, decision: "allow", level: 0 };
    const level: Level = /\b(sudo|pkexec|doas|rm\s+-rf|mkfs|dd|nixos-rebuild|systemctl\s+(start|stop|restart|enable|disable))\b/.test(cmd) ? 3 : 2;
    return { ...base, title, detail: cmd, decision: "ask", level, key: level === 2 ? `Bash:${cmd}` : undefined };
  }

  if (toolName === "mcp__system__user_desktop") {
    return { ...base, title: "Mudar a SUA área de trabalho", detail: String(input.command ?? ""), decision: "ask", level: 1, key: toolName };
  }
  if (toolName === "mcp__system__open_for_user") {
    return { ...base, title: "Abrir programa na SUA tela", detail: String(input.command ?? ""), decision: "ask", level: 1, key: toolName };
  }

  return { ...base, decision: "ask", level: 2, key: toolName };
}

/** Plain commands from a read-only allowlist, without any shell plumbing. */
export function isReadOnlyCommand(cmd: string): boolean {
  if (!cmd || /[;&|`$<>(){}\\\n]/.test(cmd)) return false;
  const [head, ...rest] = cmd.split(/\s+/);
  if (READONLY_COMMANDS.has(head)) {
    if (head === "find" && /-(exec|delete|ok)/.test(cmd)) return false;
    if (head === "swaymsg" && !/^-t\s+get_/.test(rest.join(" "))) return false;
    if (head === "ip" && !/^(-\w+\s+)*(a|addr|address|r|route|link)(\s+show(\s+[\w.-]+)?)?$/.test(rest.join(" "))) return false;
    return true;
  }
  const sub = READONLY_SUBCOMMANDS[head];
  if (!sub) return false;
  const args = rest.filter((a, i) => !(head === "git" && (a === "-C" || rest[i - 1] === "-C"))).join(" ");
  return sub.test(args);
}

interface PolicyFile {
  alwaysAllow: string[];
}

export class Policy {
  private data: PolicyFile = { alwaysAllow: [] };

  constructor() {
    if (existsSync(paths.policy)) {
      try {
        this.data = { alwaysAllow: [], ...JSON.parse(readFileSync(paths.policy, "utf8")) };
      } catch {
        /* keep defaults on a corrupt file */
      }
    }
  }

  has(key: string) {
    return this.data.alwaysAllow.includes(key);
  }

  add(key: string) {
    if (this.has(key)) return;
    this.data.alwaysAllow.push(key);
    mkdirSync(dirname(paths.policy), { recursive: true });
    writeFileSync(paths.policy, JSON.stringify(this.data, null, 2), { mode: 0o600 });
  }
}

export function makeCanUseTool(hub: Hub, policy: Policy): CanUseTool {
  return async (toolName, input, { signal }): Promise<PermissionResult> => {
    const v = classify(toolName, input);
    if (v.decision === "deny") {
      audit("tool_denied", { tool: toolName, input, reason: v.reason });
      return { behavior: "deny", message: v.reason ?? "Bloqueado pela política do Antonio OS." };
    }
    if (v.decision === "allow" || (v.key && policy.has(v.key))) {
      if (v.level > 0) audit("tool_allowed", { tool: toolName, input, level: v.level });
      return { behavior: "allow", updatedInput: input };
    }
    const decision = await hub.requestApproval(
      { title: v.title, detail: v.detail, level: v.level, canAlways: Boolean(v.key) },
      signal,
    );
    audit("tool_approval", { tool: toolName, input, level: v.level, decision });
    if (decision === "deny") {
      return { behavior: "deny", message: "O usuário negou esta ação. Pergunte como ele prefere seguir." };
    }
    if (decision === "always" && v.key) policy.add(v.key);
    return { behavior: "allow", updatedInput: input };
  };
}
