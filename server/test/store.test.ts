import { test } from "node:test";
import assert from "node:assert/strict";
import { DuplicateKeyError, SqliteTaskStore } from "../src";

const base = { clientId: "c", idempotencyKey: "k", requestHash: "h", primitive: "ask" as const, request: { a: 1 }, ttl: 1000, pollInterval: 5 };

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
