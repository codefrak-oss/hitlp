# HITLP: Human-in-the-Loop Protocol

**Version:** 1.0 (draft) · **MCP binding target:** MCP 2026-07-28 with the Tasks extension (`io.modelcontextprotocol/tasks`)

## 1. Introduction

Agents have a standard way to call tools but no standard way to call people. Each
orchestrator builds its own "waiting for a human" state, its own approval button and
its own notification path, so requests to humans have no portable shape and humans
cannot be pooled or routed across engines.

HITLP fills that gap. It models a human as a **typed resource** that an agent calls the
way it calls a tool: the agent sends a structured request, and later reads back a
structured, attributable decision. Routing, delivery, reminders, escalation and audit
belong to a **HITLP server** (the human-side control plane). The agent sees only
ordinary MCP tool calls and task handles.

HITLP does not define a new wire protocol. It is a set of request shapes, a decision
record, and normative rules, carried over MCP Tasks (section 7).

### 1.1 Conformance

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
RECOMMENDED, MAY and OPTIONAL are to be interpreted as described in RFC 2119 and
RFC 8174 when, and only when, they appear in all capitals.

A conforming **server** implements every v1 primitive (Ask, Approve), the envelope,
the decision record, the MCP binding, and every rule in section 8. A conforming
**client** (agent or orchestrator) follows the client-side rules in section 8.

### 1.2 Terminology

- **Agent**: the software that issues a request and consumes the decision.
- **Client**: the MCP client acting for the agent.
- **Server**: an MCP server implementing HITLP.
- **Human**: a person reachable through the server, described by a profile (section 3).
- **Request**: one call of a primitive, made of an envelope plus a primitive body.
- **Handle**: the MCP task identifier returned for a request.
- **Decision record**: the server's durable, attributable record of how a request ended.
- **Default action**: what the server does when a request reaches its deadline unanswered.

## 2. Architecture

<svg xmlns="http://www.w3.org/2000/svg" width="720" height="200" viewBox="0 0 720 200" font-family="sans-serif" font-size="13">
  <rect x="10" y="60" width="140" height="70" rx="8" fill="#eef3ff" stroke="#3a5bbf"/>
  <text x="80" y="90" text-anchor="middle">Agent</text>
  <text x="80" y="110" text-anchor="middle" font-size="11">(checkpoints handle)</text>
  <rect x="260" y="40" width="200" height="110" rx="8" fill="#f2fbf2" stroke="#2e8b57"/>
  <text x="360" y="70" text-anchor="middle">HITLP server</text>
  <text x="360" y="92" text-anchor="middle" font-size="11">durable task store</text>
  <text x="360" y="110" text-anchor="middle" font-size="11">routing · escalation</text>
  <text x="360" y="128" text-anchor="middle" font-size="11">decision records</text>
  <rect x="570" y="20" width="140" height="40" rx="8" fill="#fff6e8" stroke="#c07a12"/>
  <text x="640" y="45" text-anchor="middle">Chat / SMS</text>
  <rect x="570" y="75" width="140" height="40" rx="8" fill="#fff6e8" stroke="#c07a12"/>
  <text x="640" y="100" text-anchor="middle">Inbox</text>
  <rect x="570" y="130" width="140" height="40" rx="8" fill="#fff6e8" stroke="#c07a12"/>
  <text x="640" y="155" text-anchor="middle">Hosted decision page</text>
  <line x1="150" y1="85" x2="258" y2="85" stroke="#333" marker-end="url(#a)"/>
  <text x="204" y="78" text-anchor="middle" font-size="11">human.ask / approve</text>
  <line x1="258" y1="110" x2="152" y2="110" stroke="#333" marker-end="url(#a)"/>
  <text x="204" y="126" text-anchor="middle" font-size="11">Task handle, status</text>
  <line x1="460" y1="80" x2="568" y2="40" stroke="#333" marker-end="url(#a)"/>
  <line x1="460" y1="95" x2="568" y2="95" stroke="#333" marker-end="url(#a)"/>
  <line x1="460" y1="110" x2="568" y2="150" stroke="#333" marker-end="url(#a)"/>
  <defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#333"/></marker></defs>
</svg>

The agent talks MCP to the server and never to a human directly. The server picks the
humans, renders the request for each channel (the same request, rendered differently),
and records the decision.

## 3. The human as a typed resource

A server exposes humans by what they can answer, not by who they are. A **human
profile** has:

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Stable, server-scoped identifier. |
| `capabilities` | string[] | What the human can answer or judge, e.g. `finance.invoice`, `lang.de`. |
| `roles` | string[] | Authority the human holds, e.g. `approver.production-deploy`. |
| `channels` | string[] | Delivery channels the server can reach the human on. |

