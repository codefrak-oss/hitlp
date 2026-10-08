// R5: a task id is not a permission; every request is re-authenticated.
import { assert, type Context, type Test } from "../context";
import { refused, type Session } from "../client";

async function othersCannotTouch(ctx: Context, intruder: Session, who: string): Promise<void> {
  const owner = await ctx.agent(0);
  const task = await ctx.call(owner, "human.ask", ctx.ask());
  await refused(ctx.get(intruder, task.taskId), `tasks/get by ${who}`);
  await refused(intruder.request("tasks/result", { taskId: task.taskId }), `tasks/result by ${who}`);
  await refused(intruder.request("tasks/cancel", { taskId: task.taskId }), `tasks/cancel by ${who}`);
  const after = await ctx.get(owner, task.taskId);
  assert(after.status !== "cancelled", `${who} cancelled the task`);
}

export const tests: Test[] = [
  {
    rule: "R5",
    name: "another client cannot get, read, cancel or list a task",
    async run(ctx) {
      const b = await ctx.agent(1);
      await othersCannotTouch(ctx, b, "another client");
      const a = await ctx.agent(0);
      const task = await ctx.call(a, "human.ask", ctx.ask());
      const listed = await b.request("tasks/list");
      assert(!(listed.tasks ?? []).some((t: { taskId: string }) => t.taskId === task.taskId), "tasks/list showed another client's task");
      const own = await a.request("tasks/list");
      assert((own.tasks ?? []).some((t: { taskId: string }) => t.taskId === task.taskId), "tasks/list does not show the caller's own task");
    },
  },
  {
    rule: "R5",
    name: "a request without a token is refused",
    async run(ctx) {
      const anon = await ctx.session(undefined).catch(() => undefined);
      if (!anon) return; // refused at connect: conforming
      await othersCannotTouch(ctx, anon, "an unauthenticated caller");
      await refused(anon.request("tasks/list"), "tasks/list without a token");
      await refused(ctx.call(anon, "human.ask", ctx.ask()), "tools/call without a token");
    },
  },
  {
    rule: "R5",
    name: "a request with an unknown token is refused",
    async run(ctx) {
      const bad = await ctx.session(`not-a-token-${ctx.key()}`).catch(() => undefined);
      if (!bad) return;
      await othersCannotTouch(ctx, bad, "an unknown token");
      await refused(bad.request("tasks/list"), "tasks/list with an unknown token");
    },
  },
];
