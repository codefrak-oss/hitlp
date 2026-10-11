# HITLP: Human-in-the-Loop Protocol

**Version:** 0.3 (draft) · **MCP binding target:** MCP 2026-07-28 with the Tasks extension (`io.modelcontextprotocol/tasks`)

0.3 adds the surface API (7.8) to 0.2, which superseded 0.1, the first draft (previously
numbered 1.0; renumbered because the protocol is provisional and has no adopters to hold
to it). What changed: [CHANGELOG.md](CHANGELOG.md). 0.3 stays a draft until a server and a requester have
run against it; the numbers below 1.0 say that breaking changes are still expected.

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

A conforming **server** implements every 0.2 primitive (Ask, Approve), the envelope,
the decision record, the MCP binding, and every rule in section 8. A conforming
**client** (agent or orchestrator) follows the client-side rules in section 8.

### 1.2 Terminology

- **Agent**: the software that issues a request and consumes the decision.
- **Requester**: the authenticated party a request arrives from: an agent, or a
  service acting for one (an orchestrator, an operations server). The server knows a
  requester by its credentials, never by what the request says.
- **Client**: the MCP client acting for the agent.
- **Server**: an MCP server implementing HITLP.
- **Human**: a person reachable through the server, described by a profile (section 3).
- **Proxy**: the server's standing decision-making on a human's behalf (section 3.1):
  the rules and judgment that answer a request before the human is reached.
- **Surface**: a channel a human decides on (a page, an app, a chat), trusted by the
  server to carry that human's decision (section 7.7).
- **Request**: one call of a primitive, made of an envelope plus a primitive body.
- **Attested**: a part of a request the server established itself or verified with a
  system it trusts (section 5.1). **Asserted**: a part the requester wrote, taken as
  evidence and never as authority.
- **Recommendation**: the requester's own judgment of the request, attached for the
  proxy and the human to weigh (section 5.2).
- **Lineage**: the chain of intent a request serves, from the immediate why up to who
  first asked (section 5.3). Asserted, always.
- **Handle**: the MCP task identifier returned for a request.
- **Decision record**: the server's durable, attributable record of how a request ended.
- **Default action**: what the server does when a request reaches its deadline unanswered.

### 1.3 Merit and trust

Two judgments precede every decision, and 0.2 keeps them in different places.

**Merit** asks whether the action is a good one: is this command safe, is this change
correct, is this the right thing to do. Merit needs the content (the diff, the
command, the session so far) and the domain's rules. It belongs to the requester,
which has that context; a HITLP server has none of it and MUST NOT pretend to. A
requester that judges merit attaches its verdict as a **recommendation** (5.2).

**Trust** asks whether to let the requester's judgment stand without a person: how far
this requester, acting for this principal, on this kind of action, is believed. Trust
needs only the envelope. It belongs to the server, as the human's **proxy** (3.1),
and its rules read the attested part of the envelope and the recommendation, never
the content.

A human is reached when both cannot decide: the requester's merit judgment escalated
(or the requester insists on a person, 5.4), and the proxy has no trust rule that
settles it. The requester never learns which layer of the proxy answered except
through the decision record (section 6).

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
capabilities and roles; 0.2 does not standardise its shape. Agents SHOULD NOT address
individual humans; addressing by capability lets the server pool, balance and escalate.

### 3.1 The proxy: three layers before the human

A human resource is not only a person. In front of the person stands the server's
**proxy**: the human's own standing judgment, applied so that the person is reached
only for what it cannot settle. The proxy has three layers, tried in order, and a
request stops at the first that decides it:

1. **Rules.** Deterministic matches on the attested part of the envelope (5.1) and
   on the recommendation (5.2): "approve what the ops server recommends at 0.8 or
   better on cluster hosts", "always reach me for repo X". A rule MUST NOT read the
   payload, the asserted part, or the lineage. A server MUST reject, when it is saved,
   a rule that names a field outside `attested` and `recommendation`.
2. **A model reading the human's own words.** OPTIONAL. The human writes trust rules
   in prose; a model maps the envelope onto them. It reads the same fields a rule may
   read and nothing else, answers with a confidence, and MUST escalate to layer 3
   rather than decide when it is unsure. It is a reader of the human's sentences, not
   a judge of the action: a server MUST NOT give it the payload or the lineage.
3. **The person**, on a trusted surface (7.7).

