"""McpTaskTransport against an in-process FastMCP server with the Tasks extension."""

import asyncio
from datetime import timedelta
from typing import Any, Optional

import pytest

pytest.importorskip("fastmcp_tasks")

from fastmcp import Client, FastMCP  # noqa: E402
from fastmcp.utilities.tasks import TaskConfig  # noqa: E402
from fastmcp_tasks import TasksExtension  # noqa: E402
from fastmcp_tasks.context import get_task_context  # noqa: E402

from hitlp import AsyncHitlpClient, ReservedToolError, answer_of, build_approve, build_ask, is_approved  # noqa: E402
from hitlp.mcp import McpTaskTransport, McpTransportError  # noqa: E402

POLL = TaskConfig(mode="required", poll_interval=timedelta(milliseconds=10))


def ask():
    return build_ask(
        deadline="2026-10-09T09:00:00Z", default_on_timeout="reject", question="Which currency?",
        response_schema={"type": "string"},
    )


def approve():
    return build_approve(deadline="2026-10-15T12:00:00Z", action="deploy", payload={"v": 1}, payload_digest="sha256:aa")


class HumanServer:
    """``human.ask`` and ``human.approve`` as task tools; :meth:`decide` finishes a task."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self._decisions: dict[str, asyncio.Future] = {}
        self.mcp = FastMCP("hitlp-test")
        self.mcp.add_extension(TasksExtension(url="memory://"))
        @self.mcp.tool(name="human.ask", task=POLL)
        async def human_ask(
            idempotencyKey: str, deadline: str, defaultOnTimeout: str, question: str, responseSchema: Any,
            options: Optional[list] = None, priority: Optional[str] = None, requires: Optional[dict] = None,
            context: Optional[dict] = None, requester: Optional[dict] = None,
        ) -> dict:
            return await self._run("human.ask", {k: v for k, v in locals().items() if v is not None})

        @self.mcp.tool(name="human.approve", task=POLL)
        async def human_approve(
            idempotencyKey: str, deadline: str, defaultOnTimeout: str, action: str, payload: dict,
            payloadDigest: Optional[str] = None, scope: Optional[dict] = None, priority: Optional[str] = None,
            requires: Optional[dict] = None, context: Optional[dict] = None, requester: Optional[dict] = None,
        ) -> dict:
            return await self._run("human.approve", {k: v for k, v in locals().items() if v is not None})


    def _future(self, task_id: str) -> asyncio.Future:
        return self._decisions.setdefault(task_id, asyncio.get_running_loop().create_future())

    async def _run(self, name: str, args: dict[str, Any]) -> dict:
        self.calls.append((name, args))
        task_id = get_task_context().task_id
        return {"requestId": task_id, **await self._future(task_id)}

    def decide(self, task_id: str, record: dict[str, Any]) -> None:
        self._future(task_id).set_result(record)


def run(test):
    """Runs ``test(server, transport, client, slept)`` against a fresh server."""

    async def main():
        server = HumanServer()
        slept: list[float] = []

        async def sleep(s):
            slept.append(s)
            await asyncio.sleep(0.005)

        async with Client(server.mcp) as mcp_client:
            transport = McpTaskTransport(mcp_client)
            await test(server, transport, AsyncHitlpClient(transport, sleep=sleep), slept)

    asyncio.run(main())


def test_ask_round_trip():
    async def body(server, transport, client, slept):
        req = ask()
        task = await client.ask(req)
        assert task.status == "working"
        assert task.poll_interval == 10
        await asyncio.sleep(0.05)
        assert server.calls[0][0] == "human.ask"
        assert server.calls[0][1]["idempotencyKey"] == req["idempotencyKey"]
        server.decide(task.task_id, {
            "idempotencyKey": req["idempotencyKey"], "primitive": "ask", "outcome": "answered", "answer": "EUR",
            "decidedBy": {"type": "human", "id": "h1"}, "decidedAt": "2026-10-08T15:20:00Z",
        })
        done = await client.wait_for_terminal(task)
        assert done.status == "completed"
        assert answer_of(done.result) == "EUR"
        assert done.result["requestId"] == task.task_id
        assert slept and all(s >= 0.01 for s in slept)

    run(body)


@pytest.mark.parametrize("outcome", ["approved", "rejected"])
def test_approve_round_trip(outcome):
    async def body(server, transport, client, slept):
        req = approve()
        task = await client.approve(req)
        await asyncio.sleep(0.05)
        assert server.calls[0][0] == "human.approve"
        server.decide(task.task_id, {
            "idempotencyKey": req["idempotencyKey"], "primitive": "approve", "outcome": outcome,
            "payloadDigest": "sha256:aa", "decidedBy": {"type": "human", "id": "h2"},
            "decidedAt": "2026-10-08T15:21:00Z",
        })
        done = await client.wait_for_terminal(task)
        assert done.result["outcome"] == outcome
        assert is_approved(done.result, req) == (outcome == "approved")

    run(body)


def test_cancel_maps_to_tasks_cancel():
    async def body(server, transport, client, slept):
        task = await client.ask(ask())
        cancelled = await client.cancel(task.task_id)
        assert cancelled.status == "cancelled"
        again = await client.get(task.task_id)
        assert again.status == "cancelled"
        assert again.result is None

    run(body)


def test_reserved_tools_never_reach_the_server():
    async def body(server, transport, client, slept):
        with pytest.raises(ReservedToolError):
            await transport.call_tool("human.do", {})
        assert server.calls == []

    run(body)


def test_mcp_errors_keep_their_code():
    async def body(server, transport, client, slept):
        with pytest.raises(McpTransportError) as e:
            await transport.get_task("no-such-task")
        assert isinstance(e.value.code, int)

    run(body)


def test_get_task_copies_meta_and_decision_url():
    async def body(server, transport, client, slept):
        task = await client.ask(ask())
        assert task.decision_url is None
        assert (await client.get(task.task_id)).decision_url is None
        session = transport._client.session
        orig = session.send_request

        async def send_request(request, result_type, **kw):
            res = await orig(request, result_type, **kw)
            if type(request).__name__ == "GetTaskRequest":
                res = res.model_copy(update={"meta": {"io.hitlp/decisionUrl": "https://example.test/d/1"}})
            return res

        session.send_request = send_request
        got = await client.get(task.task_id)
        assert got.meta == {"io.hitlp/decisionUrl": "https://example.test/d/1"}
        assert got.decision_url == "https://example.test/d/1"

    run(body)
