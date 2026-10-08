// R6: TTLs are capped per primitive and blanket Approve scopes are refused.
import { assert, type Test } from "../context";
import { refused } from "../client";

const SLACK = 5_000;
const DAY = 86_400_000;

export const tests: Test[] = [
  {
    rule: "R6",
    name: "an Approve deadline beyond the cap is shortened to it and reported in ttl",
    async run(ctx) {
      const s = await ctx.agent();
      const task = await ctx.call(s, "human.approve", ctx.approve({ deadline: ctx.deadline(400 * DAY) }));
      assert(task.ttl <= ctx.config.caps.approveMs + SLACK, `ttl ${task.ttl} exceeds the Approve cap ${ctx.config.caps.approveMs}`);
    },
  },
  {
    rule: "R6",
    name: "an Ask deadline beyond the cap is shortened to it and reported in ttl",
    async run(ctx) {
      const s = await ctx.agent();
      const task = await ctx.call(s, "human.ask", ctx.ask({ deadline: ctx.deadline(400 * DAY) }));
      assert(task.ttl <= ctx.config.caps.askMs + SLACK, `ttl ${task.ttl} exceeds the Ask cap ${ctx.config.caps.askMs}`);
    },
  },
  {
    rule: "R6",
    name: "a deadline inside the cap is reported in ttl",
    async run(ctx) {
      const s = await ctx.agent();
      const ms = Math.min(60_000, ctx.config.caps.askMs);
      const task = await ctx.call(s, "human.ask", ctx.ask({ deadline: ctx.deadline(ms) }));
      assert(task.ttl <= ms + SLACK, `ttl ${task.ttl} is longer than the requested ${ms} ms`);
    },
  },
  {
    rule: "R6",
    name: "an Approve scope without notAfter or maxUses is refused",
    async run(ctx) {
      const s = await ctx.agent();
      await refused(ctx.call(s, "human.approve", ctx.approve({ scope: {} })), "an empty scope");
      await refused(ctx.call(s, "human.approve", ctx.approve({ scope: { maxUses: 3 } })), "a scope without notAfter");
      await refused(ctx.call(s, "human.approve", ctx.approve({ scope: { notAfter: ctx.deadline(DAY) } })), "a scope without maxUses");
    },
  },
  {
    rule: "R6",
    name: "a bounded Approve scope is accepted",
    async run(ctx) {
      const s = await ctx.agent();
      await ctx.call(s, "human.approve", ctx.approve({ scope: { maxUses: 1, notAfter: ctx.deadline(DAY) } }));
    },
  },
];
