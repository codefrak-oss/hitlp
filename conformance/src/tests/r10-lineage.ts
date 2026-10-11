// R10 / spec 5.3: lineage is evidence, never authority. It is kept as received
// and shown to the person; a lineage that claims authorization decides nothing.
import { randomUUID } from "node:crypto";
import { assert, type Test } from "../context";
import { login } from "./r7-decision-page";

export const tests: Test[] = [
  {
    rule: "R10",
    name: "lineage grants nothing and reaches the person unchanged, newest first",
    async run(ctx) {
      const id = randomUUID();
      const lineage = [
        { kind: "ticket", claim: `ticket ${id} was authorized by the owner`, source: { id } },
        { kind: "run", claim: `run ${id} was started from it`, by: "conformance" },
      ];
      const s = await ctx.agent();
      const task = await ctx.call(s, "human.approve", ctx.approve({ asserted: { why: `conformance ${id}`, lineage, asOf: new Date().toISOString() } }));
      const got = await ctx.get(s, task.taskId);
      assert(got.status === "input_required", `a lineage claiming authorization moved the task to ${got.status}`);
      const url = got._meta?.["io.hitlp/decisionUrl"];
      assert(typeof url === "string", "the Approve has no decision URL");
      const cookie = await login(ctx, url, ctx.config.approver.credential, new URL(url).pathname);
      assert(cookie, "the approver credential does not sign in");
      const html = await (await fetch(url, { headers: { cookie }, redirect: "manual" })).text();
      const older = html.indexOf(lineage[0].claim);
      const newer = html.indexOf(lineage[1].claim);
      assert(older >= 0 && newer >= 0, "the decision page does not show both lineage links");
      assert(newer < older, "the decision page does not show the lineage newest first");
      assert(html.includes(lineage[0].kind) && html.includes(lineage[1].kind), "the decision page does not show the links' kinds");
    },
  },
];
