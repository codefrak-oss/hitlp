import { test } from "node:test";
import assert from "node:assert/strict";
import {
  answerOf,
  assertCallableTool,
  buildApprove,
  buildAsk,
  checkpointFor,
  HitlpClient,
  isApproved,
  parseCheckpoint,
  ReservedToolError,
  resolve,
  serializeCheckpoint,
  verifyPayloadDigest,
  type DecisionRecord,
  type Sleep,
  type Task,
  decisionUrlOf,
  withMeta,
} from "../src";
import { FakeTransport } from "../src/testing";

function fakeClock() {
  const slept: number[] = [];
  const sleep: Sleep = async (ms) => {
    slept.push(ms);
  };
  return { slept, sleep };
}

const ask = () =>
  buildAsk({
    deadline: "2026-10-09T09:00:00Z",
    defaultOnTimeout: "reject",
    question: "Which currency?",
    responseSchema: { type: "string" },
  });
const approve = () =>
  buildApprove({ deadline: "2026-10-15T12:00:00Z", action: "deploy", payload: { v: 1 }, payloadDigest: "sha256:aa" });

test("ask returns the task handle at once, without waiting", async () => {
  const t = new FakeTransport();
  const client = new HitlpClient(t);
  const task = await client.ask(ask());
  assert.equal(task.status, "working");
  assert.equal(t.calls[0].name, "human.ask");
  assert.equal(t.gets.length, 0);
});

test("waitForTerminal never polls faster than pollInterval", async () => {
  const t = new FakeTransport(750);
  const { slept, sleep } = fakeClock();
  const client = new HitlpClient(t, { sleep });
  const req = ask();
  const task = await client.ask(req);
  let polls = 0;
  const origGet = t.getTask.bind(t);
  t.getTask = async (id) => {
    if (++polls === 3) t.complete(id, { idempotencyKey: req.idempotencyKey, primitive: "ask", outcome: "answered", answer: "EUR", decidedBy: { type: "human", id: "h1" }, decidedAt: "2026-10-08T15:20:00Z" });
    return origGet(id);
  };
  const done = await client.waitForTerminal(task);
  assert.equal(done.status, "completed");
  assert.equal(answerOf(done.result), "EUR");
  assert.deepEqual(slept, [750, 750, 750]);
});

test("waitForTerminal uses the default interval when the server gives none, and honours abort", async () => {
  const t = new FakeTransport();
  const client = new HitlpClient(t, { defaultPollInterval: 2000, sleep: fakeClock().sleep });
  const task = await client.ask(ask());
  const ac = new AbortController();
  ac.abort(new Error("stop"));
  await assert.rejects(client.waitForTerminal({ ...task, pollInterval: undefined }, { signal: ac.signal }), /stop/);
});

test("cancel goes through tasks/cancel", async () => {
  const t = new FakeTransport();
  const client = new HitlpClient(t);
  const task = await client.approve(approve());
  const after = await client.cancel(task.taskId);
  assert.deepEqual(t.cancels, [task.taskId]);
  assert.equal(after.status, "cancelled");
  assert.equal(resolve(after).kind, "cancelled");
});

test("a retried call sends the same idempotency key and gets the same handle", async () => {
  const t = new FakeTransport();
  t.failNextCalls = 1;
  const client = new HitlpClient(t);
  const req = approve();
  const task = await client.approve(req);
  assert.equal(t.calls.length, 2);
  assert.equal(t.calls[0].args.idempotencyKey, req.idempotencyKey);
  assert.equal(t.calls[1].args.idempotencyKey, req.idempotencyKey);
  assert.equal(task.taskId, "task-1");
  const other = await client.approve(approve());
  assert.notEqual(t.calls[2].args.idempotencyKey, req.idempotencyKey);
  assert.notEqual(other.taskId, task.taskId);
});

test("checkpoint round-trip, then resume from the stored task id", async () => {
  const t = new FakeTransport();
  const req = approve();
  const task = await new HitlpClient(t).approve(req);
  const stored = serializeCheckpoint(checkpointFor(task, req, "approve"));

  // A new process: only the checkpoint survives.
  const cp = parseCheckpoint(stored);
  assert.equal(cp.taskId, task.taskId);
  assert.equal(cp.idempotencyKey, req.idempotencyKey);
  t.complete(cp.taskId, { idempotencyKey: cp.idempotencyKey, primitive: "approve", outcome: "approved", decidedBy: { type: "human", id: "h-102" }, decidedAt: "2026-10-08T18:04:11Z", payloadDigest: "sha256:aa" });
  const res = await new HitlpClient(t, { sleep: fakeClock().sleep }).resume(cp);
  assert.equal(res.kind, "decided");
  assert.equal(isApproved(res.record, cp), true);
  assert.throws(() => parseCheckpoint("{}"));
});

const base: DecisionRecord = {
  requestId: "t",
  idempotencyKey: "k",
  primitive: "approve",
  outcome: "approved",
  decidedBy: { type: "human", id: "h" },
  decidedAt: "2026-10-08T18:04:11Z",
  payloadDigest: "sha256:aa",
};

