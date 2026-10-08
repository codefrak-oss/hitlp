import { test } from "node:test";
import assert from "node:assert/strict";
import { DuplicateKeyError, SqliteTaskStore, TerminalTaskError } from "../src";

const base = { clientId: "c", idempotencyKey: "k", requestHash: "h", primitive: "ask" as const, request: { a: 1 }, ttl: 1000, pollInterval: 5, deadlineAt: 2000, createdAt: new Date(1000).toISOString() };

test("SqliteTaskStore round trip", () => {
  const s = new SqliteTaskStore(":memory:");
  try {
    const t = s.create({ ...base, id: "t1" });
    assert.equal(t.status, "working");
    assert.deepEqual(s.getById("t1")?.request, { a: 1 });
    assert.equal(s.findByKey("c", "k")?.id, "t1");
    const done = s.update("t1", "completed", { result: { requestId: "t1" } as never });
    assert.equal(done.status, "completed");
    assert.deepEqual(done.result, { requestId: "t1" });
    assert.deepEqual(s.list("c").map((x) => x.id), ["t1"]);
    assert.deepEqual(s.list("other"), []);
  } finally {
    s.close();
  }
});

test("SqliteTaskStore enforces one task per (client, key)", () => {
  const s = new SqliteTaskStore(":memory:");
  try {
    s.create({ ...base, id: "t1" });
    assert.throws(() => s.create({ ...base, id: "t2" }), (e: unknown) => e instanceof DuplicateKeyError && e.existing.id === "t1");
    s.create({ ...base, id: "t3", clientId: "c2" });
  } finally {
    s.close();
  }
});

test("SqliteTaskStore update is compare-and-set on terminal tasks, and lists overdue open tasks", () => {
  const s = new SqliteTaskStore(":memory:");
  try {
    s.create({ ...base, id: "t1" });
    s.create({ ...base, id: "t2", idempotencyKey: "k2", deadlineAt: 5000 });
    assert.deepEqual(s.listOpenExpiring(1999).map((x) => x.id), []);
    assert.deepEqual(s.listOpenExpiring(2000).map((x) => x.id), ["t1"]);
    s.update("t1", "working", { finalDeadlineAt: 9000 });
    assert.deepEqual(s.listOpenExpiring(6000).map((x) => x.id), ["t2"]);
    s.update("t2", "cancelled");
    assert.throws(() => s.update("t2", "completed"), (e: unknown) => e instanceof TerminalTaskError && e.task.status === "cancelled");
    assert.deepEqual(s.listOpenExpiring(9000).map((x) => x.id), ["t1"]);
  } finally {
    s.close();
  }
});
