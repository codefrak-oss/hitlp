// Types for HITLP v1.0 (draft): spec/hitlp.md sections 4-7.
// They mirror spec/schemas/*.json; the schemas stay the authority (see validate.ts).

/** The spec version this SDK implements. */
export const SPEC_VERSION = "1.0-draft";

export type DefaultOnTimeout = "reject" | "escalate" | "cancel" | "fail";
export type Priority = "low" | "normal" | "high" | "urgent";

/** The common request envelope (spec section 5). */
export interface Envelope {
  idempotencyKey: string;
  /** RFC 3339 date-time. */
  deadline: string;
  defaultOnTimeout: DefaultOnTimeout;
  priority?: Priority;
  requires?: { capabilities?: string[]; roles?: string[] };
  context?: { summary?: string; links?: string[]; data?: Record<string, unknown> };
  requester?: { agent?: string; onBehalfOf?: string };
}

export interface AskOption {
  value: unknown;
  label: string;
}

/** `human.ask` arguments: envelope plus the Ask body, flattened (spec 4.1, 7.1). */
export interface AskRequest extends Envelope {
  question: string;
  responseSchema: Record<string, unknown> | boolean;
  options?: AskOption[];
}

export interface ApproveScope {
  maxUses?: number;
  /** RFC 3339 date-time. */
  notAfter?: string;
}

/** `human.approve` arguments: envelope plus the Approve body, flattened (spec 4.2, 7.1). */
export interface ApproveRequest extends Envelope {
  action: string;
  payload: Record<string, unknown>;
  payloadDigest?: string;
  scope?: ApproveScope;
}

export type Primitive = "ask" | "approve";
export type Outcome = "answered" | "approved" | "rejected" | "timed_out" | "cancelled";

/** The decision record (spec section 6); it is the task result. */
export interface DecisionRecord {
  requestId: string;
  idempotencyKey: string;
  primitive: Primitive;
  outcome: Outcome;
  answer?: unknown;
  reason?: string;
  decidedBy: { type: "human" | "policy"; id?: string; roles?: string[] };
  decidedAt: string;
  channel?: string;
  payloadDigest?: string;
  signature?: { alg: string; keyId: string; value: string };
}

export interface AskDecision extends DecisionRecord {
  primitive: "ask";
  outcome: "answered" | "timed_out" | "cancelled";
}

export interface ApproveDecision extends DecisionRecord {
  primitive: "approve";
  outcome: "approved" | "rejected" | "timed_out" | "cancelled";
}

/** MCP Tasks statuses (spec 7.3). */
export type TaskStatus = "working" | "input_required" | "completed" | "failed" | "cancelled";

export const TERMINAL_STATUSES: readonly TaskStatus[] = ["completed", "failed", "cancelled"];

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** A task handle as the transport reports it (spec 7.2). */
export interface Task<R extends DecisionRecord = DecisionRecord> {
  taskId: string;
  status: TaskStatus;
  /** Effective deadline in milliseconds from creation, as the server reports it. */
  ttl?: number;
  /** Minimum milliseconds between `tasks/get` calls. */
  pollInterval?: number;
  statusMessage?: string;
  /** The decision record, once the server has one (terminal tasks; spec 7.3). */
  result?: R;
  /** The task's `_meta` object as the server sent it; absent when it sent none. */
  meta?: Record<string, unknown>;
  /**
   * The decision URL of a URL-mode Approve: `meta["io.hitlp/decisionUrl"]` when
   * that is a string, else absent. The server also puts it in `statusMessage`.
   */
  decisionUrl?: string;
}

/** The `_meta` key under which the server carries a URL-mode decision URL. */
export const DECISION_URL_META_KEY = "io.hitlp/decisionUrl";

/** The decision URL in a task's `_meta`, or undefined when absent or not a string. */
export function decisionUrlOf(meta: Record<string, unknown> | null | undefined): string | undefined {
  const url = meta?.[DECISION_URL_META_KEY];
  return typeof url === "string" ? url : undefined;
}

/** Sets `meta` (and `decisionUrl` from it) on a task; `undefined` clears both. */
export function withMeta<T extends Task<any>>(task: T, meta: Record<string, unknown> | null | undefined): T {
  const out = { ...task };
  delete out.meta;
  delete out.decisionUrl;
  if (meta != null) {
    out.meta = meta;
    const url = decisionUrlOf(meta);
    if (url !== undefined) out.decisionUrl = url;
  }
  return out;
}
