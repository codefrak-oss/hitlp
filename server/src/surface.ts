// The surface API (spec 7.8): REST and JSON under /surface/v1 for the
// surfaces a human decides on (the decision page, a desktop app, a phone app),
// plus a server-sent-events stream of new tasks. A surface authenticates with
// its own bearer credential, never a requester token; every request resolves
// it afresh (R5). A task is routed to the humans whose roles and capabilities
// satisfy its `requires`: to anyone else it is not listed and not found.
//
//   GET    /surface/v1/tasks               open tasks, and those decided recently
//   GET    /surface/v1/tasks/{id}          one task: attested, asserted, payload
//   POST   /surface/v1/tasks/{id}/decision decide it once (decideAsHuman)
//   PUT    /surface/v1/devices/{id}        register a device for push
//   DELETE /surface/v1/devices/{id}        drop it
//   GET    /surface/v1/events              text/event-stream of `task` events
import type { IncomingMessage, ServerResponse } from "node:http";
import { isTerminal, type Asserted, type Attested } from "@codefrak/hitlp";
import type { SurfaceAuthenticator, SurfaceCaller } from "./auth";
import { displayedDigest, routedTo } from "./routing";
import type { TeachChoice } from "./records";
import { DecisionError, NotRoutedError, type HitlpServer, type HumanDecision } from "./server";
import { TerminalTaskError, type Device, type StoredTask, type SurfaceStore } from "./store";

export const SURFACE_PREFIX = "/surface/v1";

export interface SurfaceApiOptions {
  server: HitlpServer;
  surfaces: SurfaceAuthenticator;
  store: SurfaceStore;
  /** How long a decided task stays in the list, in ms; default 24h. */
  recentMs?: number;
  /** Period of the event stream's keep-alive comments in ms; default 25s. */
  keepAliveMs?: number;
}

const TASK = /^\/tasks\/([A-Za-z0-9-]+)$/;
const DECISION = /^\/tasks\/([A-Za-z0-9-]+)\/decision$/;
const DEVICE = /^\/devices\/([A-Za-z0-9._-]{1,128})$/;

function json(res: ServerResponse, status: number, body?: unknown): void {
  if (body === undefined) {
    res.writeHead(status, { "cache-control": "no-store" }).end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 65_536) throw new SyntaxError("body too large");
  }
  return JSON.parse(text);
}

export function bearerOf(req: IncomingMessage): string | undefined {
  return /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
}

/**
 * A task as a surface shows it (spec 7.8): `attested` labelled the server's,
 * `asserted` labelled the requester's with lineage newest first, the payload as
 * received, the effective deadline, `requiresHuman`, `priority` (`normal` when the
 * request named none) and the status.
 */
export function surfaceView(task: StoredTask): Record<string, unknown> {
  const r = task.request;
  const view: Record<string, unknown> = {
    id: task.id,
    primitive: task.primitive,
    status: task.status,
    createdAt: task.createdAt,
    deadline: new Date(task.finalDeadlineAt ?? task.deadlineAt).toISOString(),
    requiresHuman: r.requiresHuman === true,
    priority: typeof r.priority === "string" ? r.priority : "normal",
  };
  if (task.statusMessage !== undefined) view.statusMessage = task.statusMessage;
  const attested = r.attested as Attested | undefined;
  if (attested) view.attested = { source: "server", ...structuredClone(attested) };
  const asserted = r.asserted as Asserted | undefined;
  if (asserted) {
    const a: Record<string, unknown> = { source: "requester", ...structuredClone(asserted) };
    if (asserted.lineage) a.lineage = [...structuredClone(asserted.lineage)].reverse();
    view.asserted = a;
  }
  if (task.primitive === "approve") {
    view.action = r.action;
    view.payload = structuredClone(r.payload);
    view.payloadDigest = displayedDigest(task);
    if (r.scope !== undefined) view.scope = structuredClone(r.scope);
    if (r.teach !== undefined) view.teach = structuredClone(r.teach);
  } else {
    view.question = r.question;
    view.responseSchema = structuredClone(r.responseSchema);
    if (r.options !== undefined) view.options = structuredClone(r.options);
  }
  if (r.context !== undefined) view.context = structuredClone(r.context);
  if (r.requires !== undefined) view.requires = structuredClone(r.requires);
  if (task.result) view.result = structuredClone(task.result);
  return view;
}

