import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApprove } from "@codefrak/hitlp";
import { T0 } from "./support/harness";
import { startSurface } from "./support/surface";

const deadline = new Date(T0 + 3_600_000).toISOString();

/** Reads server-sent events until `count` `task` events arrived or `ms` passed. */
async function taskEvents(res: Response, count: number, ms: number): Promise<{ id: string; data: Record<string, unknown> }[]> {
  const reader = res.body!.getReader();
  const events: { id: string; data: Record<string, unknown> }[] = [];
  let buf = "";
  const stop = setTimeout(() => void reader.cancel(), ms);
  try {
    while (events.length < count) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!/^event: task$/m.test(block)) continue;
        events.push({ id: /^id: (.*)$/m.exec(block)![1], data: JSON.parse(/^data: (.*)$/m.exec(block)![1]) });
      }
    }
  } finally {
    clearTimeout(stop);
    await reader.cancel().catch(() => {});
  }
  return events;
}

test("surface events: a task created after the stream opened is delivered; an unrouted human's stream stays quiet", async () => {
  const s = await startSurface();
  try {
    const alice = await s.call("sf-alice-phone", "/events");
    const bob = await s.call("sf-bob-phone", "/events");
    assert.equal(alice.status, 200);
    assert.match(alice.headers.get("content-type") ?? "", /text\/event-stream/);
    const agent = await s.h.connect("token-a");
    const task = await agent.hitlp.approve(buildApprove({ deadline, action: "deploy", payload: { v: 1 }, payloadDigest: "sha256:aa", requires: { roles: ["release-manager"] } }));
    const [aliceEvents, bobEvents] = await Promise.all([taskEvents(alice, 1, 2000), taskEvents(bob, 1, 300)]);
    assert.equal(aliceEvents.length, 1);
    assert.equal(aliceEvents[0].id, task.taskId);
    assert.equal(aliceEvents[0].data.id, task.taskId);
    assert.deepEqual(aliceEvents[0].data.payload, { v: 1 });
    assert.deepEqual(bobEvents, []);
  } finally {
    await s.stop();
  }
});

test("surface events: an R4 repeat is not announced again", async () => {
  const s = await startSurface();
  try {
    const stream = await s.call("sf-alice-phone", "/events");
    const agent = await s.h.connect("token-a");
    const req = buildApprove({ deadline, action: "deploy", payload: { v: 1 }, payloadDigest: "sha256:aa" });
    await agent.hitlp.approve(req);
    await agent.hitlp.approve(req);
    assert.equal((await taskEvents(stream, 2, 500)).length, 1);
  } finally {
    await s.stop();
  }
});
