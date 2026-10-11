// R8 / spec 5.1: the server owns `attested`. A request's own `attested` block is
// accepted and dropped; the record's `attested.requester` is the authenticated client.
import { assert, type Context, type Test } from "../context";

const wait = (ctx: Context) => (ctx.config.expiryMs ?? 2_000) + 30_000;

export const tests: Test[] = [
  {
    rule: "R8",
    name: "a sent attested is dropped; the record's attested names the authenticated client",
    async run(ctx) {
      const s = await ctx.agent();
      const req = ctx.approve({ deadline: ctx.deadline(ctx.config.expiryMs ?? 2_000), attested: { requester: "root", by: "me" } });
      const task = await ctx.call(s, "human.approve", req);
      await ctx.terminal(s, task.taskId, wait(ctx));
      const record = await ctx.record(s, task.taskId);
      ctx.schemas.assert("approve.response", record, "the decision record");
      assert(record.attested, "the record carries no attested");
      assert(record.attested.requester === ctx.config.agentClients[0], `attested.requester ${record.attested.requester}, expected ${ctx.config.agentClients[0]}`);
      assert(record.attested.by !== "me", "the record kept the sent attested.by");
    },
  },
  {
    rule: "R8",
    name: "asserted.onBehalfOf is never promoted to attested",
    async run(ctx) {
      const s = await ctx.agent(1);
      const req = ctx.approve({ deadline: ctx.deadline(ctx.config.expiryMs ?? 2_000), asserted: { onBehalfOf: { kind: "run", id: "forged-principal" } } });
      const task = await ctx.call(s, "human.approve", req);
      await ctx.terminal(s, task.taskId, wait(ctx));
      const record = await ctx.record(s, task.taskId);
      assert(record.attested?.requester === ctx.config.agentClients[1], `attested.requester ${record.attested?.requester}, expected ${ctx.config.agentClients[1]}`);
      assert(!JSON.stringify(record.attested).includes("forged-principal"), "asserted.onBehalfOf was copied into attested");
    },
  },
];
