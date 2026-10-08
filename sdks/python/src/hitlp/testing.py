"""In-memory transports for unit tests.

They are NOT a HITLP server: an in-memory task store is not conforming (rule R1).
Tests drive decisions with ``complete`` and ``set_status``.
"""

from __future__ import annotations

import dataclasses
from typing import Any, Optional

from .types import DecisionRecord, Task, TaskStatus


class FakeTransport:
    def __init__(self, poll_interval: Optional[int] = 500) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.gets: list[str] = []
        self.cancels: list[str] = []
        self.fail_next_calls = 0
        self._poll_interval = poll_interval
        self._tasks: dict[str, Task] = {}
        self._by_key: dict[str, str] = {}

    def call_tool(self, name: str, args: dict[str, Any]) -> Task:
        self.calls.append((name, args))
        key = args["idempotencyKey"]
        tid = self._by_key.get(key)
        if tid is None:
            tid = f"task-{len(self._tasks) + 1}"
            self._by_key[key] = tid
            self._tasks[tid] = Task(tid, "working", ttl=3_600_000, poll_interval=self._poll_interval)
        if self.fail_next_calls:
            self.fail_next_calls -= 1
            raise ConnectionError("connection lost")
        return dataclasses.replace(self._tasks[tid])

    def get_task(self, task_id: str) -> Task:
        self.gets.append(task_id)
        return dataclasses.replace(self._tasks[task_id])

    def cancel_task(self, task_id: str) -> Task:
        self.cancels.append(task_id)
        t = self._tasks[task_id]
        if t.status not in ("completed", "failed"):
            t.status = "cancelled"
        return dataclasses.replace(t)

    def set_status(self, task_id: str, status: TaskStatus, message: Optional[str] = None) -> None:
        t = self._tasks[task_id]
        t.status, t.status_message = status, message

    def complete(self, task_id: str, record: dict[str, Any]) -> None:
        t = self._tasks[task_id]
        t.status = "completed"
        t.result = DecisionRecord(requestId=task_id, **record)  # type: ignore[typeddict-item]


class AsyncFakeTransport(FakeTransport):
    """The asyncio form of :class:`FakeTransport`."""

    async def call_tool(self, name: str, args: dict[str, Any]) -> Task:  # type: ignore[override]
        return FakeTransport.call_tool(self, name, args)

    async def get_task(self, task_id: str) -> Task:  # type: ignore[override]
        return FakeTransport.get_task(self, task_id)

    async def cancel_task(self, task_id: str) -> Task:  # type: ignore[override]
        return FakeTransport.cancel_task(self, task_id)
