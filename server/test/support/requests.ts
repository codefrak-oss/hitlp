import { buildApprove, buildAsk } from "@codefrak/hitlp";

export const ask = (idempotencyKey?: string, question = "Which currency?") =>
  buildAsk({ idempotencyKey, deadline: "2026-10-09T09:00:00Z", defaultOnTimeout: "reject", question, responseSchema: { type: "string" } });

export const approve = (idempotencyKey?: string) =>
  buildApprove({ idempotencyKey, deadline: "2026-10-15T12:00:00Z", action: "deploy", payload: { v: 1 }, payloadDigest: "sha256:aa" });
