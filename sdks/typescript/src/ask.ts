import { buildEnvelope, type EnvelopeInput } from "./envelope";
import type { AskOption, AskRequest } from "./types";
import { assertValidAskRequest } from "./validate";

export interface AskInput extends EnvelopeInput {
  question: string;
  /** JSON Schema for the answer. Free text must be asked for with `{type: "string"}` (spec 4.1). */
  responseSchema: Record<string, unknown> | boolean;
  options?: AskOption[];
}

/** Builds and validates `human.ask` arguments. */
export function buildAsk(input: AskInput): AskRequest {
  const { question, responseSchema, options, ...env } = input;
  const req: AskRequest = { ...buildEnvelope(env), question, responseSchema };
  if (options) req.options = options;
  assertValidAskRequest(req);
  return req;
}
