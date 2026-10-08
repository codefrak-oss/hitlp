# Next steps for HITLP after spec, diagrams, SDKs and demos
Status: proposed
Decision log:
Ticket: #10

## The question

The four foundation pieces of HITLP (human-in-the-loop-protocol) have landed. What
should the repo build next, in what order, and what must the user decide first?

### Current state

| Piece | Path | What it is |
| --- | --- | --- |
| Spec | [spec/hitlp.md](../../spec/hitlp.md), [spec/schemas/](../../spec/schemas/), [spec/examples/](../../spec/examples/) | HITLP v1.0 (draft): Ask and Approve primitives (§4.1, §4.2), envelope (§5), decision record (§6), binding over MCP Tasks (§7), rules R1–R7 (§8). Do, Inform and Escalate are reserved (§4). |
| Diagrams | [diagrams/](../../diagrams/README.md) | Mermaid: [ask.md](../../diagrams/ask.md), [approve.md](../../diagrams/approve.md), [task-lifecycle.md](../../diagrams/task-lifecycle.md). None for the reserved primitives. |
| SDKs | [sdks/](../../sdks/README.md) | Client side only, TypeScript `@codefrak/hitlp` and Python `hitlp`, both 0.1.0, schemas vendored from `spec/` by `sdks/scripts/sync-schemas.mjs`. The MCP link is a `TaskTransport` interface the user adapts (`sdks/typescript/src/transport.ts`); no MCP adapter ships. |
| Demos | [demos/](../../demos/README.md) | Hello world per SDK, Ask then Approve, against a demo-local in-memory "terminal human" transport that the demos README says is not a conforming server (R1). |
| CI | `.github/workflows/sdks.yml` | Schema drift check, old-name check, SDK build and tests. |

The gap: everything is client side. No HITLP server exists, no code speaks real MCP,
and nothing checks that a server or client conforms to §8.

## Proposal

Build the server side and the proof of conformance next, in this order:

1. **MCP transport adapters** in both SDKs: a `TaskTransport` over the official MCP
   client SDKs and the Tasks extension (spec §7.1–§7.4). Rationale: the SDKs cannot reach
   any real server today. Size: medium (one feature per SDK, ~2 runs each). Depends on:
   nothing new.
2. **Reference HITLP server** (one language, TypeScript proposed): `human.ask` and
   `human.approve` as MCP tools, a durable task store (R1), TTL and default action (R2),
   idempotency (R4), re-authorization per poll (R5), TTL caps (R6), and a hosted decision
   page for URL-mode Approve (§7.6, R7). Rationale: the spec's value is a server humans sit
   behind; the demos then run against it. Size: large (split into 3–4 features). Depends
   on: 1, for its own tests.
3. **Conformance suite**: language-neutral tests of the R1–R7 rules and the schemas,
   run against any server URL, and a client checklist. Rationale: "conforming" (§1.1) is
   untestable today. Size: medium. Depends on: 2 to have something to pass.
4. **Demos on the real server**: a demo mode that swaps the terminal transport for item 1's
   adapter pointed at item 2. Size: small. Depends on: 1, 2.
5. **Publish the SDKs** to npm and PyPI with a versioning policy tied to the spec version.
   Size: small. Depends on: 1 (so the published package is usable), the user's decision
   on spec stability.

Later, after the user decides on them: specify the reserved primitives (Do, Inform,
Escalate; medium each, spec plus diagrams plus SDK) and further SDK languages (medium
each).

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 200" style="width:100%;height:auto" font-family="sans-serif" font-size="13">
  <rect x="10" y="20" width="200" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="110" y="50" text-anchor="middle" fill="currentColor">1 MCP transport adapters</text>
  <rect x="260" y="20" width="200" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="360" y="50" text-anchor="middle" fill="currentColor">2 Reference server</text>
  <rect x="510" y="20" width="200" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="610" y="50" text-anchor="middle" fill="currentColor">3 Conformance suite</text>
  <rect x="260" y="120" width="200" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="360" y="150" text-anchor="middle" fill="currentColor">4 Demos on real server</text>
  <rect x="10" y="120" width="200" height="50" rx="6" fill="none" stroke="currentColor" stroke-width="1.5"/>
  <text x="110" y="150" text-anchor="middle" fill="currentColor">5 Publish SDKs</text>
  <path d="M210 45 H258 M460 45 H508 M360 70 V118 M110 70 V118 M180 70 L300 118" stroke="currentColor" stroke-width="1.5" fill="none"/>
</svg>

## Alternatives, and why not

- **Specify Do, Inform and Escalate first.** Grows the protocol before anything proves v1
  works end to end; a server would likely reshape the v1 rules first. Why not: spec churn
  without feedback.
- **More SDK languages first (Go, Java).** Multiplies client code that, like the existing
  two, cannot reach a server. Why not: breadth before depth.
- **Publish the SDKs now.** Cheap, but publishes a package with no usable transport and a
  draft spec. Why not now: kept, as step 5.
- **No reference server; conformance suite only.** Leaves the suite with nothing to run
  against and the demos on an in-memory fake. Why not: the suite cannot be validated.

## Open questions

1. Is a reference server in scope for this repo, or should it live elsewhere (or be left
   to implementers)? Assumed: in this repo, under `server/`.
2. Which language for the server? Assumed: TypeScript, matching the MCP TypeScript SDK.
3. What durable store should the server use (SQLite, Postgres)? Assumed: SQLite, swappable.
4. When does the spec leave "draft", and may the SDKs be published under the `@codefrak`
   npm scope and `hitlp` PyPI name before then?
5. Which reserved primitive matters most to you (Do, Inform, Escalate), if any, for after
   step 5?

## Implementation outline

1. Feature: TypeScript MCP `TaskTransport` adapter in `sdks/typescript`, with tests
   against an in-process MCP server.
2. Feature: the same for `sdks/python`.
3. Feature: server skeleton under `server/`: MCP tools `human.ask`/`human.approve`,
   durable store, R1, R4, R5.
4. Feature: server TTL, default action and caps (R2, R6).
5. Feature: server hosted decision page for URL-mode Approve (§7.6, R7).
6. Feature: conformance suite under `conformance/`, run in CI against the server.
7. Feature: demos gain a mode that uses the server.
8. Feature: publish workflow for npm and PyPI, gated on the answer to question 4.

## Cost

| Step | Tier | Runs |
| --- | --- | --- |
| 1–2 transport adapters | 3 | 2–4 |
| 3–5 reference server | 4 | 3–6 |
| 6 conformance suite | 4 | 1–2 |
| 7 demos on server | 2 | 1 |
| 8 publishing | 2 | 1 |

About 8–14 Smith runs in total, plus a proposal run per reserved primitive later.
