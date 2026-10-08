// The spec's schemas: the server refuses requests that break them, and its
// handles and decision records have the shape spec 6 and 7.2 give.
import { assert, type Test } from "../context";
import { refused } from "../client";

export const tests: Test[] = [
  {
    rule: "schemas",
    name: "human.ask and human.approve are listed as tools",
    async run(ctx) {
      const s = await ctx.agent();
      const { tools = [] } = await s.request("tools/list");
      const names = tools.map((t: { name: string }) => t.name);
      for (const n of ["human.ask", "human.approve"]) assert(names.includes(n), `tools/list lacks ${n}`);
    },
  },
  {
    rule: "schemas",
    name: "requests that break ask.request or approve.request are refused",
    async run(ctx) {
      const s = await ctx.agent();
      const bad: [string, Record<string, unknown>][] = [
        ["human.ask", { ...ctx.ask(), question: undefined }],
        ["human.ask", { ...ctx.ask(), defaultOnTimeout: "approve" }],
        ["human.ask", { ...ctx.ask(), idempotencyKey: "" }],
        ["human.approve", { ...ctx.approve(), action: undefined }],
        ["human.approve", { ...ctx.approve(), deadline: "tomorrow" }],
        ["human.approve", { ...ctx.approve(), scope: { maxUses: 0, notAfter: ctx.deadline(60_000) } }],
      ];
      for (const [tool, args] of bad) {
        const schema = tool === "human.ask" ? "ask.request" : "approve.request";
        assert(ctx.schemas.errors(schema, JSON.parse(JSON.stringify(args))).length > 0, `the suite's bad ${tool} request is valid`);
        await refused(ctx.call(s, tool as "human.ask", args), `an invalid ${tool} request ${JSON.stringify(args)}`);
      }
    },
  },
  {
    rule: "schemas",
    name: "a cancelled task is cancelled and stays so",
    async run(ctx) {
      const s = await ctx.agent();
      const task = await ctx.call(s, "human.ask", ctx.ask());
      await s.request("tasks/cancel", { taskId: task.taskId });
      const got = await ctx.get(s, task.taskId);
      assert(got.status === "cancelled", `a cancelled task is ${got.status}`);
      await refused(s.request("tasks/cancel", { taskId: task.taskId }), "cancelling a terminal task");
    },
  },
];
