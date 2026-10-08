# HITLP client checklist

The conformance suite tests servers. These are the rules a client (an agent,
its runtime, or an SDK) must keep; review a client against each.

## R3: resumable agents (spec 8, R3)

- [ ] Before yielding, the agent writes the task id **and** its idempotency key to
      its own durable checkpoint.
- [ ] The agent can stop, restart and resume from the checkpoint, without the
      original connection, and continues once the task is terminal.
- [ ] Resuming polls the recorded task; it never sends a new request with a new key.

## R1: never hold the connection (spec 7.2, 7.4, R1)

- [ ] The client reads status with `tasks/get` and never waits on an open
      request for a human.
- [ ] It polls no more often than the `pollInterval` the server returned.
- [ ] Where it uses task status notifications, it can still fall back to polling.

## R2: a timeout is an answer (spec 5, 7.5, R2)

- [ ] Every request carries a `deadline` and a `defaultOnTimeout`; Approve uses
      `reject` unless there is a reason not to.
- [ ] Any terminal state is handled as the answer: `timed_out`, `rejected`,
      `cancelled` and `failed` are all outcomes, not errors to retry.
- [ ] The client never treats silence, a timeout or a missing record as approval.

## R4: reuse the key on retry (spec 5, R4)

- [ ] A retry of the same logical request (after a timeout, a crash, a lost
      response) reuses its `idempotencyKey`.
- [ ] A new logical request gets a fresh key.
- [ ] A rejection for a reused key with different content is a bug in the
      client, not a reason to change the key and retry.

## R5: a handle is not a permission (R5)

- [ ] The client sends its own credential on every request, including every poll.
- [ ] It does not share task ids with other clients as a way to grant access.

## R6: short deadlines, bounded scopes (R6)

- [ ] Deadlines are as short as the work allows; the effective deadline is the
      `ttl` the server returns, not the one asked for.
- [ ] Approve `scope`, when used, has both `notAfter` and `maxUses`.

## R7: never form mode for Approve (spec 7.6, R7)

- [ ] The client never answers an Approve (or an Ask that authorizes something)
      through form-mode elicitation, and never sends decision content itself.
- [ ] On `input_required`, it shows the human the URL from
      `_meta["io.hitlp/decisionUrl"]` (or `statusMessage`) and keeps polling.
- [ ] The agent never holds an approver credential and never opens the
      decision page as the human.