Layer 1 is the former "standing approval". The layers are the server's: a requester
MUST NOT be able to tell, from the handle or the task, which layer will answer, and
MUST NOT be able to choose one, except by `requiresHuman` (5.4), which skips the
first two. The decision record names the layer that decided (section 6).

Why the proxy is modest: it has no domain context, so it can only express how much
the human trusts a requester's recommendation, not whether the action is right. The
test for a rule in the wrong place: if deciding it would need the payload, it is a
merit rule and belongs with the requester.

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

Diagram: [diagrams/ask.md](../diagrams/ask.md)

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

Diagram: [diagrams/approve.md](../diagrams/approve.md)

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
| `requiresHuman` | boolean | OPTIONAL | `true` skips the proxy's rule and model layers (5.4). Default `false`. |
| `asserted` | object | OPTIONAL | What the requester says about the request: `why`, `onBehalfOf`, `recommendation` (5.2), `lineage` (5.3), `asOf`. Evidence, never authority. |
| `attested` | object | server-filled | What the server established: `requester`, `onBehalfOf`, `by`. A requester MUST NOT send it; a server MUST ignore one that arrives (5.1). |

0.1's `requester` field is gone: its `agent` is now `attested.requester` (the server
learns it from the credentials) and its `onBehalfOf` is `attested.onBehalfOf` when
the credentials carry it, else `asserted.onBehalfOf`.

### 5.1 Attested and asserted

Every request has two kinds of content, and the envelope keeps them under two keys
so that no reader, human or model, can mistake one for the other.

**`attested`** is written by the server, after it authenticates the call and before
anything else reads the request. It holds what the server itself established:

- `requester` (string): the requester's identity, from its credentials.
- `onBehalfOf` (object, OPTIONAL): the principal the requester acts for, `{kind, id,
  …}`, when the credentials carry it (a run-scoped token names its run; a session
  token names its login). The shape of `kind` and `id` is the server's.
- `by` (string): which party attested: the server, or a system it verified with.

A server MAY add facts it verifies with a system it trusts (that a ticket was
authorized, and by whom) and MUST name that system in `by`. A server MUST NOT copy
anything from the requester into `attested`. If a request arrives with an `attested`
block, the server MUST drop it, fill its own, and MAY note the attempt in the record.

**`asserted`** is written by the requester. It is evidence: what the requester knows or
claims, shown to the human, given to the proxy's layers as context only where this
spec allows, and kept in the record. Nothing in it is verified, including sentences
that happen to be true about the human.

The split is the whole trust model in one rule: **the proxy decides on `attested` and
`recommendation`; everything under `asserted` informs the person and the audit.**
A field's path says what it is; a reader never has to check a flag.

### 5.2 Recommendation

`asserted.recommendation` is the requester's own merit judgment, attached so the
proxy can weigh it and the human can see it:

| Field | Type | Meaning |
| --- | --- | --- |
| `verdict` | enum | `allow`, `deny`, `escalate`, or `none` when the requester has no judgment. |
| `confidence` | number 0..1 | OPTIONAL. How sure the requester is. |
| `by` | object | Who judged: `{requester, judge, model, rubric}`, each a string naming the component, model and rules revision. |
| `reasons` | string[] | The passages or findings the verdict rests on. |

A recommendation is the unit of trust: a proxy rule says how far to believe *this
requester's* verdicts at *this* confidence. For that to mean anything the
recommendation MUST be attributed (`by`), SHOULD carry a confidence a human can
calibrate against decisions over time, and SHOULD carry reasons a human can audit.
A requester with a judgment MUST send one; a requester without one sends
`verdict: none` or omits the field.

### 5.3 Lineage

`asserted.lineage` is the chain of intent the request serves, outermost last: the
immediate why, the task it belongs to, the ask that filed the task, and so on up to
who first asked. Each link:

| Field | Type | Meaning |
| --- | --- | --- |
| `kind` | string | What the link is: `command`, `ticket`, `intake`, `session`, `proposal`, or the requester's own kinds. |
| `claim` | string | The one sentence that matters at that level: the why, the goal, the ask. |
| `source` | object | Where it was read from, with a revision when the source has one, so it can be diffed against the source later. |
| `by` | string | OPTIONAL. Who wrote this link. |

