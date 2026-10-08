"""HITLP clients over MCP Tasks.

``ask`` and ``approve`` return the task handle at once (rule R1); checkpoint it
(R3), then ``wait_for_terminal`` or ``resume``.
"""

from __future__ import annotations

import asyncio
import copy
import threading
import time
from typing import Any, Awaitable, Callable, Optional

from .checkpoint import Checkpoint
from .decision import Resolution, resolve
from .transport import APPROVE_TOOL, ASK_TOOL, AsyncTaskTransport, TaskTransport, assert_callable_tool
from .types import ApproveRequest, AskRequest, Task
from .validate import assert_valid


class Cancelled(Exception):
    """Raised when a wait is stopped through its stop event."""


def _validate_result(task: Task) -> None:
    if task.result is not None:
        kind = "approve.response" if task.result.get("primitive") == "approve" else "ask.response"
        assert_valid(kind, task.result)


def _check_checkpoint(task: Task, cp: Checkpoint) -> None:
    r = task.result
    if r is not None and (r.get("idempotencyKey") != cp.idempotency_key or r.get("primitive") != cp.primitive):
        raise ValueError(f"task {cp.task_id} does not match its checkpoint")


class HitlpClient:
    """Synchronous client.

    :param default_poll_interval: ms between polls when the server gives none.
    :param call_retries: retries of a failed ``tools/call``, with the same key (R4).
    :param sleep: seconds -> None; injectable for tests.
    """

    def __init__(
        self,
        transport: TaskTransport,
        *,
        default_poll_interval: int = 1000,
        call_retries: int = 2,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._transport = transport
        self._default_poll_interval = default_poll_interval
        self._call_retries = call_retries
        self._sleep = sleep

    def ask(self, request: AskRequest) -> Task:
        """Calls ``human.ask``; returns the handle without waiting for a human."""
        assert_valid("ask.request", request)
        return self._call(ASK_TOOL, request)

    def approve(self, request: ApproveRequest) -> Task:
        """Calls ``human.approve``; returns the handle without waiting for a human."""
        assert_valid("approve.request", request)
        return self._call(APPROVE_TOOL, request)

    def get(self, task_id: str) -> Task:
        """``tasks/get``. Prefer :meth:`wait_for_terminal`, which respects ``pollInterval``."""
        return self._transport.get_task(task_id)

    def cancel(self, task_id: str) -> Task:
        """``tasks/cancel``."""
        return self._transport.cancel_task(task_id)

    def wait_for_terminal(
        self,
        task: Task | str,
        *,
        stop: Optional[threading.Event] = None,
        on_input_required: Optional[Callable[[Task], None]] = None,
    ) -> Task:
        """Polls ``tasks/get`` until terminal, never faster than ``pollInterval`` (spec 7.4).

        ``on_input_required`` is called once per entry into ``input_required``: when the wait
        starts on an ``input_required`` task, or a poll sees it after another status. Its task
        carries that poll's ``meta`` and ``decision_url``.
        """
        t = self.get(task) if isinstance(task, str) else task
        previous: Optional[str] = None
        while not t.terminal:
            if stop is not None and stop.is_set():
                raise Cancelled(t.task_id)
            if t.status == "input_required" and previous != "input_required" and on_input_required:
                on_input_required(t)
            previous = t.status
            interval = t.poll_interval if t.poll_interval is not None else self._default_poll_interval
            self._sleep(max(interval, 0) / 1000)
            t = self.get(t.task_id)
        _validate_result(t)
        return t

    def resume(self, checkpoint: Checkpoint, **kwargs: Any) -> Resolution:
        """Waits for a checkpointed task and interprets how it ended (rule R3)."""
        t = self.wait_for_terminal(checkpoint.task_id, **kwargs)
        _check_checkpoint(t, checkpoint)
        return resolve(t)

    def _call(self, name: str, args: Any) -> Task:
        assert_callable_tool(name)
        # Every attempt sends the same arguments, so the same idempotency key (R4).
        frozen = copy.deepcopy(dict(args))
        for attempt in range(self._call_retries + 1):
            try:
                return self._transport.call_tool(name, frozen)
            except Exception:
                if attempt == self._call_retries:
                    raise
        raise AssertionError("unreachable")


class AsyncHitlpClient:
    """asyncio client; the same surface as :class:`HitlpClient`."""

    def __init__(
        self,
        transport: AsyncTaskTransport,
        *,
        default_poll_interval: int = 1000,
        call_retries: int = 2,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._transport = transport
        self._default_poll_interval = default_poll_interval
        self._call_retries = call_retries
        self._sleep = sleep

    async def ask(self, request: AskRequest) -> Task:
        assert_valid("ask.request", request)
        return await self._call(ASK_TOOL, request)

    async def approve(self, request: ApproveRequest) -> Task:
        assert_valid("approve.request", request)
        return await self._call(APPROVE_TOOL, request)

    async def get(self, task_id: str) -> Task:
        return await self._transport.get_task(task_id)

    async def cancel(self, task_id: str) -> Task:
        return await self._transport.cancel_task(task_id)

    async def wait_for_terminal(
        self,
        task: Task | str,
        *,
        on_input_required: Optional[Callable[[Task], Awaitable[None]]] = None,
    ) -> Task:
        """Polls until terminal, never faster than ``pollInterval``. Cancel it as any asyncio task.

        ``on_input_required`` is awaited once per entry into ``input_required``, as in
        :meth:`HitlpClient.wait_for_terminal`.
        """
        t = await self.get(task) if isinstance(task, str) else task
        previous: Optional[str] = None
        while not t.terminal:
            if t.status == "input_required" and previous != "input_required" and on_input_required:
                await on_input_required(t)
            previous = t.status
            interval = t.poll_interval if t.poll_interval is not None else self._default_poll_interval
            await self._sleep(max(interval, 0) / 1000)
            t = await self.get(t.task_id)
        _validate_result(t)
        return t

    async def resume(self, checkpoint: Checkpoint, **kwargs: Any) -> Resolution:
        t = await self.wait_for_terminal(checkpoint.task_id, **kwargs)
        _check_checkpoint(t, checkpoint)
        return resolve(t)

    async def _call(self, name: str, args: Any) -> Task:
        assert_callable_tool(name)
        frozen = copy.deepcopy(dict(args))
        for attempt in range(self._call_retries + 1):
            try:
                return await self._transport.call_tool(name, frozen)
            except Exception:
                if attempt == self._call_retries:
                    raise
        raise AssertionError("unreachable")
