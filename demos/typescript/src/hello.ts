import { readFileSync, rmSync, writeFileSync } from "node:fs";
import {
  answerOf,
  buildApprove,
  buildAsk,
  checkpointFor,
  HitlpClient,
  isApproved,
  parseCheckpoint,
  serializeCheckpoint,
  type Task,
  type TaskTransport,
} from "@codefrak/hitlp";
import { McpTaskTransport } from "@codefrak/hitlp/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { scriptedPrompt, terminalPrompt, TerminalHuman, type Prompt } from "./terminal-human";

export interface HelloOptions {
  /** The terminal human's prompt; ignored when `transport` is given. */
  prompt?: Prompt;
  /** Where the requests go; default a TerminalHuman on `prompt`. */
  transport?: TaskTransport;
  log?: (line: string) => void;
  checkpointFile?: string;
}

/** What the agent ended up doing. */
export interface HelloResult {
  name?: string;
  deployed: boolean;
}

/**
 * A hello world HITLP agent: it asks the human their name (Ask), greets them,
 * then asks approval to deploy a greeting (Approve) and goes on only if approved.
 */
export async function hello({ prompt, transport, log = console.log, checkpointFile = ".hitlp-demo-checkpoint.json" }: HelloOptions): Promise<HelloResult> {
  if (!transport && !prompt) throw new Error("hello needs a prompt or a transport");
  const client = new HitlpClient(transport ?? new TerminalHuman(prompt!));
  // On a real server the human decides elsewhere: say where.
  const waiting = async (created: Task) => {
    if (!transport) return;
    // The MCP SDK's CreateTaskResult schema drops the task's _meta; tasks/get carries it.
    const task = created.decisionUrl ? created : await client.get(created.taskId);
    log(`[agent] Task ${task.taskId} waits for a human${task.decisionUrl ? ` at ${task.decisionUrl}` : " (the server logs its decision page URL)"}.`);
  };
  const inAnHour = () => new Date(Date.now() + 3_600_000);
  const requester = { agent: "hitlp-hello-typescript" };

  // Ask: the call returns a task handle at once; the human answers later.
  log("[agent] Asking the human for their name (human.ask) ...");
  const ask = buildAsk({
    question: "What is your name?",
    responseSchema: { type: "string", minLength: 1 },
    deadline: inAnHour(),
    defaultOnTimeout: "cancel",
    requester,
  });
  const askTask = await client.ask(ask);
  await waiting(askTask);
  const asked = await client.waitForTerminal(askTask);
  const name = answerOf<string>(asked.result);
  if (!name) {
    log(`[agent] No answer (${asked.status}); stopping.`);
    return { deployed: false };
  }
  log(`[agent] Hello, ${name}!`);

  // Approve: checkpoint the handle before yielding (rule R3), then resume from it.
  const approve = buildApprove({
    action: "deploy.greeting",
    payload: { greeting: `Hello, ${name}!`, target: "hello-world" },
    deadline: inAnHour(),
    requester,
  });
  log(`[agent] Requesting approval for ${approve.action} (human.approve) ...`);
  const approveTask = await client.approve(approve);
  await waiting(approveTask);
  writeFileSync(checkpointFile, serializeCheckpoint(checkpointFor(approveTask, approve, "approve")));
  log(`[agent] Checkpointed task ${approveTask.taskId}; resuming from the checkpoint.`);

  const resolution = await client.resume(parseCheckpoint(readFileSync(checkpointFile, "utf8")));
  rmSync(checkpointFile, { force: true });
  if (resolution.kind === "decided" && isApproved(resolution.record, approve)) {
    log(`[agent] Approved by ${resolution.record.decidedBy.id}. Deploying "Hello, ${name}!" ... done.`);
    return { name, deployed: true };
  }
  log(`[agent] Not approved (${resolution.record?.outcome ?? resolution.kind}); nothing deployed.`);
  return { name, deployed: false };
}

/**
 * Real-server mode: an MCP Streamable HTTP client to `url` with a bearer
 * token, wrapped in the SDK's McpTaskTransport. Close the client when done.
 */
export async function connectServer(url: string, token: string): Promise<{ transport: TaskTransport; close: () => Promise<void> }> {
  const client = new Client({ name: "hitlp-hello-typescript", version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  // The SDK may resolve its own copy of the MCP SDK (file: dependency); the two Clients are the same at run time.
  return { transport: new McpTaskTransport(client as unknown as ConstructorParameters<typeof McpTaskTransport>[0]), close: () => client.close() };
}

async function main(): Promise<void> {
  const server = process.env.HITLP_DEMO_SERVER;
  if (server) {
    const { transport, close } = await connectServer(server, process.env.HITLP_DEMO_TOKEN ?? "local");
    try {
      await hello({ transport });
    } finally {
      await close();
    }
    return;
  }
  const scripted = process.env.HITLP_DEMO_ANSWERS;
  const terminal = scripted === undefined ? terminalPrompt() : undefined;
  try {
    await hello({ prompt: terminal ?? scriptedPrompt(scripted!.split(",")) });
  } finally {
    terminal?.close();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
