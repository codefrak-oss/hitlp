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
import { tokenOf, type Authenticator } from "./auth";
import { DEFAULT_CAPS, HOUR, type TtlCaps } from "./caps";
import { expireIfDue, sweepExpired, type ExpiryOptions } from "./expiry";
import { TerminalTaskError, type StoredTask, type TaskStore } from "./store";
import { createHumanTask, TOOLS } from "./tools";

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
   * (spec 7.6) calls it; clients cannot reach it over MCP. A decision after the
   * deadline, or on a decided task, is refused.
   */
  decide(taskId: string, record: Omit<DecisionRecord, "requestId">): StoredTask {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`no task ${taskId}`);
    if (isTerminal(task.status)) throw new TerminalTaskError(task);
    return this.store.update(taskId, "completed", { result: { requestId: taskId, ...record } as DecisionRecord, statusMessage: "Decided." });
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    for (const s of this.servers) await s.close();
    this.servers.clear();
  }

  /** R5: resolve the caller from this request's credential. */
  private caller(authInfo: AuthInfo | undefined): string {
    const clientId = this.options.auth.resolve(tokenOf(authInfo, this.options.defaultToken));
    if (!clientId) throw new McpError(ErrorCode.InvalidRequest, "unauthorized");
    return clientId;
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
      const task = await createHumanTask(store, this.caller(extra.authInfo), name, req.params.arguments ?? {}, {
        ttl: req.params.task.ttl ?? undefined,
        pollInterval: this.options.pollInterval ?? DEFAULT_POLL_INTERVAL,
        now: this.now(),
        caps: { approve: this.options.caps?.approve ?? DEFAULT_CAPS.approve, ask: this.options.caps?.ask ?? DEFAULT_CAPS.ask },
        allowBlanketScope: this.options.allowBlanketScope ?? false,
        decisionUrl: this.options.decisionUrl,
        notify: this.options.notify ?? (() => {}),
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
