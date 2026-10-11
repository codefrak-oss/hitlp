// The hosted decision page for URL-mode Approve (spec 7.6, rule R7): a human
// logs in, sees the action and payload exactly as the agent sent them, and
// approves or rejects once. The same page answers an Ask: the human sees the
// question as the agent sent it and submits one answer. The agent never reaches this surface: its tokens
// are refused here, and the task URL alone grants nothing (R5).
//
// Security choices the reference server makes (deployments SHOULD add MFA for
// Approve, spec 7.6, by plugging in their own HumanAuthenticator):
// - a login form sets a SameSite=Strict, HttpOnly session cookie; sessions are
//   in memory and re-resolve their credential on every request, so revoking a
//   credential ends its sessions;
// - requests carrying an Authorization header are refused, bearer or not,
//   except on /rules, the standing-rules surface, which takes a human's or an
//   admin's credential as a bearer and refuses every agent token;
// - each form carries a CSRF token bound to the session and the task;
// - the task's `requires.roles` and `requires.capabilities` are checked when the
//   page loads and again on submit.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { isTerminal, type AskOption } from "@codefrak/hitlp";
import type { Asserted, Attested } from "@codefrak/hitlp";
import { assertDisjointCredentials, type AdminAuthenticator, type Authenticator, type HumanAuthenticator, type HumanProfile } from "./auth";
import { displayedDigest, missingRequirements } from "./routing";
import { newRule, RuleError, validateRule, type RuleStore } from "./rules";
import { DecisionError, NotRoutedError, type HitlpServer } from "./server";
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
  /** The standing rules managed at /rules (proxy layer 1, spec 3.1); /rules answers 404 when unset. */
  rules?: RuleStore;
  /** Admins who may manage any human's rules at /rules; startup fails if one shares a credential with an agent or approver. */
  admins?: AdminAuthenticator;
}

const COOKIE = "hitlp_session";
const DECIDE = /^\/decide\/([A-Za-z0-9-]+)$/;
const RULES = /^\/rules(?:\/([A-Za-z0-9-]+))?$/;

interface Session {
  credential: string;
  expiresAt: number;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
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

async function text(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 65_536) throw new Error("body too large");
  }
  return body;
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

/**
 * Who is asking (`attested`, the server's) and the requester's own account
 * (`asserted`, unverified), kept apart so neither is mistaken for the other (spec 5.1).
 */