Capabilities say what a human *knows*; roles say what a human *may authorize*. A
request targets a capability and/or a role (section 5), and the server routes it to any
eligible human or pool. A server MUST NOT route a request to a human who lacks a
required capability or role. A server MAY expose a discovery tool listing available
capabilities and roles; v1 does not standardise its shape. Agents SHOULD NOT address
individual humans; addressing by capability lets the server pool, balance and escalate.

## 4. Request primitives

| Primitive | Body | Result | v1 status |
| --- | --- | --- | --- |
| **Ask** | A question and a schema for the answer | An answer valid against that schema | **Normative** |
| **Approve** | A payload to inspect and the action it authorizes | `approved` or `rejected`, with a reason | **Normative** |
| Do | A task for a human to perform and a completion contract | Evidence of completion | Reserved |
| Inform | A notice, optionally needing acknowledgement | Acknowledgement | Reserved |
| Escalate | A hand-off of a request to another human or audience | The handed-off request's outcome | Reserved |

Reserved primitives MUST NOT be implemented under the `human.` tool names of section 7
until a later version of this spec defines them. A server MAY offer them under its own
vendor prefix.

### 4.1 Ask

Ask poses a question whose answer the server validates. The body has:

- `question` (string, REQUIRED): the question as shown to the human.
- `responseSchema` (object, REQUIRED): a JSON Schema the answer MUST satisfy. Ask is not
  free text by default: a free-text answer must be asked for explicitly with
  `{"type": "string"}`. Servers MUST support at least `string`, `number`, `integer`,
  `boolean`, `enum` (pick-one) and flat `object` schemas.
- `options` (array, OPTIONAL): labelled choices `{value, label}` for a pick-one
  question; when present, the answer MUST be one of the `value`s.

The server MUST validate the human's answer against `responseSchema` before completing
the task and MUST NOT complete it with an invalid answer.

### 4.2 Approve

Approve asks a human to authorize an action after inspecting what it will do. Policy,
authentication and audit treat it more strictly than Ask. The body has:

- `action` (string, REQUIRED): a short description of what is to be authorized.
- `payload` (object, REQUIRED): the material the human inspects (a diff, an amount, a
  command). The server MUST show the human the payload exactly as received.
- `payloadDigest` (string, OPTIONAL): a hash of the payload; when given, the decision
  record MUST carry the same digest, binding the approval to that exact payload.
- `scope` (object, OPTIONAL): bounds on what the approval covers (e.g. `maxUses`,
  `notAfter`). Approvals are single-use unless a scope says otherwise.

The decision is `approved` or `rejected`. A `rejected` decision SHOULD carry a reason.
Approve MUST be gathered through a human-only surface (section 7.6).

## 5. Common request envelope

Every request carries the envelope in addition to its primitive body
([schema](schemas/envelope.schema.json)).

| Field | Type | Req. | Meaning |
| --- | --- | --- | --- |
| `idempotencyKey` | string | REQUIRED | Client-chosen key; the same key always names the same request (rule R4). |
| `deadline` | RFC 3339 date-time | REQUIRED | When the request stops waiting for a human. |
| `defaultOnTimeout` | enum | REQUIRED | The default action at the deadline: `reject`, `escalate`, `cancel` or `fail`. |
| `priority` | enum | OPTIONAL | `low`, `normal` (default), `high`, `urgent`. Affects routing and reminders, not validity. |
| `requires` | object | OPTIONAL | `{capabilities: string[], roles: string[]}`; a human must hold all listed. |
| `context` | object | OPTIONAL | Background shown to the human: `summary` (string), `links` (URI[]), `data` (object). |
| `requester` | object | OPTIONAL | Who asks: `{agent, onBehalfOf}`. Recorded in the decision record. |

Default actions:

- `reject`: the request ends with outcome `rejected` (Approve) or `timed_out` (Ask), and
  the task is `completed`. This is the RECOMMENDED default for Approve.
- `escalate`: the server re-routes to a wider audience and keeps waiting until a
  server-set final deadline, after which it applies `reject`.
- `cancel`: the task ends `cancelled`.
- `fail`: the task ends `failed`.

A server MAY shorten a `deadline` to its TTL cap (rule R6) and MUST report the
effective deadline in the task's `ttl`.

## 6. Decision record

Every request that ends, however it ends, produces exactly one decision record
([schema](schemas/decision-record.schema.json)). It is the task result.

