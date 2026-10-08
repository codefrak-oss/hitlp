"""The human's side of a HITLP server, shrunk to a terminal for the demo.

It only stores the task and turns what the person types into a decision record;
envelopes, validation, polling and deciding what a record means are the SDK's.
It is NOT a conforming HITLP server: its task store lives in memory (rule R1),
and its human is whoever sits at this terminal.
"""

from __future__ import annotations

import dataclasses
import json
import re
import sys
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

from hitlp import ASK_TOOL, DecisionRecord, Task

Prompt = Callable[[str], str]


def terminal_prompt(question: str) -> str:
    """Reads a reply from stdin, typed or piped."""
    sys.stdout.write(question)
    sys.stdout.flush()
    line = sys.stdin.readline()
    if not line:
        raise EOFError("stdin closed before the human replied")
    return line.strip()


def scripted_prompt(answers: Iterable[str], write: Callable[[str], Any] = sys.stdout.write) -> Prompt:
    """Replays scripted replies (HITLP_DEMO_ANSWERS), echoing them as if typed."""
    queue = list(answers)

    def prompt(question: str) -> str:
        if not queue:
            raise RuntimeError("ran out of scripted answers")
        reply = queue.pop(0)
        write(f"{question}{reply}\n")
        return reply

    return prompt


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class TerminalHuman:
    def __init__(self, prompt: Prompt, human_id: str = "terminal-human") -> None:
        self._prompt = prompt
        self._human_id = human_id
        self._tasks: dict[str, tuple[Task, str, dict[str, Any]]] = {}
        self._by_key: dict[str, str] = {}

    def call_tool(self, name: str, args: dict[str, Any]) -> Task:
        key = args["idempotencyKey"]
        tid = self._by_key.get(key)
        if tid is None:
            tid = f"task-{len(self._tasks) + 1}"
            self._by_key[key] = tid
            self._tasks[tid] = (Task(tid, "working", poll_interval=10), name, args)
        return dataclasses.replace(self._tasks[tid][0])

    def get_task(self, task_id: str) -> Task:
        task, name, args = self._tasks[task_id]
        if task.status == "working":
            task.result = self._decide(task_id, name, args)
            task.status = "completed"
        return dataclasses.replace(task)

    def cancel_task(self, task_id: str) -> Task:
        task = self._tasks[task_id][0]
        if task.status == "working":
            task.status = "cancelled"
        return dataclasses.replace(task)

    def _decide(self, task_id: str, name: str, args: dict[str, Any]) -> DecisionRecord:
        record: dict[str, Any] = {
            "requestId": task_id,
            "idempotencyKey": args["idempotencyKey"],
            "decidedBy": {"type": "human", "id": self._human_id},
            "channel": "terminal",
        }
        if name == ASK_TOOL:
            answer = self._prompt(f"[human] {args['question']} ")
            record.update(primitive="ask", outcome="answered", answer=answer, decidedAt=_now())
            return record  # type: ignore[return-value]
        reply = self._prompt(f'[human] Approve "{args["action"]}" {json.dumps(args["payload"])}? [y/N] ')
        approved = re.fullmatch(r"y(es)?", reply, re.IGNORECASE) is not None
        record.update(primitive="approve", outcome="approved" if approved else "rejected", decidedAt=_now())
        if not approved:
            record["reason"] = "declined at the terminal"
        if "payloadDigest" in args:
            record["payloadDigest"] = args["payloadDigest"]
        return record  # type: ignore[return-value]
