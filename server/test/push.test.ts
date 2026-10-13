import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { buildApprove } from "@codefrak/hitlp";
import { apnsJwt, apnsPush, newRule, NoopPushSender, pushContent, pushSenderFor, wirePush, type Device, type PushKind, type PushSender, type StoredTask } from "../src";
import { T0 } from "./support/harness";
import { startSurface } from "./support/surface";

const deadline = new Date(T0 + 3_600_000).toISOString();

class FakeSender implements PushSender {
  sent: { device: string; task: string; kind: PushKind }[] = [];
  gone = new Set<string>();
  async send(device: Device, task: StoredTask, kind: PushKind) {
    this.sent.push({ device: `${device.surfaceId}/${device.id}`, task: task.id, kind });
    return this.gone.has(device.id) ? ("gone" as const) : ("sent" as const);
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20));

test("push: one push per routed device per new task, none for an R4 duplicate, none for an unrouted human", async () => {
  const s = await startSurface();
  try {
    const sender = new FakeSender();
    wirePush(s.h.server, s.surfaces, s.h.rules, sender);
    for (const [cred, id] of [["sf-alice-phone", "p1"], ["sf-alice-desktop", "m1"], ["sf-bob-phone", "b1"]]) {
      assert.equal((await s.call(cred, `/devices/${id}`, { method: "PUT", body: { platform: "apns", token: `tok-${id}` } })).status, 200);
    }
    const agent = await s.h.connect("token-a");
    const req = buildApprove({ deadline, action: "deploy", payload: { v: 1 }, payloadDigest: "sha256:aa", requires: { roles: ["release-manager"] } });
    const task = await agent.hitlp.approve(req);
    await settle();
    assert.deepEqual(sender.sent.map((x) => x.device).sort(), ["alice-desktop/m1", "alice-phone/p1"]);
    assert.ok(sender.sent.every((x) => x.task === task.taskId));
    const again = await agent.hitlp.approve(req);
    assert.equal(again.taskId, task.taskId);
    await settle();
    assert.equal(sender.sent.length, 2);
    // A device APNs reports gone is dropped; a revoked surface's device gets nothing.
    sender.gone.add("m1");
    s.surfaces.revoke("sf-alice-phone");
    await agent.hitlp.approve(buildApprove({ deadline, action: "deploy 2", payload: { v: 2 }, payloadDigest: "sha256:bb" }));
    await settle();
    assert.deepEqual(sender.sent.slice(2).map((x) => x.device).sort(), ["alice-desktop/m1", "bob-phone/b1"]);
    assert.deepEqual(s.h.rules.listDevices().map((d) => d.id).sort(), ["b1", "p1"]);
  } finally {
    await s.stop();
  }
});

test("push: unconfigured APNs logs once and sends nothing", async () => {
  const logs: string[] = [];
  const sender = new NoopPushSender((m) => logs.push(m));
  const device = { id: "d", surfaceId: "s", human: "h", platform: "apns", token: "t", updatedAt: "" };
  assert.equal(await sender.send(), "failed");
  assert.equal(await sender.send(), "failed");
  assert.equal(logs.length, 1);
  assert.ok(pushSenderFor({ keyId: "k" }) instanceof NoopPushSender);
  void device;
});

test("push: the APNs provider token is an ES256 JWT with kid, iss and iat; the alert carries no payload", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwt = apnsJwt(privateKey, "KEY123", "TEAM45", 1_700_000_000_500);
  const [h, c, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "ES256", kid: "KEY123" });
  assert.deepEqual(JSON.parse(Buffer.from(c, "base64url").toString()), { iss: "TEAM45", iat: 1_700_000_000 });
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
  const content = pushContent({ id: "t1", primitive: "approve", request: { payload: { secret: "s3cret" }, action: "wire money" } } as unknown as StoredTask);
  assert.equal(JSON.stringify(content).includes("s3cret"), false);
  assert.equal(JSON.stringify(content).includes("wire money"), false);
  assert.equal(content.taskId, "t1");
});

const CONTENT = ["deploy", "s3cret", "wire money", "Which", "why-asserted"];

async function withDevices(fn: (s: Awaited<ReturnType<typeof startSurface>>, sender: FakeSender) => Promise<void>, options: Parameters<typeof startSurface>[0] = {}) {
  const s = await startSurface(options);
  try {
    const sender = new FakeSender();
    wirePush(s.h.server, s.surfaces, s.h.rules, sender);
    for (const [cred, id] of [["sf-alice-phone", "p1"], ["sf-alice-desktop", "m1"], ["sf-bob-phone", "b1"]]) {
      assert.equal((await s.call(cred, `/devices/${id}`, { method: "PUT", body: { platform: "apns", token: `tok-${id}` } })).status, 200);
    }
    await fn(s, sender);
  } finally {
    await s.stop();
  }
}

const closed = (sender: FakeSender) => sender.sent.filter((x) => x.kind === "closed");

