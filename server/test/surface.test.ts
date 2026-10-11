import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApprove, buildAsk, validate } from "@codefrak/hitlp";
import { assertSurfaceCredentialsDisjoint, StaticAdminAuthenticator, StaticApproverAuthenticator, StaticSurfaceAuthenticator, StaticTokenAuthenticator } from "../src";
import { T0 } from "./support/harness";
import { APPROVERS, SURFACES, startSurface, type SurfaceHarness } from "./support/surface";

const deadline = new Date(T0 + 3_600_000).toISOString();
const gated = () => buildApprove({ deadline, action: "deploy", payload: { v: 1, nested: { a: [1, 2] } }, payloadDigest: "sha256:aa", requires: { roles: ["release-manager"], capabilities: ["deploy"] } });

async function withSurface(fn: (s: SurfaceHarness, agent: Awaited<ReturnType<SurfaceHarness["h"]["connect"]>>) => Promise<void>): Promise<void> {
  const s = await startSurface();
  try {
    await fn(s, await s.h.connect("token-a"));
  } finally {
    await s.stop();
  }
}

test("surface: requester tokens, approver credentials and no credential are refused with 401", () =>
  withSurface(async (s) => {
    for (const cred of [undefined, "token-a", "pw-alice", "nope"]) {
      for (const path of ["/tasks", "/events", "/tasks/x", "/devices/d"]) {
        const res = await s.call(cred, path);
        assert.equal(res.status, 401, `${cred} on ${path}`);
        await res.body?.cancel();
      }
    }
  }));

test("surface: list and get show a routed task with attested, asserted, payload and deadline; an unrouted human sees nothing", () =>
  withSurface(async (s, agent) => {
    const task = await agent.transport.callTool("human.approve", {
      ...gated(),
      requiresHuman: true,
      attested: { requester: "forged", by: "me" },
      asserted: { why: "nightly", recommendation: { verdict: "allow", confidence: 0.9 }, lineage: [{ kind: "ticket", claim: "old" }, { kind: "run", claim: "new" }] },
    });
    const list = await (await s.call("sf-alice-phone", "/tasks")).json();
    assert.deepEqual(list.tasks.map((t: { id: string }) => t.id), [task.taskId]);
    const view = await (await s.call("sf-alice-phone", `/tasks/${task.taskId}`)).json();
    assert.equal(view.primitive, "approve");
    assert.equal(view.status, "working");
    assert.equal(view.requiresHuman, true);
    assert.equal(view.deadline, deadline);
    assert.deepEqual(view.payload, { v: 1, nested: { a: [1, 2] } });
    assert.equal(view.payloadDigest, "sha256:aa");
    assert.deepEqual(view.attested, { source: "server", requester: "client-a", by: view.attested.by });
    assert.equal(view.asserted.source, "requester");
    assert.equal(view.asserted.why, "nightly");
    assert.deepEqual(view.asserted.recommendation, { verdict: "allow", confidence: 0.9 });
    assert.deepEqual(view.asserted.lineage.map((l: { claim: string }) => l.claim), ["new", "old"]);
    // Bob lacks the role: the task is not listed, and is not found.
    assert.deepEqual((await (await s.call("sf-bob-phone", "/tasks")).json()).tasks, []);
    assert.equal((await s.call("sf-bob-phone", `/tasks/${task.taskId}`)).status, 404);
    const refused = await s.call("sf-bob-phone", `/tasks/${task.taskId}/decision`, { method: "POST", body: { outcome: "approve" } });
    assert.equal(refused.status, 404);
    assert.equal((await agent.hitlp.get(task.taskId)).status, "working");
  }));

test("surface: decide once through decideAsHuman; the record names the human, roles, channel and digest", () =>
  withSurface(async (s, agent) => {
    const task = await agent.hitlp.approve(gated());
    const res = await s.call("sf-alice-phone", `/tasks/${task.taskId}/decision`, { method: "POST", body: { outcome: "approve", reason: "looks right", payloadDigest: "sha256:aa" } });
    assert.equal(res.status, 200);
    const record = await res.json();
    assert.equal(record.outcome, "approved");
    assert.deepEqual(record.decidedBy, { type: "human", id: "h-alice", roles: ["release-manager"] });
    assert.equal(record.channel, "phone");
    assert.equal(record.payloadDigest, "sha256:aa");
    assert.equal(record.reason, "looks right");
    assert.equal(record.attested.requester, "client-a");
    assert.ok(validate("decision-record", record).valid);
    const again = await s.call("sf-alice-desktop", `/tasks/${task.taskId}/decision`, { method: "POST", body: { outcome: "reject" } });
    assert.equal(again.status, 409);
    const final = await agent.hitlp.get(task.taskId);
    assert.equal(final.status, "completed");
    assert.deepEqual(s.h.server.getTask(task.taskId)!.result, record);
    // Decided tasks stay in the list, with their record.
    const listed = (await (await s.call("sf-alice-desktop", "/tasks")).json()).tasks;
    assert.equal(listed[0].result.channel, "phone");
  }));

