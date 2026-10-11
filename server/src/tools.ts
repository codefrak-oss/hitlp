// human.ask and human.approve: validate, cap (R6), deduplicate (R4), persist (R1)
// and return the handle without waiting for a human.
import { randomUUID } from "node:crypto";
import { validate } from "@codefrak/hitlp";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { checkScope, effectiveDeadline, type TtlCaps } from "./caps";
import { attestedFor, dropAttested, type Caller } from "./attest";
import { requestHash } from "./idempotency";
import { buildRecord } from "./records";
import type { Rule } from "./rules";
import { DuplicateKeyError, type Primitive, type StoredTask, type TaskStore } from "./store";

export const TOOLS: Record<string, Primitive> = { "human.ask": "ask", "human.approve": "approve" };

/** The `_meta` key that carries the decision page URL of a URL-mode Approve (spec 7.6). */
export const DECISION_URL_META = "io.hitlp/decisionUrl";

export interface CreateOptions {
  /** The MCP task ttl the client requested, if any. */
  ttl?: number;
  pollInterval: number;
  now: number;
  caps: TtlCaps;
  allowBlanketScope: boolean;
  /** The decision page URL of a task; when set, Approve goes URL-mode (spec 7.6, R7). */
  decisionUrl?: (taskId: string) => string;
  /**
   * Proxy layer 1 (spec 3.1, R9): the standing rule that decides a new task, or
   * undefined when a human must. Asked after dedup (R4) and the cap (R6), before routing.
   */
  rule?: (task: StoredTask) => Rule | undefined;
  /** Called once per new task routed to a human, never for a deduplicated repeat (R4) or a rule's decision. */
  notify: (task: StoredTask) => void | Promise<void>;
}

/** Spec 5.5: teach options are an Approve's, with ids unique and `once` reserved (the schema refuses it). */
function checkTeach(primitive: Primitive, args: Record<string, unknown>): void {
  if (args.teach === undefined) return;
  if (primitive !== "approve") throw new McpError(ErrorCode.InvalidParams, "teach is offered on an Approve only");
  const ids = ((args.teach as { options: { id: string }[] }).options ?? []).map((o) => o.id);
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice !== undefined) throw new McpError(ErrorCode.InvalidParams, `teach offers the option ${twice} twice`);
}

export async function createHumanTask(
  store: TaskStore,
  caller: Caller,
  tool: string,
  sent: Record<string, unknown>,
  opts: CreateOptions,
): Promise<StoredTask> {
  const primitive = TOOLS[tool];
  const clientId = caller.clientId;
  // R8: the sent `attested` is dropped before anything reads the request; the
  // request hash (R4) is taken over the request without it, so a repeat that
  // differs only there names the same task.
  const { request: args } = dropAttested(sent);
  const check = validate(`${primitive}.request`, args);
  if (!check.valid) throw new McpError(ErrorCode.InvalidParams, `invalid ${tool} request: ${check.errors.join("; ")}`);
  checkScope(primitive, args, opts.allowBlanketScope);
  checkTeach(primitive, args);
  const key = args.idempotencyKey as string;
  const hash = requestHash({ tool, args });
  const deadlineAt = effectiveDeadline(primitive, args.deadline as string, opts.now, opts.caps, opts.ttl);
  const id = randomUUID();
  let task: StoredTask;
  try {
    task = store.create({
      id,
      clientId,
      idempotencyKey: key,
      requestHash: hash,
      primitive,
      // Everything the requester sent but `attested` is kept as received; `attested` is the server's.
      request: { ...args, attested: attestedFor(caller) },
      ttl: Math.max(0, deadlineAt - opts.now),
      pollInterval: opts.pollInterval,
      deadlineAt,
      createdAt: new Date(opts.now).toISOString(),
    });
  } catch (e) {
    if (!(e instanceof DuplicateKeyError)) throw e;
    if (e.existing.requestHash !== hash) {
      throw new McpError(ErrorCode.InvalidParams, `idempotency key ${key} was already used with different request content`);
    }
    return e.existing;
  }
  const rule = opts.rule?.(task);
  if (rule) {
    // A standing rule decides: no human is notified and the record names the rule (R11).
    const record = buildRecord(task, {
      outcome: rule.outcome === "answer" ? "answered" : rule.outcome === "approve" ? "approved" : "rejected",
      ...(rule.outcome === "answer" ? { answer: structuredClone(rule.answer) } : {}),
      reason: `Standing rule ${rule.id} of ${rule.human}.`,
      decidedBy: { type: "rule", id: rule.id },
      decidedAt: new Date(opts.now).toISOString(),
    });
    return store.update(id, "completed", { result: record, statusMessage: `Decided by rule ${rule.id}.` });
  }
  if (primitive === "approve" && opts.decisionUrl) {
    // URL-mode: the task waits in input_required until the human decides on the
    // page or the TTL passes, then goes straight to terminal.
    const url = opts.decisionUrl(id);
    task = store.update(id, "input_required", { statusMessage: `Decision required: ${url}`, meta: { [DECISION_URL_META]: url } });
  }
  await opts.notify(task);
  return task;
}
