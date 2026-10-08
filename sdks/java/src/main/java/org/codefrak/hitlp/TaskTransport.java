package org.codefrak.hitlp;

import java.util.Map;

/**
 * The few MCP Tasks operations HITLP needs. Adapt your MCP client to it:
 * {@code callTool} is a task-augmented {@code tools/call} that returns the handle
 * at once, {@code getTask} is {@code tasks/get} (with the result attached once
 * terminal), and {@code cancelTask} is {@code tasks/cancel}. Keeping it this small
 * means the SDK does not depend on which MCP SDK, or which version of the Tasks
 * extension, you use.
 *
 * <p>Arguments are plain JSON values: maps, lists, strings, numbers, booleans and null.
 */
public interface TaskTransport {
    Task callTool(String name, Map<String, Object> args) throws Exception;

    Task getTask(String taskId) throws Exception;

    Task cancelTask(String taskId) throws Exception;
}
