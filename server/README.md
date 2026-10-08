# HITLP reference server

A TypeScript MCP server that offers `human.ask` and `human.approve` as task
tools (spec section 7), with a durable SQLite task store. It implements:

- **R1**: a call returns its task handle at once; tasks live in SQLite
  (`SqliteTaskStore`) and survive a restart. `tasks/result` never blocks on a
  human: poll `tasks/get`.
- **R4**: requests are deduplicated on `idempotencyKey` per authenticated
  client. A repeat with the same content returns the existing task and notifies
  no one; a repeat with different content is rejected.
- **R5**: every `tools/call`, `tasks/get`, `tasks/result`, `tasks/list` and
  `tasks/cancel` resolves the caller from its bearer token (`authInfo.token`)
  and only shows a task to the client that created it.

Rules R2, R3, R6 and R7 (TTL default actions, TTL caps, a decision page) are
not built yet; `HitlpServer.decide` stands in for the human's decision page.

The store sits behind the `TaskStore` interface (`src/store.ts`) so another
backend can replace SQLite.

## Build and test

The server uses the TypeScript SDK from `../sdks/typescript`, so build it first:

```sh
(cd ../sdks/typescript && npm ci && npm run build)
npm ci
npm test
```

The tests drive the server through the SDK's `McpTaskTransport`.

## Run

```sh
npm run build
node dist/src/main.js --db hitlp.db --tokens tokens.json
```

`tokens.json` maps bearer tokens to client ids (`{"secret": "agent-1"}`); over
stdio the token comes from `HITLP_TOKEN`. Without `--tokens` one client,
`local`, is allowed.
