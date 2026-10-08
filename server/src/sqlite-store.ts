import Database from "better-sqlite3";
import type { DecisionRecord, TaskStatus } from "@codefrak/hitlp";
import { DuplicateKeyError, TerminalTaskError, type NewTask, type StoredTask, type TaskStore, type UpdateOptions } from "./store";

const MIGRATIONS = [
  `CREATE TABLE tasks (
     id TEXT PRIMARY KEY,
     client_id TEXT NOT NULL,
     idempotency_key TEXT NOT NULL,
     request_hash TEXT NOT NULL,
     primitive TEXT NOT NULL,
     request TEXT NOT NULL,
     status TEXT NOT NULL,
     status_message TEXT,
     ttl INTEGER NOT NULL,
     poll_interval INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL,
     result TEXT,
     UNIQUE (client_id, idempotency_key)
   )`,
  `ALTER TABLE tasks ADD COLUMN deadline_at INTEGER;
   ALTER TABLE tasks ADD COLUMN final_deadline_at INTEGER;
   ALTER TABLE tasks ADD COLUMN meta TEXT;
   UPDATE tasks SET deadline_at = CAST(strftime('%s', created_at) AS INTEGER) * 1000 + ttl;
   CREATE INDEX tasks_open_deadline ON tasks (status, deadline_at)`,
];

const OPEN = "status NOT IN ('completed', 'failed', 'cancelled')";

interface Row {
  id: string;
  client_id: string;
  idempotency_key: string;
  request_hash: string;
  primitive: StoredTask["primitive"];
  request: string;
  status: TaskStatus;
  status_message: string | null;
  ttl: number;
  poll_interval: number;
  created_at: string;
  updated_at: string;
  result: string | null;
  deadline_at: number;
  final_deadline_at: number | null;
  meta: string | null;
}

function fromRow(r: Row): StoredTask {
  const t: StoredTask = {
    id: r.id,
    clientId: r.client_id,
    idempotencyKey: r.idempotency_key,
    requestHash: r.request_hash,
    primitive: r.primitive,
    request: JSON.parse(r.request),
    status: r.status,
    ttl: r.ttl,
    pollInterval: r.poll_interval,
    deadlineAt: r.deadline_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.status_message !== null) t.statusMessage = r.status_message;
  if (r.final_deadline_at !== null) t.finalDeadlineAt = r.final_deadline_at;
  if (r.meta !== null) t.meta = JSON.parse(r.meta);
  if (r.result !== null) t.result = JSON.parse(r.result) as DecisionRecord;
  return t;
}

/** A TaskStore in one SQLite file (":memory:" only for tests: it is not durable). */
export class SqliteTaskStore implements TaskStore {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    const version = this.db.pragma("user_version", { simple: true }) as number;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  create(task: NewTask): StoredTask {
    try {
      this.db
        .prepare(
          `INSERT INTO tasks (id, client_id, idempotency_key, request_hash, primitive, request, status, ttl, poll_interval, deadline_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'working', ?, ?, ?, ?, ?)`,
        )
        .run(task.id, task.clientId, task.idempotencyKey, task.requestHash, task.primitive, JSON.stringify(task.request), task.ttl, task.pollInterval, task.deadlineAt, task.createdAt, task.createdAt);
    } catch (e) {
      const existing = this.findByKey(task.clientId, task.idempotencyKey);
      if (existing && (e as { code?: string }).code?.startsWith("SQLITE_CONSTRAINT")) throw new DuplicateKeyError(existing);
      throw e;
    }
    return this.getById(task.id)!;
  }

  getById(id: string): StoredTask | undefined {
    const r = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Row | undefined;
    return r && fromRow(r);
  }

  findByKey(clientId: string, idempotencyKey: string): StoredTask | undefined {
    const r = this.db.prepare("SELECT * FROM tasks WHERE client_id = ? AND idempotency_key = ?").get(clientId, idempotencyKey) as Row | undefined;
    return r && fromRow(r);
  }

  update(id: string, status: TaskStatus, opts: UpdateOptions = {}): StoredTask {
    const res = this.db
      .prepare(
        `UPDATE tasks SET status = ?, status_message = ?, result = COALESCE(?, result), meta = COALESCE(?, meta),
           final_deadline_at = COALESCE(?, final_deadline_at), updated_at = ?
         WHERE id = ? AND ${OPEN}`,
      )
      .run(
        status,
        opts.statusMessage ?? null,
        opts.result ? JSON.stringify(opts.result) : null,
        opts.meta ? JSON.stringify(opts.meta) : null,
        opts.finalDeadlineAt ?? null,
        new Date().toISOString(),
        id,
      );
    if (res.changes === 0) {
      const existing = this.getById(id);
      if (!existing) throw new Error(`no task ${id}`);
      throw new TerminalTaskError(existing);
    }
    return this.getById(id)!;
  }

  listOpenExpiring(now: number): StoredTask[] {
    return (
      this.db.prepare(`SELECT * FROM tasks WHERE ${OPEN} AND COALESCE(final_deadline_at, deadline_at) <= ? ORDER BY deadline_at, id`).all(now) as Row[]
    ).map(fromRow);
  }

  list(clientId: string): StoredTask[] {
    return (this.db.prepare("SELECT * FROM tasks WHERE client_id = ? ORDER BY created_at, id").all(clientId) as Row[]).map(fromRow);
  }

  close(): void {
    this.db.close();
  }
}
