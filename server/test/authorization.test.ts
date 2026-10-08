import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./support/harness";
import { ask } from "./support/requests";

const decision = (key: string) => ({ idempotencyKey: key, primitive: "ask" as const, outcome: "answered" as const, answer: "EUR", decidedBy: { type: "human" as const, id: "h1" }, decidedAt: "2026-10-08T15:20:00Z" });

test("R5: another client cannot poll, read or cancel a task it knows the id of", async () => {
  const h = await startServer();
  try {
    const a = await h.connect("token-a");
    const b = await h.connect("token-b");
    const req = ask();
    const task = await a.hitlp.ask(req);
    await assert.rejects(b.hitlp.get(task.taskId), /Task not found/);
    await assert.rejects(b.hitlp.cancel(task.taskId), /Task not found/);
    h.server.decide(task.taskId, decision(req.idempotencyKey));
    await assert.rejects(b.hitlp.get(task.taskId), /Task not found/);
    assert.equal((await a.hitlp.get(task.taskId)).status, "completed");
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R5: a token revoked between polls is refused on the next poll", async () => {
  const h = await startServer();
  try {
    const a = await h.connect("token-a");
    const task = await a.hitlp.ask(ask());
    assert.equal((await a.hitlp.get(task.taskId)).status, "working");
    h.auth.revoke("token-a");
    await assert.rejects(a.hitlp.get(task.taskId), /unauthorized/);
    await assert.rejects(a.hitlp.cancel(task.taskId), /unauthorized/);
    h.auth.grant("token-a", "client-a");
    assert.equal((await a.hitlp.get(task.taskId)).status, "working");
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R5: an unknown token cannot create tasks", async () => {
  const h = await startServer();
  try {
    const x = await h.connect("token-x");
    await assert.rejects(x.hitlp.ask(ask()), /unauthorized/);
    assert.equal(h.notified.length, 0);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("the owner can cancel its own task", async () => {
  const h = await startServer();
  try {
    const a = await h.connect("token-a");
    const task = await a.hitlp.ask(ask());
    assert.equal((await a.hitlp.cancel(task.taskId)).status, "cancelled");
    assert.equal((await a.hitlp.get(task.taskId)).status, "cancelled");
  } finally {
    await h.stop();
    h.cleanup();
  }
});
