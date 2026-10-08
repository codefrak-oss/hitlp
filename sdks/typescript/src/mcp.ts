// A TaskTransport over the official MCP TypeScript SDK and its Tasks extension
// (spec 7.1-7.4). The MCP SDK is an optional peer dependency: only code that
// imports this module needs it installed.
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResultSchema, CreateTaskResultSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { assertCallableTool, type HitlpTool, type TaskTransport } from "./transport";
import { isTerminal, type DecisionRecord, type Task, type TaskStatus } from "./types";

export interface McpTaskTransportOptions {
  /** Requested task ttl in milliseconds; the server may lower it (spec 7.2). */
  ttl?: number;
  /** Timeout for each MCP request in milliseconds. */
  timeout?: number;
}

/** The task fields MCP reports (CreateTaskResult.task, GetTaskResult, CancelTaskResult). */
interface McpTask {
  taskId: string;
  status: string;
  ttl?: number | null;
  pollInterval?: number;
  statusMessage?: string;
}

/** An MCP error, with its JSON-RPC code kept on the Error. */
export class McpTransportError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "McpTransportError";
  }
}

/**
 * Adapts a connected MCP `Client` to TaskTransport: `callTool` is a
 * task-augmented `tools/call`, `getTask` is `tasks/get` plus `tasks/result`
 * once the task is terminal, `cancelTask` is `tasks/cancel`. The Tasks API of
 * the MCP SDK is experimental, so this adapter may need to follow it.
 */
export class McpTaskTransport implements TaskTransport {
  constructor(private readonly client: Client, private readonly options: McpTaskTransportOptions = {}) {}

  async callTool(name: HitlpTool, args: Record<string, unknown>): Promise<Task> {
    assertCallableTool(name);
    const res = await this.wrap(() =>
      this.client.request(
        { method: "tools/call", params: { name, arguments: args, task: this.options.ttl ? { ttl: this.options.ttl } : {} } },
        CreateTaskResultSchema,
        this.requestOptions(),
      ),
    );
    return toTask(res.task);
  }

  async getTask(taskId: string): Promise<Task> {
    const task = toTask(await this.wrap(() => this.client.experimental.tasks.getTask(taskId, this.requestOptions())));
    if (isTerminal(task.status) && task.status !== "cancelled") {
      const result = await this.wrap(() =>
        this.client.experimental.tasks.getTaskResult(taskId, CallToolResultSchema, this.requestOptions()),
      );
      const record = result.structuredContent as DecisionRecord | undefined;
      if (record) task.result = record;
    }
    return task;
  }

  async cancelTask(taskId: string): Promise<Task> {
    return toTask(await this.wrap(() => this.client.experimental.tasks.cancelTask(taskId, this.requestOptions())));
  }

  private requestOptions() {
    return this.options.timeout ? { timeout: this.options.timeout } : undefined;
  }

  private async wrap<T>(f: () => Promise<T>): Promise<T> {
    try {
      return await f();
    } catch (e) {
      if (e instanceof McpError) throw new McpTransportError(e.message, e.code);
      throw e;
    }
  }
}

function toTask(t: McpTask): Task {
  const task: Task = { taskId: t.taskId, status: t.status as TaskStatus };
  if (t.ttl != null) task.ttl = t.ttl;
  if (t.pollInterval !== undefined) task.pollInterval = t.pollInterval;
  if (t.statusMessage !== undefined) task.statusMessage = t.statusMessage;
  return task;
}
