# HITLP spec changelog

## 0.3 (draft, 2026-10-11)

Surfaces get a contract: how a decision page, a desktop app or a phone app talks to
the server.

- **Surface API** (§7.8, pointed to from §7.7): REST and JSON under `/surface/v1`:
  list a human's tasks, read one, decide it, register a device for push, and a
  server-sent-events stream of new tasks. No MCP client needed.
- **Surface credentials**: one per surface, issued for one human, resolved on every
  request; never accepted on MCP, and a requester token is never accepted on the
  surface API (both `401`); a server refuses a configuration where one credential
  opens two doors.
- **Routing by `requires`**: a task reaches the humans whose roles and capabilities
  satisfy it; to anyone else it is not listed and not found (`404`).
- **The task view** labels `attested` as the server's and `asserted` as the
  requester's, lineage newest first, and carries the payload as received, the
  effective deadline and `requiresHuman`.
- **Deciding**: once, through the same checks on every surface (the decision page's
  included); an Approve is bound to its `payloadDigest`, an Ask's answer is validated
  against `responseSchema`; the record's `channel` names the surface's kind.
- **Push**: once per device per new task, never for an R4 repeat or a rule's decision,
  and never with the request's content.
- **Schemas** `surface/task`, `surface/task-list`, `surface/decide.request`,
  `surface/device`, with examples under `examples/surface/`.

## 0.2 (draft, 2026-10-11)

The human gets a proxy, and the envelope says what is attested and what is asserted.

- **Merit and trust** (§1.3): the requester judges merit with its own context; the
  server judges trust, as the human's proxy, from the envelope alone. A person is
  reached when both cannot decide.
- **The proxy** (§3.1): three layers in front of the human: rules, a model reading
  the human's prose rules, the person. The former "standing approval" is layer 1.
- **`attested` and `asserted`** (§5.1, R8): the server fills `attested` from the
  credentials it authenticated; the requester writes `asserted`. A rule may read only
  `attested` and `recommendation` (R9). 0.1's `requester` field is replaced by
  `attested.requester` and `attested.onBehalfOf` / `asserted.onBehalfOf`.
- **Recommendation** (§5.2): the requester's verdict, confidence, attribution and
  reasons. The unit of trust.
- **Lineage** (§5.3, R10): the chain of intent, written once by the system that holds
  the links and appended by each hop; a snapshot, asserted, never resolved by the
  server and never authority.
- **`requiresHuman`** (§5.4): the requester's right to a person, skipping the proxy's
  first two layers.
- **Decision record** (§6, R11): `decidedBy.type` gains `rule` and `model`; the record
  carries `attested` and `recommendation`, and the server keeps the request as
  received with it.
- **Trusted surfaces** (§7.7): the server holds the list of surfaces it trusts for a
  human; `channel` names the surface.
- **Renumbered**: the first draft was called 1.0; it is 0.1 from here. Nothing had
  adopted it, and 0.x says that breaking changes are expected.

## 0.1 (draft, 2026-10-08)

The first draft (as "1.0 (draft)"): Ask and Approve, the envelope, the decision
record, the MCP Tasks binding, URL-mode for human-only decisions, rules R1 to R7.
