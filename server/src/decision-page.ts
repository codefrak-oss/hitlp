// The hosted decision page for URL-mode Approve (spec 7.6, rule R7): a human
// logs in, sees the action and payload exactly as the agent sent them, and
// approves or rejects once. The agent never reaches this surface: its tokens
// are refused here, and the task URL alone grants nothing (R5).
//
// Security choices the reference server makes (deployments SHOULD add MFA for
// Approve, spec 7.6, by plugging in their own HumanAuthenticator):
// - a login form sets a SameSite=Strict, HttpOnly session cookie; sessions are
//   in memory and re-resolve their credential on every request, so revoking a
//   credential ends its sessions;
// - requests carrying an Authorization header are refused, bearer or not;
// - each form carries a CSRF token bound to the session and the task;
// - the task's `requires.roles` and `requires.capabilities` are checked when the
//   page loads and again on submit.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { isTerminal, type DecisionRecord } from "@codefrak/hitlp";
import { assertDisjointCredentials, type Authenticator, type HumanAuthenticator, type HumanProfile } from "./auth";
import { requestHash } from "./idempotency";
import type { HitlpServer } from "./server";
import { TerminalTaskError, type StoredTask } from "./store";

export interface DecisionPageOptions {
  server: HitlpServer;
  humans: HumanAuthenticator;
  /** The agents' authenticator: startup fails if it shares a credential with `humans` (R7). */
  agents: Authenticator;
  /** Set the cookie's Secure attribute; on by default, off only for plain-http tests. */
  secureCookie?: boolean;
  /** Session lifetime in ms; default 8h. */
  sessionTtlMs?: number;
}

const COOKIE = "hitlp_session";
const DECIDE = /^\/decide\/([A-Za-z0-9-]+)$/;

