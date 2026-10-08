// An in-process MCP server with human.ask and human.approve as task tools, for
// the McpTaskTransport tests. Its task store is in memory, so it is NOT a
// conforming HITLP server (rule R1); tests decide tasks with `decide`.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { InMemoryTaskStore } from "@modelcontextprotocol/sdk/experimental/tasks/stores/in-memory.js";
import { z } from "zod";
import type { DecisionRecord } from "../../src";

export interface TestMcpServer {
  client: Client;
  /** Arguments each tool call received, in order. */
  calls: { name: string; args: Record<string, unknown> }[];
  /** Completes a task with a decision record (requestId is the task id). */
  decide(taskId: string, record: Omit<DecisionRecord, "requestId">): Promise<void>;
  close(): Promise<void>;
}

export async function startTestMcpServer(pollInterval = 10): Promise<TestMcpServer> {
  const taskStore = new InMemoryTaskStore();
  const server = new McpServer(
    { name: "hitlp-test", version: "0.0.0" },
    { capabilities: { tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } } }, taskStore },
  );
  const calls: TestMcpServer["calls"] = [];
  for (const name of ["human.ask", "human.approve"]) {
    server.experimental.tasks.registerToolTask(
      name,
      { inputSchema: z.object({}).passthrough(), execution: { taskSupport: "required" } },
      {
        createTask: async (args, extra) => {
          calls.push({ name, args: args as Record<string, unknown> });
          const task = await extra.taskStore.createTask({ ttl: extra.taskRequestedTtl ?? 3_600_000, pollInterval });
          return { task };
        },
        getTask: async (_args, extra) => (await extra.taskStore.getTask(extra.taskId))!,
        getTaskResult: async (_args, extra) => extra.taskStore.getTaskResult(extra.taskId) as never,
      },
    );
  }
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hitlp-test-client", version: "0.0.0" });
  await server.connect(serverSide);
  await client.connect(clientSide);
  return {
    client,
    calls,
    async decide(taskId, record) {
      const structuredContent = { requestId: taskId, ...record };
      await taskStore.storeTaskResult(taskId, "completed", {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
      });
    },
    async close() {
      await client.close();
      await server.close();
      taskStore.cleanup();
    },
  };
}
