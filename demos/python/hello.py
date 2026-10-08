"""A hello world HITLP (human-in-the-loop-protocol) agent on the Python SDK.

It asks the human their name (Ask), greets them, then asks approval to deploy a
greeting (Approve) and goes on only if approved.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

from hitlp import Checkpoint, HitlpClient, answer_of, build_approve, build_ask, is_approved

from terminal_human import Prompt, TerminalHuman, scripted_prompt, terminal_prompt


@dataclass
class HelloResult:
    name: Optional[str]
    deployed: bool


def hello(prompt: Prompt, log: Callable[[str], None] = print, checkpoint_file: str = ".hitlp-demo-checkpoint.json") -> HelloResult:
    client = HitlpClient(TerminalHuman(prompt))
    in_an_hour = lambda: datetime.now(timezone.utc) + timedelta(hours=1)  # noqa: E731
    requester = {"agent": "hitlp-hello-python"}

    # Ask: the call returns a task handle at once; the human answers later.
    log("[agent] Asking the human for their name (human.ask) ...")
    ask = build_ask(
        question="What is your name?",
        response_schema={"type": "string", "minLength": 1},
        deadline=in_an_hour(),
        default_on_timeout="cancel",
        requester=requester,
    )
    asked = client.wait_for_terminal(client.ask(ask))
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
    task = client.approve(approve)
    path = Path(checkpoint_file)
    path.write_text(Checkpoint.for_task(task, approve, "approve").to_json())
    log(f"[agent] Checkpointed task {task.task_id}; resuming from the checkpoint.")

    resolution = client.resume(Checkpoint.from_json(path.read_text()))
    path.unlink(missing_ok=True)
    if resolution.kind == "decided" and is_approved(resolution.record, approve):
        log(f"[agent] Approved by {resolution.record['decidedBy'].get('id')}. Deploying \"Hello, {name}!\" ... done.")
        return HelloResult(name, True)
    outcome = resolution.record["outcome"] if resolution.record else resolution.kind
    log(f"[agent] Not approved ({outcome}); nothing deployed.")
    return HelloResult(name, False)


if __name__ == "__main__":
    scripted = os.environ.get("HITLP_DEMO_ANSWERS")
    hello(scripted_prompt(scripted.split(",")) if scripted is not None else terminal_prompt)
