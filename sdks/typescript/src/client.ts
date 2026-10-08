import { resolve, type Resolution } from "./decision";
import type { Checkpoint } from "./checkpoint";
import { APPROVE_TOOL, ASK_TOOL, assertCallableTool, type HitlpTool, type TaskTransport } from "./transport";
import type { ApproveDecision, ApproveRequest, AskDecision, AskRequest, DecisionRecord, Task } from "./types";
import { isTerminal } from "./types";
import { assertValidApproveDecision, assertValidApproveRequest, assertValidAskDecision, assertValidAskRequest } from "./validate";

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface ClientOptions {
  /** Poll interval when the server gives none, in ms. Default 1000. */
  defaultPollInterval?: number;
  /** How many times to retry a failed `tools/call` with the same idempotency key (R4). Default 2. */
  callRetries?: number;
  /** Injectable for tests. */
  sleep?: Sleep;
}

export interface WaitOptions {
  signal?: AbortSignal;
  /** Called whenever the task is `input_required` (spec 7.3); polling goes on. */
  onInputRequired?: (task: Task) => void | Promise<void>;
}

const realSleep: Sleep = (ms, signal) =>
  new Promise((done, fail) => {
    if (signal?.aborted) return fail(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      done();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      fail(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * A HITLP client over MCP Tasks. `ask` and `approve` return the task handle
 * at once (rule R1); checkpoint it (R3), then `waitForTerminal` or `resume`.
 */
export class HitlpClient {
  private readonly defaultPollInterval: number;
  private readonly callRetries: number;
  private readonly sleep: Sleep;

  constructor(
    private readonly transport: TaskTransport,
    options: ClientOptions = {},
  ) {
    this.defaultPollInterval = options.defaultPollInterval ?? 1000;
    this.callRetries = options.callRetries ?? 2;
    this.sleep = options.sleep ?? realSleep;
  }

  /** Calls `human.ask`; resolves to the task handle without waiting for a human. */
  ask(request: AskRequest): Promise<Task<AskDecision>> {
    assertValidAskRequest(request);
    return this.call(ASK_TOOL, request) as Promise<Task<AskDecision>>;
  }

  /** Calls `human.approve`; resolves to the task handle without waiting for a human. */
  approve(request: ApproveRequest): Promise<Task<ApproveDecision>> {
    assertValidApproveRequest(request);
    return this.call(APPROVE_TOOL, request) as Promise<Task<ApproveDecision>>;
  }

  /** `tasks/get`. Prefer `waitForTerminal`, which respects `pollInterval`. */
  get(taskId: string): Promise<Task> {
    return this.transport.getTask(taskId);
  }

  /** `tasks/cancel`. */
  cancel(taskId: string): Promise<Task> {
    return this.transport.cancelTask(taskId);
  }

  /**
   * Polls `tasks/get` until the task is terminal, never more often than the
   * server's `pollInterval` (spec 7.4), and validates the decision record.
   */
  async waitForTerminal<R extends DecisionRecord = DecisionRecord>(
    taskOrId: Task<R> | string,
    options: WaitOptions = {},
  ): Promise<Task<R>> {
    let task = typeof taskOrId === "string" ? ((await this.get(taskOrId)) as Task<R>) : taskOrId;
    while (!isTerminal(task.status)) {
      options.signal?.throwIfAborted();
      if (task.status === "input_required") await options.onInputRequired?.(task);
      await this.sleep(Math.max(task.pollInterval ?? this.defaultPollInterval, 0), options.signal);
      task = (await this.get(task.taskId)) as Task<R>;
    }
    if (task.result) {
      if (task.result.primitive === "approve") assertValidApproveDecision(task.result);
      else assertValidAskDecision(task.result);
    }
    return task;
  }

  /** Waits for a checkpointed task and interprets how it ended (rule R3). */
  async resume(checkpoint: Checkpoint, options: WaitOptions = {}): Promise<Resolution> {
    const task = await this.waitForTerminal(checkpoint.taskId, options);
    const r = task.result;
    if (r && (r.idempotencyKey !== checkpoint.idempotencyKey || r.primitive !== checkpoint.primitive)) {
      throw new Error(`task ${checkpoint.taskId} does not match its checkpoint`);
    }
    return resolve(task);
  }

  private async call(name: HitlpTool, args: AskRequest | ApproveRequest): Promise<Task> {
    assertCallableTool(name);
    // Every attempt sends the same arguments, so the same idempotency key (R4):
    // a retry after a lost response returns the existing handle.
    const frozen = structuredClone(args) as unknown as Record<string, unknown>;
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.callRetries; attempt++) {
      try {
        return await this.transport.callTool(name, frozen);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError;
  }
}
