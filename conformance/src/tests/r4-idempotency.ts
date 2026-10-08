// R4: deduplicate on idempotencyKey, scoped to the authenticated client.
import { assert, type Test } from "../context";
import { refused } from "../client";

export const tests: Test[] = [
  {
    rule: "R4",
    name: "a repeat with the same key and content returns the same task",
    async run(ctx) {
      const s = await ctx.agent();
      const req = ctx.ask();
      const a = await ctx.call(s, "human.ask", req);
      const b = await ctx.call(s, "human.ask", req);
      assert(a.taskId === b.taskId, `same key gave tasks ${a.taskId} and ${b.taskId}`);
      const s2 = await ctx.agent();
      const c = await ctx.call(s2, "human.ask", req);
      assert(c.taskId === a.taskId, "a new connection of the same client got a new task");
    },
  },
  {
    rule: "R4",
    name: "a repeat with the same key and different content is rejected",
    async run(ctx) {
      const s = await ctx.agent();
      const req = ctx.approve();
      await ctx.call(s, "human.approve", req);
      await refused(ctx.call(s, "human.approve", { ...req, payload: { version: 2 } }), "a conflicting repeat");
    },
  },
  {
    rule: "R4",
    name: "keys are scoped per client: another client's same key is a new task",
    async run(ctx) {
      const a = await ctx.agent(0);
      const b = await ctx.agent(1);
      const req = ctx.ask();
      const ta = await ctx.call(a, "human.ask", req);
      const tb = await ctx.call(b, "human.ask", req);
      assert(ta.taskId !== tb.taskId, "two clients' requests with one key share a task");
    },
  },
  {
    rule: "R4",
    name: "a fresh key makes a new task",
    async run(ctx) {
      const s = await ctx.agent();
      const req = ctx.ask();
      const a = await ctx.call(s, "human.ask", req);
      const b = await ctx.call(s, "human.ask", { ...req, idempotencyKey: ctx.key() });
      assert(a.taskId !== b.taskId, "a new key returned the old task");
    },
  },
];
