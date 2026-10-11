// The HITLP reference server: an MCP server with human.ask and human.approve
// as task tools. Tasks live in a TaskStore (R1); every task request
// re-authenticates its caller and only the creating client sees a task (R5).
// Deadlines are capped (R6) and expire into their default action (R2); an
// Approve goes URL-mode when a decision page is configured (spec 7.6, R7).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { TaskStore as McpTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/interfaces.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  CallToolRequestSchema,
  CancelTaskRequestSchema,
  ErrorCode,
  GetTaskPayloadRequestSchema,
  GetTaskRequestSchema,
  ListTasksRequestSchema,
  McpError,
  type Task as McpTask,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { isTerminal, type DecisionRecord } from "@codefrak/hitlp";
import type { Caller } from "./attest";
import { tokenOf, type Authenticator, type HumanProfile } from "./auth";
import { DEFAULT_CAPS, HOUR, type TtlCaps } from "./caps";
import { expireIfDue, sweepExpired, type ExpiryOptions } from "./expiry";
import { buildRecord, type RecordFields } from "./records";
import { matchRule, type RuleStore } from "./rules";
import { TerminalTaskError, type StoredTask, type TaskStore } from "./store";
import { createHumanTask, TOOLS } from "./tools";
import { answerErrors, displayedDigest, routedTo } from "./routing";

/** A human's decision as a surface sends it: an Approve's outcome, or an Ask's answer. */
export type HumanDecision =
  | { outcome: "approved" | "rejected"; reason?: string; payloadDigest?: string }
  | { answer: unknown; reason?: string };

/** The task does not exist or is not routed to this human: either way, not found (spec 7.8). */
export class NotRoutedError extends Error {
  constructor(readonly taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = "NotRoutedError";
  }
}

/** A decision the task cannot take; `status` is the HTTP status a surface answers. */
export class DecisionError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
    this.name = "DecisionError";
  }
}

export interface HitlpServerOptions {
  store: TaskStore;
  auth: Authenticator;
  /** Token used when the transport carries none (stdio, one local client). */
  defaultToken?: string;
  pollInterval?: number;
  /** The clock, in epoch ms (tests pass a fake one). */
  now?: () => number;
  /** Maximum TTL per primitive (R6); defaults to DEFAULT_CAPS. */
  caps?: Partial<TtlCaps>;
  /** Accept Approve scopes with no notAfter or maxUses (R6 refuses them by default). */
  allowBlanketScope?: boolean;
  /** How long `escalate` waits past the deadline before rejecting; default 24h. */
  escalationGraceMs?: number;
  /** Period of the expiry sweep in ms; 0 disables the timer (reads still expire lazily). Default 30s. */
  expirySweepMs?: number;
  /** Re-routes an escalated task to a wider audience. */
  onEscalate?: (task: StoredTask) => void | Promise<void>;
  /** The decision page URL of a task; when set, Approve goes URL-mode (spec 7.6). */
  decisionUrl?: (taskId: string) => string;
  /** The humans' standing rules (proxy layer 1, spec 3.1); none when unset. */
  rules?: RuleStore;
  /** Resolves a rule's human, so a rule decides only for a human who meets the task's `requires`. */
  humanProfile?: (id: string) => HumanProfile | undefined;
  /** Tells a human about a new task (the out-of-band channel, spec 7.6). */
  notify?: (task: StoredTask) => void | Promise<void>;
}

const DEFAULT_POLL_INTERVAL = 5_000;
const DEFAULT_SWEEP = 30_000;

function toMcpTask(t: StoredTask): McpTask {
  const task: McpTask = { taskId: t.id, status: t.status, ttl: t.ttl, createdAt: t.createdAt, lastUpdatedAt: t.updatedAt, pollInterval: t.pollInterval };
  if (t.statusMessage !== undefined) task.statusMessage = t.statusMessage;
  if (t.meta !== undefined) (task as McpTask & { _meta?: Record<string, unknown> })._meta = t.meta;
  return task;
}

function resultOf(t: StoredTask) {
  const record = t.result;
  if (!record) return { content: [{ type: "text" as const, text: t.statusMessage ?? t.status }], isError: t.status === "failed" };
  return { content: [{ type: "text" as const, text: JSON.stringify(record) }], structuredContent: record as unknown as Record<string, unknown> };
}

export class HitlpServer {
  private readonly servers = new Set<McpServer>();
  private readonly listeners = new Set<(task: StoredTask) => void>();
  private readonly timer?: NodeJS.Timeout;
  readonly now: () => number;
  private readonly expiry: ExpiryOptions;

  constructor(private readonly options: HitlpServerOptions) {
    this.now = options.now ?? Date.now;
    this.expiry = { escalationGraceMs: options.escalationGraceMs ?? 24 * HOUR, onEscalate: options.onEscalate };
    // R2: tasks that expired while the server was down get their default action now.
    this.sweep();
    const period = options.expirySweepMs ?? DEFAULT_SWEEP;
    if (period > 0) {
      this.timer = setInterval(() => this.sweep(), period);
      this.timer.unref();
    }
  }

