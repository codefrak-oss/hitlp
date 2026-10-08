package org.codefrak.hitlp.testing;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.codefrak.hitlp.DecisionRecord;
import org.codefrak.hitlp.Task;
import org.codefrak.hitlp.TaskStatus;
import org.codefrak.hitlp.TaskTransport;

/**
 * An in-memory {@link TaskTransport} for unit tests. It is NOT a HITLP server: an
 * in-memory task store is not conforming (rule R1). Tests drive decisions with
 * {@link #complete} and {@link #setStatus}.
 */
public class FakeTransport implements TaskTransport {
    /** One recorded {@code callTool}. */
    public record Call(String name, Map<String, Object> args) {}

    public final List<Call> calls = new ArrayList<>();
    public final List<String> gets = new ArrayList<>();
    public final List<String> cancels = new ArrayList<>();
    /** Fail the next N {@code callTool}s after recording them (a lost response). */
    public int failNextCalls = 0;

    private final Map<String, Task> tasks = new HashMap<>();
    private final Map<String, String> byKey = new HashMap<>();
    private final Long pollInterval;
    private int next = 1;

    public FakeTransport() {
        this(500L);
    }

    /** @param pollInterval the interval tasks report, or null for none */
    public FakeTransport(Long pollInterval) {
        this.pollInterval = pollInterval;
    }

    @Override
    public synchronized Task callTool(String name, Map<String, Object> args) {
        calls.add(new Call(name, args));
        String key = String.valueOf(args.get("idempotencyKey"));
        String id = byKey.get(key);
        if (id == null) {
            id = "task-" + next++;
            byKey.put(key, id);
            tasks.put(id, new Task(id, TaskStatus.WORKING, 3_600_000L, pollInterval, null, null));
        }
        if (failNextCalls > 0) {
            failNextCalls--;
            throw new IllegalStateException("connection lost");
        }
        return tasks.get(id);
    }

    @Override
    public synchronized Task getTask(String taskId) {
        gets.add(taskId);
        return must(taskId);
    }

    @Override
    public synchronized Task cancelTask(String taskId) {
        cancels.add(taskId);
        Task t = must(taskId);
        if (t.status() != TaskStatus.COMPLETED && t.status() != TaskStatus.FAILED) {
            t = t.withStatus(TaskStatus.CANCELLED, t.statusMessage());
            tasks.put(taskId, t);
        }
        return t;
    }

    public synchronized void setStatus(String taskId, TaskStatus status, String statusMessage) {
        tasks.put(taskId, must(taskId).withStatus(status, statusMessage));
    }

    /** Completes the task with a decision record; {@code requestId} defaults to the task id. */
    public synchronized void complete(String taskId, Map<String, ?> record) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("requestId", taskId);
        r.putAll(record);
        tasks.put(taskId, must(taskId).withStatus(TaskStatus.COMPLETED, null).withResult(DecisionRecord.of(r)));
    }

    private Task must(String taskId) {
        Task t = tasks.get(taskId);
        if (t == null) throw new IllegalArgumentException("no task " + taskId);
        return t;
    }
}
