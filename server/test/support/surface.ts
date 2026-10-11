// Starts a HitlpServer with the surface API on a local HTTP listener, the
// approvers and surfaces the surface tests share, and an agent client.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { StaticApproverAuthenticator, StaticSurfaceAuthenticator, SurfaceApi } from "../../src";
import { startServer, type Harness } from "./harness";

export const APPROVERS = [
  { credential: "pw-alice", id: "h-alice", roles: ["release-manager"], capabilities: ["deploy"] },
  { credential: "pw-bob", id: "h-bob", roles: [], capabilities: [] },
];

export const SURFACES = [
  { credential: "sf-alice-phone", id: "alice-phone", human: "h-alice", kind: "phone" },
  { credential: "sf-alice-desktop", id: "alice-desktop", human: "h-alice", kind: "desktop" },
  { credential: "sf-bob-phone", id: "bob-phone", human: "h-bob", kind: "phone" },
];

/** A fetch Response whose JSON the tests read without declaring its shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SurfaceResponse = Omit<Response, "json"> & { json(): Promise<any> };

export interface SurfaceHarness {
  h: Harness;
  api: SurfaceApi;
  surfaces: StaticSurfaceAuthenticator;
  humans: StaticApproverAuthenticator;
  base: string;
  /** fetch against /surface/v1 with `credential` as the bearer. */
  call(credential: string | undefined, path: string, init?: { method?: string; body?: unknown }): Promise<SurfaceResponse>;
  stop(): Promise<void>;
}

export async function startSurface(options: Parameters<typeof startServer>[1] = {}): Promise<SurfaceHarness> {
  const h = await startServer(undefined, options);
  const humans = new StaticApproverAuthenticator(APPROVERS);
  const surfaces = new StaticSurfaceAuthenticator(humans, SURFACES);
  const api = new SurfaceApi({ server: h.server, surfaces, store: h.rules, keepAliveMs: 50 });
  const http: Server = createServer((req, res) => {
    void api.handle(req, res).then((handled) => handled || res.writeHead(404).end());
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}/surface/v1`;
  return {
    h,
    api,
    surfaces,
    humans,
    base,
    call(credential, path, init = {}) {
      const headers: Record<string, string> = {};
      if (credential !== undefined) headers.authorization = `Bearer ${credential}`;
      if (init.body !== undefined) headers["content-type"] = "application/json";
      return fetch(`${base}${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    },
    async stop() {
      api.close();
      http.closeAllConnections();
      await new Promise<void>((r) => http.close(() => r()));
      await h.stop();
      h.cleanup();
    },
  };
}
