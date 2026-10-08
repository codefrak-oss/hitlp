import asyncio
import threading

import pytest

from hitlp import (
    AsyncHitlpClient,
    Cancelled,
    Checkpoint,
    HitlpClient,
    HitlpValidationError,
    ReservedToolError,
    Task,
    answer_of,
    assert_callable_tool,
    build_approve,
    build_ask,
    is_approved,
    resolve,
    verify_payload_digest,
)
from hitlp.testing import AsyncFakeTransport, FakeTransport


def ask():
    return build_ask(
        deadline="2026-10-09T09:00:00Z", default_on_timeout="reject", question="Which currency?",
        response_schema={"type": "string"},
    )


def approve():
    return build_approve(deadline="2026-10-15T12:00:00Z", action="deploy", payload={"v": 1}, payload_digest="sha256:aa")


def answered(req):
    return {
        "idempotencyKey": req["idempotencyKey"], "primitive": "ask", "outcome": "answered", "answer": "EUR",
        "decidedBy": {"type": "human", "id": "h1"}, "decidedAt": "2026-10-08T15:20:00Z",
    }


def test_ask_returns_handle_without_waiting():
    t = FakeTransport()
    task = HitlpClient(t).ask(ask())
    assert task.status == "working"
    assert t.calls[0][0] == "human.ask"
    assert t.gets == []


def test_polling_never_faster_than_poll_interval():
    t = FakeTransport(poll_interval=750)
    slept = []
    client = HitlpClient(t, sleep=slept.append)
    req = ask()
    task = client.ask(req)
    orig = t.get_task

    def get(tid):
        if len(t.gets) == 2:
            t.complete(tid, answered(req))
        return orig(tid)

    t.get_task = get
    done = client.wait_for_terminal(task)
    assert done.status == "completed"
    assert answer_of(done.result) == "EUR"
    assert slept == [0.75, 0.75, 0.75]


def test_default_interval_and_stop():
    t = FakeTransport(poll_interval=None)
    slept = []
    client = HitlpClient(t, default_poll_interval=2000, sleep=slept.append)
    task = client.ask(ask())
    stop = threading.Event()
    t.get_task = lambda tid: (stop.set(), FakeTransport.get_task(t, tid))[1]
    with pytest.raises(Cancelled):
        client.wait_for_terminal(task, stop=stop)
    assert slept == [2.0]


def test_cancel_goes_through_tasks_cancel():
    t = FakeTransport()
    client = HitlpClient(t)
    task = client.approve(approve())
    after = client.cancel(task.task_id)
    assert t.cancels == [task.task_id]
    assert after.status == "cancelled"
    assert resolve(after).kind == "cancelled"


def test_retry_reuses_key_and_new_request_gets_fresh_key():
    t = FakeTransport()
    t.fail_next_calls = 1
    client = HitlpClient(t)
    req = approve()
    task = client.approve(req)
    assert [c[1]["idempotencyKey"] for c in t.calls] == [req["idempotencyKey"]] * 2
    assert task.task_id == "task-1"
    other = client.approve(approve())
    assert t.calls[2][1]["idempotencyKey"] != req["idempotencyKey"]
    assert other.task_id != task.task_id


def test_checkpoint_round_trip_and_resume():
    t = FakeTransport()
    req = approve()
    task = HitlpClient(t).approve(req)
    stored = Checkpoint.for_task(task, req, "approve").to_json()

    cp = Checkpoint.from_json(stored)  # a new process: only the checkpoint survives
    assert (cp.task_id, cp.idempotency_key) == (task.task_id, req["idempotencyKey"])
    t.complete(cp.task_id, {
        "idempotencyKey": cp.idempotency_key, "primitive": "approve", "outcome": "approved",
        "decidedBy": {"type": "human", "id": "h-102"}, "decidedAt": "2026-10-08T18:04:11Z",
        "payloadDigest": "sha256:aa",
    })
    res = HitlpClient(t, sleep=lambda s: None).resume(cp)
    assert res.kind == "decided"
    assert is_approved(res.record, cp.request)
    with pytest.raises(ValueError):
        Checkpoint.from_json("{}")


BASE = {
    "requestId": "t", "idempotencyKey": "k", "primitive": "approve", "outcome": "approved",
    "decidedBy": {"type": "human", "id": "h"}, "decidedAt": "2026-10-08T18:04:11Z", "payloadDigest": "sha256:aa",
}


@pytest.mark.parametrize("outcome", ["rejected", "timed_out", "cancelled"])
def test_only_approved_is_approval(outcome):
    assert is_approved(BASE)
    assert not is_approved({**BASE, "outcome": outcome, "decidedBy": {"type": "policy"}})


def test_other_terminal_states():
    assert not is_approved(None)
    assert not is_approved({**BASE, "primitive": "ask"})
    assert resolve(Task("t", "failed", status_message="default fail")).kind == "failed"
    with pytest.raises(RuntimeError):
        resolve(Task("t", "working"))


def test_payload_digest_mismatch_flagged():
    assert verify_payload_digest(BASE, {"payloadDigest": "sha256:aa"})
    assert not verify_payload_digest({**BASE, "payloadDigest": "sha256:bb"}, {"payloadDigest": "sha256:aa"})
    no_digest = {k: v for k, v in BASE.items() if k != "payloadDigest"}
    assert not verify_payload_digest(no_digest, {"payloadDigest": "sha256:aa"})
    assert not is_approved({**BASE, "payloadDigest": "sha256:bb"}, {"payloadDigest": "sha256:aa"})


