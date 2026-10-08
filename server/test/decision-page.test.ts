import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApprove, buildAsk, isApproved } from "@codefrak/hitlp";
import { z } from "zod";
import { DECISION_URL_META, DecisionPage, StaticApproverAuthenticator, StaticTokenAuthenticator } from "../src";
import { startServer, T0, TOKENS } from "./support/harness";

const APPROVERS = [
  { credential: "pw-alice", id: "h-alice", roles: ["approver.production-deploy"], capabilities: ["ops"] },
  { credential: "pw-bob", id: "h-bob", roles: [], capabilities: ["ops"] },
];
const deadline = new Date(T0 + 3_600_000).toISOString();
const request = () =>
  buildApprove({ deadline, action: "deploy <prod>", payload: { v: 1, note: "<script>x</script>" }, payloadDigest: "sha256:aa", requires: { roles: ["approver.production-deploy"], capabilities: ["ops"] } });

async function withPage(fn: (ctx: Awaited<ReturnType<typeof setup>>) => Promise<void>): Promise<void> {
  const ctx = await setup();
  try {
    await fn(ctx);
  } finally {
    await ctx.page.close();
    await ctx.h.stop();
    ctx.h.cleanup();
  }
}

async function setup() {
  let base = "";
  const humans = new StaticApproverAuthenticator(APPROVERS);
  const h = await startServer(undefined, { decisionUrl: (id) => `${base}/decide/${id}` });
  const page = new DecisionPage({ server: h.server, humans, agents: h.auth, secureCookie: false });
  base = await page.listen();
  const agent = await h.connect("token-a");
  const req = request();
  const task = await agent.hitlp.approve(req);
  const url = `${base}/decide/${task.taskId}`;
  return { h, page, base, agent, req, task, url, humans };
}

async function login(base: string, credential: string): Promise<string> {
  const res = await fetch(`${base}/login`, { method: "POST", body: new URLSearchParams({ credential, next: "" }), redirect: "manual" });
  assert.equal(res.status, 303);
  const cookie = res.headers.get("set-cookie") ?? "";
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  return cookie.split(";")[0];
}

const field = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1] ?? "";

async function submit(url: string, cookie: string, fields: Record<string, string>) {
  return fetch(url, { method: "POST", headers: { cookie }, body: new URLSearchParams(fields), redirect: "manual" });
}

test("R7: URL-mode Approve is input_required with the URL in statusMessage and _meta", () =>
  withPage(async ({ agent, task, url, h }) => {
    assert.equal(task.status, "input_required");
    assert.equal(task.statusMessage, `Decision required: ${url}`);
    const raw = (await agent.client.request({ method: "tasks/get", params: { taskId: task.taskId } }, z.object({}).passthrough())) as Record<string, unknown>;
    assert.deepEqual(raw._meta, { [DECISION_URL_META]: url });
    assert.equal(h.notified[0].statusMessage, `Decision required: ${url}`);
    assert.equal((await agent.hitlp.get(task.taskId)).status, "input_required");
  }));

test("R7: the page needs a login cookie; the URL and agent or bearer tokens grant nothing", () =>
  withPage(async ({ url, base }) => {
    const anon = await fetch(url);
    assert.equal(anon.status, 401);
    assert.doesNotMatch(await anon.text(), /deploy/);
    assert.equal((await fetch(url, { headers: { authorization: "Bearer token-a" } })).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: "Bearer pw-alice" } })).status, 401);
    const cookie = await login(base, "pw-alice");
    assert.equal((await fetch(url, { headers: { cookie, authorization: "Bearer pw-alice" } })).status, 401);
    assert.equal((await fetch(`${base}/login`, { method: "POST", body: new URLSearchParams({ credential: "token-a" }) })).status, 401);
  }));

test("R7: startup fails when an approver credential is also an agent token", async () => {
  const h = await startServer();
  try {
    const humans = new StaticApproverAuthenticator([{ credential: Object.keys(TOKENS)[0], id: "h", roles: [], capabilities: [] }]);
    assert.throws(() => new DecisionPage({ server: h.server, humans, agents: new StaticTokenAuthenticator(TOKENS) }), /both an agent token and an approver/);
  } finally {
    await h.stop();
    h.cleanup();
  }
});

test("R7: an approver lacking a required role is refused at load and at submit", () =>
  withPage(async ({ url, base, h }) => {
    const alice = await login(base, "pw-alice");
    const csrfAlice = field(await (await fetch(url, { headers: { cookie: alice } })).text(), "csrf");
    const bob = await login(base, "pw-bob");
    const shown = await fetch(url, { headers: { cookie: bob } });
    assert.equal(shown.status, 403);
    assert.match(await shown.text(), /role approver\.production-deploy/);
    const res = await submit(url, bob, { csrf: csrfAlice, digest: "sha256:aa", decision: "approve" });
    assert.equal(res.status, 403);
    assert.equal(h.server.store.getById(url.split("/").pop()!)?.status, "input_required");
  }));

test("R7: a submit without a valid CSRF token is refused", () =>
  withPage(async ({ url, base, h, task }) => {
    const cookie = await login(base, "pw-alice");
    assert.equal((await submit(url, cookie, { digest: "sha256:aa", decision: "approve" })).status, 403);
    assert.equal((await submit(url, cookie, { csrf: "forged", digest: "sha256:aa", decision: "approve" })).status, 403);
    assert.equal(h.server.store.getById(task.taskId)?.status, "input_required");
  }));

