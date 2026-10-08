import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import envelope from "./schemas/envelope.schema.json";
import decisionRecord from "./schemas/decision-record.schema.json";
import askRequest from "./schemas/ask.request.schema.json";
import askResponse from "./schemas/ask.response.schema.json";
import approveRequest from "./schemas/approve.request.schema.json";
import approveResponse from "./schemas/approve.response.schema.json";
import type { ApproveDecision, ApproveRequest, AskDecision, AskRequest, DecisionRecord, Envelope } from "./types";

// The schemas are vendored from spec/schemas by sdks/scripts/sync-schemas.mjs.
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
for (const s of [envelope, decisionRecord, askRequest, askResponse, approveRequest, approveResponse]) {
  ajv.addSchema(s);
}

const ID = "https://github.com/codefrak-oss/hitlp/spec/schemas/";

export type SchemaName =
  | "envelope"
  | "decision-record"
  | "ask.request"
  | "ask.response"
  | "approve.request"
  | "approve.response";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validates a value against one of the spec's schemas. */
export function validate(schema: SchemaName, value: unknown): ValidationResult {
  const fn = ajv.getSchema(`${ID}${schema}.schema.json`);
  if (!fn) throw new Error(`unknown schema ${schema}`);
  const valid = fn(value) as boolean;
  const errors = (fn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
  return { valid, errors };
}

export class HitlpValidationError extends Error {
  constructor(
    readonly schema: SchemaName,
    readonly errors: string[],
  ) {
    super(`invalid ${schema}: ${errors.join("; ")}`);
    this.name = "HitlpValidationError";
  }
}

function assertValid(schema: SchemaName, value: unknown): void {
  const r = validate(schema, value);
  if (!r.valid) throw new HitlpValidationError(schema, r.errors);
}

export function assertValidEnvelope(v: unknown): asserts v is Envelope {
  assertValid("envelope", v);
}
export function assertValidAskRequest(v: unknown): asserts v is AskRequest {
  assertValid("ask.request", v);
}
export function assertValidApproveRequest(v: unknown): asserts v is ApproveRequest {
  assertValid("approve.request", v);
}
export function assertValidDecisionRecord(v: unknown): asserts v is DecisionRecord {
  assertValid("decision-record", v);
}
export function assertValidAskDecision(v: unknown): asserts v is AskDecision {
  assertValid("ask.response", v);
}
export function assertValidApproveDecision(v: unknown): asserts v is ApproveDecision {
  assertValid("approve.response", v);
}