`asserted.asOf` is when the lineage was captured. The lineage is a snapshot: it was
accurate at `asOf` and is kept as it was in the decision record, never refreshed. A
reader who wants the chain as it is now follows `source`.

**Who writes it.** The system that holds the links writes the chain once, at the start
of the work it governs (an orchestrator at the start of a run or a session), and each
hop after that appends only the link it owns (an operations server appends the
command and its why). A hop MUST pass the lineage through unchanged apart from its own
appended link. A server MUST NOT resolve or extend the lineage itself: it reads what
arrives. This keeps the server independent of every requester's data model and able
to decide when those systems are down.

**What it is for.** The human's card, the requester's own merit judge, and the audit.
A proxy rule MUST NOT read it: a chain that says the human asked for something is
still the requester's word. The attested anchor for authority is `attested`, one hop,
not the chain.

### 5.4 Requiring a person

`requiresHuman: true` says the requester has done its own merit judgment and asks for
the one thing it cannot do itself: a person's decision. The server MUST skip the
proxy's rule and model layers and route to a human. A requester SHOULD reserve it for
the cases its own rules name as needing a person (a rubric's escalate section), and
SHOULD otherwise send its recommendation and let the proxy decide how far to trust
it; a requester that sets it on every request gets no benefit from the proxy.

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
| `decidedBy` | object | Which layer decided, and who: `{type: human \| rule \| model \| policy, id, roles, confidence}`. `human` is the proxy's third layer, on a surface; `rule` its first, `id` naming the rule; `model` its second, with the `confidence` it reported; `policy` a default action at the deadline. |
| `decidedAt` | date-time | When the decision was made. |
| `channel` | string | Where it was made: the surface for a human (`url`, `desktop`, `ios`, `chat`, `sms`, …), absent for a rule, model or policy decision. |
| `payloadDigest` | string | Approve: the digest of the payload the human saw. |
| `attested` | object | The request's `attested` block as the server filled it (5.1). |
| `recommendation` | object | The request's recommendation as received (5.2), so a decision can be read against it. |
| `signature` | object | OPTIONAL: `{alg, keyId, value}` over the canonical record without `signature`. |

The server MUST persist the record before reporting the task `completed`, MUST NOT
change it afterwards, and SHOULD sign it. Timeout outcomes MUST name `policy` as the
decider, never a human. The server MUST keep the request as received (its `asserted`
block included, lineage and all) with the record for the retention period, so the
decision can be audited against what was in front of the decider at the time.

Naming the layer is what makes the proxy honest: a human reading the records can see
how often a rule or the model decided, compare those decisions with their own, and
calibrate a requester's confidence against the outcomes.

## 7. Binding over MCP (2026-07-28)

A HITLP server is an MCP server. It MUST support the stateless core of MCP 2026-07-28
and the Tasks extension `io.modelcontextprotocol/tasks`, and SHOULD support
task status notifications and URL-mode elicitation.

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

Diagram: [diagrams/task-lifecycle.md](../diagrams/task-lifecycle.md)

<svg xmlns="http://www.w3.org/2000/svg" width="700" height="230" viewBox="0 0 700 230" font-family="sans-serif" font-size="13">
  <defs><marker id="b" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#333"/></marker></defs>
  <rect x="20" y="95" width="110" height="40" rx="20" fill="#eef3ff" stroke="#3a5bbf"/><text x="75" y="120" text-anchor="middle">working</text>
  <rect x="220" y="20" width="140" height="40" rx="20" fill="#fff6e8" stroke="#c07a12"/><text x="290" y="45" text-anchor="middle">input_required</text>
  <rect x="460" y="20" width="120" height="40" rx="20" fill="#f2fbf2" stroke="#2e8b57"/><text x="520" y="45" text-anchor="middle">completed</text>
  <rect x="460" y="95" width="120" height="40" rx="20" fill="#fdeeee" stroke="#b03030"/><text x="520" y="120" text-anchor="middle">failed</text>
  <rect x="460" y="170" width="120" height="40" rx="20" fill="#f0f0f0" stroke="#666"/><text x="520" y="195" text-anchor="middle">cancelled</text>
  <line x1="130" y1="105" x2="220" y2="50" stroke="#333" marker-end="url(#b)"/>
  <line x1="330" y1="60" x2="458" y2="110" stroke="#333" marker-end="url(#b)"/>
  <line x1="300" y1="60" x2="458" y2="185" stroke="#333" marker-end="url(#b)"/>
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
- `input_required`: a URL-mode decision (7.6) is waiting for the human. The task
  carries the decision URL in its `_meta` under the key `io.hitlp/decisionUrl` and in
  its `statusMessage`. It stays `input_required` until the human decides on the
  server-hosted page, the TTL expires (7.5) or the client cancels, and then moves
  straight to `completed`, `failed` or `cancelled`. The client sends no
  acknowledgement (there is no `tasks/update` step in this binding) and the task does
  not return to `working`.
- `completed`: a decision record exists, including timeout outcomes from `reject`.
- `failed`: the request could not be served, or the default action was `fail`.
- `cancelled`: the client cancelled, or the default action was `cancel`.

`completed`, `failed` and `cancelled` are terminal; a terminal task MUST NOT change
status again. A cancellation or failure SHOULD still produce a decision record
(outcome `cancelled` / `timed_out`) for audit.

### 7.4 Polling and notification

The client reads status with `tasks/get`, no more often than the `pollInterval` the
server returned. Once the task is terminal, `tasks/get` returns its result (the
decision record) inline; there is no separate result method. Where the server
supports it, a client MAY instead receive a task status notification; it MUST still be able to fall back to polling,
since a notification is a convenience and not a delivery guarantee. The client cancels
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
Approve). The server delivers the decision URL on the task: the task moves to `input_required`
and carries the URL in `_meta` under `io.hitlp/decisionUrl` and in `statusMessage`
(7.3), and waits there until the decision or the TTL. The client learns the outcome
only through the task (`tasks/get`, or a task status notification), never by
submitting it itself. A server MUST NOT accept an Approve decision through form-mode
elicitation or through any decision content supplied by the client.

