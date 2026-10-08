"""Types for HITLP v1.0 (draft): spec/hitlp.md sections 4-7.

Requests and decision records are plain dicts shaped as the spec's JSON schemas
(see validate.py, which stays the authority); these TypedDicts name their keys.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Optional, TypedDict

SPEC_VERSION = "1.0-draft"

DefaultOnTimeout = Literal["reject", "escalate", "cancel", "fail"]
Priority = Literal["low", "normal", "high", "urgent"]
Primitive = Literal["ask", "approve"]
Outcome = Literal["answered", "approved", "rejected", "timed_out", "cancelled"]
TaskStatus = Literal["working", "input_required", "completed", "failed", "cancelled"]

TERMINAL_STATUSES: frozenset[str] = frozenset({"completed", "failed", "cancelled"})


class _EnvelopeRequired(TypedDict):
    idempotencyKey: str
    deadline: str
    defaultOnTimeout: DefaultOnTimeout


class Envelope(_EnvelopeRequired, total=False):
    """The common request envelope (spec section 5)."""

    priority: Priority
    requires: dict[str, list[str]]
    context: dict[str, Any]
    requester: dict[str, str]


class _AskBody(TypedDict):
    question: str
    responseSchema: Any


class AskRequest(Envelope, _AskBody, total=False):
    """`human.ask` arguments: envelope plus Ask body, flattened (spec 4.1, 7.1)."""

    options: list[dict[str, Any]]


class _ApproveBody(TypedDict):
    action: str
    payload: dict[str, Any]


class ApproveRequest(Envelope, _ApproveBody, total=False):
    """`human.approve` arguments: envelope plus Approve body, flattened (spec 4.2, 7.1)."""

    payloadDigest: str
    scope: dict[str, Any]


class _DecisionRequired(TypedDict):
    requestId: str
    idempotencyKey: str
    primitive: Primitive
    outcome: Outcome
    decidedBy: dict[str, Any]
    decidedAt: str


class DecisionRecord(_DecisionRequired, total=False):
    """The decision record (spec section 6); it is the task result."""

    answer: Any
    reason: str
    channel: str
    payloadDigest: str
    signature: dict[str, str]


def is_terminal(status: str) -> bool:
    return status in TERMINAL_STATUSES


DECISION_URL_META_KEY = "io.hitlp/decisionUrl"
"""The ``_meta`` key under which the server carries a URL-mode decision URL."""


@dataclass
class Task:
    """A task handle as the transport reports it (spec 7.2). Times are in milliseconds."""

    task_id: str
    status: TaskStatus
    ttl: Optional[int] = None
    poll_interval: Optional[int] = None
    status_message: Optional[str] = None
    result: Optional[DecisionRecord] = None
    meta: Optional[dict[str, Any]] = None
    """The task's ``_meta`` object as the server sent it; ``None`` when it sent none."""

    @property
    def decision_url(self) -> Optional[str]:
        """The URL-mode decision URL: ``meta["io.hitlp/decisionUrl"]`` when that is a string, else ``None``.

        The server also puts it in ``status_message``.
        """
        url = (self.meta or {}).get(DECISION_URL_META_KEY)
        return url if isinstance(url, str) else None

    @property
    def terminal(self) -> bool:
        return is_terminal(self.status)
