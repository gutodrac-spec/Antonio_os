import { homedir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
const here = dirname(fileURLToPath(import.meta.url));

export const config = {
  host: env.ANTONIO_HOST ?? "127.0.0.1",
  port: Number(env.ANTONIO_PORT ?? 7777),
  stateDir: env.ANTONIO_STATE_DIR ?? join(env.XDG_STATE_HOME ?? join(homedir(), ".local/state"), "antonio"),
  runtimeDir: join(env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}`, "antonio"),
  uiDir: env.ANTONIO_UI_DIR ?? resolve(here, "../../sidebar/web"),
  /** Git repository holding the system flake that Claude is allowed to edit. */
  configRepo: env.ANTONIO_CONFIG_REPO ?? "/etc/antonio",
  flakeHost: env.ANTONIO_FLAKE_HOST ?? "antonio",
  /** Working directory for Claude's own files (scratch, downloads). */
  workspace: env.ANTONIO_WORKSPACE ?? join(homedir(), "Antonio"),
  claudeBin: env.ANTONIO_CLAUDE_BIN || undefined,
  model: env.ANTONIO_MODEL || undefined,
  /** Seconds the user has to confirm a system change before it is rolled back. */
  confirmSeconds: Number(env.ANTONIO_CONFIRM_SECONDS ?? 60),
  /** Skip systemctl/nixos-rebuild (development outside Antonio OS). */
  dryRunSystem: env.ANTONIO_DRY_RUN_SYSTEM === "1",
};

export const paths = {
  token: join(config.stateDir, "token"),
  audit: join(config.stateDir, "audit.jsonl"),
  policy: join(config.stateDir, "policy.json"),
  conversations: join(config.stateDir, "conversations"),
  current: join(config.stateDir, "current-session"),
  claudeDesktopEnv: join(config.runtimeDir, "claude-desktop.env"),
};
