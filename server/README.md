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

HITLP 0.2 (spec 3.1, 5.1–5.4, 6):

- **R8 / spec 5.1**: on every `human.ask` and `human.approve`, right after the
  bearer token is resolved and before the request is validated, deduplicated or
  stored, the server drops any `attested` block the request carries and fills
  its own: `{"requester": <client id>, "by": "hitlp-server"}`, plus
  `onBehalfOf` when the `Authenticator` returns one for the token
  (`Authenticator.onBehalfOf`; the flat `tokens.json` map carries none). Nothing
  under `asserted` is ever copied into it. The R4 hash is taken over the request
  without the sent `attested`, so a repeat that differs only there returns the
  existing task, and one that differs in `asserted` is rejected; neither
  notifies anyone.
- **R10 / spec 5.1–5.3**: `asserted` (`why`, `onBehalfOf`, `recommendation`,
  `lineage`, `asOf`) and `requiresHuman` are stored exactly as received, in the
  task's `request`, which stays with the record. Nothing reads them to decide
  but `asserted.recommendation` for the rules below. The decision page shows,
  for an Approve and an Ask, a **Who is asking (attested by the server)** block
  and a separate **The requester's account (asserted, unverified)** block with
  the why, the recommendation (verdict, confidence, by, reasons) and the
  lineage newest first, each link's kind and claim.
- **R9 / spec 3.1, proxy layer 1**: per-human standing rules. A rule is
  `{"human", "conditions": [{"path", "op", "value"}], "outcome", "answer"?}`;
  `op` is `eq`, `in` (value is a list) or `gte` (a number, e.g. on
  `asserted.recommendation.confidence`); `outcome` is `approve` or `reject`
  (decides an Approve) or `answer` with an `answer` (decides an Ask). A path
  must lie under `attested.` or `asserted.recommendation.`; any other path
  (`payload`, `context`, `asserted.why`, `asserted.lineage`, `asserted.asOf`,
  `asserted.onBehalfOf`, …) is refused when the rule is saved, with an error
  naming it, and evaluation only ever sees those two parts of the request.
  Rules run after dedup (R4) and the caps (R6), before the task is routed to a
  human: the first match, oldest rule first, among rules whose human meets the
  task's `requires`, completes the task with `decidedBy: {"type": "rule", "id":
  <rule id>}` and no `channel`, and `notify` is not called. `requiresHuman:
  true` skips every rule. Rules are stored in the same SQLite file (`RuleStore`,
  `src/rules.ts`) and are active when the decision page is configured.

  Rules are managed on the decision page's origin, as JSON with an
  `Authorization: Bearer <credential>` header: `GET /rules`, `POST /rules`,
  `GET /rules/<id>`, `DELETE /rules/<id>` (change a rule by deleting it and
  saving a new one). An approver's credential manages that human's own rules
  (`human` defaults to them); an admin credential from `--admins` (a list of
  `{"credential", "id"}`) manages any approver's. An agent token is refused with
  403, and the server refuses to start if an admin credential is also an agent
  token or an approver credential.
- **R11 / spec 6**: every decision record (human on the page, rule, policy at
  the deadline) carries `attested` as the server filled it and, when the
  request had one, `recommendation` equal to `asserted.recommendation`.
  `decidedBy.type` is `human`, `rule` or `policy`; `model` (proxy layer 2,
  prose rules) is reserved by the schema and not implemented. Human records
  name the surface in `channel`: `url` from the decision page, the surface's
  `kind` from the surface API. Records are not signed.
- **Surfaces / spec 7.8**: every human decision, from the page or the surface
  API, goes through one path, `HitlpServer.decideAsHuman(taskId, human,
  channel, decision)`: the human must satisfy the task's `requires`, the task
  must be open, an Approve's decision is bound to its `payloadDigest` and an
  Ask's answer must match its `responseSchema` (and be one of its `options`).

## Surface API

With `--surfaces surfaces.json` the server answers a REST + JSON API at
`/surface/v1`, on the MCP listener (`--http-port`) and on the decision page's
origin, for the surfaces a human decides on: the hosted page, a desktop app, a
phone app (spec 7.8). The surfaces file is a list of
`{"credential", "id", "human", "kind"}`: `human` is an approver id from
`--approvers` (its roles and capabilities route tasks), `kind` (`page`,
`desktop`, `phone`, ...) becomes the records' `channel`. Revoke a surface by
removing it from the file and restarting.

Every call sends `Authorization: Bearer <surface credential>` and is resolved
afresh (R5). A requester token, an approver credential or no credential gets
401 here; a surface credential on `/mcp` gets 401; the server refuses to start
when a surface credential is also a requester token, approver or admin
credential. A task is routed to the humans whose roles and capabilities
satisfy its `requires`; to anyone else it is not listed and answers 404.

| Call | Answer |
| --- | --- |
| `GET /surface/v1/tasks` | `{"tasks": [view, ...]}`: open tasks routed to the human, and those decided in the last `--surface-recent-hours` (24), newest first. |
| `GET /surface/v1/tasks/{id}` | The task view: `id`, `primitive`, `status`, `createdAt`, `deadline` (effective), `requiresHuman`, `attested` (`source: "server"`), `asserted` (`source: "requester"`: `why`, `recommendation`, `lineage` newest first), for an Approve `action`, `payload` as received and `payloadDigest`, for an Ask `question`, `responseSchema`, `options`; `context`, `requires`, and `result` once decided. |
| `POST /surface/v1/tasks/{id}/decision` | Body `{"outcome": "approve" \| "reject", "reason"?, "payloadDigest"?}` for an Approve, `{"answer", "reason"?}` for an Ask. 200 with the decision record; 400 for a malformed decision or an answer the schema refuses; 404 when not routed; 409 when already decided or the digest is stale. |
| `PUT /surface/v1/devices/{id}` | Body `{"platform": "apns", "token", "environment"?: "production" \| "sandbox", "name"?}`; 200 with the device. |
| `DELETE /surface/v1/devices/{id}` | 204, or 404 when this surface has no such device. |
| `GET /surface/v1/events` | `text/event-stream`: one `event: task` (`id` the task id, `data` the view) per task routed to the human created after the stream opened; keep-alive comments every 25 s. |

Errors are JSON, `{"error": "..."}`. Devices live in the `SurfaceStore`
(`src/store.ts`; SQLite in `src/sqlite-store.ts`).

Push: with `--apns-key <AuthKey.p8> --apns-key-id <id> --apns-team-id <id>
--apns-bundle-id <id>` (and `--apns-sandbox` for devices that name no
environment) each new task is pushed once to every device of every human it is
routed to, never for an R4 repeat or a rule's decision. The alert carries a
title and the task id, never the request's content; the app fetches the task
with its own credential. A device APNs answers 410 for is dropped. Without
the flags the server logs once and pushes nothing. Other push services plug in
as a `PushSender` (`src/push.ts`).

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
`https:` one marks the cookie `Secure`. Serve it behind TLS. `--admins
admins.json` adds rule administrators (it needs `--approvers`). `--surfaces
surfaces.json` turns on the surface API (it needs `--approvers`; see above).

`tokens.json` maps bearer tokens to client ids (`{"secret": "agent-1"}`); over
stdio the token comes from `HITLP_TOKEN`. Without `--tokens` one client,
`local`, is allowed.
