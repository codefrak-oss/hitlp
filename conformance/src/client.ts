// A thin MCP client over Streamable HTTP. It sends the given bearer token (or
// none) on every request and returns raw JSON-RPC results, so the tests see
// exactly what the server put on the wire.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
  close(): Promise<void>;
}

export async function connect(url: string, token?: string): Promise<Session> {
  const headers: Record<string, string> = token === undefined ? {} : { authorization: `Bearer ${token}` };
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  const client = new Client({ name: "hitlp-conformance", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  return {
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