def test_invalid_decision_record_refused():
    t = FakeTransport()
    client = HitlpClient(t, sleep=lambda s: None)
    req = ask()
    task = client.ask(req)
    t.complete(task.task_id, {
        "idempotencyKey": req["idempotencyKey"], "primitive": "ask", "outcome": "timed_out",
        "decidedBy": {"type": "human"}, "decidedAt": "2026-10-08T15:20:00Z",
    })
    with pytest.raises(HitlpValidationError):
        client.wait_for_terminal(task.task_id)


@pytest.mark.parametrize("name", ["human.do", "human.inform", "human.escalate"])
def test_reserved_tools_not_callable(name):
    with pytest.raises(ReservedToolError):
        assert_callable_tool(name)


def test_unknown_tool_not_callable():
    with pytest.raises(ValueError):
        assert_callable_tool("human.other")
    assert_callable_tool("human.ask")


def test_async_client_round_trip():
    async def run():
        t = AsyncFakeTransport(poll_interval=300)
        slept = []

        async def sleep(s):
            slept.append(s)
            if len(slept) == 2:
                t.complete(task.task_id, answered(req))

        client = AsyncHitlpClient(t, sleep=sleep)
        req = ask()
        task = await client.ask(req)
        cp = Checkpoint.for_task(task, req, "ask")
        res = await client.resume(cp)
        return res, slept

    res, slept = asyncio.run(run())
    assert res.kind == "decided"
    assert answer_of(res.record) == "EUR"
    assert slept == [0.3, 0.3]


URL = "https://example.test/d/1"


def test_decision_url_reads_meta_only_when_a_string():
    assert Task("t", "input_required", meta={"io.hitlp/decisionUrl": URL}).decision_url == URL
    assert Task("t", "working").meta is None
    assert Task("t", "working").decision_url is None
    assert Task("t", "working", meta={"io.hitlp/decisionUrl": 42}).decision_url is None


def _scripted(transport, task_id, req, script):
    """Applies the next status in ``script`` before each ``get_task``; records the poll count."""
    state = {"polls": 0}
    orig = FakeTransport.get_task

    def apply(status):
        if status == "completed":
            transport.complete(task_id, {
                "idempotencyKey": req["idempotencyKey"], "primitive": "ask", "outcome": "answered", "answer": "EUR",
                "decidedBy": {"type": "human", "id": "h1"}, "decidedAt": "2026-10-08T15:20:00Z",
            })
        else:
            transport.set_status(task_id, status)
            transport.set_meta(task_id, {"io.hitlp/decisionUrl": URL} if status == "input_required" else None)

    def get_task(tid):
        apply(script[state["polls"]] if state["polls"] < len(script) else "completed")
        state["polls"] += 1
        return orig(transport, tid)

    return state, apply, get_task


ONCE = ["working", "input_required", "input_required", "input_required", "completed"]
TWICE = ["input_required", "input_required", "working", "input_required", "completed"]


@pytest.mark.parametrize("script,calls", [(ONCE, 1), (TWICE, 2)])
def test_on_input_required_fires_once_per_entry(script, calls):
    t = FakeTransport()
    client = HitlpClient(t, sleep=lambda s: None)
    req = ask()
    task = client.ask(req)
    state, _, get_task = _scripted(t, task.task_id, req, script)
    t.get_task = get_task
    seen = []
    assert client.wait_for_terminal(task, on_input_required=seen.append).status == "completed"
    assert len(seen) == calls
    assert all(s.decision_url == URL and s.meta == {"io.hitlp/decisionUrl": URL} for s in seen)


def test_on_input_required_fires_before_first_repoll_when_starting_input_required():
    t = FakeTransport()
    client = HitlpClient(t, sleep=lambda s: None)
    req = ask()
    task = client.ask(req)
    state, apply, get_task = _scripted(t, task.task_id, req, ["input_required", "completed"])
    apply("input_required")
    task = client.get(task.task_id)
    t.get_task = get_task
    seen = []
    client.wait_for_terminal(task, on_input_required=lambda x: seen.append(state["polls"]))
    assert seen == [0]


@pytest.mark.parametrize("script,calls", [(ONCE, 1), (TWICE, 2)])
def test_async_on_input_required_fires_once_per_entry(script, calls):
    async def main():
        t = AsyncFakeTransport()

        async def sleep(s):
            pass

        client = AsyncHitlpClient(t, sleep=sleep)
        req = ask()
        task = await client.ask(req)
        state, _, get_task = _scripted(t, task.task_id, req, script)

        async def aget(tid):
            return get_task(tid)

        t.get_task = aget
        seen = []

        async def on(x):
            seen.append(x)

        assert (await client.wait_for_terminal(task, on_input_required=on)).status == "completed"
        assert len(seen) == calls
        assert all(s.decision_url == URL for s in seen)

    asyncio.run(main())


def test_async_on_input_required_fires_before_first_repoll_when_starting_input_required():
    async def main():
        t = AsyncFakeTransport()

        async def sleep(s):
            pass

        client = AsyncHitlpClient(t, sleep=sleep)
        req = ask()
        task = await client.ask(req)
        state, apply, get_task = _scripted(t, task.task_id, req, ["input_required", "completed"])
        apply("input_required")
        task = await client.get(task.task_id)

        async def aget(tid):
            return get_task(tid)

        t.get_task = aget
        seen = []

        async def on(x):
            seen.append(state["polls"])

        await client.wait_for_terminal(task, on_input_required=on)
        assert seen == [0]

    asyncio.run(main())
