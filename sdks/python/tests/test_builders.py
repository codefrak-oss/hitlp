from datetime import datetime, timezone

import pytest

from hitlp import HitlpValidationError, build_approve, build_ask, validate


def test_build_ask_flat_arguments_with_defaults():
    req = build_ask(
        idempotency_key="inv-993-currency",
        deadline=datetime(2026, 10, 9, 9, 0, tzinfo=timezone.utc),
        default_on_timeout="escalate",
        requires={"capabilities": ["finance.invoice"]},
        question="Which currency is invoice 993 in?",
        response_schema={"type": "string", "enum": ["EUR", "USD", "GBP"]},
    )
    assert req == {
        "idempotencyKey": "inv-993-currency",
        "deadline": "2026-10-09T09:00:00Z",
        "defaultOnTimeout": "escalate",
        "priority": "normal",
        "requires": {"capabilities": ["finance.invoice"]},
        "question": "Which currency is invoice 993 in?",
        "responseSchema": {"type": "string", "enum": ["EUR", "USD", "GBP"]},
    }
    assert validate("ask.request", req).valid


def test_build_approve_defaults_to_reject_and_mints_key():
    req = build_approve(
        deadline="2026-10-15T12:00:00Z",
        action="Deploy release 4.21 to production",
        payload={"service": "billing", "version": "4.21.0"},
        payload_digest="sha256:9f2c1e0a",
        scope={"maxUses": 1, "notAfter": "2026-10-16T00:00:00Z"},
    )
    assert req["defaultOnTimeout"] == "reject"
    assert req["idempotencyKey"]
    assert validate("approve.request", req).valid


def test_builders_refuse_invalid_requests():
    with pytest.raises(HitlpValidationError):
        build_ask(deadline="soon", default_on_timeout="fail", question="q", response_schema={"type": "string"})
    with pytest.raises(HitlpValidationError):
        build_approve(deadline="2026-10-15T12:00:00Z", action="", payload={})
    with pytest.raises(ValueError):
        build_approve(deadline=datetime(2026, 10, 15), action="x", payload={})


def test_new_request_gets_fresh_key():
    a = build_approve(deadline="2026-10-15T12:00:00Z", action="x", payload={})
    b = build_approve(deadline="2026-10-15T12:00:00Z", action="x", payload={})
    assert a["idempotencyKey"] != b["idempotencyKey"]
