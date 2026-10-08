"""Builder for ``human.ask`` arguments (spec 4.1)."""

from __future__ import annotations

from typing import Any, Optional

from .envelope import build_envelope
from .types import AskRequest
from .validate import assert_valid


def build_ask(
    *,
    question: str,
    response_schema: Any,
    options: Optional[list[dict[str, Any]]] = None,
    **envelope: Any,
) -> AskRequest:
    """Builds and validates ``human.ask`` arguments.

    Free text must be asked for explicitly with ``{"type": "string"}``. The
    envelope keywords are those of :func:`hitlp.envelope.build_envelope`.
    """
    req: AskRequest = {**build_envelope(**envelope), "question": question, "responseSchema": response_schema}  # type: ignore[typeddict-item]
    if options is not None:
        req["options"] = options
    assert_valid("ask.request", req)
    return req
