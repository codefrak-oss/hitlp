import { test } from "node:test";
import assert from "node:assert/strict";
import { answerOf, isApproved } from "@codefrak/hitlp";
import { startServer } from "./support/harness";
import { approve, ask } from "./support/requests";

test("R1: a task survives a server restart, and its decision is read after it", async () => {
  const first = await startServer();
  let second;
  try {
    const { hitlp } = await first.connect("token-a");
    const req = ask();
    const created = await hitlp.ask(req);
    assert.equal(created.status, "working");
    await first.stop();

    second = await startServer(first.dbPath);
    const { hitlp: again } = await second.connect("token-a");
    const polled = await again.get(created.taskId);
    assert.equal(polled.taskId, created.taskId);
    assert.equal(polled.status, "working");

    second.server.decide(created.taskId, { idempotencyKey: req.idempotencyKey, primitive: "ask", outcome: "answered", answer: "EUR", decidedBy: { type: "human", id: "h1" }, decidedAt: "2026-10-08T15:20:00Z" });
    const done = await again.waitForTerminal(polled);
    assert.equal(done.status, "completed");
    assert.equal(answerOf(done.result), "EUR");
    assert.equal(done.result?.requestId, created.taskId);
  } finally {
    await second?.stop();
    first.cleanup();
  }
});

test("R1: a decided approval is still readable after a restart", async () => {
  const first = await startServer();
  let second;
  try {
    const { hitlp } = await first.connect("token-a");
    const req = approve();
    const task = await hitlp.approve(req);
    first.server.decide(task.taskId, { idempotencyKey: req.idempotencyKey, primitive: "approve", outcome: "approved", payloadDigest: "sha256:aa", decidedBy: { type: "human", id: "h2" }, decidedAt: "2026-10-08T15:21:00Z" });
    await first.stop();

    second = await startServer(first.dbPath);
    const { hitlp: again } = await second.connect("token-a");
    const done = await again.get(task.taskId);
    assert.equal(done.status, "completed");
    assert.equal(isApproved(done.result, req), true);
  } finally {
    await second?.stop();
    first.cleanup();
  }
});