### 7.7 Trusted surfaces

A surface is where a person decides: the server's hosted decision page (7.6), a
desktop or phone app, a chat, SMS. The server holds the list of surfaces it trusts to
carry a given human's decisions, each with its own credentials; a decision arrives
from a surface the server authenticates, never from the requester's client. The
server MUST record the surface in the decision record's `channel`. A server MAY let
a human add or remove their own surfaces; 0.3 does not standardise how. How a surface
talks to the server is the surface API, 7.8. The point of
the list is that requesters and surfaces multiply independently: a new surface serves
every requester, and a new requester reaches every surface, with the server between
them.
### 7.8 Surface API

The surface API is how a surface (7.7) reaches the server: plain HTTPS and JSON, so a
phone or desktop app needs no MCP client. It is not part of the MCP binding: requesters
never use it, and a surface never uses MCP. Paths are relative to a base URL the server
publishes, ending in `/surface/v1`. Request and response bodies follow the schemas in
`schemas/surface/`: `task`, `task-list`, `decide.request` and `device`.

**Credentials.** Each surface has its own credential, issued for one human, sent as
`Authorization: Bearer <credential>`. The server MUST resolve it on every request, as
R5 requires of requester tokens, so revoking a surface or its human takes effect on the
next call. A surface credential MUST NOT be accepted where a requester token is
(`/mcp`), and a requester token MUST NOT be accepted on the surface API; both answer
`401`. A server MUST refuse a configuration in which a surface credential is also a
requester token or a credential of another human surface (the decision page's login,
an administrator's).

**Routing.** A task is routed to the humans whose roles and capabilities include
everything in its `requires` (5); a task without `requires` is routed to every human
the server serves. A task not routed to the caller's human MUST NOT be listed, and
reading or deciding it MUST answer `404`, as for a task that does not exist.

**Resources.**

| Request | Answer |
| --- | --- |
| `GET /tasks` | `200`, `{"tasks": [...]}`: the open tasks routed to the human and those decided recently (the server picks the window), newest first. |
| `GET /tasks/{id}` | `200`, the task view. |
| `POST /tasks/{id}/decision` | `200`, the decision record (6). |
| `PUT /devices/{deviceId}` | `200`, the device as stored. |
| `DELETE /devices/{deviceId}` | `204`; `404` when the surface has no such device. |
| `GET /events` | `200`, `text/event-stream`. |

Errors carry `{"error": "<message>"}`: `400` for a malformed body or a decision the task
cannot take, `401` for a missing or refused credential, `404` for an unknown or
unrouted task, `409` for a task already terminal or a stale `payloadDigest`.

**The task view** keeps the two kinds of provenance (5.1) apart and labelled:
`attested` carries `"source": "server"` beside the fields the server filled;
`asserted` carries `"source": "requester"` beside what the requester sent, with
`lineage` reordered newest first for display (5.3). The view carries `id`,
`primitive`, `status`, `createdAt`, `deadline` (the effective deadline, after the cap
and any escalation, 5 and R6), `requiresHuman` (5.4, `false` when absent), `context`
and `requires` as received; for an Approve `action`, `payload` exactly as received and
`payloadDigest` (the request's, or the server's own over the payload); for an Ask
`question`, `responseSchema` and `options`; and `result`, the decision record, once
the task is terminal. A surface MUST show `attested` and `asserted` as distinct and
MUST NOT present asserted content as verified.

**Deciding.** An Approve takes `{"outcome": "approve" | "reject", "reason"?,
"payloadDigest"?}`; when `payloadDigest` is sent and differs from the task's the
server MUST refuse with `409`, so a human never approves a payload other than the one
shown. An Ask takes `{"answer", "reason"?}`; the server MUST validate `answer`
against the Ask's `responseSchema` (and against `options`, when present) and refuse
an invalid one with `400`. A decision is accepted once: every later decision, from
any surface, is refused with `409` and leaves the record unchanged. The record has
`decidedBy` `{"type": "human", "id", "roles"}`, `channel` naming the surface's kind
(`url` for the decision page of 7.6), and for an Approve `payloadDigest`. Every
surface, the decision page included, MUST decide through the same checks.

**Devices and push.** A surface MAY register devices for push with
`PUT /devices/{deviceId}` and `{"platform", "token", "environment"?, "name"?}`
(`platform` `apns` for Apple Push Notification service, `environment` `production` or
`sandbox`). For each new task the server SHOULD push once to every device of every
human the task is routed to, and MUST NOT push again for an R4 repeat or for a task a
standing rule decided. A push MUST NOT carry the request's content (action, payload,
question, context, asserted): only a title and the task id, which the surface reads
with its own credential. A server SHOULD drop a device the push service reports gone.

