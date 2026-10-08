# HITLP hello world demos

Runnable "hello world" agents for HITLP, the human-in-the-loop-protocol, one per SDK in [sdks/](../sdks/README.md).

| Demo | SDK | Run |
| --- | --- | --- |
| [typescript/](typescript/README.md) | `@codefrak/hitlp` | `npm start` |
| [python/](python/README.md) | `hitlp` | `python hello.py` |

Each demo plays the same exchange, using both v1 sub-protocols of the [specification](../spec/hitlp.md):

1. **Ask** (`human.ask`): the agent asks the human "What is your name?"; the call returns a task handle at once, and the agent waits for the task to end.
2. The agent greets the human by the name they typed.
3. **Approve** (`human.approve`): the agent asks approval to deploy the greeting, checkpoints the task (rule R3), resumes from the checkpoint, and deploys only if the decision is `approved` (rule R2). Any other answer than `y`/`yes` rejects.

The agent's side is all SDK: request building and validation, the client, polling, checkpoints and decision interpretation. Each demo has one small demo-local piece, a *terminal human* `TaskTransport`, which plays the HITLP server's human side by prompting at the terminal and returning a decision record. It keeps tasks in memory, so it is not a conforming HITLP server (rule R1); swap it for a transport onto a real HITLP server and the agent code stays the same.

Set `HITLP_DEMO_ANSWERS` (comma-separated replies, e.g. `Ada,y`) to run a demo without typing; its smoke tests use this.
