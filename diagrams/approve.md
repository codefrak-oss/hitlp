# Approve: message flow

The Approve sub-protocol of the human-in-the-loop protocol (HITLP), carried by the
`human.approve` tool over the MCP Tasks binding. Spec:
[§4.2 Approve](../spec/hitlp.md#42-approve),
[§7.6 URL-mode](../spec/hitlp.md#76-url-mode-for-human-only-decisions),
[§8 rules](../spec/hitlp.md#8-normative-async-and-security-rules).

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent (MCP client)
    participant S as HITLP server
    participant H as Human (server-hosted page)

    A->>S: human.approve {action, payload, payloadDigest?, scope?, idempotencyKey, deadline, defaultOnTimeout}
    Note over S: Persist durably (R1), cap TTL (R6)<br/>refuse blanket/permanent scope (R6)
    S-->>A: Task handle {taskId, status: working, ttl, pollInterval}
    Note over A: Record taskId + idempotencyKey (R3)

    A->>S: tasks/get {taskId}
    S-->>A: status: input_required (URL-mode elicitation)
    Note over A,H: Client opens the URL, it never submits the decision itself (§7.6)
    A->>S: tasks/update (acknowledges elicitation)
    Note over S: status: working

    H->>S: Authenticate on server's page (SHOULD include MFA)
    S->>H: Show action + payload exactly as received (+ payloadDigest)

    alt Human decides
        H->>S: approved, or rejected with reason
        S->>S: Persist decision record {outcome: approved | rejected, payloadDigest, decidedBy: human, channel: url}
        Note over S: status: completed
    else ttl passes (§7.5)
        Note over S: Apply defaultOnTimeout (reject recommended)
        S->>S: Decision record {outcome: rejected, decidedBy: policy}
        Note over S: status: completed (or cancelled / failed per default)
    else Agent cancels
        A->>S: tasks/cancel {taskId}
        Note over S: Decision record {outcome: cancelled}<br/>status: cancelled
    end

    loop Until terminal (§7.4)
        A->>S: tasks/get or subscriptions/listen
        S-->>A: terminal status + decision record
    end

    Note over A,S: Refused (R7): an approval sent via form-mode elicitation<br/>or as tasks/update content from the client
```

The agent must treat any terminal state, including a timeout, as the answer and must not
assume approval from silence (R2).
