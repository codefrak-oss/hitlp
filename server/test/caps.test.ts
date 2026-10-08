import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApprove, buildAsk } from "@codefrak/hitlp";
import { startServer, T0 } from "./support/harness";

const HOUR = 3_600_000;
const far = new Date(T0 + 30 * 24 * HOUR).toISOString();

test("R6: a deadline beyond the per-primitive cap is clamped and the effective deadline reported in ttl", async () => {
  const h = await startServer();
  try {
    const { hitlp } = await h.connect("token-a");
    const approve = await hitlp.approve(buildApprove({ deadline: far, action: "deploy", payload: { v: 1 } }));
    assert.equal(approve.ttl, 24 * HOUR);
    const ask = await hitlp.ask(buildAsk({ deadline: far, defaultOnTimeout: "reject", question: "q", responseSchema: true }));
    assert.equal(ask.ttl, 7 * 24 * HOUR);
    h.clock.advance(24 * HOUR);
    assert.equal((await hitlp.get(approve.taskId)).status, "completed");
    assert.equal((await hitlp.get(ask.taskId)).status, "working");
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R6: caps are configurable, and a requested task ttl shorter than the deadline wins", async () => {
  const h = await startServer(undefined, { caps: { approve: HOUR } });
  try {
    const { hitlp, client } = await h.connect("token-a");
    const approve = await hitlp.approve(buildApprove({ deadline: far, action: "deploy", payload: { v: 1 } }));
    assert.equal(approve.ttl, HOUR);
    const res = (await client.request(
      { method: "tools/call", params: { name: "human.ask", arguments: buildAsk({ deadline: far, defaultOnTimeout: "reject", question: "q", responseSchema: true }) as never, task: { ttl: 5000 } } },
      (await import("@modelcontextprotocol/sdk/types.js")).CreateTaskResultSchema,
    )) as { task: { ttl: number } };
    assert.equal(res.task.ttl, 5000);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R6: blanket Approve scope is refused by default", async () => {
  const h = await startServer();
  try {
    const { hitlp } = await h.connect("token-a");
    const base = { deadline: far, action: "deploy", payload: { v: 1 } };
    await assert.rejects(hitlp.approve(buildApprove({ ...base, scope: { maxUses: 3 } })), /blanket approval refused.*notAfter/);
    await assert.rejects(hitlp.approve(buildApprove({ ...base, scope: { notAfter: far } })), /blanket approval refused.*maxUses/);
    const ok = await hitlp.approve(buildApprove({ ...base, scope: { maxUses: 3, notAfter: far } }));
    assert.equal(ok.status, "working");
    assert.equal(h.notified.length, 1);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R6: blanket Approve scope is accepted with allowBlanketScope", async () => {
  const h = await startServer(undefined, { allowBlanketScope: true });
  try {
    const { hitlp } = await h.connect("token-a");
    const t = await hitlp.approve(buildApprove({ deadline: far, action: "deploy", payload: { v: 1 }, scope: { maxUses: 3 } }));
    assert.equal(t.status, "working");
  } finally {
    await h.stop();
    h.cleanup();
  }
});
