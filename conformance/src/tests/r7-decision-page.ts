// R7 / spec 7.6: an Approve's decision lands on a server-hosted page behind
// the server's own human authentication, which the agent cannot reach.
import { assert, type Context, type Test } from "../context";
import type { Json, Session } from "../client";

const DECISION_URL = "io.hitlp/decisionUrl";

async function urlModeApprove(ctx: Context): Promise<{ s: Session; task: Json; url: string }> {
  const s = await ctx.agent();
  const task = await ctx.call(s, "human.approve", ctx.approve());
  const got = await ctx.get(s, task.taskId);
  assert(got.status === "input_required", `a URL-mode Approve is ${got.status}, expected input_required`);
  const url = got._meta?.[DECISION_URL];
  assert(typeof url === "string" && /^https?:\/\//.test(url), `the task has no _meta["${DECISION_URL}"]`);
  assert(typeof got.statusMessage === "string" && got.statusMessage.includes(url), "statusMessage does not carry the decision URL");
  return { s, task, url };
}

async function stillWaiting(ctx: Context, s: Session, taskId: string, what: string): Promise<void> {
  const t = await ctx.get(s, taskId);
  assert(t.status === "input_required", `${what} moved the task to ${t.status}`);
}

/** The hidden fields of the page's form, as a browser would submit them. */
function hiddenFields(html: string): URLSearchParams {
  const f = new URLSearchParams();
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(m[0])?.[1];
    const value = /value="([^"]*)"/.exec(m[0])?.[1] ?? "";
    if (name) f.set(name, value);
  }
  return f;
}

async function login(ctx: Context, base: string, credential: string, next: string): Promise<string | undefined> {
  const { loginPath = "/login", field = "credential" } = ctx.config.approver;
  const body = new URLSearchParams({ [field]: credential, next });
  const res = await fetch(new URL(loginPath, base), { method: "POST", body, redirect: "manual" });
  const cookie = res.headers.get("set-cookie");
  return res.status < 400 && cookie ? cookie.split(";")[0] : undefined;
}

export const tests: Test[] = [
  {
    rule: "R7",
    name: "a URL-mode Approve waits in input_required with the decision URL in _meta and statusMessage",
    async run(ctx) {
      const { s, task } = await urlModeApprove(ctx);
      await stillWaiting(ctx, s, task.taskId, "polling");
    },
  },
  {
    rule: "R7",
    name: "the decision URL alone, or with the agent's bearer token, decides nothing",
    async run(ctx) {
      const { s, task, url } = await urlModeApprove(ctx);
      const bearer = { authorization: `Bearer ${ctx.config.agents[0]}` };
      const anon = await fetch(url, { redirect: "manual" });
      assert(!/value="approve"/.test(await anon.text()), "the page offers the decision without a login");
      const withToken = await fetch(url, { headers: bearer, redirect: "manual" });
      assert(withToken.status >= 400, `the page answered the agent's bearer token with ${withToken.status}`);
      const body = new URLSearchParams({ decision: "approve" });
      await fetch(url, { method: "POST", body, redirect: "manual" });
      await fetch(url, { method: "POST", body, headers: bearer, redirect: "manual" });
      await stillWaiting(ctx, s, task.taskId, "a POST without a human login");
      const agentLogin = await login(ctx, url, ctx.config.agents[0], new URL(url).pathname);
      assert(agentLogin === undefined, "the agent's token signs in to the decision page");
    },
  },
  {
    rule: "R7",
    name: "the client cannot supply the decision itself",
    async run(ctx) {
      const { s, task } = await urlModeApprove(ctx);
      await s.request("tasks/update", { taskId: task.taskId, result: { outcome: "approved" } }).catch(() => undefined);
      await ctx.call(s, "human.approve", { ...ctx.approve(), outcome: "approved" }).catch(() => undefined);
      await stillWaiting(ctx, s, task.taskId, "client-supplied decision content");
    },
  },
  {
    rule: "R7",
    name: "an approver signed in on the page decides; the record names a human and channel url",
    async run(ctx) {
      const { s, task, url } = await urlModeApprove(ctx);
      const path = new URL(url).pathname;
      const cookie = await login(ctx, url, ctx.config.approver.credential, path);
      assert(cookie, "the approver credential does not sign in");
      const pageRes = await fetch(url, { headers: { cookie }, redirect: "manual" });
      assert(pageRes.status === 200, `the decision page answered ${pageRes.status}`);
      const form = hiddenFields(await pageRes.text());
      form.set("decision", "approve");
      const post = await fetch(url, { method: "POST", body: form, headers: { cookie }, redirect: "manual" });
      assert(post.status < 400, `submitting the decision answered ${post.status}`);
      const done = await ctx.terminal(s, task.taskId, 10_000);
      assert(done.status === "completed", `the decided task is ${done.status}`);
      const record = await ctx.record(s, task.taskId);
      ctx.schemas.assert("approve.response", record, "the decision record");
      assert(record.outcome === "approved", `outcome ${record.outcome}, expected approved`);
      assert(record.decidedBy?.type === "human", `decidedBy.type ${record.decidedBy?.type}, expected human`);
      assert(record.channel === "url", `channel ${record.channel}, expected url`);
      const again = await fetch(url, { method: "POST", body: form, headers: { cookie }, redirect: "manual" });
      assert(again.status >= 400, "a second decision was accepted");
    },
  },
];
