# HITLP conformance suite

Black-box tests of a HITLP server against the spec's normative rules
([spec/hitlp.md](../spec/hitlp.md), section 8) and its JSON Schemas
([spec/schemas](../spec/schemas)). The suite imports nothing from `server/`: it
talks MCP Streamable HTTP to the URL it is given, and plain HTTP to the decision
page the server names, so it runs against any server in any language.

What a client must do is not testable from the server side; it is in
[CLIENT-CHECKLIST.md](CLIENT-CHECKLIST.md).

## Run

```sh
npm ci && npm run build
node dist/cli.js --url http://127.0.0.1:8090/mcp --config fixtures/config.json
```

It prints TAP and exits 1 when a test fails. `--only R5` (repeatable) runs one
rule's tests; `--schemas <dir>` points at another copy of the schemas.

`run-against-server.sh` builds nothing: with `server/`, `sdks/typescript/` and
this suite built, it starts the reference server over HTTP with the fixtures,
runs the suite, restarts the server and runs the R1 durability check. CI
(`.github/workflows/conformance.yml`) runs it on every change to the server,
the suite or the spec.

## The config file

The suite needs test credentials the server accepts, and the caps it enforces:

| Field | Meaning |
| --- | --- |
| `agents` | Two bearer tokens of two different clients. |
| `caps.approveMs`, `caps.askMs` | The server's maximum TTL per primitive (R6). |
| `approver.credential` | A human credential that may decide an Approve with no `requires`. |
| `approver.loginPath`, `approver.field` | Where the decision page's login form posts, and the credential's field name (default `/login`, `credential`). |
| `expiryMs` | How far ahead the R2 tests set their deadlines (default 2000). |
| `agentClients` | The client ids the server authenticates the two `agents` as (R8, R9, R11). |
| `surface.path`, `surface.credential`, `surface.kind` | The surface API on the MCP URL's origin (default `/surface/v1`), a surface credential of a human who may decide an Approve with no `requires`, and the surface's kind, which the record must carry as `channel` (group S). |
| `rules.path`, `rules.credential`, `rules.human` | The standing-rules surface on the decision page's origin (default `/rules`), a credential that manages `rules.human`'s rules there as a bearer, and that human's id (R9, R11). |

The server must run with URL-mode Approve on (a decision page), serve the
surface API with the configured surface credential, and accept
deadlines a few seconds ahead.

## What is tested

| Rule | Tests |
| --- | --- |
| R1 | `human.ask` and `human.approve` return a handle (`taskId`, `status`, `ttl`, `pollInterval`) at once; `tasks/get` and `tasks/result` answer an undecided task without waiting. `--persist-out` / `--persist-in` around a restart check the task survives and its key still names it. |
| R2 | Each default action at the deadline: `reject` (Ask `timed_out`, Approve `rejected`, `completed`), `cancel`, `fail`; the record is decided by `policy` and matches the response schema; terminal stays terminal; `escalate` never turns silence into approval; a request without `deadline` or `defaultOnTimeout` is refused. |
| R4 | Same key and content: same task, across connections. Same key, other content: error. Another client's same key: a new task. A fresh key: a new task. |
| R5 | Another client, no token, or an unknown token cannot `tasks/get`, `tasks/result` or `tasks/cancel` a task, and `tasks/list` shows only the caller's own. |
| R6 | Deadlines beyond the cap are shortened and reported in `ttl`; Approve scopes without `notAfter` or `maxUses` are refused; a bounded one is accepted. |
| R7 | A URL-mode Approve waits in `input_required` with the URL in `_meta["io.hitlp/decisionUrl"]` and `statusMessage`; the URL alone, the agent's bearer token, or client-supplied decision content decides nothing; the agent's token does not sign in; a signed-in approver decides once, and the record names a `human` and channel `url`. |
| R8 | A sent `attested` is accepted and dropped: the record's `attested.requester` is the authenticated client; `asserted.onBehalfOf` is never copied into `attested`. |
| R9 | A rule on `asserted.why`, `asserted.lineage`, `payload` or `context` is refused when saved, naming the field; agent tokens cannot create or delete rules; a matching rule decides an Approve with no human and the record names it (`decidedBy {type: rule, id}`, no `channel`); `requiresHuman` bypasses it. |
| R10 | A lineage claiming authorization decides nothing, and the decision page shows both links, kind and claim, newest first. |
| R11 | Policy, human and rule records validate, name their layer in `decidedBy.type`, and carry `attested` (and the recommendation); a rule's Ask record names the rule. |
| S | The surface API (spec 7.8): a requester token or no credential gets 401 on `/surface/v1`; a surface credential gets 401 on `/mcp`; a surface lists and reads a new Approve (views match `surface/task` and `surface/task-list`, `attested` is the server's, `asserted` the requester's), decides it once, a second decision is refused with 409, and the record has `decidedBy.type` `human` and `channel` the surface's kind. |
| schemas | Every example in `spec/examples` (and `spec/examples/surface`) matches its schema; both tools are listed; requests that break the request schemas are refused; cancel is terminal. |

Not observable from outside, so not tested: R3 (the agent's checkpoint), that a
deduplicated repeat notifies no human (R4), and that tasks work across
instances (R1).
