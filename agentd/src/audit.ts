import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { paths } from "./config.js";

export interface AuditEntry {
  ts: string;
  kind: string;
  [key: string]: unknown;
}

export function audit(kind: string, data: Record<string, unknown> = {}): AuditEntry {
  const entry: AuditEntry = { ts: new Date().toISOString(), kind, ...data };
  mkdirSync(dirname(paths.audit), { recursive: true });
  appendFileSync(paths.audit, JSON.stringify(entry) + "\n", { mode: 0o600 });
  return entry;
}

export function recentAudit(limit = 200): AuditEntry[] {
  if (!existsSync(paths.audit)) return [];
  const lines = readFileSync(paths.audit, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map((l) => JSON.parse(l) as AuditEntry);
}
