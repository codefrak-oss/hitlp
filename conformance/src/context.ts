// What every test gets: the server URL, the test credentials from the config
// file, the spec's schemas, and helpers to make requests and follow tasks.
import { randomUUID } from "node:crypto";
import { connect, type Json, type Session } from "./client";
import type { Schemas } from "./schemas";

export interface Config {
  /** Two agent bearer tokens of different clients. */
  agents: [string, string];
  /** The server's TTL caps in ms (R6). */
  caps: { approveMs: number; askMs: number };
  /** A human who may decide an Approve with no `requires` on the decision page (R7). */
  approver: { credential: string; loginPath?: string; field?: string };
  /** How far ahead the R2 tests set their deadlines, in ms; default 2000. */
  expiryMs?: number;
}

export const TERMINAL = ["completed", "failed", "cancelled"];

export class Context {
  private readonly open: Session[] = [];

  constructor(readonly url: string, readonly config: Config, readonly schemas: Schemas) {}

  /** A session sending `token` on every request; undefined sends none. */
  async session(token: string | undefined): Promise<Session> {
    const s = await connect(this.url, token);
    this.open.push(s);
    return s;
  }

  agent(i: 0 | 1 = 0): Promise<Session> {
    return this.session(this.config.agents[i]);
  }

  async closeAll(): Promise<void> {
    for (const s of this.open.splice(0)) await s.close().catch(() => {});
  }

  key(): string {
    return `conformance-${randomUUID()}`;
  }

  deadline(ms: number): string {
    return new Date(Date.now() + ms).toISOString();
  }

  /** A schema-valid human.ask request. */
  ask(over: Json = {}): Json {
    const req = { idempotencyKey: this.key(), deadline: this.deadline(3_600_000), defaultOnTimeout: "reject", question: "Which currency?", responseSchema: { type: "string" }, ...over };
    this.schemas.assert("ask.request", req, "the suite's own request");
    return req;
  }

  /** A schema-valid human.approve request. */
  approve(over: Json = {}): Json {
    const req = { idempotencyKey: this.key(), deadline: this.deadline(3_600_000), defaultOnTimeout: "reject", action: "deploy", payload: { version: 1 }, ...over };
    this.schemas.assert("approve.request", req, "the suite's own request");
    return req;
  }

  /** tools/call with task augmentation; returns the task handle (spec 7.2). */
  async call(s: Session, tool: "human.ask" | "human.approve", args: Json, ttl?: number): Promise<Json> {
    const res = await s.request("tools/call", { name: tool, arguments: args, task: ttl === undefined ? {} : { ttl } });
    const task = res.task;
    if (!task || typeof task.taskId !== "string") throw new Error(`tools/call ${tool} returned no task handle: ${JSON.stringify(res)}`);
    return task;
  }

  get(s: Session, taskId: string): Promise<Json> {
    return s.request("tasks/get", { taskId });
  }

  /** Polls tasks/get until the task is terminal or `timeoutMs` passes. */
  async terminal(s: Session, taskId: string, timeoutMs: number): Promise<Json> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const t = await this.get(s, taskId);
      if (TERMINAL.includes(t.status)) return t;
      if (Date.now() > end) throw new Error(`task ${taskId} still ${t.status} after ${timeoutMs} ms`);
      await sleep(250);
    }
  }

  /** The decision record of a terminal task (tasks/result, or inline on tasks/get). */
  async record(s: Session, taskId: string): Promise<Json> {
    const res = await s.request("tasks/result", { taskId });
    const record = res.structuredContent ?? parseText(res);
    if (!record) throw new Error(`task ${taskId} has no decision record: ${JSON.stringify(res)}`);
    return record;
  }
}

function parseText(res: Json): Json | undefined {
  const text = res.content?.find((c: Json) => c.type === "text")?.text;
  try {
    const v = text && JSON.parse(text);
    return v && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

export interface Test {
  rule: string;
  name: string;
  run(ctx: Context): Promise<void>;
}
