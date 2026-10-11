// HITLP 0.2 on the server: attested (R8), asserted kept as received (R10),
// standing rules as proxy layer 1 (R9) and records that name their layer (R11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, type DecisionRecord } from "@codefrak/hitlp";
import { DECISION_URL_META, matchRule, newRule, RuleError, validateRule, type Rule } from "../src";
import { startServer, T0 } from "./support/harness";

const deadline = new Date(T0 + 3_600_000).toISOString();
const key = () => `k-${Math.random().toString(36).slice(2)}`;

const asserted = {
  why: "the nightly deploy failed and the run wants to retry it",
  onBehalfOf: { kind: "run", id: "e921" },
  recommendation: { verdict: "allow", confidence: 0.91, by: { judge: "ops-judge", model: "m-1" }, reasons: ["same image", "green tests"] },
  lineage: [
    { kind: "ticket", claim: "issue #101 was authorized", source: { repo: "x/y", issue: 101 } },
    { kind: "run", claim: "run e921 started from it", by: "engine" },
  ],
  asOf: "2026-10-08T11:59:00Z",
};

const approveArgs = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: key(),
  deadline,
  defaultOnTimeout: "reject",
  action: "deploy",
  payload: { v: 1 },
  payloadDigest: "sha256:aa",
  ...over,
});

const askArgs = (over: Record<string, unknown> = {}) => ({
  idempotencyKey: key(),
  deadline,
  defaultOnTimeout: "reject",
  question: "Which currency?",
  responseSchema: { type: "string" },
  ...over,
});

const aliceRule = (over: Partial<Rule> = {}): Rule =>
  newRule(
    {
      human: "alice@example.com",
      conditions: [
        { path: "attested.requester", op: "eq", value: "client-a" },
        { path: "asserted.recommendation.verdict", op: "eq", value: "allow" },
        { path: "asserted.recommendation.confidence", op: "gte", value: 0.8 },
      ],
      outcome: "approve",
      ...over,
    },
    T0,
  );

function assertRecord(record: DecisionRecord | undefined): DecisionRecord {
  assert.ok(record, "no decision record");
  const check = validate(record.primitive === "ask" ? "ask.response" : "approve.response", record);
  assert.ok(check.valid, check.valid ? "" : check.errors.join("; "));
  return record;
}

