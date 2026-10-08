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
} from "@codefrak/hitlp";
import { scriptedPrompt, terminalPrompt, TerminalHuman, type Prompt } from "./terminal-human";

export interface HelloOptions {
  prompt: Prompt;
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
export async function hello({ prompt, log = console.log, checkpointFile = ".hitlp-demo-checkpoint.json" }: HelloOptions): Promise<HelloResult> {
  const client = new HitlpClient(new TerminalHuman(prompt));
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

if (require.main === module) {
  const scripted = process.env.HITLP_DEMO_ANSWERS;
  const terminal = scripted === undefined ? terminalPrompt() : undefined;
  hello({ prompt: terminal ?? scriptedPrompt(scripted!.split(",")) })
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => terminal?.close());
}
