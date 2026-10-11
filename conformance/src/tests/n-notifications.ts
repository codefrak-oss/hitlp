// Spec 7.4: a status change is pushed as notifications/tasks/status on the
// owner's session stream, terminal ones always, carrying the task and never the
// decision record, and never to another requester's session.
import { assert, sleep, type Context, type Test } from "../context";
import type { Json, Session } from "../client";

/** Time for a session's standalone GET stream to open after a request. */
const STREAM_OPEN_MS = 500;
/** How long a session that must hear nothing is listened to. */
const QUIET_MS = 1_000;

/** Two requesters' sessions, each bound by an authenticated request of its own. */
async function owners(ctx: Context): Promise<[Session, Session]> {
  const a = await ctx.agent(0);
  const b = await ctx.agent(1);
  await a.request("tasks/list");
  await b.request("tasks/list");
  await sleep(STREAM_OPEN_MS);
  return [a, b];
}

function noRecord(n: Json, what: string): void {
  assert(!("result" in n) && n.outcome === undefined && n.decidedBy === undefined, `${what} carried the decision record`);
}

export const tests: Test[] = [
  {
    rule: "N",
    name: "a status change is pushed to the owner's stream with task id and status, no record, and not to another requester",
    async run(ctx) {
      const [a, b] = await owners(ctx);
      const task = await ctx.call(a, "human.ask", ctx.ask());
      await a.request("tasks/cancel", { taskId: task.taskId });
      const n = await a.notification((x) => x.taskId === task.taskId && x.status === "cancelled", 5_000);
      assert(n, "no notifications/tasks/status for the cancelled task on the owner's stream");
      noRecord(n, "the notification");
      await sleep(QUIET_MS);
      assert(!b.notifications.some((x) => x.taskId === task.taskId), "another requester's stream got a notification for the task");
    },
  },
  {
    rule: "N",
    name: "a TTL expiry is pushed as a terminal notification without polling",
    async run(ctx) {
      const [a, b] = await owners(ctx);
      const ms = ctx.config.expiryMs ?? 2_000;
      const task = await ctx.call(a, "human.ask", ctx.ask({ deadline: ctx.deadline(ms), defaultOnTimeout: "reject" }));
      const n = await a.notification((x) => x.taskId === task.taskId && ["completed", "failed", "cancelled"].includes(x.status), ms + 35_000);
      assert(n, "no terminal notifications/tasks/status after the deadline passed");
      assert(n.status === "completed", `the notification's status is ${n.status}, expected completed`);
      noRecord(n, "the notification");
      assert(!b.notifications.some((x) => x.taskId === task.taskId), "another requester's stream got a notification for the task");
      const record = await ctx.record(a, task.taskId);
      assert(record.outcome === "timed_out", `outcome ${record.outcome}, expected timed_out`);
    },
  },
];
