import Database from "better-sqlite3";
import type { DecisionRecord, TaskStatus } from "@codefrak/hitlp";
import { DuplicateKeyError, type NewTask, type StoredTask, type TaskStore } from "./store";

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
];

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
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
  if (r.status_message !== null) t.statusMessage = r.status_message;
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
    const now = new Date().toISOString();
    try {
      this.db
        .prepare(
          `INSERT INTO tasks (id, client_id, idempotency_key, request_hash, primitive, request, status, ttl, poll_interval, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'working', ?, ?, ?, ?)`,
        )
        .run(task.id, task.clientId, task.idempotencyKey, task.requestHash, task.primitive, JSON.stringify(task.request), task.ttl, task.pollInterval, now, now);
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

  update(id: string, status: TaskStatus, opts: { result?: DecisionRecord; statusMessage?: string } = {}): StoredTask {
    const res = this.db
      .prepare("UPDATE tasks SET status = ?, status_message = ?, result = COALESCE(?, result), updated_at = ? WHERE id = ?")
      .run(status, opts.statusMessage ?? null, opts.result ? JSON.stringify(opts.result) : null, new Date().toISOString(), id);
    if (res.changes === 0) throw new Error(`no task ${id}`);
    return this.getById(id)!;
  }

  list(clientId: string): StoredTask[] {
    return (this.db.prepare("SELECT * FROM tasks WHERE client_id = ? ORDER BY created_at, id").all(clientId) as Row[]).map(fromRow);
  }

  close(): void {
    this.db.close();
  }
}
