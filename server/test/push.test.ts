import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { buildApprove } from "@codefrak/hitlp";
import { apnsJwt, NoopPushSender, pushContent, pushSenderFor, wirePush, type Device, type PushSender, type StoredTask } from "../src";
import { T0 } from "./support/harness";
import { startSurface } from "./support/surface";

const deadline = new Date(T0 + 3_600_000).toISOString();

class FakeSender implements PushSender {
  sent: { device: string; task: string }[] = [];
  gone = new Set<string>();
  async send(device: Device, task: StoredTask) {
    this.sent.push({ device: `${device.surfaceId}/${device.id}`, task: task.id });
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
