import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  input?: string | Buffer;
  timeoutMs?: number;
  binary?: boolean;
}

/** Runs a command without a shell and collects its output. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult & { raw: Buffer }> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, {
      env: opts.env ?? process.env,
      cwd: opts.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) {
      timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs);
    }
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code: 127, stdout: "", stderr: String(e), raw: Buffer.alloc(0) });
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      const raw = Buffer.concat(out);
      resolvePromise({
        code: code ?? 1,
        stdout: opts.binary ? "" : raw.toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        raw,
      });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/** Keeps the last `max` characters of long command output for the model. */
export function tail(text: string, max = 6000): string {
  return text.length <= max ? text : "…\n" + text.slice(text.length - max);
}

export function textResult(text: string, isError = false) {
  return { content: [{ type: "text" as const, text }], isError };
}
