import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer } from "ws";
import { config, paths } from "./config.js";
import type { Hub, ApprovalDecision } from "./hub.js";
import type { Agent, ImageInput } from "./agent.js";
import type { ClaudeDesktop } from "./claudeDesktop.js";
import { recentAudit } from "./audit.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json",
};

export function loadToken(): string {
  if (existsSync(paths.token)) return readFileSync(paths.token, "utf8").trim();
  const token = randomBytes(24).toString("hex");
  mkdirSync(dirname(paths.token), { recursive: true });
  writeFileSync(paths.token, token, { mode: 0o600 });
  return token;
}

function tokenOk(given: string | null | undefined, token: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

type ClientMsg =
  | { type: "send"; text: string; images?: ImageInput[] }
  | { type: "interrupt" }
  | { type: "panic" }
  | { type: "new_conversation" }
  | { type: "approval"; id: string; decision: ApprovalDecision }
  | { type: "confirm"; id: string; keep: boolean }
  | { type: "set_api_key"; key: string | null }
  | { type: "login" }
  | { type: "audit" };

export function startServer(hub: Hub, agent: Agent, desk: ClaudeDesktop, onLogin: () => void) {
  const token = loadToken();
  let preview: { at: number; img: Buffer } | null = null;

  const http = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const authed = tokenOk(url.searchParams.get("token") ?? req.headers["x-antonio-token"]?.toString(), token);

    if (url.pathname === "/api/preview.jpg") {
      if (!authed) return void res.writeHead(401).end();
      try {
        if (!preview || Date.now() - preview.at > 700) preview = { at: Date.now(), img: await desk.screenshot({ scale: 0.5, quality: 60 }) };
        res.writeHead(200, { "content-type": "image/jpeg", "cache-control": "no-store" }).end(preview.img);
      } catch {
        res.writeHead(503).end();
      }
      return;
    }
    if (url.pathname === "/api/panic" && req.method === "POST") {
      if (!authed) return void res.writeHead(401).end();
      await agent.panic();
      return void res.writeHead(204).end();
    }

    // Static sidebar UI.
    const rel = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
    const file = join(config.uiDir, rel);
    if (!file.startsWith(config.uiDir) || !existsSync(file) || !statSync(file).isFile()) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    res.end(readFileSync(file));
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 * 1024 });
  http.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws" || !tokenOk(url.searchParams.get("token"), token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      hub.add(ws);
      ws.on("message", (raw) => {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        switch (msg.type) {
          case "send":
            if (msg.text?.trim() || msg.images?.length) agent.send(msg.text ?? "", msg.images ?? []);
            break;
          case "interrupt": void agent.interrupt(); break;
          case "panic": void agent.panic(); break;
          case "new_conversation": agent.newConversation(); break;
          case "approval": hub.answerApproval(msg.id, msg.decision); break;
          case "confirm": hub.answerConfirm(msg.id, msg.keep); break;
          case "set_api_key": agent.setApiKey(msg.key); break;
          case "login": onLogin(); break;
          case "audit": ws.send(JSON.stringify({ type: "audit", entries: recentAudit() })); break;
        }
      });
    });
  });

  http.listen(config.port, config.host, () => {
    console.log(`antonio-agentd ouvindo em http://${config.host}:${config.port}`);
  });
  return http;
}
