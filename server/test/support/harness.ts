// Starts a HitlpServer on a SQLite file and connects clients to it through the
// TypeScript SDK's McpTaskTransport over an in-memory MCP transport. Each
// client sends its bearer token with every request, as an HTTP client would.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { HitlpClient } from "@codefrak/hitlp";
import { McpTaskTransport } from "@codefrak/hitlp/mcp";
import { HitlpServer, SqliteTaskStore, StaticTokenAuthenticator, type StoredTask } from "../../src";

export const TOKENS = { "token-a": "client-a", "token-b": "client-b" };

/** Wraps a transport so every message it sends carries `token` as its bearer credential. */
function withToken(inner: InMemoryTransport, token: string): Transport {
  const t: Transport = {
    start: () => inner.start(),
    close: () => inner.close(),
    send: (message: JSONRPCMessage, options?: TransportSendOptions) =>
      inner.send(message, { ...options, authInfo: { token, clientId: "", scopes: [] } }),
  };
  inner.onmessage = (m, extra) => t.onmessage?.(m, extra);
  inner.onclose = () => t.onclose?.();
  inner.onerror = (e) => t.onerror?.(e);
  return t;
}

export interface Harness {
  dbPath: string;
  server: HitlpServer;
  auth: StaticTokenAuthenticator;
  notified: StoredTask[];
  /** An SDK client for `token`, through McpTaskTransport. */
  connect(token: string): Promise<{ hitlp: HitlpClient; transport: McpTaskTransport }>;
  /** Closes the server and its store, keeping the database file. */
  stop(): Promise<void>;
  /** Removes the database directory. */
  cleanup(): void;
}

export async function startServer(dbPath?: string): Promise<Harness> {
  const dir = dbPath ? undefined : mkdtempSync(join(tmpdir(), "hitlp-server-"));
  const path = dbPath ?? join(dir!, "tasks.db");
  const auth = new StaticTokenAuthenticator(TOKENS);
  const notified: StoredTask[] = [];
  const server = new HitlpServer({ store: new SqliteTaskStore(path), auth, pollInterval: 1, notify: (t) => void notified.push(t) });
  const clients: Client[] = [];
  return {
    dbPath: path,
    server,
    auth,
    notified,
    async connect(token) {
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
      await server.connect(serverSide);
      const client = new Client({ name: "hitlp-test-client", version: "0.0.0" });
      await client.connect(withToken(clientSide, token));
      clients.push(client);
      const transport = new McpTaskTransport(client);
      return { transport, hitlp: new HitlpClient(transport, { sleep: () => new Promise((r) => setTimeout(r, 1)) }) };
    },
    async stop() {
      for (const c of clients) await c.close();
      await server.close();
      server.store.close();
    },
    cleanup() {
      rmSync(dbPath ? join(path, "..") : dir!, { recursive: true, force: true });
    },
  };
}
