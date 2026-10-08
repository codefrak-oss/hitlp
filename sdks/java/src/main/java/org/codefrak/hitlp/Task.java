package org.codefrak.hitlp;

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
 */
public record Task(String taskId, TaskStatus status, Long ttl, Long pollInterval, String statusMessage, DecisionRecord result) {
    public Task {
        Objects.requireNonNull(taskId, "taskId");
        Objects.requireNonNull(status, "status");
    }

    public Task(String taskId, TaskStatus status) {
        this(taskId, status, null, null, null, null);
    }

    public Task withStatus(TaskStatus status, String statusMessage) {
        return new Task(taskId, status, ttl, pollInterval, statusMessage, result);
    }

    public Task withPollInterval(Long pollInterval) {
        return new Task(taskId, status, ttl, pollInterval, statusMessage, result);
    }

    public Task withResult(DecisionRecord result) {
        return new Task(taskId, status, ttl, pollInterval, statusMessage, result);
    }
}
