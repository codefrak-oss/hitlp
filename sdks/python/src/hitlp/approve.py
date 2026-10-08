"""Builder for ``human.approve`` arguments (spec 4.2)."""

from __future__ import annotations

from typing import Any, Optional

from .envelope import build_envelope
from .types import ApproveRequest, DefaultOnTimeout
from .validate import assert_valid


def build_approve(
    *,
    action: str,
    payload: dict[str, Any],
    payload_digest: Optional[str] = None,
    scope: Optional[dict[str, Any]] = None,
    default_on_timeout: DefaultOnTimeout = "reject",
    **envelope: Any,
) -> ApproveRequest:
    """Builds and validates ``human.approve`` arguments.

    ``default_on_timeout`` defaults to ``reject``, the spec's recommended
    default for Approve (section 5).
    """
    req: ApproveRequest = {
        **build_envelope(default_on_timeout=default_on_timeout, **envelope),
        "action": action,
        "payload": payload,
    }  # type: ignore[typeddict-item]
    if payload_digest is not None:
        req["payloadDigest"] = payload_digest
    if scope is not None:
        req["scope"] = scope
    assert_valid("approve.request", req)
    return req
