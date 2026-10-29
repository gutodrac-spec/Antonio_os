import { readFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { paths } from "./config.js";
import { run } from "./util.js";

/**
 * Claude's own desktop: a separate headless Sway instance with its own seat.
 * Every input event goes to that compositor only, so the user's cursor,
 * keyboard focus and typing are never touched.
 */
export class ClaudeDesktop {
  constructor(private envFile = paths.claudeDesktopEnv) {}

  env(): NodeJS.ProcessEnv {
    if (!existsSync(this.envFile)) {
      throw new Error("A Área do Claude não está rodando (antonio-claude-desktop.service).");
    }
    const vars: Record<string, string> = {};
    for (const line of readFileSync(this.envFile, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m && m[2]) vars[m[1]] = m[2];
    }
    const env: NodeJS.ProcessEnv = { ...process.env, ...vars };
    if (!vars.DISPLAY) delete env.DISPLAY;
    return env;
  }

  async swaymsg(command: string): Promise<string> {
    const r = await run("swaymsg", [command], { env: this.env(), timeoutMs: 10_000 });
    if (r.code !== 0 || /"success": false/.test(r.stdout)) throw new Error(`swaymsg falhou: ${r.stdout}${r.stderr}`.trim());
    return r.stdout;
  }

  async tree(): Promise<SwayNode> {
    const r = await run("swaymsg", ["-t", "get_tree", "-r"], { env: this.env(), timeoutMs: 10_000 });
    if (r.code !== 0) throw new Error(r.stderr || "get_tree falhou");
    return JSON.parse(r.stdout) as SwayNode;
  }

  async windows(): Promise<WindowInfo[]> {
    const out: WindowInfo[] = [];
    const walk = (n: SwayNode) => {
      if (n.pid && (n.type === "con" || n.type === "floating_con")) {
        out.push({
          id: n.id,
          app: n.app_id ?? n.window_properties?.class ?? "?",
          title: n.name ?? "",
          focused: Boolean(n.focused),
          rect: n.rect,
        });
      }
      for (const c of [...(n.nodes ?? []), ...(n.floating_nodes ?? [])]) walk(c);
    };
    walk(await this.tree());
    return out;
  }

  async screenshot(opts: { scale?: number; quality?: number } = {}): Promise<Buffer> {
    const args = ["-t", "jpeg", "-q", String(opts.quality ?? 80)];
    if (opts.scale && opts.scale !== 1) args.push("-s", String(opts.scale));
    args.push("-");
    const r = await run("grim", args, { env: this.env(), binary: true, timeoutMs: 15_000 });
    if (r.code !== 0) throw new Error(`grim falhou: ${r.stderr}`);
    return r.raw;
  }

  async moveTo(x: number, y: number) {
    await this.swaymsg(`seat seat0 cursor set ${Math.round(x)} ${Math.round(y)}`);
  }

  async click(x: number, y: number, button: MouseButton = "left", count = 1) {
    await this.moveTo(x, y);
    const b = BUTTONS[button];
    for (let i = 0; i < count; i++) {
      await this.swaymsg(`seat seat0 cursor press ${b}`);
      await this.swaymsg(`seat seat0 cursor release ${b}`);
    }
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number) {
    await this.moveTo(fromX, fromY);
    await this.swaymsg("seat seat0 cursor press button1");
    const steps = 10;
    for (let i = 1; i <= steps; i++) {
      await this.moveTo(fromX + ((toX - fromX) * i) / steps, fromY + ((toY - fromY) * i) / steps);
    }
    await this.swaymsg("seat seat0 cursor release button1");
  }

  async scroll(x: number, y: number, direction: "up" | "down" | "left" | "right", amount: number) {
    await this.moveTo(x, y);
    const b = { up: "button4", down: "button5", left: "button6", right: "button7" }[direction];
    for (let i = 0; i < amount; i++) {
      await this.swaymsg(`seat seat0 cursor press ${b}`);
      await this.swaymsg(`seat seat0 cursor release ${b}`);
    }
  }

  async type(text: string) {
    const r = await run("wtype", ["-s", String(KEYMAP_SETTLE_MS), "-d", "8", "--", text], { env: this.env(), timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`wtype falhou: ${r.stderr}`);
  }

  async key(combo: string) {
    const r = await run("wtype", ["-s", String(KEYMAP_SETTLE_MS), ...keyArgs(combo)], { env: this.env(), timeoutMs: 10_000 });
    if (r.code !== 0) throw new Error(`wtype falhou: ${r.stderr}`);
  }

  /** Starts a program inside Claude's desktop, detached from the daemon. */
  launch(command: string): number | undefined {
    const child = spawn("sh", ["-c", command], { env: this.env(), detached: true, stdio: "ignore" });
    child.unref();
    return child.pid;
  }
}

/**
 * Each wtype call creates a fresh virtual keyboard with its own keymap; clients
 * drop the first key if it arrives before they processed that keymap.
 */
const KEYMAP_SETTLE_MS = 60;

export type MouseButton = "left" | "right" | "middle";
const BUTTONS: Record<MouseButton, string> = { left: "button1", right: "button3", middle: "button2" };

const MODIFIERS: Record<string, string> = {
  ctrl: "ctrl", control: "ctrl", shift: "shift", alt: "alt", super: "logo", win: "logo", meta: "logo", logo: "logo", altgr: "altgr",
};

const KEY_NAMES: Record<string, string> = {
  enter: "Return", return: "Return", esc: "Escape", escape: "Escape", tab: "Tab", space: "space",
  backspace: "BackSpace", delete: "Delete", del: "Delete", insert: "Insert", home: "Home", end: "End",
  pageup: "Page_Up", pagedown: "Page_Down", up: "Up", down: "Down", left: "Left", right: "Right",
  menu: "Menu", print: "Print",
};

/** Translates "ctrl+shift+t" into wtype arguments. */
export function keyArgs(combo: string): string[] {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) throw new Error("Combinação de teclas vazia");
  const keyName = parts.pop()!;
  const mods = parts.map((p) => {
    const m = MODIFIERS[p.toLowerCase()];
    if (!m) throw new Error(`Modificador desconhecido: ${p}`);
    return m;
  });
  const lower = keyName.toLowerCase();
  const key = KEY_NAMES[lower] ?? (/^f\d{1,2}$/.test(lower) ? lower.toUpperCase() : keyName);
  const args: string[] = [];
  for (const m of mods) args.push("-M", m);
  args.push("-k", key);
  for (const m of [...mods].reverse()) args.push("-m", m);
  return args;
}

export interface SwayNode {
  id: number;
  type: string;
  name?: string;
  app_id?: string | null;
  pid?: number;
  focused?: boolean;
  rect: { x: number; y: number; width: number; height: number };
  window_properties?: { class?: string };
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
}

export interface WindowInfo {
  id: number;
  app: string;
  title: string;
  focused: boolean;
  rect: SwayNode["rect"];
}
