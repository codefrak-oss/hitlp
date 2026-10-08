"""An AsyncTaskTransport over FastMCP and its Tasks extension (spec 7.1-7.4).

It targets SEP-2663, the ``io.modelcontextprotocol/tasks`` extension, through
the ``fastmcp[tasks]`` package (install ``hitlp[mcp]``). Only code that imports
this module needs it installed. fastmcp-tasks is experimental, so this adapter
may need to follow it.
"""

from __future__ import annotations

from typing import Any, Awaitable, Callable, Optional, TypeVar

from fastmcp import Client
from fastmcp_tasks import call_tool_task
from fastmcp_tasks.client_models import (
    CancelTaskRequest,
    CancelTaskRequestParams,
    ClientCreateTaskResult,
    ClientGetTaskResult,
    GetTaskRequest,
    GetTaskRequestParams,
)
from mcp.shared.exceptions import MCPError
from mcp_types import Result

from .transport import assert_callable_tool
from .types import Task

__all__ = ["McpTaskTransport", "McpTransportError"]

T = TypeVar("T")


class McpTransportError(Exception):
    """An MCP error, with its JSON-RPC code kept."""

    def __init__(self, message: str, code: Optional[int] = None) -> None:
        super().__init__(message)
        self.code = code


class McpTaskTransport:
    """Adapts a connected fastmcp ``Client`` to :class:`~hitlp.AsyncTaskTransport`.

    ``call_tool`` is a task-augmented ``tools/call`` that returns the handle at
    once, ``get_task`` is ``tasks/get`` (the inlined CallToolResult's
    ``structuredContent`` is the decision record once completed) and
    ``cancel_task`` is ``tasks/cancel``. SEP-2663 lets the server pick the
    task's ttl, so there is none to request.

    :param timeout: timeout for each MCP request, in seconds.
    """

    def __init__(self, client: Client, *, timeout: Optional[float] = None) -> None:
        self._client = client
        self._timeout = timeout

    async def call_tool(self, name: str, args: dict[str, Any]) -> Task:
        assert_callable_tool(name)
        handle = await self._wrap(lambda: call_tool_task(self._client, name, args, timeout=self._timeout))
        return _to_task(handle.create_result)

    async def get_task(self, task_id: str) -> Task:
        res = await self._wrap(
            lambda: self._client.session.send_request(
                GetTaskRequest(params=GetTaskRequestParams(task_id=task_id)),
                ClientGetTaskResult,
                request_read_timeout_seconds=self._timeout,
            )
        )
        task = _to_task(res)
        if res.status == "completed" and res.result and not res.result.get("isError"):
            record = res.result.get("structuredContent")
            if record:
                task.result = record
        return task

    async def cancel_task(self, task_id: str) -> Task:
        # SEP-2663 acknowledges tasks/cancel with an empty result; read the task back.
        await self._wrap(
            lambda: self._client.session.send_request(
                CancelTaskRequest(params=CancelTaskRequestParams(task_id=task_id)),
                Result,
                request_read_timeout_seconds=self._timeout,
            )
        )
        return await self.get_task(task_id)

    async def _wrap(self, f: Callable[[], Awaitable[T]]) -> T:
        try:
            return await f()
        except MCPError as e:
            raise McpTransportError(e.message, e.code) from e


def _to_task(t: ClientCreateTaskResult | ClientGetTaskResult) -> Task:
    return Task(
        task_id=t.task_id,
        status=t.status,
        ttl=t.ttl_ms,
        poll_interval=t.poll_interval_ms,
        status_message=t.status_message,
    )
