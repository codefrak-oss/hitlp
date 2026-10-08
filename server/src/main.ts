#!/usr/bin/env node
// hitlp-server --db <file> [--tokens <file.json>] [--approvers <file.json> --page-url <url>]
//   [--page-port <n>] [--approve-cap-hours <h>] [--ask-cap-hours <h>] [--allow-blanket-scope]
// Serves one client over stdio. The tokens file maps bearer tokens to client ids;
// HITLP_TOKEN picks the stdio client's token. With --approvers, the decision page
// for URL-mode Approve (spec 7.6) listens on --page-port; --page-url is its public
// base URL. The approvers file is a list of {credential, id, roles, capabilities}.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  defaultToken: process.env.HITLP_TOKEN ?? "local",
  caps: { approve: hours(values["approve-cap-hours"]), ask: hours(values["ask-cap-hours"]) },
  allowBlanketScope: values["allow-blanket-scope"],
  decisionUrl: humans && ((id) => `${pageUrl}/decide/${id}`),
  notify: (t) => console.error(`hitlp: new ${t.primitive} task ${t.id} from ${t.clientId}${t.statusMessage ? `: ${t.statusMessage}` : ""}`),
});
if (humans) {
  const page = new DecisionPage({ server, humans, agents: auth, secureCookie: pageUrl.startsWith("https:") });
  void page.listen(port, values["page-host"]).then((url) => console.error(`hitlp: decision page on ${url}`));
}
void server.connect(new StdioServerTransport());
