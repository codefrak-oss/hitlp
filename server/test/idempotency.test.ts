import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./support/harness";
import { ask } from "./support/requests";

test("R4: the same key and body return the same task and notify once", async () => {
  const h = await startServer();
  try {
    const { hitlp } = await h.connect("token-a");
    const req = ask("key-1");
    const one = await hitlp.ask(req);
    const two = await hitlp.ask({ ...req });
    assert.equal(two.taskId, one.taskId);
    assert.equal(h.notified.length, 1);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R4: the same key survives a restart", async () => {
  const first = await startServer();
  let second;
  try {
    const req = ask("key-r");
    const one = await (await first.connect("token-a")).hitlp.ask(req);
    await first.stop();
    second = await startServer(first.dbPath);
    const two = await (await second.connect("token-a")).hitlp.ask(req);
    assert.equal(two.taskId, one.taskId);
    assert.equal(second.notified.length, 0);
  } finally {
    await second?.stop();
    first.cleanup();
  }
});

test("R4: the same key with a different body is rejected", async () => {
  const h = await startServer();
  try {
    const { transport } = await h.connect("token-a");
    await transport.callTool("human.ask", { ...ask("key-2") });
    await assert.rejects(transport.callTool("human.ask", { ...ask("key-2", "Which language?") }), /different request content/);
    assert.equal(h.notified.length, 1);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R4: keys are scoped to the authenticated client", async () => {
  const h = await startServer();
  try {
    const a = await (await h.connect("token-a")).hitlp.ask(ask("shared"));
    const b = await (await h.connect("token-b")).hitlp.ask(ask("shared"));
    assert.notEqual(a.taskId, b.taskId);
    assert.equal(h.notified.length, 2);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("an invalid request is rejected and stores nothing", async () => {
  const h = await startServer();
  try {
    const { transport } = await h.connect("token-a");
    await assert.rejects(transport.callTool("human.ask", { question: "no envelope" }), /invalid human.ask request/);
    assert.equal(h.notified.length, 0);
  } finally {
    await h.stop();
    h.cleanup();
  }
});
