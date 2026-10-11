#!/usr/bin/env node
// hitlp-server --db <file> [--tokens <file.json>] [--approvers <file.json> --page-url <url>]
//   [--admins <file.json>] [--page-port <n>] [--approve-cap-hours <h>] [--ask-cap-hours <h>] [--allow-blanket-scope]
//   [--http-port <n> [--http-host <h>]] [--surfaces <file.json> [--surface-recent-hours <h>]]
//   [--apns-key <file.p8> --apns-key-id <id> --apns-team-id <id> --apns-bundle-id <id> [--apns-sandbox]]
//   [--pushover-token-file <file> --pushover-user-file <file> [--pushover-priority <n>]]
// Over HTTP --tokens is required, and --page-url with --approvers: no default.
// Serves one client over stdio, or with --http-port any number of clients over
// MCP Streamable HTTP at /mcp, each request's Authorization bearer token naming
// its client (R5). The tokens file maps bearer tokens to client ids;
// HITLP_TOKEN picks the stdio client's token. With --approvers, the decision page
// for URL-mode Approve (spec 7.6), which also answers Asks, listens on --page-port; --page-url is its public
// base URL. The approvers file is a list of {credential, id, roles, capabilities}.
// The page also serves /rules, where an approver manages their own standing rules
// (proxy layer 1) and an admin from the --admins file ({credential, id} list) anyone's.
// With --surfaces ({credential, id, human, kind} list; `human` is an approver id) the
// surface API (spec 7.8) answers under /surface/v1 on the MCP listener and the page;
// with the --apns-* flags new tasks are pushed to the devices surfaces register.
// With both --pushover-* files, each new task routed to an approver is also sent as a Pushover message.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { assertSurfaceCredentialsDisjoint, StaticAdminAuthenticator, StaticApproverAuthenticator, StaticSurfaceAuthenticator, StaticTokenAuthenticator } from "./auth";
import { HOUR } from "./caps";
import { DecisionPage } from "./decision-page";
import { pushSenderFor, wirePush } from "./push";
import { PushoverSender, wirePushover } from "./pushover";
import { HitlpServer } from "./server";
import { bearerOf, SurfaceApi } from "./surface";
import { SqliteTaskStore } from "./sqlite-store";

