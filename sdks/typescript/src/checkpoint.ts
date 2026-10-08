import type { Primitive, Task } from "./types";

/**
 * What an agent must store durably before it yields (rule R3): the task id and
 * the idempotency key, plus enough to check the result when it resumes.
 */
export interface Checkpoint {
  version: 1;
  taskId: string;
  idempotencyKey: string;
  primitive: Primitive;
  payloadDigest?: string;
  createdAt: string;
}

export function checkpointFor(
  task: Pick<Task, "taskId">,
  request: { idempotencyKey: string; payloadDigest?: string },
  primitive: Primitive,
  now: Date = new Date(),
): Checkpoint {
  const cp: Checkpoint = {
    version: 1,
    taskId: task.taskId,
    idempotencyKey: request.idempotencyKey,
    primitive,
    createdAt: now.toISOString(),
  };
  if (request.payloadDigest !== undefined) cp.payloadDigest = request.payloadDigest;
  return cp;
}

export function serializeCheckpoint(cp: Checkpoint): string {
  return JSON.stringify(cp);
}

export function parseCheckpoint(text: string): Checkpoint {
  const cp = JSON.parse(text) as Partial<Checkpoint>;
  if (
    cp.version !== 1 ||
    typeof cp.taskId !== "string" ||
    typeof cp.idempotencyKey !== "string" ||
    (cp.primitive !== "ask" && cp.primitive !== "approve") ||
    typeof cp.createdAt !== "string"
  ) {
    throw new Error("not a HITLP checkpoint");
  }
  return cp as Checkpoint;
}
