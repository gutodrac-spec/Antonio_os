#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { config } from "./config.js";
import { Hub } from "./hub.js";
import { Agent } from "./agent.js";
import { ClaudeDesktop } from "./claudeDesktop.js";
import { startServer } from "./server.js";
import { audit } from "./audit.js";

mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });

const hub = new Hub();
const desk = new ClaudeDesktop();
const agent = new Agent(hub, desk);
hub.stateExtra = () => ({ sessionId: agent.sessionId, model: agent.model, auth: agent.authOk });

/** Opens a terminal on the user's desktop running the Claude Code login. */
function login() {
  const claude = config.claudeBin ?? "claude";
  const child = spawn("foot", ["--title", "Entrar no Claude", "--", claude, "/login"], { detached: true, stdio: "ignore" });
  child.on("error", () => hub.notice("Não consegui abrir o terminal de login (foot).", "error"));
  child.unref();
}

startServer(hub, agent, desk, login);
audit("agentd_started");

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    hub.cancelAll();
    process.exit(0);
  });
}
