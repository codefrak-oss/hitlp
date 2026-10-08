// human.ask and human.approve: validate, cap (R6), deduplicate (R4), persist (R1)
// and return the handle without waiting for a human.
import { randomUUID } from "node:crypto";
import { validate } from "@codefrak/hitlp";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { checkScope, effectiveDeadline, type TtlCaps } from "./caps";
import { requestHash } from "./idempotency";
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
  /** Called once per new task, never for a deduplicated repeat (R4). */
  notify: (task: StoredTask) => void | Promise<void>;
}

export async function createHumanTask(
  store: TaskStore,
  clientId: string,
  tool: string,
  args: Record<string, unknown>,
  opts: CreateOptions,
): Promise<StoredTask> {
  const primitive = TOOLS[tool];
  const check = validate(`${primitive}.request`, args);
  if (!check.valid) throw new McpError(ErrorCode.InvalidParams, `invalid ${tool} request: ${check.errors.join("; ")}`);
  checkScope(primitive, args, opts.allowBlanketScope);
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
      request: args,
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
  if (primitive === "approve" && opts.decisionUrl) {
    // URL-mode: the task waits in input_required until the human decides on the
    // page or the TTL passes, then goes straight to terminal.
    const url = opts.decisionUrl(id);
    task = store.update(id, "input_required", { statusMessage: `Decision required: ${url}`, meta: { [DECISION_URL_META]: url } });
  }
  await opts.notify(task);
  return task;
}
