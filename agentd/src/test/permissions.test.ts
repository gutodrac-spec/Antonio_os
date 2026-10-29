import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { classify, isReadOnlyCommand } from "../permissions.js";
import { keyArgs } from "../claudeDesktop.js";
import { config } from "../config.js";

test("read-only commands run without asking", () => {
  for (const c of ["ls -la", "git -C /etc/antonio status", "systemctl --failed", "swaymsg -t get_tree", "journalctl -u sway -n 20", "ip addr"]) {
    assert.equal(isReadOnlyCommand(c), true, c);
  }
});

test("shell plumbing and writes need approval", () => {
  for (const c of ["ls; rm -rf ~", "cat a | sh", "git push", "find / -delete", "swaymsg exit", "echo $(id)", "rm file", "ip link set eth0 down"]) {
    assert.equal(isReadOnlyCommand(c), false, c);
  }
});

test("Bash with sudo is level 3 and cannot be always-allowed", () => {
  const v = classify("Bash", { command: "sudo nixos-rebuild switch" });
  assert.equal(v.decision, "ask");
  assert.equal(v.level, 3);
  assert.equal(v.key, undefined);
});

test("edits inside the config repo are allowed, elsewhere asked, secrets denied", () => {
  assert.equal(classify("Edit", { file_path: `${config.configRepo}/system/packages.nix` }).decision, "allow");
  assert.equal(classify("Write", { file_path: "/etc/passwd" }).decision, "ask");
  assert.equal(classify("Write", { file_path: `${homedir()}/.ssh/authorized_keys` }).decision, "deny");
  assert.equal(classify("Read", { file_path: `${homedir()}/.ssh/id_ed25519` }).decision, "deny");
  assert.equal(classify("Edit", { file_path: `${config.configRepo}-evil/x.nix` }).decision, "ask");
});

test("Claude's desktop tools are allowed, the user's desktop is asked", () => {
  assert.equal(classify("mcp__desktop__click", { x: 1, y: 2 }).decision, "allow");
  assert.equal(classify("mcp__system__apply", { summary: "x" }).decision, "allow");
  assert.equal(classify("mcp__system__user_desktop", { command: "output * bg red solid_color" }).decision, "ask");
  assert.equal(classify("mcp__other__thing", {}).decision, "ask");
});

test("key combos map to wtype arguments", () => {
  assert.deepEqual(keyArgs("enter"), ["-k", "Return"]);
  assert.deepEqual(keyArgs("ctrl+shift+t"), ["-M", "ctrl", "-M", "shift", "-k", "t", "-m", "shift", "-m", "ctrl"]);
  assert.deepEqual(keyArgs("super+f4"), ["-M", "logo", "-k", "F4", "-m", "logo"]);
  assert.throws(() => keyArgs("hyper+x"));
});