export function provenance(task: StoredTask): string {
  const attested = task.request.attested as Attested | undefined;
  const asserted = task.request.asserted as Asserted | undefined;
  let html = "";
  if (attested) {
    html +=
      `<section id="attested"><h2>Who is asking (attested by the server)</h2><dl>` +
      `<dt>Requester</dt><dd id="attested-requester">${escapeHtml(attested.requester)}</dd>` +
      (attested.onBehalfOf ? `<dt>On behalf of</dt><dd><pre>${escapeHtml(JSON.stringify(attested.onBehalfOf, null, 2))}</pre></dd>` : "") +
      `<dt>Attested by</dt><dd>${escapeHtml(attested.by)}</dd></dl></section>`;
  }
  if (task.request.requiresHuman === true) html += `<p id="requires-human">The requester asked for a person: standing rules were skipped.</p>`;
  if (!asserted) return html;
  html += `<section id="asserted"><h2>The requester's account (asserted, unverified)</h2>`;
  if (asserted.why !== undefined) html += `<h3>Why</h3><p id="why">${escapeHtml(asserted.why)}</p>`;
  if (asserted.onBehalfOf !== undefined) html += `<h3>Says it acts for</h3><pre>${escapeHtml(JSON.stringify(asserted.onBehalfOf, null, 2))}</pre>`;
  const rec = asserted.recommendation;
  if (rec) {
    html +=
      `<h3>Recommendation</h3><dl id="recommendation"><dt>Verdict</dt><dd>${escapeHtml(rec.verdict)}</dd>` +
      (rec.confidence !== undefined ? `<dt>Confidence</dt><dd>${escapeHtml(String(rec.confidence))}</dd>` : "") +
      (rec.by
        ? `<dt>By</dt><dd>${Object.entries(rec.by)
            .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`)
            .join(", ")}</dd>`
        : "") +
      (rec.reasons?.length ? `<dt>Reasons</dt><dd><ul>${rec.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul></dd>` : "") +
      `</dl>`;
  }
  if (asserted.lineage?.length) {
    // Received oldest-first; shown newest-first.
    const links = [...asserted.lineage].reverse();
    html +=
      `<h3>Lineage (newest first)${asserted.asOf ? `, as of ${escapeHtml(asserted.asOf)}` : ""}</h3><ol id="lineage">` +
      links.map((l) => `<li><strong>${escapeHtml(l.kind)}</strong>: ${escapeHtml(l.claim)}${l.by ? ` (${escapeHtml(l.by)})` : ""}</li>`).join("") +
      `</ol>`;
  } else if (asserted.asOf) {
    html += `<p>As of ${escapeHtml(asserted.asOf)}</p>`;
  }
  return html + `</section>`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

export class DecisionPage {
  private readonly sessions = new Map<string, Session>();
  private readonly secret = randomBytes(32);
  private readonly http: Server;

  constructor(private readonly options: DecisionPageOptions) {
    assertDisjointCredentials(options.agents, options.humans, options.admins);
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
    const rules = RULES.exec(url.pathname);
    if (rules) return this.rules(req, res, rules[1]);
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

  /**
   * The standing-rules surface: GET /rules, POST /rules, DELETE /rules/<id>, as
   * JSON with `Authorization: Bearer <credential>`. A human's approver credential
   * manages that human's own rules; an admin credential manages anyone's. An agent
   * token is refused outright: a requester never shapes the proxy that judges it.
   */
  private async rules(req: IncomingMessage, res: ServerResponse, id: string | undefined): Promise<void> {
    const store = this.options.rules;
    if (!store) return json(res, 404, { error: "rules are not enabled" });
    const credential = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (credential === undefined) return json(res, 401, { error: "a bearer credential is required" });
    if (this.options.agents.resolve(credential) !== undefined) return json(res, 403, { error: "agent tokens cannot manage rules" });
    const admin = this.options.admins?.resolve(credential);
    const human = admin === undefined ? this.options.humans.resolve(credential) : undefined;
    if (admin === undefined && !human) return json(res, 401, { error: "unknown credential" });
    const mayManage = (owner: string) => admin !== undefined || owner === human!.id;
    if (req.method === "GET" && id === undefined) {
      return json(res, 200, { rules: store.listRules(admin !== undefined ? undefined : human!.id) });
    }
    if (req.method === "GET") {
      const rule = store.getRule(id!);
      return rule && mayManage(rule.human) ? json(res, 200, rule) : json(res, 404, { error: "no such rule" });
    }
    if (req.method === "POST" && id === undefined) {
      let body: unknown;
      try {
        body = JSON.parse(await text(req));
      } catch {
        return json(res, 400, { error: "the body is not JSON" });
      }
      if (body && typeof body === "object" && !Array.isArray(body) && (body as { human?: unknown }).human === undefined && human) {
        body = { ...body, human: human.id };
      }
      let rule;
      try {
        rule = validateRule(body);
      } catch (e) {
        if (e instanceof RuleError) return json(res, 400, { error: e.message });
        throw e;
      }
      if (!mayManage(rule.human)) return json(res, 403, { error: "a human manages only their own rules" });
      if (this.options.humans.profile && !this.options.humans.profile(rule.human)) return json(res, 400, { error: `no human ${rule.human}` });
      return json(res, 201, store.saveRule(newRule(rule, this.options.server.now())));
    }
    if (req.method === "DELETE" && id !== undefined) {
      const rule = store.getRule(id);
      if (!rule || !mayManage(rule.human)) return json(res, 404, { error: "no such rule" });
      store.deleteRule(id);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(405, { allow: id === undefined ? "GET, POST" : "GET, DELETE" }).end();
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
    if (!task) {
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
    if (task.primitive === "ask") return this.showAsk(res, task, sessionId, human);
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
        provenance(task) +
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
    if (task.primitive === "ask") return this.submitAsk(res, f, task, human);
    const digest = displayedDigest(task);
    if (f.get("digest") !== digest) return page(res, 409, "Payload changed", "<p>Reload the page and decide again.</p>");
    const decision = f.get("decision");
    if (decision !== "approve" && decision !== "reject") return page(res, 400, "Bad request", "<p>Choose approve or reject.</p>");
    const outcome = decision === "approve" ? "approved" : "rejected";
    const reason = f.get("reason") || undefined;
    if (!this.record(res, () => this.options.server.decideAsHuman(taskId, human, "url", { outcome, reason, payloadDigest: digest }))) return;
    page(res, 200, "Decision recorded", `<p>${escapeHtml(outcome)} by ${escapeHtml(human.id)}.</p>`);
  }

  /** Runs the shared decide path (spec 7.8); on a refusal writes the page for it and returns false. */
  private record(res: ServerResponse, decide: () => StoredTask): boolean {
    try {
      decide();
      return true;
    } catch (e) {
      if (e instanceof TerminalTaskError) page(res, 409, "Already decided", `<p>This request is ${escapeHtml(e.task.status)}.</p>`);
      else if (e instanceof NotRoutedError) page(res, 403, "Forbidden", "<p>This request is not routed to you.</p>");
      else if (e instanceof DecisionError) page(res, e.status, e.status === 409 ? "Payload changed" : "Bad request", `<p>${escapeHtml(e.message)}</p>`);
      else throw e;
      return false;
    }
  }

  private showAsk(res: ServerResponse, task: StoredTask, sessionId: string, human: HumanProfile): void {
    const r = task.request;
    const context = r.context as { summary?: string } | undefined;
    const options = (r.options ?? []) as AskOption[];
    const input =
      options.length > 0
        ? options.map((o, i) => `<label><input type="radio" name="option" value="${i}"> ${escapeHtml(o.label)}</label><br>`).join("")
        : `<label>Answer <input name="answer"></label> `;
    page(
      res,
      200,
      "Question",
      `<p>Signed in as ${escapeHtml(human.id)}.</p>` +
        `<h2>Question</h2><p id="question">${escapeHtml(String(r.question))}</p>` +
        (context?.summary ? `<h2>Context</h2><p>${escapeHtml(context.summary)}</p>` : "") +
        provenance(task) +
        `<p>Deadline: ${escapeHtml(new Date(task.finalDeadlineAt ?? task.deadlineAt).toISOString())}</p>` +
        `<form method="post" action="/decide/${escapeHtml(task.id)}">` +
        `<input type="hidden" name="csrf" value="${this.csrf(sessionId, task.id)}">` +
        `${input}<button>Answer</button></form>`,
    );
  }

  /** Records the human's answer: one of `options` when the Ask has them, else the text (JSON when the schema is not a string). */
  private submitAsk(res: ServerResponse, f: URLSearchParams, task: StoredTask, human: HumanProfile): void {
    const options = (task.request.options ?? []) as AskOption[];
    let answer: unknown;
    if (options.length > 0) {
      const option = options[Number(f.get("option") ?? "")];
      if (!/^\d+$/.test(f.get("option") ?? "") || !option) return page(res, 400, "Bad request", "<p>Choose one of the options.</p>");
      answer = option.value;
    } else {
      const text = f.get("answer") ?? "";
      if (text === "") return page(res, 400, "Bad request", "<p>Enter an answer.</p>");
      const schema = task.request.responseSchema as { type?: unknown } | boolean | undefined;
      answer = text;
      if (typeof schema === "object" && schema.type !== undefined && schema.type !== "string") {
        try {
          answer = JSON.parse(text);
        } catch {
          return page(res, 400, "Bad request", "<p>This question takes a JSON answer.</p>");
        }
      }
    }
    if (!this.record(res, () => this.options.server.decideAsHuman(task.id, human, "url", { answer }))) return;
    page(res, 200, "Answer recorded", `<p>Answered by ${escapeHtml(human.id)}.</p>`);
  }
}