| Field | Type | Meaning |
| --- | --- | --- |
| `requestId` | string | Server-assigned request id (equal to the task id). |
| `idempotencyKey` | string | The envelope's key. |
| `primitive` | `ask` \| `approve` | |
| `outcome` | enum | `answered` (Ask), `approved`, `rejected`, `timed_out`, `cancelled`. |
| `answer` | any | Ask only, when `answered`: the validated answer. |
| `reason` | string | Free-text justification; SHOULD be present when `rejected`. |
| `decidedBy` | object | `{type: human \| policy, id, roles}`; `policy` when a default action decided. |
| `decidedAt` | date-time | When the decision was made. |
| `channel` | string | Where it was made, e.g. `url`, `chat`, `sms`. |
| `payloadDigest` | string | Approve: the digest of the payload the human saw. |
| `signature` | object | OPTIONAL: `{alg, keyId, value}` over the canonical record without `signature`. |

The server MUST persist the record before reporting the task `completed`, MUST NOT
change it afterwards, and SHOULD sign it. Timeout outcomes MUST name `policy` as the
decider, never a human.

## 7. Binding over MCP (2026-07-28)

A HITLP server is an MCP server. It MUST support the stateless core of MCP 2026-07-28
and the Tasks extension `io.modelcontextprotocol/tasks`, and SHOULD support
`subscriptions/listen` and URL-mode elicitation.

### 7.1 Tools

| Tool | Status | Arguments |
| --- | --- | --- |
| `human.ask` | v1 | [ask.request.schema.json](schemas/ask.request.schema.json) |
| `human.approve` | v1 | [approve.request.schema.json](schemas/approve.request.schema.json) |
| `human.do`, `human.inform`, `human.escalate` | reserved | |

Tool arguments are the envelope fields and the primitive body, flattened into one
object. Results are defined in [ask.response.schema.json](schemas/ask.response.schema.json)
and [approve.response.schema.json](schemas/approve.response.schema.json).

### 7.2 Every call returns a Task

Every call of a `human.*` tool MUST return a Task handle at once, without waiting for
a human. The handle carries the task id, `status`, `ttl` and `pollInterval`. The server
MUST persist the request durably before returning the handle.

### 7.3 Statuses and lifecycle

<svg xmlns="http://www.w3.org/2000/svg" width="700" height="230" viewBox="0 0 700 230" font-family="sans-serif" font-size="13">
  <defs><marker id="b" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#333"/></marker></defs>
  <rect x="20" y="95" width="110" height="40" rx="20" fill="#eef3ff" stroke="#3a5bbf"/><text x="75" y="120" text-anchor="middle">working</text>
  <rect x="220" y="20" width="140" height="40" rx="20" fill="#fff6e8" stroke="#c07a12"/><text x="290" y="45" text-anchor="middle">input_required</text>
  <rect x="460" y="20" width="120" height="40" rx="20" fill="#f2fbf2" stroke="#2e8b57"/><text x="520" y="45" text-anchor="middle">completed</text>
  <rect x="460" y="95" width="120" height="40" rx="20" fill="#fdeeee" stroke="#b03030"/><text x="520" y="120" text-anchor="middle">failed</text>
  <rect x="460" y="170" width="120" height="40" rx="20" fill="#f0f0f0" stroke="#666"/><text x="520" y="195" text-anchor="middle">cancelled</text>
  <line x1="130" y1="105" x2="220" y2="50" stroke="#333" marker-end="url(#b)"/>
  <line x1="250" y1="60" x2="125" y2="100" stroke="#333" stroke-dasharray="4" marker-end="url(#b)"/>
  <line x1="360" y1="40" x2="458" y2="40" stroke="#333" marker-end="url(#b)"/>
  <text x="410" y="33" text-anchor="middle" font-size="11">decision</text>
  <line x1="130" y1="110" x2="458" y2="45" stroke="#333" marker-end="url(#b)"/>
  <line x1="130" y1="115" x2="458" y2="115" stroke="#333" marker-end="url(#b)"/>
  <text x="300" y="130" text-anchor="middle" font-size="11">error / default fail</text>
  <line x1="130" y1="125" x2="458" y2="190" stroke="#333" marker-end="url(#b)"/>
  <text x="270" y="185" text-anchor="middle" font-size="11">tasks/cancel / default cancel</text>
</svg>

- `working`: the request is persisted and routed; humans are being reached. Reminders
  and escalations happen inside this state.
- `input_required`: the server needs the client to act, e.g. to open a URL-mode
  elicitation (7.6) or answer a multi-round-trip `inputResponses` request. The client
  supplies it with `tasks/update` or by re-issuing the call, after which the task
  returns to `working`.
- `completed`: a decision record exists, including timeout outcomes from `reject`.
- `failed`: the request could not be served, or the default action was `fail`.
- `cancelled`: the client cancelled, or the default action was `cancel`.

`completed`, `failed` and `cancelled` are terminal; a terminal task MUST NOT change
status again. A cancellation or failure SHOULD still produce a decision record
(outcome `cancelled` / `timed_out`) for audit.

