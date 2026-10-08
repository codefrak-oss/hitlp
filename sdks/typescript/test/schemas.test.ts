import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validate, type SchemaName } from "../src";

// test/examples is vendored from spec/examples; tests run from dist/test.
const examples = join(__dirname, "..", "..", "test", "examples");
const load = (f: string) => JSON.parse(readFileSync(join(examples, f), "utf8"));

const cases: [string, SchemaName][] = [
  ["ask.request.json", "ask.request"],
  ["ask.response.json", "ask.response"],
  ["approve.request.json", "approve.request"],
  ["approve.response.json", "approve.response"],
];

for (const [file, schema] of cases) {
  test(`spec example ${file} validates against ${schema}`, () => {
    const r = validate(schema, load(file));
    assert.equal(r.valid, true, r.errors.join("; "));
  });
}

const invalid: [string, SchemaName, (v: any) => void][] = [
  ["missing deadline", "ask.request", (v) => delete v.deadline],
  ["bad defaultOnTimeout", "approve.request", (v) => (v.defaultOnTimeout = "approve")],
  ["deadline not a date-time", "approve.request", (v) => (v.deadline = "tomorrow")],
  ["ask without responseSchema", "ask.request", (v) => delete v.responseSchema],
  ["answered without answer", "ask.response", (v) => delete v.answer],
  ["timed_out decided by a human", "ask.response", (v) => Object.assign(v, { outcome: "timed_out", answer: undefined })],
  ["approve result with an answer", "approve.response", (v) => (v.answer = "yes")],
  ["ask result with outcome approved", "ask.response", (v) => (v.outcome = "approved")],
];

for (const [name, schema, mutate] of invalid) {
  test(`rejects: ${name}`, () => {
    const v = load(`${schema}.json`);
    mutate(v);
    for (const k of Object.keys(v)) if (v[k] === undefined) delete v[k];
    assert.equal(validate(schema, v).valid, false);
  });
}
