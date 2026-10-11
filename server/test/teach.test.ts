// Spec 5.5: an Approve offers teach options, the surface sends the human's choice
// with the decision, and the record carries it, validated but never interpreted.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApprove, validate } from "@codefrak/hitlp";
import { T0 } from "./support/harness";
import { startSurface, type SurfaceHarness } from "./support/surface";

const deadline = new Date(T0 + 3_600_000).toISOString();
const TEACH = {
  options: [
    { id: "always-allow", label: "Always allow commands like this", after: ["approve"], editable: { label: "Pattern", default: "ls *" } },
    { id: "never-allow", label: "Never allow this", after: ["reject"] },
  ],
};
const askRequest = (): Record<string, unknown> => ({ idempotencyKey: `ask-${Math.random()}`, deadline, defaultOnTimeout: "reject", question: "q?", responseSchema: { type: "string" } });
const approve = (teach: unknown = TEACH) => ({ ...buildApprove({ deadline, action: "run ls", payload: { cmd: "ls" } }), teach });

async function withSurface(fn: (s: SurfaceHarness, agent: Awaited<ReturnType<SurfaceHarness["h"]["connect"]>>) => Promise<void>): Promise<void> {
  const s = await startSurface();
  try {
    await fn(s, await s.h.connect("token-a"));
  } finally {
    await s.stop();
  }
}

const decide = (s: SurfaceHarness, id: string, body: unknown) => s.call("sf-alice-phone", `/tasks/${id}/decision`, { method: "POST", body });

test("teach: the task view carries the offered options as received", () =>
  withSurface(async (s, agent) => {
    const task = await agent.transport.callTool("human.approve", approve());
    const view = await (await s.call("sf-alice-phone", `/tasks/${task.taskId}`)).json();
    assert.deepEqual(view.teach, TEACH);
  }));

test("teach: the human's choice is stored in the record and returned by tasks/result", () =>
  withSurface(async (s, agent) => {
    const task = await agent.transport.callTool("human.approve", approve());
    const res = await decide(s, task.taskId, { outcome: "approve", teach: { option: "always-allow", text: "ls -la *" } });
    assert.equal(res.status, 200);
    const record = await res.json();
    assert.deepEqual(record.teach, { option: "always-allow", text: "ls -la *" });
    assert.equal(record.decidedBy.type, "human");
    assert.ok(validate("decision-record", record).valid);
    assert.deepEqual(((await agent.hitlp.get(task.taskId)).result as { teach?: unknown } | undefined)?.teach, { option: "always-allow", text: "ls -la *" });
  }));

test("teach: a non-editable option is stored without text; after reject only reject options", () =>
  withSurface(async (s, agent) => {
    const task = await agent.transport.callTool("human.approve", approve());
    const record = await (await decide(s, task.taskId, { outcome: "reject", reason: "no", teach: { option: "never-allow" } })).json();
    assert.equal(record.outcome, "rejected");
    assert.deepEqual(record.teach, { option: "never-allow" });
  }));

test("teach: just this once, or no choice, records no teach", () =>
  withSurface(async (s, agent) => {
    for (const body of [{ outcome: "approve", teach: { option: "once" } }, { outcome: "approve" }]) {
      const task = await agent.transport.callTool("human.approve", approve());
      const record = await (await decide(s, task.taskId, body)).json();
      assert.equal(record.outcome, "approved");
      assert.equal("teach" in record, false);
    }
  }));

test("teach: an unoffered, mismatched or malformed choice is refused with 400 and the task stays open", () =>
  withSurface(async (s, agent) => {
    const task = await agent.transport.callTool("human.approve", approve());
    for (const body of [
      { outcome: "approve", teach: { option: "made-up" } },
      { outcome: "approve", teach: { option: "never-allow" } },
      { outcome: "reject", teach: { option: "always-allow" } },
      { outcome: "reject", teach: { option: "never-allow", text: "x" } },
      { outcome: "approve", teach: { option: "once", text: "x" } },
      { outcome: "approve", teach: "always-allow" },
      { outcome: "approve", teach: { option: "always-allow", extra: 1 } },
    ]) {
      const res = await decide(s, task.taskId, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      await res.body?.cancel();
    }
    assert.equal((await agent.hitlp.get(task.taskId)).status, "working");
  }));

test("teach: a request without teach options takes no choice and behaves as before", () =>
  withSurface(async (s, agent) => {
    const task = await agent.transport.callTool("human.approve", { ...buildApprove({ deadline, action: "run ls", payload: { cmd: "ls" } }) });
    const view = await (await s.call("sf-alice-phone", `/tasks/${task.taskId}`)).json();
    assert.equal("teach" in view, false);
    const refused = await decide(s, task.taskId, { outcome: "approve", teach: { option: "always-allow" } });
    assert.equal(refused.status, 400);
    await refused.body?.cancel();
    const record = await (await decide(s, task.taskId, { outcome: "approve" })).json();
    assert.equal("teach" in record, false);
  }));

test("teach: an Ask takes no teach, and a request offering once or a duplicate id is refused", () =>
  withSurface(async (s, agent) => {
    await assert.rejects(agent.transport.callTool("human.ask", { ...askRequest(), teach: TEACH }), /Approve only/);
    await assert.rejects(agent.transport.callTool("human.approve", approve({ options: [{ id: "once", label: "x", after: ["approve"] }] })), /invalid/);
    await assert.rejects(agent.transport.callTool("human.approve", approve({ options: [TEACH.options[1], TEACH.options[1]] })), /twice/);
    const asked = await agent.transport.callTool("human.ask", askRequest());
    const res = await decide(s, asked.taskId, { answer: "a", teach: { option: "once" } });
    assert.equal(res.status, 400);
    await res.body?.cancel();
  }));

test("teach: a record from a rule, model or policy never validates with a teach choice", () => {
  const base = { requestId: "t", idempotencyKey: "k", primitive: "approve", outcome: "approved", decidedAt: deadline, teach: { option: "always-allow" } };
  assert.ok(validate("decision-record", { ...base, decidedBy: { type: "human", id: "h" } }).valid);
  for (const type of ["rule", "model", "policy"]) assert.equal(validate("decision-record", { ...base, decidedBy: { type } }).valid, false, type);
});
