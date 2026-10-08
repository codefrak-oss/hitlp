"""HITLP, the human-in-the-loop-protocol: Python SDK for spec v1.0 (draft).

Specification: https://github.com/codefrak-oss/hitlp/blob/main/spec/hitlp.md
"""

from .approve import build_approve
from .ask import build_ask
from .checkpoint import Checkpoint
from .client import AsyncHitlpClient, Cancelled, HitlpClient
from .decision import NotTerminalError, Resolution, answer_of, is_approved, resolve, verify_payload_digest
from .envelope import build_envelope
from .idempotency import new_idempotency_key
from .transport import (
    APPROVE_TOOL,
    ASK_TOOL,
    RESERVED_TOOLS,
    AsyncTaskTransport,
    ReservedToolError,
    TaskTransport,
    assert_callable_tool,
)
from .types import (
    SPEC_VERSION,
    TERMINAL_STATUSES,
    ApproveRequest,
    AskRequest,
    DecisionRecord,
    Envelope,
    Task,
    is_terminal,
)
from .validate import HitlpValidationError, ValidationResult, assert_valid, validate

__version__ = "0.1.0"

__all__ = [
    "APPROVE_TOOL", "ASK_TOOL", "RESERVED_TOOLS", "SPEC_VERSION", "TERMINAL_STATUSES",
    "ApproveRequest", "AskRequest", "AsyncHitlpClient", "AsyncTaskTransport", "Cancelled",
    "Checkpoint", "DecisionRecord", "Envelope", "HitlpClient", "HitlpValidationError",
    "NotTerminalError", "ReservedToolError", "Resolution", "Task", "TaskTransport",
    "ValidationResult", "answer_of", "assert_callable_tool", "assert_valid", "build_approve",
    "build_ask", "build_envelope", "is_approved", "is_terminal", "new_idempotency_key",
    "resolve", "validate", "verify_payload_digest",
]