interface Session {
  credential: string;
  expiresAt: number;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The digest the page binds a decision to: the request's own, or one over the payload shown. */
export function displayedDigest(task: StoredTask): string {
  return (task.request.payloadDigest as string | undefined) ?? requestHash(task.request.payload);
}

/** What the human lacks of the task's `requires`, empty when they may decide. */
export function missingRequirements(task: StoredTask, human: HumanProfile): string[] {
  const requires = (task.request.requires ?? {}) as { roles?: string[]; capabilities?: string[] };
  return [
    ...(requires.roles ?? []).filter((r) => !human.roles.includes(r)).map((r) => `role ${r}`),
    ...(requires.capabilities ?? []).filter((c) => !human.capabilities.includes(c)).map((c) => `capability ${c}`),
  ];
}

function page(res: ServerResponse, status: number, title: string, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
    ...headers,
  });
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`);
}

async function form(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65_536) throw new Error("form too large");
  }
  return new URLSearchParams(body);
}

function cookieOf(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class DecisionPage {
  private readonly sessions = new Map<string, Session>();
  private readonly secret = randomBytes(32);
  private readonly http: Server;

  constructor(private readonly options: DecisionPageOptions) {
    assertDisjointCredentials(options.agents, options.humans);
    this.http = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        if (!res.headersSent) page(res, 400, "Bad request", "");
        else res.end();
      });
    });
  }

  /** Starts listening; returns the base URL. */
  async listen(port = 0, host = "127.0.0.1"): Promise<string> {
    await new Promise<void>((resolve) => this.http.listen(port, host, resolve));
    const addr = this.http.address() as AddressInfo;
    return `http://${host}:${addr.port}`;
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  private csrf(sessionId: string, taskId: string): string {
    return createHmac("sha256", this.secret).update(`${sessionId}\n${taskId}`).digest("base64url");
  }

  /** The logged-in human, resolved afresh from the session's credential. */
  private human(req: IncomingMessage): { sessionId: string; human: HumanProfile } | undefined {
    const sessionId = cookieOf(req, COOKIE);
    const session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (!sessionId || !session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return undefined;
    }
    const human = this.options.humans.resolve(session.credential);
    return human && { sessionId, human };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://page");
    // The page takes humans only, by cookie: an agent's bearer token never works here.
    if (req.headers.authorization !== undefined) return page(res, 401, "Unauthorized", "<p>This page does not accept bearer credentials.</p>");
    if (url.pathname === "/login") return req.method === "POST" ? this.login(req, res) : this.loginForm(res, url.searchParams.get("next") ?? "");
    const match = DECIDE.exec(url.pathname);
    if (!match) return page(res, 404, "Not found", "");
    const who = this.human(req);
    if (!who) return this.loginForm(res, url.pathname, 401);
    const taskId = match[1];
    if (req.method === "GET") return this.show(res, taskId, who.sessionId, who.human);
    if (req.method === "POST") return this.submit(req, res, taskId, who.sessionId, who.human);
    page(res, 405, "Method not allowed", "", { allow: "GET, POST" });
  }

  private loginForm(res: ServerResponse, next: string, status = 200, error = ""): void {
    const target = DECIDE.test(next) ? next : "";
    page(
      res,
      status,
      "Sign in",
      `${error && `<p>${escapeHtml(error)}</p>`}<form method="post" action="/login">` +
        `<input type="hidden" name="next" value="${escapeHtml(target)}">` +
        `<label>Credential <input type="password" name="credential" autocomplete="current-password"></label> <button>Sign in</button></form>`,
    );
  }

  private async login(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const f = await form(req);
    const credential = f.get("credential") ?? "";
    const next = f.get("next") ?? "";
    if (!this.options.humans.resolve(credential)) return this.loginForm(res, next, 401, "Unknown credential.");
    const sessionId = randomBytes(32).toString("base64url");
    const ttl = this.options.sessionTtlMs ?? 8 * 3_600_000;
    this.sessions.set(sessionId, { credential, expiresAt: Date.now() + ttl });
    const secure = this.options.secureCookie === false ? "" : "; Secure";
    res.writeHead(303, {
      location: DECIDE.test(next) ? next : "/login",
      "set-cookie": `${COOKIE}=${sessionId}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(ttl / 1000)}${secure}`,
      "cache-control": "no-store",
    });
    res.end();
  }

  /** The task if this human may decide it now, or writes the refusal and returns undefined. */
  private decidable(res: ServerResponse, taskId: string, human: HumanProfile): StoredTask | undefined {
    const task = this.options.server.getTask(taskId);
    if (!task || task.primitive !== "approve") {
      page(res, 404, "Not found", "");
      return undefined;
    }
    const missing = missingRequirements(task, human);
    if (missing.length > 0) {
      page(res, 403, "Forbidden", `<p>You lack ${escapeHtml(missing.join(", "))}.</p>`);
      return undefined;
    }
    if (isTerminal(task.status)) {
      page(res, 409, "Already decided", `<p>This request is ${escapeHtml(task.status)}${task.result ? `: ${escapeHtml(task.result.outcome)}` : ""}.</p>`);
      return undefined;
    }
    return task;
  }

  private show(res: ServerResponse, taskId: string, sessionId: string, human: HumanProfile): void {
    const task = this.decidable(res, taskId, human);
    if (!task) return;
    const r = task.request;
    const context = r.context as { summary?: string } | undefined;
    page(
      res,
      200,
      "Approval requested",
      `<p>Signed in as ${escapeHtml(human.id)}.</p>` +
        `<h2>Action</h2><pre id="action">${escapeHtml(String(r.action))}</pre>` +
        `<h2>Payload</h2><pre id="payload">${escapeHtml(JSON.stringify(r.payload, null, 2))}</pre>` +
        `<p>Digest: <code>${escapeHtml(displayedDigest(task))}</code></p>` +
        (context?.summary ? `<h2>Context</h2><p>${escapeHtml(context.summary)}</p>` : "") +
        `<p>Deadline: ${escapeHtml(new Date(task.finalDeadlineAt ?? task.deadlineAt).toISOString())}</p>` +
        `<form method="post" action="/decide/${escapeHtml(task.id)}">` +
        `<input type="hidden" name="csrf" value="${this.csrf(sessionId, task.id)}">` +
        `<input type="hidden" name="digest" value="${escapeHtml(displayedDigest(task))}">` +
        `<label>Reason <input name="reason"></label> ` +
        `<button name="decision" value="approve">Approve</button> <button name="decision" value="reject">Reject</button></form>`,
    );
  }

  private async submit(req: IncomingMessage, res: ServerResponse, taskId: string, sessionId: string, human: HumanProfile): Promise<void> {
    const f = await form(req);
    if (!same(f.get("csrf") ?? "", this.csrf(sessionId, taskId))) return page(res, 403, "Forbidden", "<p>Invalid form token.</p>");
    const task = this.decidable(res, taskId, human);
    if (!task) return;
    const digest = displayedDigest(task);
    if (f.get("digest") !== digest) return page(res, 409, "Payload changed", "<p>Reload the page and decide again.</p>");
    const decision = f.get("decision");
    if (decision !== "approve" && decision !== "reject") return page(res, 400, "Bad request", "<p>Choose approve or reject.</p>");
    const record: Omit<DecisionRecord, "requestId"> = {
      idempotencyKey: task.idempotencyKey,
      primitive: "approve",
      outcome: decision === "approve" ? "approved" : "rejected",
      decidedBy: { type: "human", id: human.id, roles: [...human.roles] },
      decidedAt: new Date(this.options.server.now()).toISOString(),
      channel: "url",
      payloadDigest: digest,
    };
    const reason = f.get("reason");
    if (reason) record.reason = reason;
    try {
      this.options.server.decide(taskId, record);
    } catch (e) {
      if (e instanceof TerminalTaskError) return page(res, 409, "Already decided", `<p>This request is ${escapeHtml(e.task.status)}.</p>`);
      throw e;
    }
    page(res, 200, "Decision recorded", `<p>${escapeHtml(record.outcome)} by ${escapeHtml(human.id)}.</p>`);
  }
}
