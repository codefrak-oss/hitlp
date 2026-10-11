import { test } from "node:test";
import assert from "node:assert/strict";
import { answerOf, buildAsk, HitlpClient } from "../src";
import { McpTaskTransport } from "../src/mcp";
import { startTestMcpServer } from "./support/mcp-server";

const ask = () =>
  buildAsk({ deadline: "2026-10-09T09:00:00Z", defaultOnTimeout: "reject", question: "Which currency?", responseSchema: { type: "string" } });
const record = (key: string) => ({ idempotencyKey: key, primitive: "ask" as const, outcome: "answered" as const, answer: "EUR", decidedBy: { type: "human" as const, id: "h1" }, decidedAt: "2026-10-08T15:20:00Z" });

async function setup(notifications: boolean) {
  const server = await startTestMcpServer();
  const transport = new McpTaskTransport(server.client, { notifications });
  const slept: number[] = [];
  const client = new HitlpClient(transport, { sleep: async (ms) => {
      slept.push(ms);
      await new Promise((r) => setTimeout(r, 1));
    },
  });
  let gets = 0;
  const get = transport.getTask.bind(transport);
  transport.getTask = (id) => (gets++, get(id));
  return { server, transport, client, slept, gets: () => gets };
}

test("waitForTerminal with notifications: reconciles once, then reads only on a notification, never sleeping", async () => {
  const { server, client, slept, gets } = await setup(true);
  try {
    const req = ask();
    const task = await client.ask(req);
    const done = client.waitForTerminal(task);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(gets(), 1);
    await server.decide(task.taskId, record(req.idempotencyKey));
    await server.notifyStatus(task.taskId);
    const t = await done;
    assert.equal(t.status, "completed");
    assert.equal(answerOf(t.result), "EUR");
    assert.equal(gets(), 2);
    assert.deepEqual(slept, []);
  } finally {
    await server.close();
  }
});

test("waitForTerminal with notifications: a reconnect reconciles a decision whose notification was missed", async () => {
  const { server, transport, client, gets } = await setup(true);
  try {
    const req = ask();
    const task = await client.ask(req);
    const done = client.waitForTerminal(task);
    await new Promise((r) => setTimeout(r, 30));
    await server.decide(task.taskId, record(req.idempotencyKey));
    // Another task's notification does not wake the wait.
    const other = await client.ask(ask());
    await server.notifyStatus(other.taskId);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(gets(), 1);
    transport.reconnected();
    assert.equal((await done).status, "completed");
  } finally {
    await server.close();
  }
});

test("waitForTerminal without notifications falls back to polling at pollInterval", async () => {
  const { server, client, slept } = await setup(false);
  try {
    const req = ask();
    const task = await client.ask(req);
    setTimeout(() => void server.decide(task.taskId, record(req.idempotencyKey)), 20);
    assert.equal((await client.waitForTerminal(task)).status, "completed");
    assert.ok(slept.length > 0 && slept.every((ms) => ms >= 10));
  } finally {
    await server.close();
  }
});

test("waitForTerminal with notifications stops on abort", async () => {
  const { server, client } = await setup(true);
  try {
    const task = await client.ask(ask());
    const ac = new AbortController();
    const done = client.waitForTerminal(task, { signal: ac.signal });
    setTimeout(() => ac.abort(new Error("stop")), 20);
    await assert.rejects(done, /stop/);
  } finally {
    await server.close();
  }
});
