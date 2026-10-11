import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const main = join(__dirname, "../src/main.js");
const dir = mkdtempSync(join(tmpdir(), "hitlp-main-"));
const run = (...args: string[]) => spawnSync(process.execPath, [main, "--db", join(dir, "t.db"), ...args], { encoding: "utf8", input: "", timeout: 10_000 });

test("HTTP mode without --tokens refuses to start, naming it", () => {
  const r = run("--http-port", "0");
  assert.equal(r.status, 2);
  assert.match(r.stderr, /missing required setting --tokens/);
});

test("HTTP mode with --approvers and no --page-url refuses to start, naming it", () => {
  const tokens = join(dir, "tokens.json");
  const approvers = join(dir, "approvers.json");
  writeFileSync(tokens, JSON.stringify({ secret: "agent-1" }));
  writeFileSync(approvers, JSON.stringify([{ credential: "human", id: "alice", roles: [], capabilities: [] }]));
  const r = run("--http-port", "0", "--tokens", tokens, "--approvers", approvers);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /missing required setting --page-url/);
});

test("stdio still starts with its local defaults", () => {
  // stdin closes at once, so the server ends cleanly after starting.
  const r = run();
  assert.doesNotMatch(r.stderr, /missing required setting/);
  assert.equal(r.status, 0);
});
