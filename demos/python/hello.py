"""A hello world HITLP (human-in-the-loop-protocol) agent on the Python SDK.

It asks the human their name (Ask), greets them, then asks approval to deploy a
greeting (Approve) and goes on only if approved.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Optional

from hitlp import AsyncHitlpClient, AsyncTaskTransport, Checkpoint, Task, TaskTransport, answer_of, build_approve, build_ask, is_approved

from terminal_human import Prompt, TerminalHuman, scripted_prompt, terminal_prompt


@dataclass
class HelloResult:
    name: Optional[str]
    deployed: bool


class _AsyncOf:
    """Runs a blocking TaskTransport (the terminal human) behind the async client."""

    def __init__(self, transport: TaskTransport) -> None:
        self._t = transport

    async def call_tool(self, name: str, args: dict[str, Any]) -> Task:
        return self._t.call_tool(name, args)

    async def get_task(self, task_id: str) -> Task:
        return self._t.get_task(task_id)

    async def cancel_task(self, task_id: str) -> Task:
        return self._t.cancel_task(task_id)


def hello(prompt: Prompt, log: Callable[[str], None] = print, checkpoint_file: str = ".hitlp-demo-checkpoint.json") -> HelloResult:
    """Terminal mode: the human answers at this terminal."""
    return asyncio.run(hello_async(_AsyncOf(TerminalHuman(prompt)), log, checkpoint_file))


async def hello_server(url: str, token: str, log: Callable[[str], None] = print, checkpoint_file: str = ".hitlp-demo-checkpoint.json") -> HelloResult:
    """Real-server mode: an MCP Streamable HTTP client to ``url`` with a bearer token, through hitlp.mcp."""
    from fastmcp import Client  # needs hitlp[mcp]

    from hitlp.mcp import McpTaskTransport

    async with Client(url, auth=token) as client:
        return await hello_async(McpTaskTransport(client), log, checkpoint_file, server=True)


async def hello_async(
    transport: AsyncTaskTransport,
    log: Callable[[str], None] = print,
    checkpoint_file: str = ".hitlp-demo-checkpoint.json",
    server: bool = False,
) -> HelloResult:
    client = AsyncHitlpClient(transport)
    in_an_hour = lambda: datetime.now(timezone.utc) + timedelta(hours=1)  # noqa: E731
    requester = {"agent": "hitlp-hello-python"}

    async def waiting(created: Task) -> None:
        # On a real server the human decides elsewhere: say where.
        if not server:
            return
        task = created if created.decision_url else await client.get(created.task_id)
        where = f" at {task.decision_url}" if task.decision_url else " (the server logs its decision page URL)"
        log(f"[agent] Task {task.task_id} waits for a human{where}.")

    # Ask: the call returns a task handle at once; the human answers later.
    log("[agent] Asking the human for their name (human.ask) ...")
    ask = build_ask(
        question="What is your name?",
        response_schema={"type": "string", "minLength": 1},
        deadline=in_an_hour(),
        default_on_timeout="cancel",
        requester=requester,
    )
    ask_task = await client.ask(ask)
    await waiting(ask_task)
    asked = await client.wait_for_terminal(ask_task)
    name = answer_of(asked.result)
    if not name:
        log(f"[agent] No answer ({asked.status}); stopping.")
        return HelloResult(None, False)
    log(f"[agent] Hello, {name}!")

    # Approve: checkpoint the handle before yielding (rule R3), then resume from it.
    approve = build_approve(
        action="deploy.greeting",
        payload={"greeting": f"Hello, {name}!", "target": "hello-world"},
        deadline=in_an_hour(),
        requester=requester,
    )
    log(f"[agent] Requesting approval for {approve['action']} (human.approve) ...")
    task = await client.approve(approve)
    await waiting(task)
    path = Path(checkpoint_file)
    path.write_text(Checkpoint.for_task(task, approve, "approve").to_json())
    log(f"[agent] Checkpointed task {task.task_id}; resuming from the checkpoint.")

    resolution = await client.resume(Checkpoint.from_json(path.read_text()))
    path.unlink(missing_ok=True)
    if resolution.kind == "decided" and is_approved(resolution.record, approve):
        log(f"[agent] Approved by {resolution.record['decidedBy'].get('id')}. Deploying \"Hello, {name}!\" ... done.")
        return HelloResult(name, True)
    outcome = resolution.record["outcome"] if resolution.record else resolution.kind
    log(f"[agent] Not approved ({outcome}); nothing deployed.")
    return HelloResult(name, False)


if __name__ == "__main__":
    server_url = os.environ.get("HITLP_DEMO_SERVER")
    scripted = os.environ.get("HITLP_DEMO_ANSWERS")
    if server_url:
        asyncio.run(hello_server(server_url, os.environ.get("HITLP_DEMO_TOKEN", "local")))
    else:
        hello(scripted_prompt(scripted.split(",")) if scripted is not None else terminal_prompt)
