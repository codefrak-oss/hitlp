// human.ask and human.approve: validate, deduplicate (R4), persist (R1) and
// return the handle without waiting for a human.
import { randomUUID } from "node:crypto";
import { validate } from "@codefrak/hitlp";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { requestHash } from "./idempotency";
import { DuplicateKeyError, type Primitive, type StoredTask, type TaskStore } from "./store";

export const TOOLS: Record<string, Primitive> = { "human.ask": "ask", "human.approve": "approve" };

export interface CreateOptions {
  ttl: number;
  pollInterval: number;
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
  const key = args.idempotencyKey as string;
  const hash = requestHash({ tool, args });
  let task: StoredTask;
  try {
    task = store.create({ id: randomUUID(), clientId, idempotencyKey: key, requestHash: hash, primitive, request: args, ttl: opts.ttl, pollInterval: opts.pollInterval });
  } catch (e) {
    if (!(e instanceof DuplicateKeyError)) throw e;
    if (e.existing.requestHash !== hash) {
      throw new McpError(ErrorCode.InvalidParams, `idempotency key ${key} was already used with different request content`);
    }
    return e.existing;
  }
  await opts.notify(task);
  return task;
}