/** The decision a surface sent, or a message saying what is wrong with it. */
function parseDecision(task: StoredTask | undefined, b: unknown): HumanDecision | string {
  if (!b || typeof b !== "object" || Array.isArray(b)) return "the body must be a JSON object";
  const d = b as Record<string, unknown>;
  if (d.reason !== undefined && typeof d.reason !== "string") return "reason must be a string";
  const reason = d.reason as string | undefined;
  if (task?.primitive === "ask") {
    if (d.teach !== undefined) return "an Ask takes no teach choice";
    if (!("answer" in d)) return "an Ask takes an answer";
    return { answer: d.answer, reason };
  }
  if (d.outcome !== "approve" && d.outcome !== "reject") return "outcome must be approve or reject";
  if (d.payloadDigest !== undefined && typeof d.payloadDigest !== "string") return "payloadDigest must be a string";
  const teach = parseTeach(d.teach);
  if (typeof teach === "string") return teach;
  return { outcome: d.outcome === "approve" ? "approved" : "rejected", reason, payloadDigest: d.payloadDigest as string | undefined, teach };
}

/** The `teach` of a decision body (spec 5.5), or a message saying what is wrong with it. */
function parseTeach(t: unknown): TeachChoice | undefined | string {
  if (t === undefined) return undefined;
  if (!t || typeof t !== "object" || Array.isArray(t)) return "teach must be an object";
  const c = t as Record<string, unknown>;
  if (typeof c.option !== "string" || !c.option) return "teach.option must be a string";
  if (c.text !== undefined && typeof c.text !== "string") return "teach.text must be a string";
  if (Object.keys(c).some((k) => k !== "option" && k !== "text")) return "teach takes option and text only";
  return c.text === undefined ? { option: c.option } : { option: c.option, text: c.text };
}

export class SurfaceApi {
  private readonly streams = new Set<ServerResponse>();

  constructor(private readonly options: SurfaceApiOptions) {}

  /** The surface the request's bearer credential names, resolved now (R5). */
  private caller(req: IncomingMessage): SurfaceCaller | undefined {
    return this.options.surfaces.resolve(bearerOf(req));
  }

  /** True when the credential is a surface's: /mcp refuses it (spec 7.8). */
  isSurfaceCredential(credential: string | undefined): boolean {
    if (credential === undefined) return false;
    for (const c of this.options.surfaces.credentials?.() ?? []) if (c === credential) return true;
    return false;
  }

  /** Answers the request when its path is under /surface/v1; returns false otherwise. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const path = new URL(req.url ?? "/", "http://surface").pathname;
    if (path !== SURFACE_PREFIX && !path.startsWith(`${SURFACE_PREFIX}/`)) return false;
    try {
      await this.route(req, res, path.slice(SURFACE_PREFIX.length));
    } catch (e) {
      if (!res.headersSent) json(res, e instanceof SyntaxError ? 400 : 500, { error: e instanceof SyntaxError ? "the body is not JSON" : "internal error" });
      else res.end();
    }
    return true;
  }

  private async route(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const who = this.caller(req);
    if (!who) return json(res, 401, { error: "a surface credential is required" });
    const method = req.method ?? "GET";
    if (path === "/tasks") return method === "GET" ? json(res, 200, { tasks: this.list(who) }) : this.notAllowed(res, "GET");
    if (path === "/events") return method === "GET" ? this.events(req, res) : this.notAllowed(res, "GET");
    let m = TASK.exec(path);
    if (m) {
      if (method !== "GET") return this.notAllowed(res, "GET");
      const task = this.visible(m[1], who);
      return task ? json(res, 200, surfaceView(task)) : json(res, 404, { error: "no such task" });
    }
    m = DECISION.exec(path);
    if (m) return method === "POST" ? this.decide(req, res, m[1], who) : this.notAllowed(res, "POST");
    m = DEVICE.exec(path);
    if (m) {
      if (method === "PUT") return this.putDevice(req, res, m[1], who);
      if (method === "DELETE") return this.options.store.deleteDevice(who.surfaceId, m[1]) ? json(res, 204) : json(res, 404, { error: "no such device" });
      return this.notAllowed(res, "PUT, DELETE");
    }
    json(res, 404, { error: "not found" });
  }

  private notAllowed(res: ServerResponse, allow: string): void {
    res.writeHead(405, { allow, "content-type": "application/json" }).end(JSON.stringify({ error: "method not allowed" }));
  }

  /** The task when it exists and is routed to the caller's human. */
  private visible(id: string, who: SurfaceCaller): StoredTask | undefined {
    const task = this.options.server.getTask(id);
    return task && routedTo(task, who.human) ? task : undefined;
  }

