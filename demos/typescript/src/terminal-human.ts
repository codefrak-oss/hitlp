import { createInterface } from "node:readline/promises";
import type { DecisionRecord, HitlpTool, Task, TaskTransport } from "@codefrak/hitlp";

/** Where the human's replies come from: the terminal, or a script of answers. */
export type Prompt = (question: string) => Promise<string>;

/** Reads each reply from stdin, a line at a time (typed or piped). */
export function terminalPrompt(): Prompt & { close(): void } {
  const rl = createInterface({ input: process.stdin });
  const lines = rl[Symbol.asyncIterator]();
  const prompt = async (question: string) => {
    process.stdout.write(question);
    const next = await lines.next();
    if (next.done) throw new Error("stdin closed before the human replied");
    return String(next.value).trim();
  };
  return Object.assign(prompt, { close: () => rl.close() });
}

/** Replays scripted replies (HITLP_DEMO_ANSWERS), echoing them as if typed. */
export function scriptedPrompt(answers: string[], write: (s: string) => void = (s) => process.stdout.write(s)): Prompt {
  const queue = [...answers];
  return async (question) => {
    const reply = queue.shift();
    if (reply === undefined) throw new Error("ran out of scripted answers");
    write(`${question}${reply}\n`);
    return reply;
  };
}

/**
 * The human's side of a HITLP server, shrunk to a terminal for the demo. It
 * only stores the task and turns what the person types into a decision record;
 * envelopes, validation, polling and deciding what a record means are the
 * SDK's. It is NOT a conforming HITLP server: its task store lives in memory
 * (rule R1), and its human is whoever sits at this terminal.
 */
export class TerminalHuman implements TaskTransport {
  private readonly tasks = new Map<string, { task: Task; name: HitlpTool; args: Record<string, unknown> }>();
  private readonly byKey = new Map<string, string>();
  private next = 1;

  constructor(
    private readonly prompt: Prompt,
    private readonly humanId = "terminal-human",
  ) {}

  async callTool(name: HitlpTool, args: Record<string, unknown>): Promise<Task> {
    const key = String(args.idempotencyKey);
    let id = this.byKey.get(key);
    if (!id) {
      id = `task-${this.next++}`;
      this.byKey.set(key, id);
      this.tasks.set(id, { task: { taskId: id, status: "working", pollInterval: 10 }, name, args });
    }
    return { ...this.must(id).task };
  }

  async getTask(taskId: string): Promise<Task> {
    const entry = this.must(taskId);
    if (entry.task.status === "working") {
      entry.task.status = "completed";
      entry.task.result = await this.decide(taskId, entry.name, entry.args);
    }
    return { ...entry.task };
  }

  async cancelTask(taskId: string): Promise<Task> {
    const t = this.must(taskId).task;
    if (t.status === "working") t.status = "cancelled";
    return { ...t };
  }

  private async decide(taskId: string, name: HitlpTool, args: Record<string, unknown>): Promise<DecisionRecord> {
    const base = {
      requestId: taskId,
      idempotencyKey: String(args.idempotencyKey),
      decidedBy: { type: "human" as const, id: this.humanId },
      channel: "terminal",
    };
    if (name === "human.ask") {
      const answer = await this.prompt(`[human] ${args.question} `);
      return { ...base, primitive: "ask", outcome: "answered", answer, decidedAt: new Date().toISOString() };
    }
    const reply = await this.prompt(`[human] Approve "${args.action}" ${JSON.stringify(args.payload)}? [y/N] `);
    const approved = /^y(es)?$/i.test(reply);
    const record: DecisionRecord = {
      ...base,
      primitive: "approve",
      outcome: approved ? "approved" : "rejected",
      decidedAt: new Date().toISOString(),
    };
    if (!approved) record.reason = "declined at the terminal";
    if (typeof args.payloadDigest === "string") record.payloadDigest = args.payloadDigest;
    return record;
  }

  private must(taskId: string) {
    const e = this.tasks.get(taskId);
    if (!e) throw new Error(`no task ${taskId}`);
    return e;
  }
}