test("only an approved outcome is approval; timeouts never are", () => {
  assert.equal(isApproved(base), true);
  for (const outcome of ["rejected", "timed_out", "cancelled"] as const) {
    assert.equal(isApproved({ ...base, outcome, decidedBy: { type: "policy" } }), false, outcome);
  }
  assert.equal(isApproved(undefined), false);
  assert.equal(isApproved({ ...base, primitive: "ask" }), false);
  const failed = resolve({ taskId: "t", status: "failed", statusMessage: "default fail" });
  assert.equal(failed.kind, "failed");
  assert.throws(() => resolve({ taskId: "t", status: "working" }));
});

test("a payloadDigest mismatch is flagged", () => {
  assert.equal(verifyPayloadDigest(base, { payloadDigest: "sha256:aa" }), true);
  assert.equal(verifyPayloadDigest({ ...base, payloadDigest: "sha256:bb" }, { payloadDigest: "sha256:aa" }), false);
  assert.equal(verifyPayloadDigest({ ...base, payloadDigest: undefined }, { payloadDigest: "sha256:aa" }), false);
  assert.equal(isApproved({ ...base, payloadDigest: "sha256:bb" }, { payloadDigest: "sha256:aa" }), false);
});

test("an invalid decision record from the server is refused", async () => {
  const t = new FakeTransport();
  const client = new HitlpClient(t, { sleep: fakeClock().sleep });
  const req = ask();
  const task = await client.ask(req);
  t.complete(task.taskId, { idempotencyKey: req.idempotencyKey, primitive: "ask", outcome: "timed_out", decidedBy: { type: "human" }, decidedAt: "2026-10-08T15:20:00Z" });
  await assert.rejects(client.waitForTerminal(task.taskId), /invalid ask.response/);
});

test("reserved tool names are not callable", () => {
  for (const name of ["human.do", "human.inform", "human.escalate"]) {
    assert.throws(() => assertCallableTool(name), ReservedToolError);
  }
  assert.throws(() => assertCallableTool("human.other"));
  assert.doesNotThrow(() => assertCallableTool("human.ask"));
});

test("decisionUrlOf reads io.hitlp/decisionUrl only when it is a string", () => {
  const t: Task = withMeta({ taskId: "t", status: "input_required" }, { "io.hitlp/decisionUrl": "https://example.test/d/1" });
  assert.equal(t.decisionUrl, "https://example.test/d/1");
  assert.equal(decisionUrlOf(t.meta), "https://example.test/d/1");
  const none: Task = { taskId: "t", status: "working" };
  assert.equal(none.meta, undefined);
  assert.equal(decisionUrlOf(none.meta), undefined);
  assert.equal(withMeta(none, undefined).decisionUrl, undefined);
  const bad = withMeta(none, { "io.hitlp/decisionUrl": 42 });
  assert.equal(bad.decisionUrl, undefined);
  assert.equal(decisionUrlOf(bad.meta), undefined);
});

async function driveInputRequired(script: ("working" | "input_required" | "completed")[], startOn?: "input_required") {
  const t = new FakeTransport();
  const client = new HitlpClient(t, { sleep: fakeClock().sleep });
  const req = ask();
  let task: Task = await client.ask(req);
  const url = "https://example.test/d/1";
  const apply = (s: string) => {
    if (s === "completed") t.complete(task.taskId, { idempotencyKey: req.idempotencyKey, primitive: "ask", outcome: "answered", answer: "EUR", decidedBy: { type: "human", id: "h1" }, decidedAt: "2026-10-08T15:20:00Z" });
    else {
      t.setStatus(task.taskId, s as "working");
      t.setMeta(task.taskId, s === "input_required" ? { "io.hitlp/decisionUrl": url } : undefined);
    }
  };
  if (startOn) {
    apply(startOn);
    task = await client.get(task.taskId);
  }
  const seen: { task: Task; polls: number }[] = [];
  let polls = 0;
  const origGet = t.getTask.bind(t);
  t.getTask = async (id) => {
    apply(script[polls++] ?? "completed");
    return origGet(id);
  };
  const done = await client.waitForTerminal(task, { onInputRequired: (x) => void seen.push({ task: x, polls }) });
  assert.equal(done.status, "completed");
  return { seen, url };
}

test("onInputRequired fires once per entry, not per poll", async () => {
  const { seen, url } = await driveInputRequired(["working", "input_required", "input_required", "input_required", "completed"]);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].task.decisionUrl, url);
  assert.deepEqual(seen[0].task.meta, { "io.hitlp/decisionUrl": url });
});

test("onInputRequired fires again after leaving and re-entering input_required", async () => {
  const { seen, url } = await driveInputRequired(["input_required", "input_required", "working", "input_required", "completed"]);
  assert.equal(seen.length, 2);
  assert.ok(seen.every((s) => s.task.decisionUrl === url));
});

test("onInputRequired fires before the first re-poll when the wait starts on input_required", async () => {
  const { seen } = await driveInputRequired(["input_required", "input_required", "completed"], "input_required");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].polls, 0);
});