test("R7: the human approves once on the page; the agent reads the record through tasks/get", () =>
  withPage(async ({ url, base, agent, task, req }) => {
    const cookie = await login(base, "pw-alice");
    const html = await (await fetch(url, { headers: { cookie } })).text();
    assert.match(html, /deploy &#60;prod&#62;/);
    assert.match(html, /&#60;script&#62;x&#60;\/script&#62;/);
    assert.doesNotMatch(html, /<script>/);
    const csrf = field(html, "csrf");
    assert.equal(field(html, "digest"), "sha256:aa");
    const res = await submit(url, cookie, { csrf, digest: "sha256:aa", decision: "approve", reason: "looks good" });
    assert.equal(res.status, 200);

    const done = await agent.hitlp.get(task.taskId);
    assert.equal(done.status, "completed");
    assert.equal(done.result?.outcome, "approved");
    assert.deepEqual(done.result?.decidedBy, { type: "human", id: "h-alice", roles: ["approver.production-deploy"] });
    assert.equal(done.result?.channel, "url");
    assert.equal(done.result?.payloadDigest, "sha256:aa");
    assert.equal(done.result?.reason, "looks good");
    assert.equal(isApproved(done.result, req), true);

    const again = await submit(url, cookie, { csrf, digest: "sha256:aa", decision: "reject" });
    assert.equal(again.status, 409);
    assert.equal((await agent.hitlp.get(task.taskId)).result?.outcome, "approved");
  }));

test("R7: a revoked approver's session stops working; an expired task cannot be decided", () =>
  withPage(async ({ url, base, h, humans, task }) => {
    const cookie = await login(base, "pw-alice");
    const csrf = field(await (await fetch(url, { headers: { cookie } })).text(), "csrf");
    humans.revoke("pw-alice");
    assert.equal((await fetch(url, { headers: { cookie } })).status, 401);
    humans.grant(APPROVERS[0]);
    h.clock.advance(3_600_000);
    assert.equal((await submit(url, cookie, { csrf, digest: "sha256:aa", decision: "approve" })).status, 409);
    const t = h.server.store.getById(task.taskId)!;
    assert.equal(t.status, "completed");
    assert.equal(t.result?.outcome, "rejected");
    assert.equal(t.result?.decidedBy.type, "policy");
  }));

async function withAsk(options: { label: string; value: unknown }[] | undefined, fn: (ctx: Awaited<ReturnType<typeof setup>> & { askId: string }) => Promise<void>): Promise<void> {
  return withPage(async (ctx) => {
    const ask = buildAsk({
      deadline,
      question: "Name <b>?</b>",
      defaultOnTimeout: "cancel",
      responseSchema: options ? { type: "integer" } : { type: "string", minLength: 1 },
      ...(options ? { options } : {}),
      requires: { roles: ["approver.production-deploy"] },
    });
    const t = await ctx.agent.hitlp.ask(ask);
    await fn({ ...ctx, askId: t.taskId, url: `${ctx.base}/decide/${t.taskId}` });
  });
}

test("Ask on the page: the human answers once; the agent reads the record", () =>
  withAsk(undefined, async ({ url, base, agent, askId }) => {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: "Bearer token-a" } })).status, 401);
    const cookie = await login(base, "pw-alice");
    const html = await (await fetch(url, { headers: { cookie } })).text();
    assert.match(html, /Name &#60;b&#62;\?&#60;\/b&#62;/);
    const csrf = field(html, "csrf");
    assert.equal((await submit(url, cookie, { answer: "Ada" })).status, 403);
    assert.equal((await submit(url, cookie, { csrf, answer: "Ada" })).status, 200);
    const done = await agent.hitlp.get(askId);
    assert.equal(done.status, "completed");
    assert.equal(done.result?.outcome, "answered");
    assert.equal(done.result?.answer, "Ada");
    assert.equal(done.result?.channel, "url");
    assert.deepEqual(done.result?.decidedBy, { type: "human", id: "h-alice", roles: ["approver.production-deploy"] });
    assert.equal((await submit(url, cookie, { csrf, answer: "Bob" })).status, 409);
    assert.equal((await agent.hitlp.get(askId)).result?.answer, "Ada");
  }));

test("Ask on the page: requires is enforced and an answer must be one of the options", () =>
  withAsk([{ label: "One", value: 1 }, { label: "Two", value: 2 }], async ({ url, base, agent, askId }) => {
    const bob = await login(base, "pw-bob");
    assert.equal((await fetch(url, { headers: { cookie: bob } })).status, 403);
    const cookie = await login(base, "pw-alice");
    const csrf = field(await (await fetch(url, { headers: { cookie } })).text(), "csrf");
    assert.equal((await submit(url, cookie, { csrf, option: "5" })).status, 400);
    assert.equal((await submit(url, cookie, { csrf, answer: "3" })).status, 400);
    assert.equal((await submit(url, cookie, { csrf, option: "1" })).status, 200);
    assert.equal((await agent.hitlp.get(askId)).result?.answer, 2);
  }));
