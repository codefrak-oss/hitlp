// Real-server mode: runs the demo against server/ (spawned from its build) and
// plays the human on the decision page. Skipped until server/ is built.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { connectServer, hello } from "../src/hello";

const MAIN = join(__dirname, "..", "..", "..", "..", "server", "dist", "src", "main.js");
const skip = existsSync(MAIN) ? false : "server/ is not built (npm --prefix ../../server ci && npm --prefix ../../server run build)";

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function startServer(): Promise<{ proc: ChildProcess; mcp: string; page: string }> {
  const dir = mkdtempSync(join(tmpdir(), "hitlp-demo-server-"));
  const approvers = join(dir, "approvers.json");
  writeFileSync(approvers, JSON.stringify([{ credential: "pw-demo", id: "h-demo", roles: [], capabilities: [] }]));
  const pagePort = await freePort();
  const proc = spawn(process.execPath, [MAIN, "--db", join(dir, "hitlp.db"), "--http-port", "0", "--approvers", approvers, "--page-port", String(pagePort)], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  const mcp = await new Promise<string>((resolve, reject) => {
    let err = "";
    proc.stderr!.on("data", (d) => {
      err += d;
      const m = /MCP on (\S+)/.exec(err);
      if (m) resolve(m[1]);
    });
    proc.on("exit", () => reject(new Error(`server exited: ${err}`)));
  });
  return { proc, mcp, page: `http://127.0.0.1:${pagePort}` };
}

/** The human: logs in, then answers each task the agent says it waits on. */
async function human(page: string, lines: string[], answers: Record<string, string>[]): Promise<void> {
  const login = await fetch(`${page}/login`, { method: "POST", body: new URLSearchParams({ credential: "pw-demo", next: "" }), redirect: "manual" });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  let seen = 0;
  for (const fields of answers) {
    let id: string | undefined;
    while (!id) {
      for (; seen < lines.length && !id; seen++) id = /Task (\S+) waits for a human/.exec(lines[seen])?.[1];
      if (!id) await new Promise((r) => setTimeout(r, 20));
    }
    const url = `${page}/decide/${id}`;
    const html = await (await fetch(url, { headers: { cookie } })).text();
    const hidden = (name: string) => new RegExp(`name="${name}" value="([^"]*)"`).exec(html)?.[1];
    const body = new URLSearchParams({ csrf: hidden("csrf") ?? "", ...fields });
    const digest = hidden("digest");
    if (digest) body.set("digest", digest);
    const res = await fetch(url, { method: "POST", headers: { cookie }, body });
    assert.equal(res.status, 200, await res.text());
  }
}

async function run(answers: Record<string, string>[]) {
  const { proc, mcp, page } = await startServer();
  const { transport, close } = await connectServer(mcp, "local");
  const lines: string[] = [];
  const checkpointFile = join(mkdtempSync(join(tmpdir(), "hitlp-demo-")), "cp.json");
  try {
    const [result] = await Promise.all([hello({ transport, log: (l) => lines.push(l), checkpointFile }), human(page, lines, answers)]);
    return { result, lines };
  } finally {
    await close();
    proc.kill();
  }
}

test("server mode: the human answers and approves on the decision page", { skip }, async () => {
  const { result, lines } = await run([{ answer: "Ada" }, { decision: "approve" }]);
  assert.deepEqual(result, { name: "Ada", deployed: true });
  assert.ok(lines.some((l) => l.includes("Approved by h-demo")));
  assert.ok(lines.some((l) => /waits for a human at http:\/\/127\.0\.0\.1:\d+\/decide\//.test(l)));
});

test("server mode: nothing is deployed when the human rejects", { skip }, async () => {
  const { result, lines } = await run([{ answer: "Ada" }, { decision: "reject" }]);
  assert.deepEqual(result, { name: "Ada", deployed: false });
  assert.ok(lines.some((l) => l.includes("Not approved (rejected)")));
});
