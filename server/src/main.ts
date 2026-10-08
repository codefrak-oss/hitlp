#!/usr/bin/env node
// hitlp-server --db <file> [--tokens <file.json>]: serves one client over stdio.
// The tokens file maps bearer tokens to client ids; HITLP_TOKEN picks the
// stdio client's token.
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StaticTokenAuthenticator } from "./auth";
import { HitlpServer } from "./server";
import { SqliteTaskStore } from "./sqlite-store";

const { values } = parseArgs({ options: { db: { type: "string", default: "hitlp.db" }, tokens: { type: "string" } } });
const tokens: Record<string, string> = values.tokens ? JSON.parse(readFileSync(values.tokens, "utf8")) : { local: "local" };
const server = new HitlpServer({
  store: new SqliteTaskStore(values.db!),
  auth: new StaticTokenAuthenticator(tokens),
  defaultToken: process.env.HITLP_TOKEN ?? "local",
  notify: (t) => console.error(`hitlp: new ${t.primitive} task ${t.id} from ${t.clientId}`),
});
void server.connect(new StdioServerTransport());
