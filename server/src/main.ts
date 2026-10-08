#!/usr/bin/env node
// hitlp-server --db <file> [--tokens <file.json>] [--approvers <file.json> --page-url <url>]
//   [--page-port <n>] [--approve-cap-hours <h>] [--ask-cap-hours <h>] [--allow-blanket-scope]
//   [--http-port <n> [--http-host <h>]]
// Serves one client over stdio, or with --http-port any number of clients over
// MCP Streamable HTTP at /mcp, each request's Authorization bearer token naming
// its client (R5). The tokens file maps bearer tokens to client ids;
// HITLP_TOKEN picks the stdio client's token. With --approvers, the decision page
// for URL-mode Approve (spec 7.6) listens on --page-port; --page-url is its public
// base URL. The approvers file is a list of {credential, id, roles, capabilities}.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { StaticApproverAuthenticator, StaticTokenAuthenticator } from "./auth";
import { HOUR } from "./caps";
import { DecisionPage } from "./decision-page";
import { HitlpServer } from "./server";
import { SqliteTaskStore } from "./sqlite-store";

const { values } = parseArgs({
  options: {
    db: { type: "string", default: "hitlp.db" },
    tokens: { type: "string" },
    approvers: { type: "string" },
    "page-port": { type: "string", default: "8080" },
    "page-host": { type: "string", default: "127.0.0.1" },
    "page-url": { type: "string" },
    "approve-cap-hours": { type: "string" },
    "ask-cap-hours": { type: "string" },
    "allow-blanket-scope": { type: "boolean", default: false },
    "http-port": { type: "string" },
    "http-host": { type: "string", default: "127.0.0.1" },
  },
});
const tokens: Record<string, string> = values.tokens ? JSON.parse(readFileSync(values.tokens, "utf8")) : { local: "local" };
const auth = new StaticTokenAuthenticator(tokens);
const humans = values.approvers ? new StaticApproverAuthenticator(JSON.parse(readFileSync(values.approvers, "utf8"))) : undefined;
const port = Number(values["page-port"]);
const pageUrl = (values["page-url"] ?? `http://${values["page-host"]}:${port}`).replace(/\/$/, "");
const hours = (v: string | undefined) => (v === undefined ? undefined : Number(v) * HOUR);
const server = new HitlpServer({
  store: new SqliteTaskStore(values.db!),
  auth,
  // Over HTTP a request without a token is anonymous and refused (R5).
  defaultToken: values["http-port"] === undefined ? (process.env.HITLP_TOKEN ?? "local") : undefined,
  caps: { approve: hours(values["approve-cap-hours"]), ask: hours(values["ask-cap-hours"]) },
  allowBlanketScope: values["allow-blanket-scope"],
  decisionUrl: humans && ((id) => `${pageUrl}/decide/${id}`),
  notify: (t) => console.error(`hitlp: new ${t.primitive} task ${t.id} from ${t.clientId}${t.statusMessage ? `: ${t.statusMessage}` : ""}`),
});
if (humans) {
  const page = new DecisionPage({ server, humans, agents: auth, secureCookie: pageUrl.startsWith("https:") });
  void page.listen(port, values["page-host"]).then((url) => console.error(`hitlp: decision page on ${url}`));
}
if (values["http-port"] === undefined) {
  void server.connect(new StdioServerTransport());
} else {
  // One transport per MCP session; the token is read from every request, never the session.
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const http = createServer(async (req: IncomingMessage & { auth?: AuthInfo }, res) => {
    try {
      if (new URL(req.url ?? "/", "http://mcp").pathname !== "/mcp") {
        res.writeHead(404).end();
        return;
      }
      const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "")?.[1];
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
