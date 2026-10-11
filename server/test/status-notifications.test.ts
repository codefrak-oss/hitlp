import { test } from "node:test";
import assert from "node:assert/strict";
import { TaskStatusNotificationSchema, type Task } from "@modelcontextprotocol/sdk/types.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { buildAsk } from "@codefrak/hitlp";
import { startServer, T0 } from "./support/harness";

const HOUR = 3_600_000;
const ask = () => buildAsk({ deadline: new Date(T0 + HOUR).toISOString(), defaultOnTimeout: "reject", question: "Which currency?", responseSchema: { type: "string" } });

/** Collects the status notifications `client` receives. */
function listen(client: Client): Task[] {
  const got: Task[] = [];
  client.setNotificationHandler(TaskStatusNotificationSchema, (n) => void got.push(n.params as Task));
  return got;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test("status notifications: a decision is pushed to the owner, without the record; another requester gets nothing", async () => {
  const h = await startServer();
  try {
    const a = await h.connect("token-a");
    const b = await h.connect("token-b");
    const aGot = listen(a.client);
    const bGot = listen(b.client);
    // b authenticates on its session, so the session carries b's notifications only.
    await b.hitlp.ask(ask());
    const task = await a.hitlp.ask(ask());
    h.server.decide(task.taskId, { outcome: "answered", answer: "EUR", decidedBy: { type: "human", id: "alice" }, decidedAt: new Date(T0).toISOString() });
    await settle();
    const mine = aGot.filter((t) => t.taskId === task.taskId);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].status, "completed");
    assert.equal("result" in mine[0], false);
    assert.equal(JSON.stringify(mine[0]).includes("EUR"), false);
    assert.deepEqual(bGot, []);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("status notifications: cancel and TTL expiry are terminal and always pushed", async () => {
  const h = await startServer();
  try {
    const a = await h.connect("token-a");
    const got = listen(a.client);
    const cancelled = await a.hitlp.ask(ask());
    await a.hitlp.cancel(cancelled.taskId);
    const expired = await a.hitlp.ask(ask());
    h.clock.advance(HOUR);
    assert.equal(h.server.sweep(), 1);
    await settle();
    assert.deepEqual(
      got.map((t) => [t.taskId, t.status]),
      [
        [cancelled.taskId, "cancelled"],
        [expired.taskId, "completed"],
      ],
    );
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("status notifications: a session no request authenticated on gets nothing", async () => {
  const h = await startServer();
  try {
    const a = await h.connect("token-a");
    const idle = await h.connect("token-a");
    const got = listen(idle.client);
    const task = await a.hitlp.ask(ask());
    await a.hitlp.cancel(task.taskId);
    await settle();
    assert.deepEqual(got, []);
  } finally {
    await h.stop();
    h.cleanup();
  }
});
