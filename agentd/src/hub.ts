import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";

/** Events shown in the sidebar conversation. Persisted per session. */
export type UiEvent =
  | { kind: "user"; id: string; text: string; images?: number }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; summary: string }
  | { kind: "tool_result"; id: string; ok: boolean; summary: string }
  | { kind: "notice"; id: string; level: "info" | "warn" | "error"; text: string }
  | { kind: "result"; id: string; ok: boolean; durationMs: number; costUsd?: number };

export type ApprovalDecision = "allow" | "deny" | "always";

export interface ApprovalRequest {
  id: string;
  title: string;
  detail: string;
  level: 0 | 1 | 2 | 3;
  /** Rendered as a diff in the sidebar when true. */
  diff?: boolean;
  canAlways: boolean;
}

export interface PendingChange {
  id: string;
  summary: string;
  deadline: number;
}

interface Waiter<T> {
  resolve: (value: T) => void;
}

/** Fan-out point between the agent and every connected sidebar. */
export class Hub {
  private clients = new Set<WebSocket>();
  private approvals = new Map<string, { request: ApprovalRequest } & Waiter<ApprovalDecision>>();
  private change: (PendingChange & Waiter<boolean> & { timer: NodeJS.Timeout }) | null = null;
  history: UiEvent[] = [];
  busy = false;
  onEvent?: (event: UiEvent) => void;
  stateExtra: () => Record<string, unknown> = () => ({});

  add(ws: WebSocket) {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
    this.send(ws, this.snapshot());
  }

  snapshot() {
    return {
      type: "state",
      busy: this.busy,
      history: this.history,
      approvals: [...this.approvals.values()].map((a) => a.request),
      change: this.change ? { id: this.change.id, summary: this.change.summary, deadline: this.change.deadline } : null,
      ...this.stateExtra(),
    };
  }

  broadcast(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) if (ws.readyState === ws.OPEN) ws.send(data);
  }

  private send(ws: WebSocket, msg: unknown) {
    ws.send(JSON.stringify(msg));
  }

  emit(event: UiEvent) {
    this.history.push(event);
    this.onEvent?.(event);
    this.broadcast({ type: "event", event });
  }

  /** Transient streaming text, not persisted. */
  delta(text: string) {
    this.broadcast({ type: "delta", text });
  }

  setBusy(busy: boolean) {
    this.busy = busy;
    this.broadcast({ type: "busy", busy });
  }

  notice(text: string, level: "info" | "warn" | "error" = "info") {
    this.emit({ kind: "notice", id: randomUUID(), level, text });
  }

  requestApproval(req: Omit<ApprovalRequest, "id">, signal?: AbortSignal): Promise<ApprovalDecision> {
    const request: ApprovalRequest = { id: randomUUID(), ...req };
    return new Promise((resolve) => {
      const done = (d: ApprovalDecision) => {
        if (!this.approvals.delete(request.id)) return;
        this.broadcast({ type: "approval_done", id: request.id, decision: d });
        resolve(d);
      };
      this.approvals.set(request.id, { request, resolve: done });
      signal?.addEventListener("abort", () => done("deny"), { once: true });
      this.broadcast({ type: "approval", request });
    });
  }

  answerApproval(id: string, decision: ApprovalDecision) {
    this.approvals.get(id)?.resolve(decision);
  }

  /** Asks the user to keep an applied system change; resolves false on timeout. */
  requestConfirm(summary: string, seconds: number): Promise<boolean> {
    this.change?.resolve(false);
    return new Promise((resolve) => {
      const id = randomUUID();
      const deadline = Date.now() + seconds * 1000;
      const finish = (keep: boolean) => {
        if (!this.change || this.change.id !== id) return;
        clearTimeout(this.change.timer);
        this.change = null;
        this.broadcast({ type: "change_done", id, keep });
        resolve(keep);
      };
      const timer = setTimeout(() => finish(false), seconds * 1000);
      this.change = { id, summary, deadline, resolve: finish, timer };
      this.broadcast({ type: "change", change: { id, summary, deadline } });
    });
  }

  answerConfirm(id: string, keep: boolean) {
    if (this.change?.id === id) this.change.resolve(keep);
  }

  /** Denies every pending approval and rejects a pending system change. */
  cancelAll() {
    for (const a of [...this.approvals.values()]) a.resolve("deny");
    this.change?.resolve(false);
  }
}