### 7.4 Polling and subscription

The client reads status with `tasks/get`, no more often than the `pollInterval` the
server returned. A client MAY instead open `subscriptions/listen` to receive task
change notifications on one stream; it MUST still be able to fall back to polling,
since a subscription is a convenience and not a delivery guarantee. The client cancels
with `tasks/cancel`; the server MUST then stop notifying humans and withdraw open
prompts where the channel permits.

### 7.5 TTL expiry and the default action

The task's `ttl` is the effective deadline. When it passes with no decision, the server
MUST apply `defaultOnTimeout` (section 5), write the decision record, and move the task
to its terminal status. After expiry, `tasks/get` on the handle MUST keep returning the
terminal state and record for a retention period the server documents.

### 7.6 URL-mode for human-only decisions

Form-mode elicitation is answered by the MCP client, which may be an autonomous agent
that accepts everything; it is therefore not a human gate. For `human.approve`, and for
any `human.ask` whose answer authorizes something, the server MUST gather the decision
through URL-mode elicitation or an out-of-band channel: the human decides on a page
the server hosts, behind the server's own authentication (SHOULD include MFA for
Approve). The client learns the outcome only through the task (poll or subscription),
never by submitting it itself. A server MUST NOT accept an Approve decision through
form-mode elicitation or through `tasks/update` content supplied by the client.

## 8. Normative async and security rules

**R1. The handle is the contract, not the connection.** The server MUST return the
Task handle without blocking on a human and MUST keep the request in durable storage
that survives restarts and works across instances. An in-memory task store is not
conforming. A client MUST NOT hold a connection open waiting for a decision.

**R2. TTL and default action.** Every request MUST have a deadline and a default
action. The server MUST apply the default action when the TTL passes, and MAY send
reminders and escalations before it. The client MUST treat any terminal state,
including a timeout outcome, as an answer and MUST NOT assume approval from silence.

**R3. Resumable agents.** The agent MUST be able to stop and resume without the
connection: it MUST record the task id (and its idempotency key) in its own durable
checkpoint before yielding, and resume from the checkpoint when the task reaches a
terminal state. MCP does not provide this; the agent's runtime does.

**R4. Idempotency: never double-ask.** The server MUST deduplicate on
`idempotencyKey` (scoped to the authenticated client), not on each incoming RPC. A
repeated call with a known key MUST return the existing handle and MUST NOT notify any
human again. A repeated key with different request content MUST be rejected with an
error. Clients MUST reuse the key on every retry of the same logical request and MUST
use a fresh key for a new one.

**R5. Re-authorize on every poll.** A task handle is an identifier, not a permission.
On every `tasks/get`, `tasks/update`, `tasks/cancel` and subscription, the server MUST
authenticate the caller and check that it may see or act on that task. Knowing a task
id MUST NOT grant access to its result.

**R6. Cap TTL: it is standing authority.** One approval at call time covers the whole
life of a task, so a long TTL is standing authority. The server MUST enforce a maximum
TTL per primitive (and SHOULD per role), MUST shorten longer requested deadlines to it,
and MUST flag, and by default refuse, Approve requests whose `scope` asks for blanket or
permanent approval (no `notAfter`, unbounded `maxUses`).

**R7. Form-mode is not a human gate.** As section 7.6: a decision that authorizes
action MUST land on a surface the agent cannot reach.

## 9. Example

A `human.approve` call:

```json
{
  "idempotencyKey": "deploy-4821-prod",
  "deadline": "2026-10-15T12:00:00Z",
  "defaultOnTimeout": "reject",
  "priority": "high",
  "requires": { "roles": ["approver.production-deploy"] },
  "context": { "summary": "Release 4.21 passed staging checks." },
  "action": "Deploy release 4.21 to production",
  "payload": { "service": "billing", "version": "4.21.0" },
  "payloadDigest": "sha256:9f2c1e0a",
  "scope": { "maxUses": 1, "notAfter": "2026-10-16T00:00:00Z" }
}
```

returns a Task handle at once (`status: working`, with `ttl` and `pollInterval`). When it completes, the task result is a decision record:

```json
{
  "requestId": "task-7f3a",
  "idempotencyKey": "deploy-4821-prod",
  "primitive": "approve",
  "outcome": "approved",
  "decidedBy": { "type": "human", "id": "h-102", "roles": ["approver.production-deploy"] },
  "decidedAt": "2026-10-08T18:04:11Z",
  "channel": "url",
  "payloadDigest": "sha256:9f2c1e0a",
  "signature": { "alg": "ES256", "keyId": "hitlp-2026", "value": "MEUCIQ..." }
}
```

More examples: [spec/examples/](examples/).
