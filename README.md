# hitlp
human-in-the-loop-protocol - originally authored by Mike Peterson and Matt Lund

example:

```
[agent] Asking the human for their name (human.ask) ...
[wire] -> human.ask arguments
       {
         "idempotencyKey": "fd6dfaa4-e7ae-48e4-9520-e3f06c1db6ad",
         "deadline": "2026-10-08T16:03:11.898089Z",
         "defaultOnTimeout": "cancel",
         "priority": "normal",
         "requester": { "agent": "hitlp-hello-dotnet" },
         "question": "What is your name?",
         "responseSchema": { "type": "string", "minLength": 1 }
       }
[wire] <- task handle
       { "taskId": "task-1", "status": "working", "pollInterval": 10 }
[human] What is your name? Ada
[wire] <- tasks/get task-1 (terminal)
       {
         "taskId": "task-1",
         "status": "completed",
         "pollInterval": 10,
         "result": {
           "requestId": "task-1",
           "idempotencyKey": "fd6dfaa4-...",
           "decidedBy": { "type": "human", "id": "terminal-human" },
           "channel": "terminal",
           "primitive": "ask",
           "outcome": "answered",
           "answer": "Ada",
           "decidedAt": "2026-10-08T15:03:11.96774Z"
         }
       }
[agent] Hello, Ada!
```

The protocol specification is in [spec/hitlp.md](spec/hitlp.md), with JSON Schemas in [spec/schemas/](spec/schemas/).

SDKs implementing the protocol are in [sdks/](sdks/README.md).
Diagrams of the sub-protocols are in [diagrams/](diagrams/README.md).
Runnable hello world demos built on the SDKs are in [demos/](demos/README.md).

A reference server (TypeScript, SQLite task store) is in [server/](server/README.md).
