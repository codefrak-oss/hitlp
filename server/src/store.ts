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
  /** Effective deadline in epoch ms: the requested deadline clamped to the TTL cap (R2, R6). */
  deadlineAt: number;
  /** Set when `escalate` fired: the server-set deadline after which `reject` applies (spec 5). */
  finalDeadlineAt?: number;
  /** Task `_meta`, e.g. the decision page URL (spec 7.6). */
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  result?: DecisionRecord;
}

export type NewTask = Omit<StoredTask, "status" | "updatedAt" | "result" | "statusMessage" | "finalDeadlineAt" | "meta">;

export interface UpdateOptions {
  result?: DecisionRecord;
  statusMessage?: string;
  meta?: Record<string, unknown>;
  finalDeadlineAt?: number;
}

/** Thrown by `create` when (clientId, idempotencyKey) is already taken. */
export class DuplicateKeyError extends Error {
  constructor(readonly existing: StoredTask) {
    super(`idempotency key ${existing.idempotencyKey} is taken`);
    this.name = "DuplicateKeyError";
  }
}

/** Thrown by `update` when the task is already terminal: a terminal task never changes (spec 7.3). */
export class TerminalTaskError extends Error {
  constructor(readonly task: StoredTask) {
    super(`task ${task.id} is already ${task.status}`);
    this.name = "TerminalTaskError";
  }
}

export interface TaskStore {
  /** Inserts a working task; throws DuplicateKeyError if its key is taken. */
  create(task: NewTask): StoredTask;
  getById(id: string): StoredTask | undefined;
  findByKey(clientId: string, idempotencyKey: string): StoredTask | undefined;
  /**
   * Sets status, and the result when given; returns the updated task. Compare-and-set:
   * throws TerminalTaskError when the task is already terminal, so an expiry and a
   * late decision cannot both win.
   */
  update(id: string, status: TaskStatus, opts?: UpdateOptions): StoredTask;
  list(clientId: string): StoredTask[];
  /** Open (non-terminal) tasks whose effective or final deadline is at or before `now`. */
  listOpenExpiring(now: number): StoredTask[];
  close(): void;
}
