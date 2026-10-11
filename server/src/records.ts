// Spec 6 and R11: every decision record names the layer that decided it and
// carries the request's `attested` as the server filled it and the requester's
// `recommendation` as received. Every record writer (decision page, rules,
// expiry) builds its record here.
import type { Attested, DecisionRecord, Recommendation } from "@codefrak/hitlp";
import type { StoredTask } from "./store";

export type RecordFields = Omit<DecisionRecord, "requestId" | "idempotencyKey" | "primitive" | "attested" | "recommendation">;

export function buildRecord(task: StoredTask, fields: RecordFields): DecisionRecord {
  const record: DecisionRecord = { requestId: task.id, idempotencyKey: task.idempotencyKey, primitive: task.primitive, ...fields };
  const attested = task.request.attested as Attested | undefined;
  if (attested) record.attested = structuredClone(attested);
  const recommendation = (task.request.asserted as { recommendation?: Recommendation } | undefined)?.recommendation;
  if (recommendation) record.recommendation = structuredClone(recommendation);
  return record;
}
