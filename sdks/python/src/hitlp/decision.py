"""Interpreting how a request ended (spec 6, 7.3; rule R2)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Mapping, Optional

from .types import DecisionRecord, Task


def verify_payload_digest(record: Mapping[str, Any], request: Optional[Mapping[str, Any]] = None) -> bool:
    """True when the record is bound to the payload the request sent.

    True when the request had no ``payloadDigest``; false when it had one the
    record does not repeat (spec 4.2).
    """
    if request is None or request.get("payloadDigest") is None:
        return True
    return record.get("payloadDigest") == request["payloadDigest"]


def is_approved(record: Optional[Mapping[str, Any]], request: Optional[Mapping[str, Any]] = None) -> bool:
    """True only for an ``approved`` Approve decision bound to the request's digest.

    Any other terminal state, a timeout included, is not approval (rule R2).
    """
    if not record or record.get("primitive") != "approve" or record.get("outcome") != "approved":
        return False
    return verify_payload_digest(record, request)


def answer_of(record: Optional[Mapping[str, Any]]) -> Any:
    """The answer of an ``answered`` Ask decision, else None."""
    if record and record.get("primitive") == "ask" and record.get("outcome") == "answered":
        return record.get("answer")
    return None


@dataclass
class Resolution:
    """How a terminal task ended, from the agent's point of view."""

    kind: Literal["decided", "failed", "cancelled"]
    record: Optional[DecisionRecord] = None
    message: Optional[str] = None


class NotTerminalError(RuntimeError):
    pass


def resolve(task: Task) -> Resolution:
    """Interprets a terminal task. Raises for a task that is still running."""
    if not task.terminal:
        raise NotTerminalError(f"task {task.task_id} is {task.status}, not terminal")
    if task.status == "completed":
        if task.result is None:
            raise RuntimeError(f"task {task.task_id} is completed without a decision record")
        return Resolution("decided", task.result)
    return Resolution(task.status, task.result, task.status_message)  # type: ignore[arg-type]
