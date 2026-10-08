import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApprove, buildAsk, HitlpValidationError, validate } from "../src";

test("buildAsk produces flat human.ask arguments with envelope defaults", () => {
  const req = buildAsk({
    idempotencyKey: "inv-993-currency",
    deadline: new Date("2026-10-09T09:00:00Z"),
    defaultOnTimeout: "escalate",
    requires: { capabilities: ["finance.invoice"] },
    question: "Which currency is invoice 993 in?",
    responseSchema: { type: "string", enum: ["EUR", "USD", "GBP"] },
  });
  assert.deepEqual(req, {
    idempotencyKey: "inv-993-currency",
    deadline: "2026-10-09T09:00:00.000Z",
    defaultOnTimeout: "escalate",
    priority: "normal",
    requires: { capabilities: ["finance.invoice"] },
    question: "Which currency is invoice 993 in?",
    responseSchema: { type: "string", enum: ["EUR", "USD", "GBP"] },
  });
  assert.equal(validate("ask.request", req).valid, true);
});

test("buildApprove defaults defaultOnTimeout to reject and mints a key", () => {
  const req = buildApprove({
    deadline: "2026-10-15T12:00:00Z",
    action: "Deploy release 4.21 to production",
    payload: { service: "billing", version: "4.21.0" },
    payloadDigest: "sha256:9f2c1e0a",
    scope: { maxUses: 1, notAfter: "2026-10-16T00:00:00Z" },
  });
  assert.equal(req.defaultOnTimeout, "reject");
  assert.ok(req.idempotencyKey.length > 0);
  assert.equal(validate("approve.request", req).valid, true);
});

test("builders refuse requests the schema rejects", () => {
  assert.throws(
    () => buildAsk({ deadline: "soon", defaultOnTimeout: "fail", question: "q", responseSchema: { type: "string" } }),
    HitlpValidationError,
  );
  assert.throws(
    () => buildApprove({ deadline: "2026-10-15T12:00:00Z", action: "", payload: {} }),
    HitlpValidationError,
  );
});

test("each new request gets a fresh idempotency key", () => {
  const input = { deadline: "2026-10-15T12:00:00Z", action: "x", payload: {} };
  assert.notEqual(buildApprove(input).idempotencyKey, buildApprove(input).idempotencyKey);
});
