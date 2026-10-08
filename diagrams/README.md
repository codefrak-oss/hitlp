# HITLP diagrams

Diagrams of the sub-protocols of the human-in-the-loop protocol (HITLP), as defined in
[spec/hitlp.md](../spec/hitlp.md). They are Mermaid in Markdown and render on GitHub.

| Diagram | Shows | Spec section |
| --- | --- | --- |
| [ask.md](ask.md) | `human.ask` message flow | [§4.1 Ask](../spec/hitlp.md#41-ask) |
| [approve.md](approve.md) | `human.approve` message flow with URL-mode elicitation | [§4.2 Approve](../spec/hitlp.md#42-approve), [§7.6](../spec/hitlp.md#76-url-mode-for-human-only-decisions) |
| [task-lifecycle.md](task-lifecycle.md) | Task statuses shared by both | [§7.3 Statuses and lifecycle](../spec/hitlp.md#73-statuses-and-lifecycle) |

Do, Inform and Escalate are reserved in v1 ([§4](../spec/hitlp.md#4-request-primitives))
with no defined behaviour, so they have no diagrams yet.
