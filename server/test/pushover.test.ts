import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { buildApprove } from "@codefrak/hitlp";
import { PushoverSender, wirePush, wirePushover, type Device, type PushSender, type StoredTask } from "../src";
import { T0 } from "./support/harness";
import { APPROVERS, startSurface } from "./support/surface";

const deadline = new Date(T0 + 3_600_000).toISOString();
const settle = () => new Promise((r) => setTimeout(r, 50));

/** A fake messages endpoint: records each form, answers `status`. */
async function fakePushover(status = 200): Promise<{ url: string; got: Record<string, string>[]; close(): Promise<void> }> {
  const got: Record<string, string>[] = [];
  const srv: Server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      got.push(Object.fromEntries(new URLSearchParams(body)));
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify({ status: status === 200 ? 1 : 0 }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/1/messages.json`, got, close: () => new Promise((r) => srv.close(() => r())) };
}

const profiles = () => APPROVERS.map((a) => ({ id: a.id, roles: a.roles ?? [], capabilities: a.capabilities ?? [] }));

test("pushover: title, task id, link and priority; never payload, why or other request fields", async () => {
  const fake = await fakePushover();
  const s = await startSurface();
  try {
    wirePushover(s.h.server, new PushoverSender({ token: "app-tok", user: "user-key", pageUrl: "https://hitlp.example/", endpoint: fake.url }), profiles);
    const agent = await s.h.connect("token-a");
    const req = buildApprove({ deadline, action: "run on pve3", payload: { command: "rm -rf SECRET-CMD" }, payloadDigest: "sha256:aa", why: "SECRET-WHY" } as any);
    const task = await agent.hitlp.approve(req);
    await agent.hitlp.approve(req);
    await settle();
    assert.equal(fake.got.length, 1);
    const m = fake.got[0];
    assert.equal(m.token, "app-tok");
    assert.equal(m.user, "user-key");
    assert.equal(m.title, "Approve: run on pve3");
    assert.ok(m.message.includes(task.taskId));
    assert.equal(m.url, `https://hitlp.example/decide/${task.taskId}`);
    assert.ok(m.url_title);
    assert.equal(m.priority, "1");
    assert.deepEqual(Object.keys(m).sort(), ["message", "priority", "title", "token", "url", "url_title", "user"]);
    assert.ok(!JSON.stringify(m).includes("SECRET"));
  } finally {
    await s.stop();
    await fake.close();
  }
});

test("pushover: no link without a page URL, priority configurable, nothing for an unrouted task", async () => {
  const fake = await fakePushover();
  const s = await startSurface();
  try {
    wirePushover(s.h.server, new PushoverSender({ token: "t", user: "u", approvePriority: 0, endpoint: fake.url }), profiles);
    const agent = await s.h.connect("token-a");
    await agent.hitlp.approve(buildApprove({ deadline, action: "deploy", payload: {}, payloadDigest: "sha256:bb" }));
    await agent.hitlp.approve(buildApprove({ deadline, action: "nobody", payload: {}, payloadDigest: "sha256:cc", requires: { roles: ["no-such-role"] } }));
    await settle();
    assert.equal(fake.got.length, 1);
    assert.equal(fake.got[0].priority, "0");
    assert.equal(fake.got[0].url, undefined);
  } finally {
    await s.stop();
    await fake.close();
  }
});

test("pushover: beside APNs both send; a Pushover failure is logged and task creation succeeds", async () => {
  const fake = await fakePushover(500);
  const s = await startSurface();
  try {
    const apns: string[] = [];
    const sender: PushSender = { send: async (_d: Device, t: StoredTask) => (apns.push(t.id), "sent") };
    wirePush(s.h.server, s.surfaces, s.h.rules, sender);
    const logs: string[] = [];
    wirePushover(s.h.server, new PushoverSender({ token: "t", user: "u", endpoint: fake.url, log: (l) => logs.push(l) }), profiles);
    const down = new PushoverSender({ token: "t", user: "u", endpoint: "http://127.0.0.1:1/x", log: (l) => logs.push(l) });
    wirePushover(s.h.server, down);
    assert.equal((await s.call("sf-alice-phone", "/devices/p1", { method: "PUT", body: { platform: "apns", token: "tok" } })).status, 200);
    const agent = await s.h.connect("token-a");
    const task = await agent.hitlp.approve(buildApprove({ deadline, action: "deploy", payload: {}, payloadDigest: "sha256:dd" }));
    assert.ok(task.taskId);
    await settle();
    await settle();
    assert.deepEqual(apns, [task.taskId]);
    assert.equal(fake.got.length, 1);
    assert.equal(logs.length, 2);
    assert.ok(logs.every((l) => l.includes(task.taskId)));
  } finally {
    await s.stop();
    await fake.close();
  }
});