const { values } = parseArgs({
  options: {
    db: { type: "string", default: "hitlp.db" },
    tokens: { type: "string" },
    approvers: { type: "string" },
    admins: { type: "string" },
    "page-port": { type: "string", default: "8080" },
    "page-host": { type: "string", default: "127.0.0.1" },
    "page-url": { type: "string" },
    "approve-cap-hours": { type: "string" },
    "ask-cap-hours": { type: "string" },
    "allow-blanket-scope": { type: "boolean", default: false },
    "http-port": { type: "string" },
    "http-host": { type: "string", default: "127.0.0.1" },
    surfaces: { type: "string" },
    "surface-recent-hours": { type: "string", default: "24" },
    "apns-key": { type: "string" },
    "apns-key-id": { type: "string" },
    "apns-team-id": { type: "string" },
    "apns-bundle-id": { type: "string" },
    "apns-sandbox": { type: "boolean", default: false },
    "pushover-token-file": { type: "string" },
    "pushover-user-file": { type: "string" },
    "pushover-priority": { type: "string" },
  },
});
// Over HTTP nothing defaults: a missing setting stops the server, naming it.
const httpMode = values["http-port"] !== undefined;
const missing = [
  httpMode && !values.tokens && "--tokens (HTTP mode)",
  httpMode && values.approvers && !values["page-url"] && "--page-url (HTTP mode with --approvers)",
].filter(Boolean);
if (missing.length) {
  console.error(`hitlp: missing required setting ${missing.join(", ")}`);
  process.exit(2);
}
// Over stdio one local client is allowed without a tokens file.
const tokens: Record<string, string> = values.tokens ? JSON.parse(readFileSync(values.tokens, "utf8")) : { local: "local" };
const auth = new StaticTokenAuthenticator(tokens);
const humans = values.approvers ? new StaticApproverAuthenticator(JSON.parse(readFileSync(values.approvers, "utf8"))) : undefined;
if (values.admins && !humans) throw new Error("--admins needs --approvers: rules are managed on the decision page");
const admins = values.admins ? new StaticAdminAuthenticator(JSON.parse(readFileSync(values.admins, "utf8"))) : undefined;
const store = new SqliteTaskStore(values.db!);
const port = Number(values["page-port"]);
const pageUrl = (values["page-url"] ?? (httpMode ? "" : `http://${values["page-host"]}:${port}`)).replace(/\/$/, "");
const hours = (v: string | undefined) => (v === undefined ? undefined : Number(v) * HOUR);
const server = new HitlpServer({
  store,
  // Standing rules decide only with a decision page: its approvers are the humans they belong to.
  rules: humans && store,
  humanProfile: humans && ((id) => humans.profile(id)),
  auth,
  // Over HTTP a request without a token is anonymous and refused (R5).
  defaultToken: values["http-port"] === undefined ? (process.env.HITLP_TOKEN ?? "local") : undefined,
  caps: { approve: hours(values["approve-cap-hours"]), ask: hours(values["ask-cap-hours"]) },
  allowBlanketScope: values["allow-blanket-scope"],
  decisionUrl: humans && ((id) => `${pageUrl}/decide/${id}`),
  notify: (t) => {
    console.error(`hitlp: new ${t.primitive} task ${t.id} from ${t.clientId}${t.statusMessage ? `: ${t.statusMessage}` : ""}`);
    // An Ask carries no decision URL meta; the page still answers it, so log where.
    if (humans && t.primitive === "ask") console.error(`hitlp: answer at ${pageUrl}/decide/${t.id}`);
  },
});
if (values.surfaces && !humans) throw new Error("--surfaces needs --approvers: a surface's human is an approver");
const surfaces = humans && values.surfaces ? new StaticSurfaceAuthenticator(humans, JSON.parse(readFileSync(values.surfaces, "utf8"))) : undefined;
if (surfaces) assertSurfaceCredentialsDisjoint(surfaces, auth, humans, admins);
const surface = surfaces && new SurfaceApi({ server, surfaces, store, recentMs: hours(values["surface-recent-hours"]) });
if (surfaces) {
  const sender = pushSenderFor({
    key: values["apns-key"] && readFileSync(values["apns-key"], "utf8"),
    keyId: values["apns-key-id"],
    teamId: values["apns-team-id"],
    bundleId: values["apns-bundle-id"],
    sandbox: values["apns-sandbox"],
  });
  wirePush(server, surfaces, store, sender);
}
if (values["pushover-token-file"] && values["pushover-user-file"]) {
  const priority = values["pushover-priority"] === undefined ? undefined : Number(values["pushover-priority"]);
  if (priority !== undefined && !(Number.isInteger(priority) && priority >= -2 && priority <= 2)) throw new Error("--pushover-priority must be an integer from -2 to 2");
  const sender = new PushoverSender({
    token: readFileSync(values["pushover-token-file"], "utf8").trim(),
    user: readFileSync(values["pushover-user-file"], "utf8").trim(),
    pageUrl: values["page-url"],
    approvePriority: priority,
  });
  wirePushover(server, sender, humans && (() => [...humans.credentials()].map((c) => humans.resolve(c)!)));
} else if (values["pushover-token-file"] || values["pushover-user-file"]) {
  console.error("hitlp: Pushover needs both --pushover-token-file and --pushover-user-file; sending none");
}
if (humans) {
  const page = new DecisionPage({ server, humans, agents: auth, admins, rules: store, surface, secureCookie: pageUrl.startsWith("https:") });
  void page.listen(port, values["page-host"]).then((url) => console.error(`hitlp: decision page on ${url}`));
}
if (values["http-port"] === undefined) {
  void server.connect(new StdioServerTransport());
} else {
  // One transport per MCP session; the token is read from every request, never the session.
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const http = createServer(async (req: IncomingMessage & { auth?: AuthInfo }, res) => {
    try {
      if (surface && (await surface.handle(req, res))) return;
      if (new URL(req.url ?? "/", "http://mcp").pathname !== "/mcp") {
        res.writeHead(404).end();
        return;
      }
      const bearer = bearerOf(req);
      // A surface credential opens the surface API only (spec 7.8).
      if (surface?.isSurfaceCredential(bearer)) {
        res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "a surface credential is not a requester token" }));
        return;
      }
      if (bearer) req.auth = { token: bearer, clientId: "", scopes: [] };
      const sid = req.headers["mcp-session-id"];
      let transport = typeof sid === "string" ? sessions.get(sid) : undefined;
      if (!transport) {
        if (sid !== undefined) {
          res.writeHead(404).end();
          return;
        }
        const t: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => void sessions.set(id, t),
        });
        t.onclose = () => t.sessionId && sessions.delete(t.sessionId);
        await server.connect(t);
        transport = t;
      }
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  http.listen(Number(values["http-port"]), values["http-host"], () => {
    const addr = http.address();
    console.error(`hitlp: MCP on http://${values["http-host"]}:${typeof addr === "object" && addr ? addr.port : values["http-port"]}/mcp`);
  });
}
