import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { hello } from "../src/hello";
import { scriptedPrompt } from "../src/terminal-human";

function run(answers: string[]) {
  const lines: string[] = [];
  const checkpointFile = join(mkdtempSync(join(tmpdir(), "hitlp-demo-")), "cp.json");
  const prompt = scriptedPrompt(answers, (s) => lines.push(s));
  return hello({ prompt, log: (l) => lines.push(l), checkpointFile }).then((result) => ({ result, lines, checkpointFile }));
}

test("the agent greets the human and deploys once approved", async () => {
  const { result, lines, checkpointFile } = await run(["Ada", "y"]);
  assert.deepEqual(result, { name: "Ada", deployed: true });
  assert.ok(lines.some((l) => l.includes("Hello, Ada!")));
  assert.ok(!existsSync(checkpointFile));
});

test("the agent does not deploy when the human rejects", async () => {
  const { result, lines } = await run(["Ada", "n"]);
  assert.deepEqual(result, { name: "Ada", deployed: false });
  assert.ok(lines.some((l) => l.includes("Not approved (rejected)")));
});