**Events.** `GET /events` is a server-sent-events stream. For each task routed to the
human and created after the stream opened, the server sends one event with
`event: task`, `id` the task id and `data` the task view. The server SHOULD send a
comment line at least every 30 s to keep intermediaries from closing the stream, and
MUST re-resolve the credential before each event, ending the stream when it is no
longer valid.

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
On every `tasks/get`, `tasks/list`, `tasks/cancel` and task status notification, the server MUST
authenticate the caller and check that it may see or act on that task. Knowing a task
id MUST NOT grant access to its result.

**R6. Cap TTL: it is standing authority.** One approval at call time covers the whole
life of a task, so a long TTL is standing authority. The server MUST enforce a maximum
TTL per primitive (and SHOULD per role), MUST shorten longer requested deadlines to it,
and MUST flag, and by default refuse, Approve requests whose `scope` asks for blanket or
permanent approval (no `notAfter`, unbounded `maxUses`).

**R7. Form-mode is not a human gate.** As section 7.6: a decision that authorizes
action MUST land on a surface the agent cannot reach.

**R8. The server owns `attested`.** The server fills `attested` from the credentials
it authenticated and from systems it verified with, and from nothing else. A request's
own `attested` block is dropped. Nothing under `asserted` is ever promoted to
`attested` by being repeated, well-formed or plausible.

**R9. Trust rules read `attested` and `recommendation` only.** A proxy rule (3.1
layer 1) and the model layer (3.1 layer 2) MUST NOT read the payload, `context`, or
anything under `asserted` other than `recommendation`. A server MUST refuse to save a
rule that names any other field. The lineage, the why and the summary are for the
person and the record.

**R10. Lineage is evidence, not authority.** A server MUST NOT derive any permission
from `asserted.lineage`, however it reads, and MUST NOT resolve or extend it. It is
stored as received, as of the time it says, and shown to the person as the
requester's account of why.

**R11. The layer is named.** Every decision record names which proxy layer decided
(`decidedBy.type`), and a decision by a rule or the model MUST carry enough (`id`,
`confidence`) for a human to find and change what decided it.

## 9. Example

A `human.approve` call from an operations server, acting for an agent's run, after
its own judge escalated a command. The requester sends everything but `attested`:

