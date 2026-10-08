import { test } from "node:test";
import assert from "node:assert/strict";
import { answerOf, buildApprove, buildAsk, HitlpClient, isApproved, ReservedToolError, type Task } from "../src";
import { McpTaskTransport } from "../src/mcp";
import { startTestMcpServer } from "./support/mcp-server";

const ask = () =>
  buildAsk({ deadline: "2026-10-09T09:00:00Z", defaultOnTimeout: "reject", question: "Which currency?", responseSchema: { type: "string" } });
const approve = () =>
  buildApprove({ deadline: "2026-10-15T12:00:00Z", action: "deploy", payload: { v: 1 }, payloadDigest: "sha256:aa" });

async function setup() {
  const server = await startTestMcpServer();
  const transport = new McpTaskTransport(server.client);
  const slept: number[] = [];
  const client = new HitlpClient(transport, {
    sleep: async (ms) => {
      slept.push(ms);
      await new Promise((r) => setTimeout(r, 1));
    },
  });
  return { server, transport, client, slept };
}

test("Ask round trip over MCP Tasks", async () => {
  const { server, client, slept } = await setup();
  try {
    const req = ask();
    const task = await client.ask(req);
    assert.equal(task.status, "working");
    assert.equal(task.pollInterval, 10);
    assert.equal(server.calls[0].name, "human.ask");
    assert.equal(server.calls[0].args.idempotencyKey, req.idempotencyKey);
    setTimeout(() => {
      void server.decide(task.taskId, { idempotencyKey: req.idempotencyKey, primitive: "ask", outcome: "answered", answer: "EUR", decidedBy: { type: "human", id: "h1" }, decidedAt: "2026-10-08T15:20:00Z" });
    }, 20);
    const done = await client.waitForTerminal(task);
    assert.equal(done.status, "completed");
    assert.equal(answerOf(done.result), "EUR");
    assert.equal(done.result?.requestId, task.taskId);
    assert.ok(slept.length > 0 && slept.every((ms) => ms >= 10));
  } finally {
    await server.close();
  }
});

for (const outcome of ["approved", "rejected"] as const) {
  test(`Approve round trip over MCP Tasks: ${outcome}`, async () => {
    const { server, client } = await setup();
    try {
      const req = approve();
      const task = await client.approve(req);
      assert.equal(server.calls[0].name, "human.approve");
      await server.decide(task.taskId, { idempotencyKey: req.idempotencyKey, primitive: "approve", outcome, payloadDigest: "sha256:aa", decidedBy: { type: "human", id: "h2" }, decidedAt: "2026-10-08T15:21:00Z" });
      const done = await client.waitForTerminal(task);
      assert.equal(done.result?.outcome, outcome);
      assert.equal(isApproved(done.result, req), outcome === "approved");
    } finally {
      await server.close();
    }
  });
}

test("cancel maps to tasks/cancel", async () => {
  const { server, client } = await setup();
  try {
    const task = await client.ask(ask());
    const cancelled: Task = await client.cancel(task.taskId);
    assert.equal(cancelled.status, "cancelled");
    const again = await client.get(task.taskId);
    assert.equal(again.status, "cancelled");
    assert.equal(again.result, undefined);
  } finally {
    await server.close();
  }
});

test("reserved tools are refused before reaching the server", async () => {
  const { server, transport } = await setup();
  try {
    await assert.rejects(transport.callTool("human.do" as never, {}), ReservedToolError);
    assert.equal(server.calls.length, 0);
  } finally {
    await server.close();
  }
});
