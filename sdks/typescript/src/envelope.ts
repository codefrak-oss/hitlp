import { newIdempotencyKey } from "./idempotency";
import type { DefaultOnTimeout, Envelope, Priority } from "./types";

/** Envelope fields a builder takes; the key and priority get defaults. */
export interface EnvelopeInput {
  /** Defaults to a fresh key. Pass the stored key when re-building a retried request. */
  idempotencyKey?: string;
  /** A Date or an RFC 3339 string. */
  deadline: Date | string;
  defaultOnTimeout: DefaultOnTimeout;
  priority?: Priority;
  requires?: Envelope["requires"];
  context?: Envelope["context"];
  requester?: Envelope["requester"];
}

export function buildEnvelope(input: EnvelopeInput): Envelope {
  const env: Envelope = {
    idempotencyKey: input.idempotencyKey ?? newIdempotencyKey(),
    deadline: input.deadline instanceof Date ? input.deadline.toISOString() : input.deadline,
    defaultOnTimeout: input.defaultOnTimeout,
    priority: input.priority ?? "normal",
  };
  if (input.requires) env.requires = input.requires;
  if (input.context) env.context = input.context;
  if (input.requester) env.requester = input.requester;
  return env;
}