  private list(who: SurfaceCaller): Record<string, unknown>[] {
    const server = this.options.server;
    server.sweep();
    const since = new Date(server.now() - (this.options.recentMs ?? 24 * 3_600_000)).toISOString();
    return server.store
      .listForSurfaces(since)
      .filter((t) => routedTo(t, who.human))
      .map(surfaceView);
  }

  private async decide(req: IncomingMessage, res: ServerResponse, id: string, who: SurfaceCaller): Promise<void> {
    const task = this.visible(id, who);
    if (!task) return json(res, 404, { error: "no such task" });
    const decision = parseDecision(task, await body(req));
    if (typeof decision === "string") return json(res, 400, { error: decision });
    try {
      const decided = this.options.server.decideAsHuman(id, who.human, who.kind, decision);
      json(res, 200, decided.result);
    } catch (e) {
      if (e instanceof NotRoutedError) return json(res, 404, { error: "no such task" });
      if (e instanceof TerminalTaskError) return json(res, 409, { error: `the task is already ${e.task.status}`, status: e.task.status });
      if (e instanceof DecisionError) return json(res, e.status, { error: e.message });
      throw e;
    }
  }

  private async putDevice(req: IncomingMessage, res: ServerResponse, id: string, who: SurfaceCaller): Promise<void> {
    const b = (await body(req)) as Record<string, unknown> | null;
    if (!b || typeof b !== "object" || Array.isArray(b)) return json(res, 400, { error: "the body must be a JSON object" });
    if (typeof b.platform !== "string" || !b.platform) return json(res, 400, { error: "platform is required, e.g. apns" });
    if (typeof b.token !== "string" || !/^[A-Za-z0-9._:-]{1,512}$/.test(b.token)) return json(res, 400, { error: "token is required" });
    if (b.environment !== undefined && b.environment !== "production" && b.environment !== "sandbox") {
      return json(res, 400, { error: "environment is production or sandbox" });
    }
    if (b.name !== undefined && typeof b.name !== "string") return json(res, 400, { error: "name must be a string" });
    const device: Device = { id, surfaceId: who.surfaceId, human: who.human.id, platform: b.platform, token: b.token, updatedAt: new Date(this.options.server.now()).toISOString() };
    if (b.environment !== undefined) device.environment = b.environment;
    if (b.name !== undefined) device.name = b.name as string;
    json(res, 200, this.options.store.putDevice(device));
  }

  /**
   * The new-task stream: one `task` event per task routed to the caller's human,
   * created after the stream opened. The credential is resolved again before
   * every event, so a revoked surface's stream ends.
   */
  private events(req: IncomingMessage, res: ServerResponse): void {
    const credential = bearerOf(req);
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(": hitlp surface events\n\n");
    this.streams.add(res);
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      unsubscribe();
      clearInterval(keepAlive);
      this.streams.delete(res);
      res.end();
    };
    const unsubscribe = this.options.server.onNewTask((task) => {
      const who = this.options.surfaces.resolve(credential);
      if (!who) return end();
      if (!routedTo(task, who.human) || isTerminal(task.status)) return;
      res.write(`event: task\nid: ${task.id}\ndata: ${JSON.stringify(surfaceView(task))}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), this.options.keepAliveMs ?? 25_000);
    keepAlive.unref();
    req.on("close", end);
  }

  /** Ends every open event stream. */
  close(): void {
    for (const res of [...this.streams]) res.destroy();
    this.streams.clear();
  }
}
