// R11 / spec 6: every decision record names the proxy layer that decided it in
// `decidedBy.type`, carries `attested`, and a rule's record names the rule.
import { assert, type Context, type Test } from "../context";
import type { Json } from "../client";
import { hiddenFields, login, urlModeApprove } from "./r7-decision-page";
import { recommended, withRule } from "./r9-rules";

function named(ctx: Context, record: Json, layer: string): void {
  ctx.schemas.assert(`${record.primitive}.response`, record, `the ${layer} decision record`);
  assert(record.decidedBy?.type === layer, `decidedBy.type ${record.decidedBy?.type}, expected ${layer}`);
  assert(record.attested?.requester === ctx.config.agentClients[0], `the ${layer} record's attested.requester is ${record.attested?.requester}`);
}

export const tests: Test[] = [
  {
    rule: "R11",
    name: "a policy decision at the deadline is named policy and carries attested and the recommendation",
    async run(ctx) {
      const s = await ctx.agent();
      const asserted = { recommendation: { verdict: "deny", confidence: 0.4 } };
      const task = await ctx.call(s, "human.approve", ctx.approve({ deadline: ctx.deadline(ctx.config.expiryMs ?? 2_000), asserted }));
      await ctx.terminal(s, task.taskId, (ctx.config.expiryMs ?? 2_000) + 30_000);
      const record = await ctx.record(s, task.taskId);
      named(ctx, record, "policy");
      assert(JSON.stringify(record.recommendation) === JSON.stringify(asserted.recommendation), "the record's recommendation is not the request's");
    },
  },
  {
    rule: "R11",
    name: "a human decision on the page is named human",
    async run(ctx) {
      const { s, task, url } = await urlModeApprove(ctx);
      const cookie = await login(ctx, url, ctx.config.approver.credential, new URL(url).pathname);
      assert(cookie, "the approver credential does not sign in");
      const form = hiddenFields(await (await fetch(url, { headers: { cookie }, redirect: "manual" })).text());
      form.set("decision", "reject");
      await fetch(url, { method: "POST", body: form, headers: { cookie }, redirect: "manual" });
      await ctx.terminal(s, task.taskId, 10_000);
      named(ctx, await ctx.record(s, task.taskId), "human");
    },
  },
  {
    rule: "R11",
    name: "a rule's decision of an Ask is named rule with the rule's id",
    async run(ctx) {
      await withRule(ctx, { outcome: "answer", answer: "EUR" }, async (rule, judge) => {
        const s = await ctx.agent();
        const task = await ctx.call(s, "human.ask", ctx.ask({ asserted: recommended(judge) }));
        await ctx.terminal(s, task.taskId, 10_000);
        const record = await ctx.record(s, task.taskId);
        named(ctx, record, "rule");
        assert(record.decidedBy.id === rule.id, `decidedBy.id ${record.decidedBy.id}, expected ${rule.id}`);
        assert(record.outcome === "answered" && record.answer === "EUR", `the rule answered ${record.outcome} ${JSON.stringify(record.answer)}`);
      });
    },
  },
];