test("surface: a stale digest or a malformed decision is refused and decides nothing", () =>
  withSurface(async (s, agent) => {
    const task = await agent.hitlp.approve(gated());
    const path = `/tasks/${task.taskId}/decision`;
    assert.equal((await s.call("sf-alice-phone", path, { method: "POST", body: { outcome: "approve", payloadDigest: "sha256:bb" } })).status, 409);
    assert.equal((await s.call("sf-alice-phone", path, { method: "POST", body: { outcome: "approved" } })).status, 400);
    assert.equal((await s.call("sf-alice-phone", path, { method: "POST", body: [] })).status, 400);
    assert.equal(s.h.server.getTask(task.taskId)!.status, "working");
  }));

test("surface: an Ask answer is validated against responseSchema", () =>
  withSurface(async (s, agent) => {
    const task = await agent.hitlp.ask(
      buildAsk({ deadline, defaultOnTimeout: "reject", question: "How many?", responseSchema: { type: "integer", minimum: 1 } }),
    );
    const view = await (await s.call("sf-bob-phone", `/tasks/${task.taskId}`)).json();
    assert.deepEqual(view.responseSchema, { type: "integer", minimum: 1 });
    const path = `/tasks/${task.taskId}/decision`;
    assert.equal((await s.call("sf-bob-phone", path, { method: "POST", body: { answer: "three" } })).status, 400);
    assert.equal((await s.call("sf-bob-phone", path, { method: "POST", body: { answer: 0 } })).status, 400);
    assert.equal((await s.call("sf-bob-phone", path, { method: "POST", body: {} })).status, 400);
    const ok = await s.call("sf-bob-phone", path, { method: "POST", body: { answer: 3 } });
    assert.equal(ok.status, 200);
    const record = await ok.json();
    assert.equal(record.outcome, "answered");
    assert.equal(record.answer, 3);
    assert.equal(record.channel, "phone");
    assert.equal(record.decidedBy.id, "h-bob");
  }));

test("surface: every request re-resolves the credential; a revoked surface or human is refused next call", () =>
  withSurface(async (s) => {
    assert.equal((await s.call("sf-alice-phone", "/tasks")).status, 200);
    s.surfaces.revoke("sf-alice-phone");
    assert.equal((await s.call("sf-alice-phone", "/tasks")).status, 401);
    assert.equal((await s.call("sf-bob-phone", "/tasks")).status, 200);
    s.humans.revoke("pw-bob");
    assert.equal((await s.call("sf-bob-phone", "/tasks")).status, 401);
  }));

test("surface: devices are put and deleted per surface", () =>
  withSurface(async (s) => {
    const put = await s.call("sf-alice-phone", "/devices/iphone-1", { method: "PUT", body: { platform: "apns", token: "a1b2", environment: "sandbox" } });
    assert.equal(put.status, 200);
    assert.deepEqual({ ...(await put.json()), updatedAt: undefined }, { id: "iphone-1", surfaceId: "alice-phone", human: "h-alice", platform: "apns", token: "a1b2", environment: "sandbox", updatedAt: undefined });
    assert.equal(s.h.rules.devicesFor("h-alice").length, 1);
    assert.equal((await s.call("sf-alice-phone", "/devices/iphone-1", { method: "PUT", body: { platform: "apns" } })).status, 400);
    // Another surface cannot delete it.
    assert.equal((await s.call("sf-alice-desktop", "/devices/iphone-1", { method: "DELETE" })).status, 404);
    assert.equal((await s.call("sf-alice-phone", "/devices/iphone-1", { method: "DELETE" })).status, 204);
    assert.deepEqual(s.h.rules.devicesFor("h-alice"), []);
  }));

test("surface credentials must not be requester tokens, approver or admin credentials", () => {
  const humans = new StaticApproverAuthenticator(APPROVERS);
  const agents = new StaticTokenAuthenticator({ "token-a": "client-a" });
  assert.doesNotThrow(() => assertSurfaceCredentialsDisjoint(new StaticSurfaceAuthenticator(humans, SURFACES), agents, humans));
  const clash = (credential: string) => new StaticSurfaceAuthenticator(humans, [{ credential, id: "x", human: "h-alice", kind: "phone" }]);
  assert.throws(() => assertSurfaceCredentialsDisjoint(clash("token-a"), agents, humans), /requester token/);
  assert.throws(() => assertSurfaceCredentialsDisjoint(clash("pw-bob"), agents, humans), /approver credential/);
  const admins = new StaticAdminAuthenticator([{ credential: "adm", id: "root" }]);
  assert.throws(() => assertSurfaceCredentialsDisjoint(clash("adm"), agents, humans, admins), /admin credential/);
});
