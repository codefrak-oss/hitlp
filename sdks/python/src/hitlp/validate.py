"""Validation against the spec's JSON schemas.

The schemas in ./schemas are vendored from spec/schemas by
sdks/scripts/sync-schemas.mjs; never edit them by hand.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from importlib import resources
from typing import Any, Literal

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

SchemaName = Literal[
    "envelope", "decision-record", "ask.request", "ask.response", "approve.request", "approve.response"
]
_NAMES: tuple[str, ...] = (
    "envelope", "decision-record", "ask.request", "ask.response", "approve.request", "approve.response"
)
_BASE = "https://github.com/codefrak-oss/hitlp/spec/schemas/"


def _load() -> dict[str, Draft202012Validator]:
    root = resources.files(__package__) / "schemas"
    schemas = {n: json.loads((root / f"{n}.schema.json").read_text("utf-8")) for n in _NAMES}
    registry = Registry().with_resources(
        (s["$id"], Resource.from_contents(s)) for s in schemas.values()
    )
    checker = Draft202012Validator.FORMAT_CHECKER
    return {
        n: Draft202012Validator(s, registry=registry, format_checker=checker) for n, s in schemas.items()
    }


_VALIDATORS = _load()


@dataclass
class ValidationResult:
    valid: bool
    errors: list[str]


def validate(schema: SchemaName, value: Any) -> ValidationResult:
    """Validates a value against one of the spec's schemas."""
    try:
        v = _VALIDATORS[schema]
    except KeyError:
        raise ValueError(f"unknown schema {schema}") from None
    errors = [f"/{'/'.join(map(str, e.absolute_path))} {e.message}" for e in v.iter_errors(value)]
    return ValidationResult(not errors, errors)


class HitlpValidationError(ValueError):
    def __init__(self, schema: str, errors: list[str]) -> None:
        super().__init__(f"invalid {schema}: {'; '.join(errors)}")
        self.schema = schema
        self.errors = errors


def assert_valid(schema: SchemaName, value: Any) -> None:
    r = validate(schema, value)
    if not r.valid:
        raise HitlpValidationError(schema, r.errors)
