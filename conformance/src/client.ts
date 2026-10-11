// A thin MCP client over Streamable HTTP. It sends the given bearer token (or
// none) on every request and returns raw JSON-RPC results, so the tests see
// exactly what the server put on the wire.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { TaskStatusNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const Any = z.object({}).passthrough();

export type Json = Record<string, any>;

/** A JSON-RPC error answer, as the tests assert on it. */
export class RpcError extends Error {
  constructor(readonly code: number | undefined, message: string) {
    super(message);
  }
}

export interface Session {
  request(method: string, params?: Json): Promise<Json>;
  /** The `notifications/tasks/status` params received on the session's stream (spec 7.4), in order. */
  notifications: Json[];
  /** Resolves to the first notification (received so far or later) that `match` accepts; undefined after `timeoutMs`. */
  notification(match: (n: Json) => boolean, timeoutMs: number): Promise<Json | undefined>;
  close(): Promise<void>;
}

export async function connect(url: string, token?: string): Promise<Session> {
  const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` };
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  const client = new Client({ name: "hitlp-conformance", version: "0.1.0" }, { capabilities: {} });
  const notifications: Json[] = [];
  const waiters = new Set<() => void>();
  client.setNotificationHandler(TaskStatusNotificationSchema, (n) => {
    notifications.push(n.params as Json);
    for (const w of waiters) w();
  });
  await client.connect(transport);
  return {
    notifications,
    notification(match, timeoutMs) {
      return new Promise((done) => {
        const check = () => {
          const found = notifications.find(match);
          if (!found) return;
          clearTimeout(timer);
          waiters.delete(check);
          done(found);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          done(undefined);
        }, timeoutMs);
        waiters.add(check);
        check();
      });
    },
    async request(method, params = {}) {
      try {
        return (await client.request({ method, params } as never, Any)) as Json;
      } catch (e) {
        const err = e as { code?: number; message?: string };
        throw new RpcError(err.code, err.message ?? String(e));
      }
    },
    close: () => client.close(),
  };
}

/** Resolves to the error a request fails with; fails the test when it succeeds. */
export async function refused(p: Promise<unknown>, what: string): Promise<RpcError> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RpcError) return e;
    throw e;
  }
  throw new Error(`${what}: expected a JSON-RPC error, got a result`);
}
