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
  /** Every open task, and every task that reached a terminal status at or after `decidedSince` (ISO-8601), newest first. */
  listForSurfaces(decidedSince: string): StoredTask[];
  /** Open (non-terminal) tasks whose effective or final deadline is at or before `now`. */
  listOpenExpiring(now: number): StoredTask[];
  close(): void;
}

/** A device a surface registered for push (spec 7.8). */
export interface Device {
  /** The device id the surface chose; unique per surface. */
  id: string;
  /** The surface that registered it. */
  surfaceId: string;
  /** The human it belongs to. */
  human: string;
  /** The push service, e.g. `apns`. */
  platform: string;
  /** The push service's token for the device. */
  token: string;
  /** For APNs: `production` or `sandbox`. */
  environment?: string;
  name?: string;
  updatedAt: string;
}

/** The surfaces' own state: the devices they registered for push. */
export interface SurfaceStore {
  /** Inserts or replaces the device (surfaceId, id). */
  putDevice(device: Device): Device;
  /** Removes the device; false when there was none. */
  deleteDevice(surfaceId: string, id: string): boolean;
  /** One human's devices, across their surfaces. */
  devicesFor(human: string): Device[];
  /** Every device. */
  listDevices(): Device[];
}