test("push: deciding, cancelling and expiring a routed task each sends one closed push per routed device, naming only the task id", () =>
  withDevices(async (s, sender) => {
    const agent = await s.h.connect("token-a");
    const req = (action: string) => buildApprove({ deadline, action, payload: { secret: "s3cret" }, payloadDigest: "sha256:aa", requires: { roles: ["release-manager"] } });
    const decided = await agent.hitlp.approve(req("deploy a"));
    const cancelled = await agent.hitlp.approve(req("deploy b"));
    const expired = await agent.hitlp.approve(req("deploy c"));
    await settle();
    assert.equal(closed(sender).length, 0);
    const alice = s.humans.profile("h-alice")!;
    s.h.server.decideAsHuman(decided.taskId, alice, "surface", { outcome: "approved", payloadDigest: "sha256:aa" } as never);
    await agent.hitlp.cancel(cancelled.taskId);
    s.h.clock.advance(3_600_000);
    s.h.server.sweep();
    await settle();
    for (const id of [decided.taskId, cancelled.taskId, expired.taskId]) {
      assert.deepEqual(closed(sender).filter((x) => x.task === id).map((x) => x.device).sort(), ["alice-desktop/m1", "alice-phone/p1"]);
    }
    assert.equal(closed(sender).length, 6);
    // Nothing more once terminal; the closed payload names the task id and nothing of the request.
    s.h.server.sweep();
    await settle();
    assert.equal(closed(sender).length, 6);
    const task = s.h.server.store.getById(decided.taskId)!;
    const body = JSON.stringify(apnsPush(task, "closed"));
    for (const c of CONTENT) assert.equal(body.includes(c), false, c);
    assert.deepEqual(apnsPush(task, "closed").payload, { aps: { "content-available": 1 }, taskId: decided.taskId, event: "closed" });
    assert.equal(apnsPush(task, "closed").headers["apns-push-type"], "background");
  }));

test("push: no closed push for an R4 repeat or a task a standing rule decided", () =>
  withDevices(
    async (s, sender) => {
      s.h.rules.saveRule(newRule({ human: "h-alice", conditions: [{ path: "attested.requester", op: "eq", value: "client-a" }], outcome: "approve" }, T0));
      const agent = await s.h.connect("token-a");
      const ruled = await agent.hitlp.approve(buildApprove({ deadline, action: "deploy", payload: { v: 1 }, payloadDigest: "sha256:aa" }));
      assert.equal(ruled.status, "completed");
      const other = await s.h.connect("token-b");
      const req = buildApprove({ deadline, action: "deploy 2", payload: { v: 2 }, payloadDigest: "sha256:bb", requires: { roles: ["release-manager"] } });
      const task = await other.hitlp.approve(req);
      assert.equal((await other.hitlp.approve(req)).taskId, task.taskId);
      await other.hitlp.cancel(task.taskId);
      await settle();
      assert.equal(sender.sent.filter((x) => x.task === ruled.taskId).length, 0);
      assert.deepEqual(sender.sent.filter((x) => x.task === task.taskId).map((x) => x.kind).sort(), ["closed", "closed", "new", "new"]);
    },
    { withRules: true },
  ));

test("push: a device APNs reports gone on a closed push is dropped", () =>
  withDevices(async (s, sender) => {
    const agent = await s.h.connect("token-a");
    const task = await agent.hitlp.approve(buildApprove({ deadline, action: "deploy", payload: { v: 1 }, payloadDigest: "sha256:aa", requires: { roles: ["release-manager"] } }));
    await settle();
    sender.gone.add("p1");
    await agent.hitlp.cancel(task.taskId);
    await settle();
    assert.deepEqual(s.h.rules.listDevices().map((d) => d.id).sort(), ["b1", "m1"]);
  }));

test("push: an urgent task's alert is time-sensitive; a normal one's is unchanged", () => {
  const task = (priority?: string) => ({ id: "t1", primitive: "approve", request: { priority, action: "wire money" } }) as unknown as StoredTask;
  const normal = apnsPush(task("normal"), "new");
  assert.deepEqual(normal.payload, { aps: { alert: { title: "Approval requested", body: "A request is waiting for your decision." }, sound: "default", "thread-id": "hitlp" }, taskId: "t1" });
  assert.deepEqual(normal.headers, { "apns-push-type": "alert", "apns-priority": "10", "apns-collapse-id": "t1" });
  assert.deepEqual(apnsPush(task(), "new"), normal);
  assert.deepEqual(apnsPush(task("high"), "new"), normal);
  const urgent = apnsPush(task("urgent"), "new");
  const aps = urgent.payload.aps as Record<string, unknown>;
  assert.equal(aps["interruption-level"], "time-sensitive");
  assert.equal(aps.sound, "default");
  assert.equal(urgent.headers["apns-priority"], "10");
  assert.equal(JSON.stringify(urgent).includes("wire money"), false);
});
