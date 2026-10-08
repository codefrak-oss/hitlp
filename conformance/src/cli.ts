#!/usr/bin/env node
// hitlp-conformance --url <mcp url> --config <file.json> [--only R5]... [--schemas <dir>]
//   [--persist-out <file> | --persist-in <file>]
// Runs the HITLP conformance tests against a server's MCP Streamable HTTP URL and
// prints TAP; exits 1 when a test fails. --persist-out makes a task and writes
// its handle to a file; after the server restarts, --persist-in checks the task
// survived (R1 durability).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Context, assert, type Config, type Test } from "./context";
import { Schemas } from "./schemas";
import { tests as r1 } from "./tests/r1-handle";
import { tests as r2 } from "./tests/r2-ttl";
import { tests as r4 } from "./tests/r4-idempotency";
import { tests as r5 } from "./tests/r5-reauth";
import { tests as r6 } from "./tests/r6-caps";
import { tests as r7 } from "./tests/r7-decision-page";
import { tests as schemaTests } from "./tests/schemas";

const ALL: Test[] = [...r1, ...r2, ...r4, ...r5, ...r6, ...r7, ...schemaTests];

async function persistOut(ctx: Context, file: string): Promise<void> {
  const s = await ctx.agent();
  const request = ctx.ask();
  const task = await ctx.call(s, "human.ask", request);
  writeFileSync(file, JSON.stringify({ taskId: task.taskId, request }));
  console.log(`ok - R1 made task ${task.taskId}; restart the server and run --persist-in ${file}`);
}

async function persistIn(ctx: Context, file: string): Promise<void> {
  const { taskId, request } = JSON.parse(readFileSync(file, "utf8"));
  const s = await ctx.agent();
  const got = await ctx.get(s, taskId);
  assert(got.taskId === taskId, "tasks/get after the restart named another task");
  const again = await ctx.call(s, "human.ask", request);
  assert(again.taskId === taskId, "after the restart the same key made a new task");
  console.log(`ok - R1 task ${taskId} survived the restart (${got.status})`);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      config: { type: "string" },
      only: { type: "string", multiple: true },
      schemas: { type: "string", default: join(__dirname, "..", "..", "spec", "schemas") },
      "persist-out": { type: "string" },
      "persist-in": { type: "string" },
    },
  });
  if (!values.url || !values.config) {
    console.error("usage: hitlp-conformance --url <mcp url> --config <file.json> [--only <rule>]... [--persist-out|--persist-in <file>]");
    return 2;
  }
  const config = JSON.parse(readFileSync(values.config, "utf8")) as Config;
  const ctx = new Context(values.url, config, new Schemas(values.schemas!));
  try {
    if (values["persist-out"]) await persistOut(ctx, values["persist-out"]);
    else if (values["persist-in"]) await persistIn(ctx, values["persist-in"]);
    else return await runAll(ctx, values.only);
    return 0;
  } catch (e) {
    console.log(`not ok - ${(e as Error).message}`);
    return 1;
  } finally {
    await ctx.closeAll();
  }
}

async function runAll(ctx: Context, only: string[] | undefined): Promise<number> {
  const selected = only?.length ? ALL.filter((t) => only.includes(t.rule)) : ALL;
  console.log("TAP version 13");
  console.log(`1..${selected.length}`);
  // Tests run concurrently: the R2 tests spend most of their time waiting on deadlines.
  const results = await Promise.all(
    selected.map(async (t) => {
      try {
        await t.run(ctx);
        return undefined;
      } catch (e) {
        return (e as Error).message ?? String(e);
      }
    }),
  );
  let failed = 0;
  selected.forEach((t, i) => {
    const err = results[i];
    console.log(`${err ? "not ok" : "ok"} ${i + 1} - ${t.rule}: ${t.name}`);
    if (err) {
      failed++;
      console.log(`  ---\n  message: ${JSON.stringify(err)}\n  ...`);
    }
  });
  console.log(`# ${selected.length - failed} passed, ${failed} failed`);
  return failed === 0 ? 0 : 1;
}

void main().then((code) => process.exit(code));
