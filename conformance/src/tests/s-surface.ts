// Group S / spec 7.8: the surface API. A surface authenticates with its own
// credential, never a requester token, and a surface credential never opens
// MCP; a human decides once, and the record names the surface in `channel`.
import { assert, type Context, type Test } from "../context";
import type { Json } from "../client";

function surface(ctx: Context): { base: string; credential: string; kind: string } {
  const s = ctx.config.surface;
  assert(s !== undefined, "the config has no `surface`: group S needs a surface credential");
  return { base: new URL(s!.path ?? "/surface/v1", ctx.url).href.replace(/\/$/, ""), credential: s!.credential, kind: s!.kind };
}

async function call(base: string, path: string, credential: string | undefined, method = "GET", body?: Json): Promise<{ status: number; json?: Json }> {
  const headers: Record<string, string> = {};
  if (credential !== undefined) headers.authorization = `Bearer ${credential}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: Json | undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, json };
}

export const tests: Test[] = [
  {
    rule: "S",
    name: "a requester token, or no credential, is refused on the surface API with 401",
    async run(ctx) {
      const { base } = surface(ctx);
      for (const token of [ctx.config.agents[0], ctx.config.agents[1], undefined]) {
        for (const path of ["/tasks", "/tasks/x", "/devices/d"]) {
          const res = await call(base, path, token);
          assert(res.status === 401, `GET ${path} with ${token === undefined ? "no credential" : "a requester token"} answered ${res.status}, expected 401`);
        }
      }
    },
  },
  {
    rule: "S",
    name: "a surface credential is refused on /mcp with 401",
    async run(ctx) {
      const { credential } = surface(ctx);
      const res = await fetch(ctx.url, {
        method: "POST",
        headers: { authorization: `Bearer ${credential}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "hitlp-conformance", version: "0.1.0" } } }),
      });
      await res.body?.cancel();
      assert(res.status === 401, `initialize with a surface credential answered ${res.status}, expected 401`);
    },
  },
  {
    rule: "S",
    name: "a surface lists and reads a task, decides it once, and the record names the surface in channel",
    async run(ctx) {
      const { base, credential, kind } = surface(ctx);
      const s = await ctx.agent();
      const task = await ctx.call(s, "human.approve", ctx.approve({ asserted: { why: "conformance S" } }));
      const list = await call(base, "/tasks", credential);
      assert(list.status === 200, `GET /tasks answered ${list.status}`);
      ctx.schemas.assert("surface/task-list", list.json, "the task list");
      assert(list.json!.tasks.some((t: Json) => t.id === task.taskId), "the new task is not listed for its human");
      const view = await call(base, `/tasks/${task.taskId}`, credential);
      assert(view.status === 200, `GET /tasks/{id} answered ${view.status}`);
      ctx.schemas.assert("surface/task", view.json, "the task view");
      assert(view.json!.attested?.source === "server" && view.json!.attested?.requester === ctx.config.agentClients[0], "the view's attested is not the server's, naming the requester");
      assert(view.json!.asserted?.source === "requester" && view.json!.asserted?.why === "conformance S", "the view's asserted is not the requester's as sent");
      const decided = await call(base, `/tasks/${task.taskId}/decision`, credential, "POST", { outcome: "approve", reason: "conformance", payloadDigest: view.json!.payloadDigest });
      assert(decided.status === 200, `the decision answered ${decided.status}: ${JSON.stringify(decided.json)}`);
      ctx.schemas.assert("decision-record", decided.json, "the surface's decision record");
      assert(decided.json!.channel === kind, `the record's channel is ${decided.json!.channel}, expected ${kind}`);
      assert(decided.json!.decidedBy?.type === "human", "the record is not decided by a human");
      assert(decided.json!.outcome === "approved", `the record's outcome is ${decided.json!.outcome}`);
      const again = await call(base, `/tasks/${task.taskId}/decision`, credential, "POST", { outcome: "reject" });
      assert(again.status === 409, `a second decision answered ${again.status}, expected 409`);
      const got = await ctx.get(s, task.taskId);
      assert(got.status === "completed", `the task is ${got.status} after the decision`);
      const result = await s.request("tasks/result", { taskId: task.taskId });
      const record = result.structuredContent;
      assert(record?.outcome === "approved" && record?.channel === kind, `the record changed after a second decision: ${JSON.stringify(record)}`);
    },
  },
  {
    rule: "S",
    name: "a teach choice the request offered round-trips into the decision record (5.5)",
    async run(ctx) {
      const { base, credential } = surface(ctx);
      const s = await ctx.agent();
      const teach = { options: [{ id: "always-allow", label: "Always allow this", after: ["approve"], editable: { label: "Pattern", default: "conformance *" } }] };
      const task = await ctx.call(s, "human.approve", ctx.approve({ teach }));
      const view = await call(base, `/tasks/${task.taskId}`, credential);
      ctx.schemas.assert("surface/task", view.json, "the task view");
      assert(JSON.stringify(view.json!.teach) === JSON.stringify(teach), `the view's teach is not the offered options as sent: ${JSON.stringify(view.json!.teach)}`);
      const choice = { option: "always-allow", text: "conformance S *" };
      const decided = await call(base, `/tasks/${task.taskId}/decision`, credential, "POST", { outcome: "approve", teach: choice });
      assert(decided.status === 200, `the decision answered ${decided.status}: ${JSON.stringify(decided.json)}`);
      ctx.schemas.assert("decision-record", decided.json, "the surface's decision record");
      const result = await s.request("tasks/result", { taskId: task.taskId });
      const record = result.structuredContent;
      assert(JSON.stringify(record?.teach) === JSON.stringify(choice), `tasks/result's teach is ${JSON.stringify(record?.teach)}, expected ${JSON.stringify(choice)}`);
    },
  },
  {
    rule: "S",
    name: "a teach choice the request did not offer is refused with 400 and the task stays open (5.5)",
    async run(ctx) {
      const { base, credential } = surface(ctx);
      const s = await ctx.agent();
      const task = await ctx.call(s, "human.approve", ctx.approve({ teach: { options: [{ id: "never-allow", label: "Never allow this", after: ["reject"] }] } }));
      for (const body of [
        { outcome: "approve", teach: { option: "always-allow" } },
        { outcome: "approve", teach: { option: "never-allow" } },
      ]) {
        const res = await call(base, `/tasks/${task.taskId}/decision`, credential, "POST", body);
        assert(res.status === 400, `${JSON.stringify(body)} answered ${res.status}, expected 400`);
      }
      const got = await ctx.get(s, task.taskId);
      assert(got.status !== "completed", "the task was decided by a refused teach choice");
    },
  },
];
