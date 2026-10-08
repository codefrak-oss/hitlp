"""The MCP Tasks operations HITLP needs (spec 7.1-7.4)."""

from __future__ import annotations

from typing import Any, Protocol

from .types import Task

ASK_TOOL = "human.ask"
APPROVE_TOOL = "human.approve"
TOOLS = frozenset({ASK_TOOL, APPROVE_TOOL})
# Reserved by the spec (section 4); never callable through this SDK.
RESERVED_TOOLS = frozenset({"human.do", "human.inform", "human.escalate"})


class TaskTransport(Protocol):
    """Adapt your MCP client to this.

    ``call_tool`` is a task-augmented ``tools/call`` that returns the handle at
    once, ``get_task`` is ``tasks/get`` (with the result attached once terminal)
    and ``cancel_task`` is ``tasks/cancel``.
    """

    def call_tool(self, name: str, args: dict[str, Any]) -> Task: ...
    def get_task(self, task_id: str) -> Task: ...
    def cancel_task(self, task_id: str) -> Task: ...


class AsyncTaskTransport(Protocol):
    """The asyncio form of :class:`TaskTransport`."""

    async def call_tool(self, name: str, args: dict[str, Any]) -> Task: ...
    async def get_task(self, task_id: str) -> Task: ...
    async def cancel_task(self, task_id: str) -> Task: ...


class ReservedToolError(ValueError):
    def __init__(self, name: str) -> None:
        super().__init__(f"{name} is reserved by HITLP v1 and must not be called")


def assert_callable_tool(name: str) -> None:
    if name in RESERVED_TOOLS:
        raise ReservedToolError(name)
    if name not in TOOLS:
        raise ValueError(f"{name} is not a HITLP v1 tool")
