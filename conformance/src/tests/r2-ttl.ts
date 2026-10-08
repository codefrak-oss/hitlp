// R2 / spec 5 and 7.5: when the deadline passes the server applies the default
// action itself, a policy decides, and silence is never an approval.
import { assert, type Context, type Test } from "../context";
import { refused } from "../client";

const wait = (ctx: Context) => (ctx.config.expiryMs ?? 2_000) + 30_000;

function expiry(primitive: "ask" | "approve", action: string, status: string, outcome?: string): Test {
  return {
    rule: "R2",
    name: `${primitive} with defaultOnTimeout ${action} ends ${status}${outcome ? ` / ${outcome}` : ""}, decided by policy`,
    async run(ctx) {
      const s = await ctx.agent();
      const over = { deadline: ctx.deadline(ctx.config.expiryMs ?? 2_000), defaultOnTimeout: action };
      const task = await ctx.call(s, `human.${primitive}`, primitive === "ask" ? ctx.ask(over) : ctx.approve(over));
      const done = await ctx.terminal(s, task.taskId, wait(ctx));
      assert(done.status === status, `status ${done.status}, expected ${status}`);
      if (!outcome) return;
      const record = await ctx.record(s, task.taskId);
      ctx.schemas.assert(`${primitive}.response`, record, "the decision record");
      assert(record.outcome === outcome, `outcome ${record.outcome}, expected ${outcome}`);
      assert(record.decidedBy?.type === "policy", `decidedBy.type ${record.decidedBy?.type}, expected policy`);
      assert(record.requestId === task.taskId, "the record's requestId is not the task id");
      const again = await ctx.get(s, task.taskId);
      assert(again.status === status, `a terminal task changed to ${again.status}`);
    },
  };
}

export const tests: Test[] = [
  expiry("ask", "reject", "completed", "timed_out"),
  expiry("approve", "reject", "completed", "rejected"),
  expiry("ask", "cancel", "cancelled"),
  expiry("ask", "fail", "failed"),
  {
    rule: "R2",
    name: "an Approve with defaultOnTimeout escalate is never approved by its deadline passing",
    async run(ctx) {
      const s = await ctx.agent();
      const task = await ctx.call(s, "human.approve", ctx.approve({ deadline: ctx.deadline(ctx.config.expiryMs ?? 2_000), defaultOnTimeout: "escalate" }));
      await new Promise((r) => setTimeout(r, (ctx.config.expiryMs ?? 2_000) + 1_000));
      const got = await ctx.get(s, task.taskId);
      if (got.status !== "completed") return;
      const record = await ctx.record(s, task.taskId);
      assert(record.outcome !== "approved", "silence was taken as approval");
    },
  },
  {
    rule: "R2",
    name: "a request without deadline or defaultOnTimeout is refused",
    async run(ctx) {
      const s = await ctx.agent();
      const { deadline: _d, ...noDeadline } = ctx.ask();
      await refused(ctx.call(s, "human.ask", noDeadline), "an Ask without deadline");
      const { defaultOnTimeout: _a, ...noDefault } = ctx.approve();
      await refused(ctx.call(s, "human.approve", noDefault), "an Approve without defaultOnTimeout");
    },
  },
];