test("R8: attested is filled from the authenticated client and carried by the record", async () => {
  const h = await startServer();
  try {
    const { transport } = await h.connect("token-a");
    const task = await transport.callTool("human.approve", approveArgs({ deadline: new Date(T0 + 1000).toISOString() }));
    const stored = h.server.store.getById(task.taskId)!;
    assert.deepEqual(stored.request.attested, { requester: "client-a", by: "hitlp-server" });
    h.clock.advance(2000);
    const done = h.server.getTask(task.taskId)!;
    const record = assertRecord(done.result);
    assert.equal(record.decidedBy.type, "policy");
    assert.deepEqual(record.attested, { requester: "client-a", by: "hitlp-server" });
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R8: onBehalfOf is attested only when the credential carries it", async () => {
  const h = await startServer();
  try {
    Object.assign(h.auth, { onBehalfOf: (token: string | undefined) => (token === "token-a" ? { kind: "run", id: "r-7" } : undefined) });
    const { transport } = await h.connect("token-a");
    const task = await transport.callTool("human.approve", approveArgs({ asserted: { onBehalfOf: { kind: "run", id: "forged" } } }));
    assert.deepEqual(h.server.store.getById(task.taskId)!.request.attested, { requester: "client-a", by: "hitlp-server", onBehalfOf: { kind: "run", id: "r-7" } });
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R8: a sent attested is dropped, even one the schema would refuse", async () => {
  const h = await startServer();
  try {
    const { transport } = await h.connect("token-a");
    const one = await transport.callTool("human.approve", approveArgs({ attested: { requester: "root", by: "me" } }));
    assert.deepEqual(h.server.store.getById(one.taskId)!.request.attested, { requester: "client-a", by: "hitlp-server" });
    const two = await transport.callTool("human.approve", approveArgs({ attested: { anything: true } }));
    assert.deepEqual(h.server.store.getById(two.taskId)!.request.attested, { requester: "client-a", by: "hitlp-server" });
    assert.doesNotMatch(JSON.stringify(h.server.store.getById(one.taskId)), /root/);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R10: asserted and requiresHuman are kept exactly as received", async () => {
  const h = await startServer();
  try {
    const { transport } = await h.connect("token-a");
    const task = await transport.callTool("human.approve", approveArgs({ asserted, requiresHuman: true }));
    const stored = h.server.store.getById(task.taskId)!;
    assert.equal(JSON.stringify(stored.request.asserted), JSON.stringify(asserted));
    assert.equal(stored.request.requiresHuman, true);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R4: a repeat differing only in attested names the same task; one differing in asserted is refused; neither notifies", async () => {
  const h = await startServer();
  try {
    const { transport } = await h.connect("token-a");
    const args = approveArgs({ asserted });
    const one = await transport.callTool("human.approve", args);
    const two = await transport.callTool("human.approve", { ...args, attested: { requester: "root", by: "me" } });
    assert.equal(two.taskId, one.taskId);
    await assert.rejects(transport.callTool("human.approve", { ...args, asserted: { ...asserted, why: "other" } }), /different request content/);
    assert.equal(h.notified.length, 1);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R9: a matching rule decides an Approve before any human is notified; the record names it", async () => {
  const rule = aliceRule();
  const h = await startServer(undefined, { withRules: true, decisionUrl: (id) => `http://page/decide/${id}` });
  try {
    h.rules.saveRule(rule);
    const { transport } = await h.connect("token-a");
    const args = approveArgs({ asserted });
    const task = await transport.callTool("human.approve", args);
    assert.equal(task.status, "completed");
    const record = assertRecord(h.server.store.getById(task.taskId)!.result);
    assert.equal(record.outcome, "approved");
    assert.deepEqual(record.decidedBy, { type: "rule", id: rule.id });
    assert.equal(record.channel, undefined);
    assert.deepEqual(record.attested, { requester: "client-a", by: "hitlp-server" });
    assert.deepEqual(record.recommendation, asserted.recommendation);
    assert.equal(h.notified.length, 0);

    // R4 runs first: a repeat returns the decided task and notifies nobody.
    assert.equal((await transport.callTool("human.approve", { ...args })).taskId, task.taskId);
    assert.equal(h.notified.length, 0);

    const human = await transport.callTool("human.approve", approveArgs({ asserted, requiresHuman: true }));
    assert.equal(human.status, "input_required");
    assert.equal(h.server.store.getById(human.taskId)!.meta?.[DECISION_URL_META], `http://page/decide/${human.taskId}`);
    assert.equal(h.notified.length, 1);

    const low = await transport.callTool("human.approve", approveArgs({ asserted: { recommendation: { verdict: "allow", confidence: 0.5 } } }));
    assert.equal(low.status, "input_required");
    const other = await (await h.connect("token-b")).transport.callTool("human.approve", approveArgs({ asserted }));
    assert.equal(other.status, "input_required");
    assert.equal(h.notified.length, 3);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R9: an answer rule decides a matching Ask", async () => {
  const rule = newRule({ human: "alice@example.com", conditions: [{ path: "attested.requester", op: "in", value: ["client-a", "client-c"] }], outcome: "answer", answer: "EUR" }, T0);
  const h = await startServer(undefined, { withRules: true });
  try {
    h.rules.saveRule(rule);
    const { transport } = await h.connect("token-a");
    const task = await transport.callTool("human.ask", askArgs());
    const record = assertRecord(h.server.store.getById(task.taskId)!.result);
    assert.equal(record.outcome, "answered");
    assert.equal(record.answer, "EUR");
    assert.deepEqual(record.decidedBy, { type: "rule", id: rule.id });
    assert.equal(h.notified.length, 0);
    // An approve outcome never decides an Ask, nor an answer rule an Approve.
    const approve = await transport.callTool("human.approve", approveArgs());
    assert.notEqual(approve.status, "completed");
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R9: the cap (R6) runs before the rules: a refused scope is never decided by a rule", async () => {
  const h = await startServer(undefined, { withRules: true });
  try {
    h.rules.saveRule(aliceRule());
    const { transport } = await h.connect("token-a");
    await assert.rejects(transport.callTool("human.approve", approveArgs({ asserted, scope: {} })));
    assert.equal(h.server.store.list("client-a").length, 0);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R9: a rule naming any field outside attested and asserted.recommendation is refused, naming it", () => {
  for (const path of ["asserted.why", "asserted.lineage", "asserted.asOf", "asserted.onBehalfOf.id", "asserted", "payload", "context.summary", "action", "attested.__proto__", "requiresHuman"]) {
    assert.throws(() => validateRule({ human: "h", conditions: [{ path, op: "eq", value: 1 }], outcome: "approve" }), (e: Error) => e instanceof RuleError && e.message.includes(path), path);
  }
  assert.throws(() => validateRule({ human: "h", conditions: [{ path: "asserted.recommendation.verdict", op: "gte", value: "x" }], outcome: "approve" }), RuleError);
  assert.throws(() => validateRule({ human: "h", conditions: [{ path: "attested.requester", op: "eq", value: "a" }], outcome: "answer" }), RuleError);
  assert.ok(validateRule({ human: "h", conditions: [{ path: "asserted.recommendation.by.judge", op: "eq", value: "j" }], outcome: "reject" }));
});

test("R9: a rule sees only attested and the recommendation, and decides only for a human who meets requires", () => {
  const rule = newRule({ human: "alice", conditions: [{ path: "attested.requester", op: "eq", value: "client-a" }], outcome: "approve" }, T0);
  const task = (request: Record<string, unknown>) => ({ primitive: "approve", request: { attested: { requester: "client-a", by: "hitlp-server" }, ...request } }) as never;
  assert.equal(matchRule(task({}), [rule])?.id, rule.id);
  assert.equal(matchRule(task({ requiresHuman: true }), [rule]), undefined);
  const forged = { ...rule, conditions: [{ path: "payload.v", op: "eq" as const, value: 1 }] };
  assert.equal(matchRule(task({ payload: { v: 1 } }), [forged]), undefined);
  const requires = task({ requires: { roles: ["ops"] } });
  assert.equal(matchRule(requires, [rule]), undefined);
  assert.equal(matchRule(requires, [rule], () => ({ id: "alice", roles: [], capabilities: [] })), undefined);
  assert.equal(matchRule(requires, [rule], () => ({ id: "alice", roles: ["ops"], capabilities: [] }))?.id, rule.id);
});
