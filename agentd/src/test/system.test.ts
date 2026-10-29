import { test, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const repo = mkdtempSync(join(tmpdir(), "antonio-repo-"));
process.env.ANTONIO_CONFIG_REPO = repo;
process.env.ANTONIO_DRY_RUN_SYSTEM = "1";
process.env.ANTONIO_CONFIRM_SECONDS = "1";
process.env.ANTONIO_STATE_DIR = mkdtempSync(join(tmpdir(), "antonio-state-"));

const { Hub } = await import("../hub.js");
const sys = await import("../system.js");
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

before(() => {
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "packages.nix"), "{ pkgs, ... }: { environment.systemPackages = [ pkgs.firefox ]; }\n");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
});

/** A hub whose "user" answers approvals and confirmations automatically. */
function autoHub(approval: "allow" | "deny", keep: boolean) {
  const hub = new Hub();
  hub.broadcast = (msg: any) => {
    if (msg.type === "approval") setImmediate(() => hub.answerApproval(msg.request.id, approval));
    if (msg.type === "change" && keep) setImmediate(() => hub.answerConfirm(msg.change.id, true));
  };
  return hub;
}

test("no changes means nothing to apply", async () => {
  const r = await sys.applyChange(autoHub("allow", true), "nada");
  assert.equal(r.status, "no_changes");
});

test("denied changes stay uncommitted", async () => {
  appendFileSync(join(repo, "packages.nix"), "# gimp\n");
  const r = await sys.applyChange(autoHub("deny", true), "Instalar GIMP");
  assert.equal(r.status, "denied");
  assert.equal(git("log", "--oneline").split("\n").length, 1);
});

test("an unconfirmed change is reverted after the deadline", async () => {
  const r = await sys.applyChange(autoHub("allow", false), "Instalar GIMP");
  assert.equal(r.status, "reverted");
  assert.equal(git("log", "--oneline").split("\n").length, 1);
});

test("a confirmed change is committed, and undo reverts it", async () => {
  const r = await sys.applyChange(autoHub("allow", true), "Instalar GIMP");
  assert.equal(r.status, "kept");
  assert.equal(git("log", "-1", "--pretty=%s"), "Instalar GIMP");
  assert.equal(git("status", "--porcelain"), "");

  const u = await sys.undo(autoHub("allow", true));
  assert.equal(u.status, "kept");
  assert.equal(git("log", "-1", "--pretty=%s"), "Desfazer: Instalar GIMP");
  assert.doesNotMatch(execFileSync("cat", [join(repo, "packages.nix")], { encoding: "utf8" }), /gimp/);
});

test("rejecting an undo leaves the history untouched", async () => {
  const head = git("rev-parse", "HEAD");
  const u = await sys.undo(autoHub("deny", true));
  assert.equal(u.status, "denied");
  assert.equal(git("rev-parse", "HEAD"), head);
  assert.equal(git("status", "--porcelain"), "");
});