  get store(): TaskStore {
    return this.options.store;
  }

  /** Applies the default action to every overdue task (R2); returns how many changed. */
  sweep(): number {
    return sweepExpired(this.store, this.now(), this.expiry);
  }

  /** A task by id, expired first if its deadline has passed (R2). */
  getTask(taskId: string): StoredTask | undefined {
    const task = this.store.getById(taskId);
    return task && expireIfDue(this.store, task, this.now(), this.expiry);
  }

  /** Serves one MCP connection. */
  async connect(transport: Transport): Promise<McpServer> {
    const server = this.build();
    this.servers.add(server);
    await server.connect(transport);
    return server;
  }

  /**
   * Records a human's decision on a task, exactly once. The decision page
   * (spec 7.6) calls it; clients cannot reach it over MCP. The record gets the
   * request's `attested` and `recommendation` (spec 6). A decision after the
   * deadline, or on a decided task, is refused.
   */
  /**
   * Records a human's decision from a surface (spec 7.7, 7.8): the decision page
   * passes channel `url`, the surface API the surface's kind. The one path every
   * human decision takes: the human must satisfy the task's `requires`
   * (NotRoutedError), the task must be open (TerminalTaskError), an Approve takes
   * approved or rejected bound to the payload's digest, an Ask an answer valid
   * against its `responseSchema` (DecisionError). The record names the human,
   * their roles and the channel.
   */
  decideAsHuman(taskId: string, human: HumanProfile, channel: string, decision: HumanDecision): StoredTask {
    const task = this.getTask(taskId);
    if (!task || !routedTo(task, human)) throw new NotRoutedError(taskId);
    if (isTerminal(task.status)) throw new TerminalTaskError(task);
    const base = {
      decidedBy: { type: "human" as const, id: human.id, roles: [...human.roles] },
      decidedAt: new Date(this.now()).toISOString(),
      channel,
    };
    let fields: RecordFields;
    if (task.primitive === "approve") {
      if (!("outcome" in decision) || (decision.outcome !== "approved" && decision.outcome !== "rejected")) {
        throw new DecisionError(400, "an Approve takes outcome approved or rejected");
      }
      const digest = displayedDigest(task);
      if (decision.payloadDigest !== undefined && decision.payloadDigest !== digest) {
        throw new DecisionError(409, "the payload digest does not match the task's: reload and decide again");
      }
      fields = { outcome: decision.outcome, ...base, payloadDigest: digest };
    } else {
      if (!("answer" in decision) || decision.answer === undefined) throw new DecisionError(400, "an Ask takes an answer");
      const options = (task.request.options ?? []) as { value: unknown }[];
      if (options.length > 0 && !options.some((o) => JSON.stringify(o.value) === JSON.stringify(decision.answer))) {
        throw new DecisionError(400, "the answer is not one of the options");
      }
      const errors = answerErrors(task, decision.answer);
      if (errors.length > 0) throw new DecisionError(400, `the answer does not match the responseSchema: ${errors.join("; ")}`);
      fields = { outcome: "answered", answer: structuredClone(decision.answer), ...base };
    }
    if (decision.reason) fields.reason = decision.reason;
    return this.store.update(taskId, "completed", { result: buildRecord(task, fields), statusMessage: "Decided." });
  }

