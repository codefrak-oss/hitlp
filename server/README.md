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

- **R2**: a task's effective deadline is the earliest of its `deadline`, the
  MCP task `ttl` the client asked for, and the cap. When it passes, the server
  applies `defaultOnTimeout` and writes a decision record with
  `decidedBy.type: policy`: `reject` ends `completed` (`rejected` for Approve,
  `timed_out` for Ask), `cancel` ends `cancelled`, `fail` ends `failed`, and
  `escalate` calls `onEscalate` and keeps waiting `escalationGraceMs` (24h by
  default) before it rejects. Expiry runs on start, on a timer
  (`expirySweepMs`, 30s) and on every read. Store updates are compare-and-set,
  so an expiry and a late decision cannot both win. Terminal tasks are kept
  (the retention period of spec 7.5 is unbounded).
- **R6**: TTLs are capped per primitive (Approve 24h, Ask 7 days; `caps`,
  `--approve-cap-hours`, `--ask-cap-hours`); a longer deadline is shortened
  and the effective deadline reported in `ttl`. An Approve whose `scope` has
  no `notAfter` or no `maxUses` is refused unless `allowBlanketScope`
  (`--allow-blanket-scope`) is set.
- **R7 / spec 7.6**: with a decision page configured, `human.approve` moves the
  task to `input_required` with `statusMessage` `Decision required: <url>` and
  `_meta["io.hitlp/decisionUrl"]`. The task stays there until the human decides
  or the TTL passes, then goes straight to terminal; the client never submits
  anything. The page (`DecisionPage`, `src/decision-page.ts`):
  - authenticates humans through the `HumanAuthenticator` interface; the
    static implementation reads `--approvers`, a list of human profiles
    (`{"credential", "id", "roles", "capabilities"}`, spec section 3). The
    server refuses to start if a credential is also an agent token;
  - takes a login form that sets a `SameSite=Strict`, `HttpOnly` session
    cookie, and refuses any request with an `Authorization` header; the URL
    alone grants nothing;
  - checks the task's `requires.roles` and `requires.capabilities` when the
    page loads and on submit, and protects the form with a per-session,
    per-task CSRF token;
  - shows the action and payload exactly as received and records one
    decision: `decidedBy` carries the approver's id and roles, `channel` is
    `url`, and `payloadDigest` is the request's digest (or a sha256 over the
    canonical payload when it has none). A second submit is refused.
  - answers an Ask the same way, at `/decide/<id>` behind the same login,
    `requires` and CSRF checks: the human sees the question as received and
    submits one answer, free text or one of the request's `options` (text is
    parsed as JSON when `responseSchema` is not a string). The record has
    outcome `answered`, the human's `decidedBy` and `channel` `url`. An Ask's
    status and `_meta` do not change; `hitlp-server` logs its page URL when
    the task is created.

  MFA is not built in: deployments SHOULD add it for Approve (spec 7.6) by
  plugging in an OIDC- or MFA-backed `HumanAuthenticator`. Page sessions live
  in memory, so a restart asks approvers to sign in again.

R3 is the agent's (the SDKs' checkpoints). Without a decision page,
`HitlpServer.decide` is how a decision is recorded.

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

With `--http-port <n>` (and `--http-host`, default `127.0.0.1`) it serves MCP
Streamable HTTP at `/mcp` instead of stdio; each request's
`Authorization: Bearer` token names its client, and a request without one is
refused. The conformance suite (`../conformance`) runs against that URL.

With `--approvers approvers.json` the decision page listens on `--page-port`
(8080) on `--page-host` (127.0.0.1); `--page-url` is its public base URL, and an
`https:` one marks the cookie `Secure`. Serve it behind TLS.

`tokens.json` maps bearer tokens to client ids (`{"secret": "agent-1"}`); over
stdio the token comes from `HITLP_TOKEN`. Without `--tokens` one client,
`local`, is allowed.
