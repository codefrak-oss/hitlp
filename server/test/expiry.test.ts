import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApprove, buildAsk, type DefaultOnTimeout } from "@codefrak/hitlp";
import { FakeClock, startServer, T0 } from "./support/harness";

const HOUR = 3_600_000;
const deadline = new Date(T0 + HOUR).toISOString();
const askWith = (d: DefaultOnTimeout) => buildAsk({ deadline, defaultOnTimeout: d, question: "Which currency?", responseSchema: { type: "string" } });
const approveWith = (d: DefaultOnTimeout) => buildApprove({ deadline, defaultOnTimeout: d, action: "deploy", payload: { v: 1 } });

const cases: [DefaultOnTimeout, "ask" | "approve", string, string][] = [
  ["reject", "ask", "completed", "timed_out"],
  ["reject", "approve", "completed", "rejected"],
  ["cancel", "ask", "cancelled", "cancelled"],
  ["cancel", "approve", "cancelled", "cancelled"],
  ["fail", "ask", "failed", "timed_out"],
  ["fail", "approve", "failed", "timed_out"],
];

for (const [action, primitive, status, outcome] of cases) {
  test(`R2: an expired ${primitive} with defaultOnTimeout ${action} ends ${status} / ${outcome}, decided by policy`, async () => {
    const h = await startServer();
    try {
      const { hitlp } = await h.connect("token-a");
      const task = primitive === "ask" ? await hitlp.ask(askWith(action)) : await hitlp.approve(approveWith(action));
      assert.equal(task.ttl, HOUR);
      h.clock.advance(HOUR - 1);
      assert.equal((await hitlp.get(task.taskId)).status, "working");
      h.clock.advance(1);
      const done = await hitlp.get(task.taskId);
      assert.equal(done.status, status);
      // The SDK reads no result for a cancelled task; the record is still written (spec 7.3).
      done.result ??= h.server.store.getById(task.taskId)?.result;
      assert.equal(done.result?.outcome, outcome);
      assert.equal(done.result?.decidedBy.type, "policy");
      assert.equal(done.result?.requestId, task.taskId);
      assert.equal(done.result?.decidedAt, new Date(T0 + HOUR).toISOString());
    } finally {
      await h.stop();
      h.cleanup();
    }
  });
}

test("R2: escalate keeps waiting until the server-set final deadline, then rejects", async () => {
  const escalated: string[] = [];
  const h = await startServer(undefined, { escalationGraceMs: 2 * HOUR, onEscalate: (t) => void escalated.push(t.id) });
  try {
    const { hitlp } = await h.connect("token-a");
    const task = await hitlp.approve(approveWith("escalate"));
    h.clock.advance(HOUR);
    const waiting = await hitlp.get(task.taskId);
    assert.equal(waiting.status, "working");
    assert.match(waiting.statusMessage ?? "", /escalated/);
    assert.deepEqual(escalated, [task.taskId]);
    h.clock.advance(2 * HOUR - 1);
    assert.equal((await hitlp.get(task.taskId)).status, "working");
    h.clock.advance(1);
    const done = await hitlp.get(task.taskId);
    assert.equal(done.status, "completed");
    assert.equal(done.result?.outcome, "rejected");
    assert.equal(done.result?.decidedBy.type, "policy");
    assert.deepEqual(escalated, [task.taskId]);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R2: tasks that expired while the server was down are swept on start", async () => {
  const first = await startServer();
  let second;
  try {
    const { hitlp } = await first.connect("token-a");
    const task = await hitlp.ask(askWith("reject"));
    await first.stop();
    second = await startServer(first.dbPath, { clock: new FakeClock(T0 + 2 * HOUR) });
    const t = second.server.store.getById(task.taskId)!;
    assert.equal(t.status, "completed");
    assert.equal(t.result?.outcome, "timed_out");
    assert.equal(second.server.sweep(), 0);
  } finally {
    await second?.stop();
    first.cleanup();
  }
});

test("R2: the timer sweep expires tasks nobody polls", async () => {
  const clock = new FakeClock();
  const h = await startServer(undefined, { clock, expirySweepMs: 5 });
  try {
    const { hitlp } = await h.connect("token-a");
    const task = await hitlp.ask(askWith("cancel"));
    clock.advance(HOUR);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(h.server.store.getById(task.taskId)?.status, "cancelled");
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R2: a decision after the deadline is refused; the policy record stands", async () => {
  const h = await startServer();
  try {
    const { hitlp } = await h.connect("token-a");
    const req = askWith("reject");
    const task = await hitlp.ask(req);
    h.clock.advance(HOUR);
    assert.throws(
      () => h.server.decide(task.taskId, { idempotencyKey: req.idempotencyKey, primitive: "ask", outcome: "answered", answer: "EUR", decidedBy: { type: "human", id: "h1" }, decidedAt: "2026-10-08T13:00:00Z" }),
      /already completed/,
    );
    const done = await hitlp.get(task.taskId);
    assert.equal(done.result?.outcome, "timed_out");
    assert.equal(done.result?.decidedBy.type, "policy");
  } finally {
    await h.stop();
    h.cleanup();
  }
});
