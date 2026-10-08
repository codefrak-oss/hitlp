# Task lifecycle

The task statuses shared by both HITLP sub-protocols, [Ask](ask.md) and
[Approve](approve.md). Spec: [§7.3 Statuses and lifecycle](../spec/hitlp.md#73-statuses-and-lifecycle),
[§7.5 TTL expiry](../spec/hitlp.md#75-ttl-expiry-and-the-default-action).

```mermaid
stateDiagram-v2
    [*] --> working: human.ask / human.approve returns Task handle
    working --> input_required: server needs client action (URL-mode elicitation)
    input_required --> working: tasks/update or re-issued call
    working --> completed: decision record written (incl. defaultOnTimeout reject)
    working --> failed: error / defaultOnTimeout fail
    working --> cancelled: tasks/cancel / defaultOnTimeout cancel
    completed --> [*]
    failed --> [*]
    cancelled --> [*]
```

`completed`, `failed` and `cancelled` are terminal and never change again.
