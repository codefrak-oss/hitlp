import { buildEnvelope, type EnvelopeInput } from "./envelope";
import type { ApproveRequest, ApproveScope } from "./types";
import { assertValidApproveRequest } from "./validate";

export interface ApproveInput extends Omit<EnvelopeInput, "defaultOnTimeout"> {
  /** Defaults to `reject`, the spec's recommended default for Approve (section 5). */
  defaultOnTimeout?: EnvelopeInput["defaultOnTimeout"];
  action: string;
  payload: Record<string, unknown>;
  payloadDigest?: string;
  scope?: ApproveScope;
}

/** Builds and validates `human.approve` arguments. */
export function buildApprove(input: ApproveInput): ApproveRequest {
  const { action, payload, payloadDigest, scope, defaultOnTimeout, ...env } = input;
  const req: ApproveRequest = {
    ...buildEnvelope({ ...env, defaultOnTimeout: defaultOnTimeout ?? "reject" }),
    action,
    payload,
  };
  if (payloadDigest !== undefined) req.payloadDigest = payloadDigest;
  if (scope) req.scope = scope;
  assertValidApproveRequest(req);
  return req;
}