  /** Calls `listener` with each new task routed to humans (never an R4 repeat or a rule's decision); returns the unsubscribe. */
  onNewTask(listener: (task: StoredTask) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private async announce(task: StoredTask): Promise<void> {
    for (const l of this.listeners) {
      try {
        l(task);
      } catch (e) {
        console.error(`hitlp: a new-task listener failed: ${(e as Error).message}`);
      }
    }
    await this.options.notify?.(task);
  }

  decide(taskId: string, decision: RecordFields & Partial<Pick<DecisionRecord, "idempotencyKey" | "primitive">>): StoredTask {
    // The task, not the caller, supplies the key, primitive, attested and recommendation.
    const { idempotencyKey: _k, primitive: _p, attested: _a, recommendation: _r, ...fields } = decision as DecisionRecord;
    const task = this.getTask(taskId);
    if (!task) throw new Error(`no task ${taskId}`);
    if (isTerminal(task.status)) throw new TerminalTaskError(task);
    const record: DecisionRecord = buildRecord(task, fields);
    return this.store.update(taskId, "completed", { result: record, statusMessage: "Decided." });
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    for (const s of this.servers) await s.close();
    this.servers.clear();
  }

  /** R5: resolve the caller from this request's credential. */
  private caller(authInfo: AuthInfo | undefined): string {
    return this.attestedCaller(authInfo).clientId;
  }

  /** R5 and R8: the caller, and the principal its credential carries, from this request's credential only. */
  private attestedCaller(authInfo: AuthInfo | undefined): Caller {
    const token = tokenOf(authInfo, this.options.defaultToken);
    const clientId = this.options.auth.resolve(token);
    if (!clientId) throw new McpError(ErrorCode.InvalidRequest, "unauthorized");
    const onBehalfOf = this.options.auth.onBehalfOf?.(token);
    return onBehalfOf === undefined ? { clientId } : { clientId, onBehalfOf };
  }

  /** R5: a task the caller did not create is reported as not found. */
  private ownTask(taskId: string, authInfo: AuthInfo | undefined): StoredTask {
    const clientId = this.caller(authInfo);
    const task = this.store.getById(taskId);
    if (!task || task.clientId !== clientId) throw new McpError(ErrorCode.InvalidParams, `Task not found: ${taskId}`);
    return expireIfDue(this.store, task, this.now(), this.expiry);
  }

  private build(): McpServer {
    const store = this.store;
    // The MCP SDK requires a task store to route task-augmented tool calls;
    // every task request is answered by the handlers below instead.
    const mcpStore: McpTaskStore = {
      createTask: async () => {
        throw new Error("tasks are created by the HITLP tools");
      },
      getTask: async (id) => {
        const t = store.getById(id);
        return t ? toMcpTask(t) : null;
      },
      storeTaskResult: async () => {
        throw new Error("results are recorded by HitlpServer.decide");
      },
      getTaskResult: async (id) => {
        const t = store.getById(id);
        if (!t) throw new Error(`no task ${id}`);
        return resultOf(t);
      },
      updateTaskStatus: async () => {
        throw new Error("status changes go through HitlpServer");
      },
      listTasks: async () => ({ tasks: [] }),
    };
    const server = new McpServer(
      { name: "hitlp-server", version: "0.1.0" },
      { capabilities: { tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } } }, taskStore: mcpStore },
    );
    for (const name of Object.keys(TOOLS)) {
      server.experimental.tasks.registerToolTask(
        name,
        { inputSchema: z.object({}).passthrough(), execution: { taskSupport: "required" } },
        {
          // Registered for tools/list; tools/call is answered by the handler below.
          createTask: async () => {
            throw new McpError(ErrorCode.InternalError, "unreachable");
          },
          getTask: async (_args, extra) => toMcpTask(this.ownTask(extra.taskId, extra.authInfo)),
          getTaskResult: async (_args, extra) => resultOf(this.ownTask(extra.taskId, extra.authInfo)) as never,
        },
      );
    }
    const raw = server.server;
    // McpServer turns a tool's errors into isError results; R4's rejection and
    // R5's refusal must be JSON-RPC errors, so tools/call is answered here.
    raw.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
      const name = req.params.name;
      if (!(name in TOOLS)) throw new McpError(ErrorCode.InvalidParams, `Tool ${name} not found`);
      if (!req.params.task) throw new McpError(ErrorCode.MethodNotFound, `Tool ${name} requires task augmentation (taskSupport: 'required')`);
      const task = await createHumanTask(store, this.attestedCaller(extra.authInfo), name, req.params.arguments ?? {}, {
        ttl: req.params.task.ttl ?? undefined,
        pollInterval: this.options.pollInterval ?? DEFAULT_POLL_INTERVAL,
        now: this.now(),
        caps: { approve: this.options.caps?.approve ?? DEFAULT_CAPS.approve, ask: this.options.caps?.ask ?? DEFAULT_CAPS.ask },
        allowBlanketScope: this.options.allowBlanketScope ?? false,
        decisionUrl: this.options.decisionUrl,
        rule: (t) => (this.options.rules ? matchRule(t, this.options.rules.listRules(), this.options.humanProfile) : undefined),
        notify: (t) => this.announce(t),
      });
      return { task: toMcpTask(task) } as never;
    });
    raw.setRequestHandler(GetTaskRequestSchema, async (req, extra) => toMcpTask(this.ownTask(req.params.taskId, extra.authInfo)) as never);
    raw.setRequestHandler(GetTaskPayloadRequestSchema, async (req, extra) => {
      const task = this.ownTask(req.params.taskId, extra.authInfo);
      // R1: never hold the connection waiting for a human.
      if (!isTerminal(task.status)) throw new McpError(ErrorCode.InvalidParams, `Task ${task.id} is ${task.status}; poll tasks/get`);
      return { ...resultOf(task), _meta: { "io.modelcontextprotocol/related-task": { taskId: task.id } } } as never;
    });
    raw.setRequestHandler(ListTasksRequestSchema, async (_req, extra) => ({
      tasks: store.list(this.caller(extra.authInfo)).map((t) => toMcpTask(expireIfDue(store, t, this.now(), this.expiry))),
      _meta: {},
    }) as never);
    raw.setRequestHandler(CancelTaskRequestSchema, async (req, extra) => {
      const task = this.ownTask(req.params.taskId, extra.authInfo);
      if (isTerminal(task.status)) throw new McpError(ErrorCode.InvalidParams, `Cannot cancel task in terminal status: ${task.status}`);
      const cancelled = store.update(task.id, "cancelled", { statusMessage: "Client cancelled the request." });
      return { ...toMcpTask(cancelled), _meta: cancelled.meta ?? {} } as never;
    });
    return server;
  }
}
