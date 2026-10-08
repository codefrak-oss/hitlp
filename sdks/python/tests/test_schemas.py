import copy
import json
from pathlib import Path

import pytest

from hitlp import validate

EXAMPLES = Path(__file__).parent / "examples"  # vendored from spec/examples


def load(name):
    return json.loads((EXAMPLES / name).read_text("utf-8"))


@pytest.mark.parametrize("schema", ["ask.request", "ask.response", "approve.request", "approve.response"])
def test_spec_example_validates(schema):
    r = validate(schema, load(f"{schema}.json"))
    assert r.valid, r.errors


def _without(key):
    return lambda v: v.pop(key)


INVALID = [
    ("missing deadline", "ask.request", _without("deadline")),
    ("bad defaultOnTimeout", "approve.request", lambda v: v.update(defaultOnTimeout="approve")),
    ("deadline not a date-time", "approve.request", lambda v: v.update(deadline="tomorrow")),
    ("ask without responseSchema", "ask.request", _without("responseSchema")),
    ("answered without answer", "ask.response", _without("answer")),
    ("timed_out decided by a human", "ask.response", lambda v: (v.pop("answer"), v.update(outcome="timed_out"))),
    ("approve result with an answer", "approve.response", lambda v: v.update(answer="yes")),
    ("ask result with outcome approved", "ask.response", lambda v: v.update(outcome="approved")),
]


@pytest.mark.parametrize("name,schema,mutate", INVALID, ids=[c[0] for c in INVALID])
def test_invalid_variant_rejected(name, schema, mutate):
    v = copy.deepcopy(load(f"{schema}.json"))
    mutate(v)
    assert not validate(schema, v).valid
