import type { ApproveDecision, ApproveRequest, AskDecision, DecisionRecord, Task } from "./types";
import { isTerminal } from "./types";

/**
 * True only for an `approved` Approve decision. Any other terminal state,
 * a timeout included, is not approval (rule R2). When the request carried a
 * `payloadDigest`, the record must carry the same one (spec 4.2).
 */
export function isApproved(record: DecisionRecord | undefined, request?: Pick<ApproveRequest, "payloadDigest">): boolean {
  if (!record || record.primitive !== "approve" || record.outcome !== "approved") return false;
  return verifyPayloadDigest(record, request);
}

/**
 * Checks that the record is bound to the payload the request sent. True when
 * the request had no digest; false when it had one the record does not repeat.
 */
export function verifyPayloadDigest(record: DecisionRecord, request?: Pick<ApproveRequest, "payloadDigest">): boolean {
  if (request?.payloadDigest === undefined) return true;
  return record.payloadDigest === request.payloadDigest;
}

/** The answer of an `answered` Ask decision, or undefined for any other outcome. */
export function answerOf<T = unknown>(record: AskDecision | DecisionRecord | undefined): T | undefined {
  return record?.primitive === "ask" && record.outcome === "answered" ? (record.answer as T) : undefined;
}

/** How a terminal task ended, from the agent's point of view (spec 7.3). */
export type Resolution<R extends DecisionRecord = DecisionRecord> =
  | { kind: "decided"; record: R }
  | { kind: "failed"; record?: R; message?: string }
  | { kind: "cancelled"; record?: R; message?: string };

export class NotTerminalError extends Error {
  constructor(task: Task) {
    super(`task ${task.taskId} is ${task.status}, not terminal`);
    this.name = "NotTerminalError";
  }
}

/** Interprets a terminal task. Throws for a task that is still running. */
export function resolve<R extends DecisionRecord>(task: Task<R>): Resolution<R> {
  if (!isTerminal(task.status)) throw new NotTerminalError(task);
  if (task.status === "completed") {
    if (!task.result) throw new Error(`task ${task.taskId} is completed without a decision record`);
    return { kind: "decided", record: task.result };
  }
  return { kind: task.status as "failed" | "cancelled", record: task.result, message: task.statusMessage };
}

export type { ApproveDecision, AskDecision };
