"""The common request envelope (spec section 5)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional, Union

from .idempotency import new_idempotency_key
from .types import DefaultOnTimeout, Envelope, Priority


def _rfc3339(value: Union[datetime, str]) -> str:
    if isinstance(value, str):
        return value
    if value.tzinfo is None:
        raise ValueError("deadline must be timezone-aware")
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def build_envelope(
    *,
    deadline: Union[datetime, str],
    default_on_timeout: DefaultOnTimeout,
    idempotency_key: Optional[str] = None,
    priority: Priority = "normal",
    requires: Optional[dict[str, list[str]]] = None,
    context: Optional[dict[str, Any]] = None,
    requester: Optional[dict[str, str]] = None,
) -> Envelope:
    """Envelope fields; the key defaults to a fresh one, priority to ``normal``.

    Pass the stored ``idempotency_key`` when re-building a retried request.
    """
    env: Envelope = {
        "idempotencyKey": idempotency_key or new_idempotency_key(),
        "deadline": _rfc3339(deadline),
        "defaultOnTimeout": default_on_timeout,
        "priority": priority,
    }
    if requires is not None:
        env["requires"] = requires
    if context is not None:
        env["context"] = context
    if requester is not None:
        env["requester"] = requester
    return env
