// R1 / spec 7.2: the handle comes back at once and nothing blocks on a human.
import { assert, TERMINAL, type Test } from "../context";

async function timed<T>(p: Promise<T>): Promise<[T | undefined, number, unknown]> {
  const t0 = Date.now();
  try {
    const v = await p;
    return [v, Date.now() - t0, undefined];
  } catch (e) {
    return [undefined, Date.now() - t0, e];
  }
}

export const tests: Test[] = [
  {
    rule: "R1",
    name: "human.ask returns a task handle with taskId, status, ttl and pollInterval at once",
    async run(ctx) {
      const s = await ctx.agent();
      const [task, ms, err] = await timed(ctx.call(s, "human.ask", ctx.ask()));
      if (err) throw err;
      assert(ms < 5_000, `tools/call took ${ms} ms`);
      assert(!TERMINAL.includes(task!.status), `a new task is already ${task!.status}`);
      assert(typeof task!.ttl === "number" && task!.ttl > 0, `ttl ${task!.ttl} is not a positive number`);
      assert(typeof task!.pollInterval === "number", "the handle has no pollInterval");
    },
  },
  {
    rule: "R1",
    name: "human.approve returns a task handle at once",
    async run(ctx) {
      const s = await ctx.agent();
      const [task, ms, err] = await timed(ctx.call(s, "human.approve", ctx.approve()));
      if (err) throw err;
      assert(ms < 5_000, `tools/call took ${ms} ms`);
      assert(!TERMINAL.includes(task!.status), `a new task is already ${task!.status}`);
    },
  },
  {
    rule: "R1",
    name: "tasks/get and tasks/result on an undecided task answer without waiting for a human",
    async run(ctx) {
      const s = await ctx.agent();
      const task = await ctx.call(s, "human.ask", ctx.ask());
      const got = await ctx.get(s, task.taskId);
      assert(got.taskId === task.taskId, "tasks/get named another task");
      assert(!TERMINAL.includes(got.status), `an undecided task is ${got.status}`);
      const [, ms] = await timed(s.request("tasks/result", { taskId: task.taskId }));
      assert(ms < 5_000, `tasks/result held the connection for ${ms} ms`);
    },
  },
];
