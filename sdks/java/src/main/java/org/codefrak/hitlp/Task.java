package org.codefrak.hitlp;

import java.util.Map;
import java.util.Objects;

/**
 * A task handle as the transport reports it (spec 7.2). Immutable; the
 * {@code with...} methods return copies.
 *
 * @param taskId the task id
 * @param status the task status
 * @param ttl effective deadline in milliseconds from creation, as the server reports it, or null
 * @param pollInterval minimum milliseconds between {@code tasks/get} calls, or null
 * @param statusMessage the server's status message, or null
 * @param result the decision record, once the server has one (terminal tasks; spec 7.3), or null
 * @param meta the task's {@code _meta} object as the server sent it, or null when it sent none
 */
public record Task(
        String taskId, TaskStatus status, Long ttl, Long pollInterval, String statusMessage, DecisionRecord result,
        Map<String, Object> meta) {
    /** The {@code _meta} key under which the server carries a URL-mode decision URL. */
    public static final String DECISION_URL_META_KEY = "io.hitlp/decisionUrl";

    public Task {
        Objects.requireNonNull(taskId, "taskId");
        Objects.requireNonNull(status, "status");
    }

    public Task(String taskId, TaskStatus status, Long ttl, Long pollInterval, String statusMessage, DecisionRecord result) {
        this(taskId, status, ttl, pollInterval, statusMessage, result, null);
    }

    public Task(String taskId, TaskStatus status) {
        this(taskId, status, null, null, null, null, null);
    }

    /**
     * The URL-mode decision URL: {@code meta["io.hitlp/decisionUrl"]} when that is a
     * string, else null. The server also puts it in {@code statusMessage}.
     */
    public String decisionUrl() {
        return meta != null && meta.get(DECISION_URL_META_KEY) instanceof String url ? url : null;
    }

    public Task withMeta(Map<String, Object> meta) {
        return new Task(taskId, status, ttl, pollInterval, statusMessage, result, meta);
    }

    public Task withStatus(TaskStatus status, String statusMessage) {
        return new Task(taskId, status, ttl, pollInterval, statusMessage, result, meta);
    }

    public Task withPollInterval(Long pollInterval) {
        return new Task(taskId, status, ttl, pollInterval, statusMessage, result, meta);
    }

    public Task withResult(DecisionRecord result) {
        return new Task(taskId, status, ttl, pollInterval, statusMessage, result, meta);
    }
}
