# hitlp (Python)

Python SDK for HITLP, the human-in-the-loop-protocol.

**Implements HITLP v1.0 (draft)**: [spec/hitlp.md](../../spec/hitlp.md).

It is a client-side SDK: it builds and validates `human.ask` and `human.approve`
requests, calls them over MCP Tasks, polls or cancels the task, and interprets the
decision record. It does not implement a HITLP server.

## Install

```sh
pip install -e sdks/python          # from a checkout; not yet published
```

Python 3.10 or later. The one dependency is `jsonschema` (Draft 2020-12, with format checks).

## Use

```python
from hitlp import Checkpoint, HitlpClient, build_approve, is_approved, resolve

client = HitlpClient(my_transport)  # your MCP client, adapted to hitlp.TaskTransport

request = build_approve(
    deadline="2026-10-15T12:00:00Z",            # default_on_timeout defaults to "reject"
    requires={"roles": ["approver.production-deploy"]},
    action="Deploy release 4.21 to production",
    payload={"service": "billing", "version": "4.21.0"},
    payload_digest="sha256:9f2c1e0a",
)
task = client.approve(request)                  # returns the handle at once (R1)

save(Checkpoint.for_task(task, request, "approve").to_json())   # before yielding (R3)

# ...later, perhaps in another process:
cp = Checkpoint.from_json(load())
result = client.resume(cp)                      # polls tasks/get at pollInterval
if result.kind == "decided" and is_approved(result.record, cp.request):
    deploy()
# Anything else (rejected, timed_out, cancelled, failed, digest mismatch) is not approval (R2).
```

`build_ask(question=..., response_schema=..., deadline=..., default_on_timeout=...)`
works the same way; `answer_of(record)` gives the validated answer.
`AsyncHitlpClient` is the asyncio form, over an `AsyncTaskTransport`.

### URL-mode decisions and `input_required`

A task carries the server's `_meta` object as `task.meta`, `None` when the server sent
none. When a URL-mode Approve puts the task into `input_required`, the server puts
the decision page's URL in `_meta` under `io.hitlp/decisionUrl`; `task.decision_url` returns it
when it is a string, else `None`. For compatibility the server also sends the
URL in `statusMessage`, so fall back to that.

`on_input_required` (on `HitlpClient` and `AsyncHitlpClient`) is called once per entry into `input_required`, not on every poll: when
the wait starts on an `input_required` task, and each time a poll sees
`input_required` after another status (`input_required` -> `working` ->
`input_required` calls it twice). Its task argument carries that poll's meta and
decision URL, so opening the URL there opens it once.

```python
done = client.wait_for_terminal(
    task, on_input_required=lambda t: open_in_browser(t.decision_url or t.status_message)
)
```

### What the SDK covers

| Spec | SDK |
| --- | --- |
| Envelope (§5) | `build_envelope`; every builder takes its keywords |
| Ask (§4.1), Approve (§4.2) | `build_ask`, `build_approve` |
| Decision record (§6) | `DecisionRecord`, `resolve`, `is_approved`, `answer_of`, `verify_payload_digest` |
| Tools, Task lifecycle (§7.1–7.4) | `HitlpClient` / `AsyncHitlpClient`: `ask`, `approve`, `get`, `cancel`, `wait_for_terminal`, `resume` |
| R1 handle, R2 no approval from silence | handles return at once; only `approved` with a matching digest is approval |
| R3 resumable agents | `Checkpoint` |
| R4 idempotency | `new_idempotency_key`; client retries resend the same key |
| Reserved primitives (§4) | `human.do` / `human.inform` / `human.escalate` raise `ReservedToolError` |
| Schemas | `validate(name, value)`; the spec's schemas are vendored in `src/hitlp/schemas/` |

The transport is three methods (`call_tool`, `get_task`, `cancel_task`), so the SDK
does not depend on a particular MCP SDK. `hitlp.testing.FakeTransport` is an
in-memory transport for unit tests only; an in-memory task store is not a
conforming server.

## Over MCP (fastmcp)

`hitlp.mcp.McpTaskTransport` adapts a connected [fastmcp](https://github.com/PrefectHQ/fastmcp)
`Client` to `AsyncTaskTransport`. It targets SEP-2663, the MCP Tasks extension
(`io.modelcontextprotocol/tasks`), through `fastmcp[tasks]`. It is an optional extra,
so the core SDK still depends on jsonschema alone:

```sh
pip install 'hitlp[mcp]'
```

```python
from fastmcp import Client
from hitlp import AsyncHitlpClient
from hitlp.mcp import McpTaskTransport

async with Client("https://hitlp.example/mcp") as mcp:
    client = AsyncHitlpClient(McpTaskTransport(mcp))
    task = await client.approve(req)        # task-augmented tools/call; returns the handle
    done = await client.wait_for_terminal(task)  # tasks/get, at the server's pollIntervalMs
```

- `call_tool` returns the task handle at once; it never waits for the result.
- `get_task` is `tasks/get`; once the task is `completed`, the inlined
  CallToolResult's `structuredContent` is the decision record (`task.result`).
- `cancel_task` is `tasks/cancel`, then `tasks/get` to report the cancelled task.
- The server picks the task's ttl (SEP-2663 has no client-requested ttl);
  `McpTaskTransport(mcp, timeout=...)` sets a per-request timeout in seconds.
- MCP errors become `McpTransportError`, with the JSON-RPC code on `.code`.

The server side needs `human.ask` and `human.approve` declared as task tools
(`@mcp.tool(task=True)`) on a FastMCP server with `TasksExtension`; see
`tests/test_mcp.py`. fastmcp-tasks is labeled experimental, so this adapter may
need to follow its changes.

## Build and test

```sh
cd sdks/python
pip install -e '.[test,mcp]'
pytest
```

Without the `mcp` extra, `tests/test_mcp.py` is skipped.

The vendored schemas come from `spec/` through `node sdks/scripts/sync-schemas.mjs`;
do not edit them by hand.
