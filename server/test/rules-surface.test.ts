// The /rules surface on the decision page: a human manages their own standing
// rules, an admin anyone's, and an agent token never manages any (R9, R7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DecisionPage, StaticAdminAuthenticator, StaticApproverAuthenticator, StaticTokenAuthenticator } from "../src";
import { startServer, TOKENS } from "./support/harness";

const APPROVERS = [
  { credential: "pw-alice", id: "alice@example.com", roles: [], capabilities: [] },
  { credential: "pw-bob", id: "bob@example.com", roles: [], capabilities: [] },
];
const RULE = {
  conditions: [
    { path: "attested.requester", op: "eq", value: "client-a" },
    { path: "asserted.recommendation.confidence", op: "gte", value: 0.8 },
  ],
  outcome: "approve",
};

async function setup() {
  const h = await startServer(undefined, { withRules: true });
  const page = new DecisionPage({
    server: h.server,
    humans: new StaticApproverAuthenticator(APPROVERS),
    agents: h.auth,
    admins: new StaticAdminAuthenticator([{ credential: "pw-admin", id: "admin" }]),
    rules: h.rules,
    secureCookie: false,
  });
  const base = await page.listen();
  const call = (method: string, path: string, credential?: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    h,
    call,
    async done() {
      await page.close();
      await h.stop();
      h.cleanup();
    },
  };
}

test("R9: an agent token cannot create, list or delete a rule", async () => {
  const { h, call, done } = await setup();
  try {
    const saved = ((await (await call("POST", "/rules", "pw-alice", RULE)).json()) as any);
    for (const token of Object.keys(TOKENS)) {
      assert.equal((await call("POST", "/rules", token, { ...RULE, human: "alice@example.com" })).status, 403);
      assert.equal((await call("GET", "/rules", token)).status, 403);
      assert.equal((await call("DELETE", `/rules/${saved.id}`, token)).status, 403);
    }
    assert.equal((await call("POST", "/rules", undefined, RULE)).status, 401);
    assert.equal((await call("POST", "/rules", "nobody", RULE)).status, 401);
    assert.deepEqual(h.rules.listRules().map((r) => r.id), [saved.id]);
  } finally {
    await done();
  }
});

test("R9: a human manages only their own rules; an admin manages anyone's", async () => {
  const { h, call, done } = await setup();
  try {
    const own = await call("POST", "/rules", "pw-alice", RULE);
    assert.equal(own.status, 201);
    const rule = (await own.json()) as any;
    assert.equal(rule.human, "alice@example.com");
    assert.match(rule.id, /^rule-/);
    assert.equal((await call("POST", "/rules", "pw-alice", { ...RULE, human: "bob@example.com" })).status, 403);
    assert.deepEqual((await ((await (await call("GET", "/rules", "pw-bob")).json()) as any)).rules, []);
    assert.equal((await call("DELETE", `/rules/${rule.id}`, "pw-bob")).status, 404);
    assert.equal((await call("POST", "/rules", "pw-admin", RULE)).status, 400);
    assert.equal((await call("POST", "/rules", "pw-admin", { ...RULE, human: "nobody@example.com" })).status, 400);
    assert.equal((await call("POST", "/rules", "pw-admin", { ...RULE, human: "bob@example.com" })).status, 201);
    assert.equal((await ((await (await call("GET", "/rules", "pw-admin")).json()) as any)).rules.length, 2);
    assert.equal((await call("DELETE", `/rules/${rule.id}`, "pw-alice")).status, 204);
    assert.deepEqual(h.rules.listRules().map((r) => r.human), ["bob@example.com"]);
  } finally {
    await done();
  }
});

test("R9: a rule on asserted.why, the lineage, the payload or context is refused, naming the field, and not stored", async () => {
  const { h, call, done } = await setup();
  try {
    for (const path of ["asserted.why", "asserted.lineage", "payload.v", "context.summary", "action"]) {
      const res = await call("POST", "/rules", "pw-alice", { ...RULE, conditions: [{ path, op: "eq", value: "x" }] });
      assert.equal(res.status, 400);
      assert.match(((await res.json()) as any).error, new RegExp(path.replace(".", "\\.")));
    }
    assert.equal(h.rules.listRules().length, 0);
  } finally {
    await done();
  }
});

test("R7: startup fails when an admin credential is also an agent token or an approver credential", async () => {
  const h = await startServer();
  try {
    const humans = new StaticApproverAuthenticator(APPROVERS);
    const agents = new StaticTokenAuthenticator(TOKENS);
    const admins = (credential: string) => new StaticAdminAuthenticator([{ credential, id: "admin" }]);
    assert.throws(() => new DecisionPage({ server: h.server, humans, agents, admins: admins("token-a") }), /agent token and an admin/);
    assert.throws(() => new DecisionPage({ server: h.server, humans, agents, admins: admins("pw-alice") }), /approver and an admin/);
  } finally {
    await h.stop();
    h.cleanup();
  }
});
