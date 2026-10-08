# @codefrak/hitlp (TypeScript)

TypeScript SDK for HITLP, the human-in-the-loop-protocol.

**Implements HITLP v1.0 (draft)**: [spec/hitlp.md](../../spec/hitlp.md).

It is a client-side SDK: it builds and validates `human.ask` and `human.approve`
requests, calls them over MCP Tasks, polls or cancels the task, and interprets the
decision record. It does not implement a HITLP server.

## Install

```sh
npm install ./sdks/typescript      # from a checkout; not yet published
```

Node 20 or later. Validation uses Ajv (JSON Schema 2020-12) with `ajv-formats`.

## Use

```ts
import { HitlpClient, buildApprove, checkpointFor, isApproved, parseCheckpoint, serializeCheckpoint } from "@codefrak/hitlp";

const client = new HitlpClient(myTransport); // your MCP client, adapted to TaskTransport

const request = buildApprove({
  deadline: "2026-10-15T12:00:00Z", // defaultOnTimeout defaults to "reject"
  requires: { roles: ["approver.production-deploy"] },
  action: "Deploy release 4.21 to production",
  payload: { service: "billing", version: "4.21.0" },
  payloadDigest: "sha256:9f2c1e0a",
});
const task = await client.approve(request); // returns the handle at once (R1)

await save(serializeCheckpoint(checkpointFor(task, request, "approve"))); // before yielding (R3)

// ...later, perhaps in another process:
const cp = parseCheckpoint(await load());
const result = await client.resume(cp); // polls tasks/get at pollInterval
if (result.kind === "decided" && isApproved(result.record, cp)) await deploy();
// Anything else (rejected, timed_out, cancelled, failed, digest mismatch) is not approval (R2).
```

`buildAsk({ question, responseSchema, deadline, defaultOnTimeout })` works the same
way; `answerOf(record)` gives the validated answer.

### What the SDK covers

| Spec | SDK |
| --- | --- |
| Envelope (§5) | `buildEnvelope`; every builder takes its fields |
| Ask (§4.1), Approve (§4.2) | `buildAsk`, `buildApprove` |
| Decision record (§6) | `DecisionRecord`, `resolve`, `isApproved`, `answerOf`, `verifyPayloadDigest` |
| Tools, Task lifecycle (§7.1–7.4) | `HitlpClient`: `ask`, `approve`, `get`, `cancel`, `waitForTerminal` (with `AbortSignal`), `resume` |
| R1 handle, R2 no approval from silence | handles return at once; only `approved` with a matching digest is approval |
| R3 resumable agents | `checkpointFor`, `serializeCheckpoint`, `parseCheckpoint` |
| R4 idempotency | `newIdempotencyKey`; client retries resend the same key |
| Reserved primitives (§4) | `human.do` / `human.inform` / `human.escalate` throw `ReservedToolError` |
| Schemas | `validate(name, value)`; the spec's schemas are vendored in `src/schemas/` |

The transport is three methods (`callTool`, `getTask`, `cancelTask`), so the SDK
does not depend on a particular MCP SDK. `FakeTransport` in `src/testing.ts` is an
in-memory transport for unit tests only; an in-memory task store is not a
conforming server.

## Connecting to an MCP server

`McpTaskTransport` (from `@codefrak/hitlp/mcp`) implements `TaskTransport` over
the official MCP TypeScript SDK and its Tasks extension (spec 7.1-7.4):
`callTool` sends a task-augmented `tools/call` and returns the handle at once,
`getTask` is `tasks/get` (plus `tasks/result` once the task is terminal, whose
`structuredContent` is the decision record), and `cancelTask` is `tasks/cancel`.
MCP errors are rethrown as `McpTransportError` with the JSON-RPC `code`.

The MCP SDK is an optional peer dependency; install it only if you use this adapter:

```sh
npm install @modelcontextprotocol/sdk
```

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { HitlpClient, buildAsk } from "@codefrak/hitlp";
import { McpTaskTransport } from "@codefrak/hitlp/mcp";

const mcp = new Client({ name: "my-agent", version: "1.0.0" });
await mcp.connect(new StreamableHTTPClientTransport(new URL("https://hitlp.example.com/mcp")));

const hitlp = new HitlpClient(new McpTaskTransport(mcp, { ttl: 86_400_000 }));
const task = await hitlp.ask(buildAsk({ /* ... */ }));
const done = await hitlp.waitForTerminal(task);
```

The Tasks API is experimental in the MCP SDK (`client.experimental.tasks`), so
the adapter pins `@modelcontextprotocol/sdk` `^1.32` and may need to follow it.
`test/mcp.test.ts` runs Ask and Approve through it against an in-process MCP server.

## Build and test

```sh
cd sdks/typescript
npm ci
npm run build
npm test
```

The vendored schemas come from `spec/` through `node sdks/scripts/sync-schemas.mjs`;
do not edit them by hand.
