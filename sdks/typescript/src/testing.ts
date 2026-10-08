import type { HitlpTool, TaskTransport } from "./transport";
import type { DecisionRecord, Task, TaskStatus } from "./types";

/**
 * An in-memory TaskTransport for unit tests. It is NOT a HITLP server: an
 * in-memory task store is not conforming (rule R1). Tests drive decisions
 * with `complete`, `fail` and `setStatus`.
 */
export class FakeTransport implements TaskTransport {
  readonly calls: { name: HitlpTool; args: Record<string, unknown> }[] = [];
  readonly gets: string[] = [];
  readonly cancels: string[] = [];
  /** Fail the next N `callTool`s after recording them (a lost response). */
  failNextCalls = 0;
  private readonly tasks = new Map<string, Task>();
  private readonly byKey = new Map<string, string>();
  private next = 1;

  constructor(private readonly pollInterval = 500) {}

  async callTool(name: HitlpTool, args: Record<string, unknown>): Promise<Task> {
    this.calls.push({ name, args });
    const key = String(args.idempotencyKey);
    let id = this.byKey.get(key);
    if (!id) {
      id = `task-${this.next++}`;
      this.byKey.set(key, id);
      this.tasks.set(id, { taskId: id, status: "working", ttl: 3_600_000, pollInterval: this.pollInterval });
    }
    if (this.failNextCalls > 0) {
      this.failNextCalls--;
      throw new Error("connection lost");
    }
    return { ...this.tasks.get(id)! };
  }

  async getTask(taskId: string): Promise<Task> {
    this.gets.push(taskId);
    return { ...this.must(taskId) };
  }

  async cancelTask(taskId: string): Promise<Task> {
    this.cancels.push(taskId);
    const t = this.must(taskId);
    if (t.status !== "completed" && t.status !== "failed") t.status = "cancelled";
    return { ...t };
  }

  setStatus(taskId: string, status: TaskStatus, statusMessage?: string): void {
    Object.assign(this.must(taskId), { status, statusMessage });
  }

  complete(taskId: string, record: Omit<DecisionRecord, "requestId">): void {
    Object.assign(this.must(taskId), { status: "completed", result: { requestId: taskId, ...record } });
  }

  private must(taskId: string): Task {
    const t = this.tasks.get(taskId);
    if (!t) throw new Error(`no task ${taskId}`);
    return t;
  }
}
