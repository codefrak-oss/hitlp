// The task store behind the server. Rule R1 needs it durable: SqliteTaskStore
// is the default; any other backend implements this interface.
import type { DecisionRecord, TaskStatus } from "@codefrak/hitlp";

export type Primitive = "ask" | "approve";

export interface StoredTask {
  id: string;
  /** The authenticated client that created the task; only it may see it (R5). */
  clientId: string;
  idempotencyKey: string;
  /** Hash of the canonical request, to reject a reused key with other content (R4). */
  requestHash: string;
  primitive: Primitive;
  request: Record<string, unknown>;
  status: TaskStatus;
  statusMessage?: string;
  ttl: number;
  pollInterval: number;
  createdAt: string;
  updatedAt: string;
  result?: DecisionRecord;
}

export type NewTask = Omit<StoredTask, "status" | "createdAt" | "updatedAt" | "result" | "statusMessage">;

/** Thrown by `create` when (clientId, idempotencyKey) is already taken. */
export class DuplicateKeyError extends Error {
  constructor(readonly existing: StoredTask) {
    super(`idempotency key ${existing.idempotencyKey} is taken`);
    this.name = "DuplicateKeyError";
  }
}

export interface TaskStore {
  /** Inserts a working task; throws DuplicateKeyError if its key is taken. */
  create(task: NewTask): StoredTask;
  getById(id: string): StoredTask | undefined;
  findByKey(clientId: string, idempotencyKey: string): StoredTask | undefined;
  /** Sets status, and the result when given; returns the updated task. */
  update(id: string, status: TaskStatus, opts?: { result?: DecisionRecord; statusMessage?: string }): StoredTask;
  list(clientId: string): StoredTask[];
  close(): void;
}
