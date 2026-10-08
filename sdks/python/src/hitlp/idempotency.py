"""Idempotency keys (rule R4)."""

from __future__ import annotations

import uuid
from typing import Optional


def new_idempotency_key(prefix: Optional[str] = None) -> str:
    """A fresh key for a new logical request.

    Reuse it on every retry of that request; never mint a new one to retry.
    """
    key = str(uuid.uuid4())
    return f"{prefix}-{key}" if prefix else key
