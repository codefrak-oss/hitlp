// Rule R2 and spec 7.5: when a task's effective deadline passes with no
// decision, apply its `defaultOnTimeout`, write a decision record decided by
// policy, and move the task to its terminal status.
import type { DecisionRecord, DefaultOnTimeout, Outcome, TaskStatus } from "@codefrak/hitlp";
import { isTerminal } from "@codefrak/hitlp";
import { TerminalTaskError, type StoredTask, type TaskStore } from "./store";

export interface ExpiryOptions {
  /** How long `escalate` keeps waiting past the deadline before it applies `reject`. */
  escalationGraceMs: number;
  /** Re-routes an escalated task to a wider audience. */
  onEscalate?: (task: StoredTask) => void | Promise<void>;
}

/** The terminal status and outcome a default action ends in (spec 5). */
function terminalOf(task: StoredTask, action: Exclude<DefaultOnTimeout, "escalate">): { status: TaskStatus; outcome: Outcome; message: string } {
  switch (action) {
    case "reject":
      return { status: "completed", outcome: task.primitive === "approve" ? "rejected" : "timed_out", message: "Deadline passed: default action reject." };
    case "cancel":
      return { status: "cancelled", outcome: "cancelled", message: "Deadline passed: default action cancel." };
    case "fail":
      return { status: "failed", outcome: "timed_out", message: "Deadline passed: default action fail." };
  }
}

function overdue(task: StoredTask, now: number): boolean {
  return !isTerminal(task.status) && (task.finalDeadlineAt ?? task.deadlineAt) <= now;
}

/**
 * Applies the default action to `task` when it is overdue at `now`, and returns
 * the task as it is afterwards. Losing a race to a decision is not an error: the
 * store's compare-and-set lets exactly one of them win.
 */
export function expireIfDue(store: TaskStore, task: StoredTask, now: number, opts: ExpiryOptions): StoredTask {
  if (!overdue(task, now)) return task;
  const requested = task.request.defaultOnTimeout as DefaultOnTimeout;
  try {
    if (requested === "escalate" && task.finalDeadlineAt === undefined) {
      const escalated = store.update(task.id, task.status, {
        statusMessage: "Deadline passed: escalated to a wider audience.",
        finalDeadlineAt: task.deadlineAt + opts.escalationGraceMs,
      });
      void opts.onEscalate?.(escalated);
      return overdue(escalated, now) ? expireIfDue(store, escalated, now, opts) : escalated;
    }
    // escalate past its final deadline applies reject (spec 5).
    const { status, outcome, message } = terminalOf(task, requested === "escalate" ? "reject" : requested);
    const record: DecisionRecord = {
      requestId: task.id,
      idempotencyKey: task.idempotencyKey,
      primitive: task.primitive,
      outcome,
      reason: message,
      decidedBy: { type: "policy", id: `defaultOnTimeout:${requested}` },
      decidedAt: new Date(now).toISOString(),
    };
    return store.update(task.id, status, { result: record, statusMessage: message });
  } catch (e) {
    if (e instanceof TerminalTaskError) return e.task;
    throw e;
  }
}

/** Expires every overdue open task; returns how many changed. */
export function sweepExpired(store: TaskStore, now: number, opts: ExpiryOptions): number {
  let n = 0;
  for (const task of store.listOpenExpiring(now)) if (expireIfDue(store, task, now, opts) !== task) n++;
  return n;
}
