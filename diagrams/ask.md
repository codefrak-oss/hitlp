# Ask: message flow

The Ask sub-protocol of the human-in-the-loop protocol (HITLP), carried by the `human.ask`
tool over the MCP Tasks binding. Spec: [§4.1 Ask](../spec/hitlp.md#41-ask),
[§5 envelope](../spec/hitlp.md#5-common-request-envelope),
[§7 binding](../spec/hitlp.md#7-binding-over-mcp-2026-07-28).

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent (MCP client)
    participant S as HITLP server
    participant H as Human (channel)

    A->>S: human.ask {question, responseSchema, options?, idempotencyKey, deadline, defaultOnTimeout, requires?}
    Note over S: Persist request durably (§7.2, R1)<br/>Cap deadline to TTL (R6)
    S-->>A: Task handle {taskId, status: working, ttl, pollInterval}
    Note over A: Record taskId + idempotencyKey in checkpoint (R3)
    S->>H: Route to a human holding requires (§5)

    opt Retry with the same idempotencyKey (R4)
        A->>S: human.ask (same key, same content)
        S-->>A: Same Task handle (no human notified again)
    end

    loop Until terminal (§7.4)
        alt Polling
            A->>S: tasks/get {taskId}
            S-->>A: status: working
        else Notification (where supported)
            S--)A: task status notification
        end
    end

    alt Human answers
        H->>S: answer
        Note over S: Validate answer against responseSchema (§4.1)
        S->>S: Persist decision record {outcome: answered, answer, decidedBy: human}
        Note over S: status: completed
    else ttl passes with no decision (§7.5)
        Note over S: Apply defaultOnTimeout
        S->>S: Decision record {outcome: timed_out, decidedBy: policy}
        Note over S: reject → completed · cancel → cancelled · fail → failed<br/>escalate → re-route, then reject at final deadline
    else Agent cancels
        A->>S: tasks/cancel {taskId}
        S--xH: Withdraw open prompts
        Note over S: Decision record {outcome: cancelled}<br/>status: cancelled
    end

    A->>S: tasks/get {taskId}
    S-->>A: terminal status + decision record
```

An Ask whose answer authorizes something must be gathered on a human-only surface, as
for [Approve](approve.md) ([§7.6](../spec/hitlp.md#76-url-mode-for-human-only-decisions)).
