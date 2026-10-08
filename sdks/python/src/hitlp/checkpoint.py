"""Checkpoints for resumable agents (rule R3)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Optional

from .types import Primitive, Task


@dataclass(frozen=True)
class Checkpoint:
    """What an agent stores durably before it yields: task id and idempotency key."""

    task_id: str
    idempotency_key: str
    primitive: Primitive
    created_at: str
    payload_digest: Optional[str] = None
    version: int = 1

    @classmethod
    def for_task(
        cls, task: Task, request: Mapping[str, Any], primitive: Primitive, now: Optional[datetime] = None
    ) -> "Checkpoint":
        at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        return cls(
            task_id=task.task_id,
            idempotency_key=request["idempotencyKey"],
            primitive=primitive,
            created_at=at.isoformat().replace("+00:00", "Z"),
            payload_digest=request.get("payloadDigest"),
        )

    def to_json(self) -> str:
        return json.dumps({k: v for k, v in asdict(self).items() if v is not None})

    @classmethod
    def from_json(cls, text: str) -> "Checkpoint":
        d = json.loads(text)
        if (
            not isinstance(d, dict)
            or d.get("version") != 1
            or not isinstance(d.get("task_id"), str)
            or not isinstance(d.get("idempotency_key"), str)
            or d.get("primitive") not in ("ask", "approve")
            or not isinstance(d.get("created_at"), str)
        ):
            raise ValueError("not a HITLP checkpoint")
        return cls(**d)

    @property
    def request(self) -> dict[str, Any]:
        """The fields of the original request that checking the result needs."""
        r: dict[str, Any] = {"idempotencyKey": self.idempotency_key}
        if self.payload_digest is not None:
            r["payloadDigest"] = self.payload_digest
        return r
