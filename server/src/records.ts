// Spec 6 and R11: every decision record names the layer that decided it and
// carries the request's `attested` as the server filled it and the requester's
// `recommendation` as received. Every record writer (decision page, rules,
// expiry) builds its record here.
import type { Attested, DecisionRecord, Recommendation } from "@codefrak/hitlp";
import type { StoredTask } from "./store";

export type RecordFields = Omit<DecisionRecord, "requestId" | "idempotencyKey" | "primitive" | "attested" | "recommendation">;

/** An option an Approve offers in `teach` (spec 5.5); carried, never interpreted. */
export interface TeachOption {
  id: string;
  label: string;
  after: ("approve" | "reject")[];
  editable?: { label: string; default?: string };
}

/** The human's teach choice as the record carries it (spec 5.5, 6). */
export interface TeachChoice {
  option: string;
  text?: string;
}

/** The options an Approve offered, or none. */
export function offeredTeach(task: StoredTask): TeachOption[] {
  return task.primitive === "approve" ? ((task.request.teach as { options?: TeachOption[] } | undefined)?.options ?? []) : [];
}

export function buildRecord(task: StoredTask, fields: RecordFields): DecisionRecord {
  const record: DecisionRecord = { requestId: task.id, idempotencyKey: task.idempotencyKey, primitive: task.primitive, ...fields };
  const attested = task.request.attested as Attested | undefined;
  if (attested) record.attested = structuredClone(attested);
  const recommendation = (task.request.asserted as { recommendation?: Recommendation } | undefined)?.recommendation;
  if (recommendation) record.recommendation = structuredClone(recommendation);
  return record;
}