```json
{
  "idempotencyKey": "ops-run-e921-cmd-14",
  "deadline": "2026-10-11T12:33:00Z",
  "defaultOnTimeout": "reject",
  "priority": "urgent",
  "requires": { "roles": ["approver.homelab"] },
  "context": { "summary": "k8s-1: kubectl -n frakworks rollout undo deploy/engine\nwhy: the new pod crash-loops; restore the last working rollout" },
  "action": "run",
  "payload": { "host": "k8s-1", "command": "kubectl -n frakworks rollout undo deploy/engine" },
  "payloadDigest": "sha256:10e81569",
  "scope": { "maxUses": 1, "notAfter": "2026-10-11T12:33:00Z" },
  "requiresHuman": false,
  "asserted": {
    "why": "the new pod crash-loops on the 6Gi limit; restore the last working rollout",
    "recommendation": {
      "verdict": "escalate",
      "confidence": 0.78,
      "by": { "requester": "homelab-ops-server", "judge": "engine /mcp/judge", "model": "jev-1.13.0", "rubric": "ops/rubric/ssh.md@87554a1" },
      "reasons": ["Escalate: a rollout change the rubric does not name"]
    },
    "lineage": [
      { "kind": "command", "claim": "restore the last working rollout", "source": { "run": "e921", "session": "24bd" }, "by": "homelab-ops-server" },
      { "kind": "ticket", "claim": "roll out the 6Gi limit and verify the engine stays up", "source": { "repo": "lundmatt1/homelab-gitops", "number": 101, "bodyRev": "c3a9" }, "by": "frakworks-engine" },
      { "kind": "intake", "claim": "the limit change is merged; it needs rolling out and watching", "source": { "intake": "B", "filedBy": "smith run on #100" }, "by": "frakworks-engine" },
      { "kind": "ticket", "claim": "raise the engine's memory limit to 6Gi", "source": { "repo": "lundmatt1/homelab-gitops", "number": 100, "bodyRev": "91f0" }, "by": "frakworks-engine" },
      { "kind": "intake", "claim": "the engine got OOM-killed twice this week, fix it", "source": { "intake": "A", "filedBy": "lundmatt1 via first mate" }, "by": "frakworks-engine" }
    ],
    "asOf": "2026-10-11T12:27:00Z"
  }
}
```

The server authenticates the call and fills `attested` before anything reads the
request; the lineage's last link, which says a person started the chain, stays under
`asserted` and grants nothing:

```json
"attested": {
  "requester": "homelab-ops-server",
  "onBehalfOf": { "kind": "run", "id": "e921", "ticket": "lundmatt1/homelab-gitops#101" },
  "by": "hitlp-server"
}
```

The call returns a Task handle at once (`status: working`, with `ttl` and
`pollInterval`). The proxy's rules do not match (the human has a rule for `allow`
verdicts on cluster hosts, none for `escalate`), its model layer reads the human's
sentence "escalates always reach me" and defers, and the request goes to the person,
who approves it on their phone. The task result is the decision record:

```json
{
  "requestId": "task-7f3a",
  "idempotencyKey": "ops-run-e921-cmd-14",
  "primitive": "approve",
  "outcome": "approved",
  "reason": "yes, roll it back",
  "decidedBy": { "type": "human", "id": "h-102", "roles": ["approver.homelab"] },
  "decidedAt": "2026-10-11T12:28:12Z",
  "channel": "ios",
  "payloadDigest": "sha256:10e81569",
  "attested": { "requester": "homelab-ops-server", "onBehalfOf": { "kind": "run", "id": "e921", "ticket": "lundmatt1/homelab-gitops#101" }, "by": "hitlp-server" },
  "recommendation": { "verdict": "escalate", "confidence": 0.78, "by": { "requester": "homelab-ops-server", "judge": "engine /mcp/judge", "model": "jev-1.13.0", "rubric": "ops/rubric/ssh.md@87554a1" }, "reasons": ["Escalate: a rollout change the rubric does not name"] },
  "signature": { "alg": "ES256", "keyId": "hitlp-2026", "value": "MEUCIQ..." }
}
```

Had the judge said `allow` at 0.91, the human's first rule would have decided and
the record would read `"decidedBy": { "type": "rule", "id": "trust-ops-allows-on-cluster" }`
with no `channel`, and the person would never have been reached.

More examples: [spec/examples/](examples/).
