import type { Task } from "./types";

/** The v1 tool names (spec 7.1). */
export const ASK_TOOL = "human.ask";
export const APPROVE_TOOL = "human.approve";
export type HitlpTool = typeof ASK_TOOL | typeof APPROVE_TOOL;

/** Reserved by the spec (section 4); never callable through this SDK. */
export const RESERVED_TOOLS: readonly string[] = ["human.do", "human.inform", "human.escalate"];

/**
 * The few MCP Tasks operations HITLP needs. Adapt your MCP client to it:
 * `callTool` is a task-augmented `tools/call` that returns the handle at once,
 * `getTask` is `tasks/get` (with the result attached once terminal), and
 * `cancelTask` is `tasks/cancel`. Keeping it this small means the SDK does not
 * depend on which MCP SDK, or which version of the Tasks extension, you use.
 */
export interface TaskTransport {
  callTool(name: HitlpTool, args: Record<string, unknown>): Promise<Task>;
  getTask(taskId: string): Promise<Task>;
  cancelTask(taskId: string): Promise<Task>;
  /**
   * Optional: listens for pushed task status (spec 7.4, `notifications/tasks/status`)
   * and stream (re)connects. Returns the unsubscribe, or undefined when no stream is
   * available, in which case the client polls `tasks/get`.
   */
  watch?(listener: (event: TaskEvent) => void): (() => void) | undefined;
}

/** What a watching transport reports: a task's new status, or that its stream (re)connected. */
export type TaskEvent = { kind: "status"; taskId: string; status: string } | { kind: "reconnected" };

export class ReservedToolError extends Error {
  constructor(name: string) {
    super(`${name} is reserved by HITLP v1 and must not be called`);
    this.name = "ReservedToolError";
  }
}

export function assertCallableTool(name: string): asserts name is HitlpTool {
  if (RESERVED_TOOLS.includes(name)) throw new ReservedToolError(name);
  if (name !== ASK_TOOL && name !== APPROVE_TOOL) throw new Error(`${name} is not a HITLP v1 tool`);
}
