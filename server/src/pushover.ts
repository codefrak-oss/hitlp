// Pushover notifications for new tasks, beside APNs push (src/push.ts): one
// message per new task routed to an approver, to the one configured user key.
// Like an APNs alert it carries a title and the task id, never the payload or
// any other request content but an Approve's action, cut short.
import { routedTo } from "./routing";
import type { HumanProfile } from "./auth";
import type { HitlpServer } from "./server";
import type { StoredTask } from "./store";

export const PUSHOVER_API = "https://api.pushover.net/1/messages.json";
const SUBJECT_MAX = 60;

export interface PushoverConfig {
  /** The application's API token. */
  token: string;
  /** The user (or group) key messages go to. */
  user: string;
  /** Base URL of the decision page; the message links to /decide/{id} on it. None, no link. */
  pageUrl?: string;
  /** Priority of an Approve's message (-2..2); default 1. An Ask's is 0. */
  approvePriority?: number;
  /** The messages endpoint; tests point it at a fake. */
  endpoint?: string;
  log?: (msg: string) => void;
}

/** The form fields of one message: title, task id, link, priority; nothing else from the request. */
export function pushoverMessage(task: StoredTask, config: Pick<PushoverConfig, "pageUrl" | "approvePriority">): Record<string, string> {
  let title = "Question";
  if (task.primitive === "approve") {
    const action = typeof task.request.action === "string" ? task.request.action.replace(/\s+/g, " ").trim() : "";
    const subject = action.length > SUBJECT_MAX ? `${action.slice(0, SUBJECT_MAX - 1)}…` : action;
    title = subject ? `Approve: ${subject}` : "Approval requested";
  }
  const fields: Record<string, string> = {
    title,
    message: `Task ${task.id} is waiting for your decision.`,
    priority: String(task.primitive === "approve" ? (config.approvePriority ?? 1) : 0),
  };
  if (config.pageUrl) {
    fields.url = `${config.pageUrl.replace(/\/$/, "")}/decide/${encodeURIComponent(task.id)}`;
    fields.url_title = "Open decision page";
  }
  return fields;
}

export class PushoverSender {
  private readonly log: (msg: string) => void;

  constructor(private readonly config: PushoverConfig) {
    this.log = config.log ?? ((m) => console.error(m));
  }

  /** Sends the task's message; an error is logged and never thrown. */
  async send(task: StoredTask): Promise<boolean> {
    try {
      const body = new URLSearchParams({ token: this.config.token, user: this.config.user, ...pushoverMessage(task, this.config) });
      const res = await fetch(this.config.endpoint ?? PUSHOVER_API, { method: "POST", body, signal: AbortSignal.timeout(10_000) });
      if (res.ok) return true;
      this.log(`hitlp: pushover refused task ${task.id}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      this.log(`hitlp: pushover failed for task ${task.id}: ${(e as Error).message}`);
    }
    return false;
  }
}

/**
 * Sends each new task once (never an R4 repeat) when it is routed to at least
 * one of `approvers`; with no approvers given, every new task.
 */
export function wirePushover(server: HitlpServer, sender: PushoverSender, approvers?: () => Iterable<HumanProfile>): () => void {
  return server.onNewTask((task) => {
    if (approvers && ![...approvers()].some((h) => routedTo(task, h))) return;
    void sender.send(task);
  });
}
