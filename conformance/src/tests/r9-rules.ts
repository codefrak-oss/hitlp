// R9 / spec 3.1: standing rules read `attested` and `recommendation` only. A rule
// naming another field is refused when saved; a matching rule decides without a
// human and the record names it; `requiresHuman` bypasses every rule; an agent
// token never manages rules.
import { randomUUID } from "node:crypto";
import { assert, rulesCall, type Context, type Test } from "../context";
import type { Json, Session } from "../client";
import { urlModeApprove } from "./r7-decision-page";

/** The decision page's origin, learned from a URL-mode Approve's decision URL. */
export async function pageBase(ctx: Context): Promise<string> {
  const { url } = await urlModeApprove(ctx);
  return new URL(url).origin;
}

/** Saves a rule matching agent 0's requests whose recommendation names a fresh judge, so no other test trips it. */
export async function withRule(ctx: Context, outcome: Json, fn: (rule: Json, judge: string, base: string) => Promise<void>): Promise<void> {
  const base = await pageBase(ctx);
  const judge = `conformance-judge-${randomUUID()}`;
  const body = {
    human: ctx.config.rules.human,
    conditions: [
      { path: "attested.requester", op: "eq", value: ctx.config.agentClients[0] },
      { path: "asserted.recommendation.by.judge", op: "eq", value: judge },
      { path: "asserted.recommendation.verdict", op: "eq", value: "allow" },
      { path: "asserted.recommendation.confidence", op: "gte", value: 0.8 },
    ],
    ...outcome,
  };
  const saved = await rulesCall(ctx, base, "POST", "", ctx.config.rules.credential, body);
  assert(saved.status < 300 && typeof saved.json?.id === "string", `saving a valid rule answered ${saved.status}: ${JSON.stringify(saved.json)}`);
  try {
    await fn(saved.json!, judge, base);
  } finally {
    await rulesCall(ctx, base, "DELETE", `/${saved.json!.id}`, ctx.config.rules.credential);
  }
}

export const recommended = (judge: string) => ({ recommendation: { verdict: "allow", confidence: 0.9, by: { judge }, reasons: ["conformance"] } });

async function decidedByRule(ctx: Context, s: Session, taskId: string, ruleId: string): Promise<Json> {
  const done = await ctx.terminal(s, taskId, 10_000);
  assert(done.status === "completed", `the rule-matched task is ${done.status}`);
  const record = await ctx.record(s, taskId);
  assert(record.decidedBy?.type === "rule", `decidedBy.type ${record.decidedBy?.type}, expected rule`);
  assert(record.decidedBy?.id === ruleId, `decidedBy.id ${record.decidedBy?.id}, expected ${ruleId}`);
  assert(record.channel === undefined, `a rule's record has channel ${record.channel}`);
  return record;
}

export const tests: Test[] = [
  {
    rule: "R9",
    name: "a rule naming asserted.why, the lineage, the payload or context is refused when saved",
    async run(ctx) {
      const base = await pageBase(ctx);
      for (const path of ["asserted.why", "asserted.lineage", "payload", "context.summary"]) {
        const res = await rulesCall(ctx, base, "POST", "", ctx.config.rules.credential, {
          human: ctx.config.rules.human,
          conditions: [{ path, op: "eq", value: "x" }],
          outcome: "approve",
        });
        assert(res.status >= 400 && res.status < 500, `a rule on ${path} answered ${res.status}`);
        assert(JSON.stringify(res.json ?? "").includes(path), `the refusal of a rule on ${path} does not name it`);
      }
      const list = await rulesCall(ctx, base, "GET", "", ctx.config.rules.credential);
      const stored = JSON.stringify(list.json ?? "");
      assert(!/asserted\.why|asserted\.lineage|"payload"|context\.summary/.test(stored), "a refused rule was stored");
    },
  },
  {
    rule: "R9",
    name: "an agent token cannot create, list or delete rules",
    async run(ctx) {
      await withRule(ctx, { outcome: "approve" }, async (rule, _judge, base) => {
        for (const token of ctx.config.agents) {
          const made = await rulesCall(ctx, base, "POST", "", token, { human: ctx.config.rules.human, conditions: [{ path: "attested.requester", op: "eq", value: "x" }], outcome: "approve" });
          assert(made.status >= 400, `an agent token created a rule (${made.status})`);
          const gone = await rulesCall(ctx, base, "DELETE", `/${rule.id}`, token);
          assert(gone.status >= 400, `an agent token deleted a rule (${gone.status})`);
        }
        const still = await rulesCall(ctx, base, "GET", "", ctx.config.rules.credential);
        assert(JSON.stringify(still.json).includes(rule.id), "the rule is gone after an agent's delete");
      });
    },
  },
  {
    rule: "R9",
    name: "a matching rule decides an Approve without a human; the record names the rule",
    async run(ctx) {
      await withRule(ctx, { outcome: "approve" }, async (rule, judge) => {
        const s = await ctx.agent();
        const asserted = recommended(judge);
        const task = await ctx.call(s, "human.approve", ctx.approve({ asserted }));
        const record = await decidedByRule(ctx, s, task.taskId, rule.id);
        ctx.schemas.assert("approve.response", record, "the rule's decision record");
        assert(record.outcome === "approved", `outcome ${record.outcome}, expected approved`);
        assert(JSON.stringify(record.recommendation) === JSON.stringify(asserted.recommendation), "the record's recommendation is not the request's");
        const other = await ctx.call(await ctx.agent(1), "human.approve", ctx.approve({ asserted }));
        assert(other.status === "input_required", `another client's request was ${other.status}: the rule matched a requester it does not name`);
      });
    },
  },
  {
    rule: "R9",
    name: "requiresHuman bypasses a matching rule",
    async run(ctx) {
      await withRule(ctx, { outcome: "approve" }, async (_rule, judge) => {
        const s = await ctx.agent();
        const task = await ctx.call(s, "human.approve", ctx.approve({ asserted: recommended(judge), requiresHuman: true }));
        const got = await ctx.get(s, task.taskId);
        assert(got.status === "input_required", `a requiresHuman Approve is ${got.status}, expected input_required`);
        assert(typeof got._meta?.["io.hitlp/decisionUrl"] === "string", "the requiresHuman Approve has no decision URL");
      });
    },
  },
];
