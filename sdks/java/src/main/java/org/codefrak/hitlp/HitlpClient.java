package org.codefrak.hitlp;

import java.util.Map;
import java.util.function.Consumer;

/**
 * A HITLP client over MCP Tasks. {@code ask} and {@code approve} return the task
 * handle at once (rule R1); checkpoint it (R3), then {@code waitForTerminal} or
 * {@code resume}. Transport failures surface as {@link HitlpTransportException}.
 */
public final class HitlpClient {
    private final TaskTransport transport;
    private final long defaultPollInterval;
    private final int callRetries;
    private final Sleeper sleeper;

    public HitlpClient(TaskTransport transport) {
        this(transport, new Options());
    }

    public HitlpClient(TaskTransport transport, Options options) {
        this.transport = transport;
        this.defaultPollInterval = options.defaultPollInterval;
        this.callRetries = options.callRetries;
        this.sleeper = options.sleeper;
    }

    /** Client options; fluent. */
    public static final class Options {
        long defaultPollInterval = 1000;
        int callRetries = 2;
        Sleeper sleeper = Sleeper.REAL;

        /** Poll interval when the server gives none, in ms. Default 1000. */
        public Options defaultPollInterval(long millis) {
            this.defaultPollInterval = millis;
            return this;
        }

        /** How many times to retry a failed {@code tools/call} with the same idempotency key (R4). Default 2. */
        public Options callRetries(int retries) {
            this.callRetries = retries;
            return this;
        }

        /** Injectable for tests. */
        public Options sleeper(Sleeper sleeper) {
            this.sleeper = sleeper;
            return this;
        }
    }

    /** Options for {@link #waitForTerminal} and {@link #resume}; fluent. */
    public static final class WaitOptions {
        CancelSignal signal;
        Consumer<Task> onInputRequired;

        public WaitOptions signal(CancelSignal signal) {
            this.signal = signal;
            return this;
        }

        /**
         * Called once per entry into {@code input_required} (spec 7.3): when the wait starts on
         * an {@code input_required} task, or a poll sees it after another status. The task
         * carries that poll's {@code meta} and {@code decisionUrl()}. Polling goes on.
         */
        public WaitOptions onInputRequired(Consumer<Task> onInputRequired) {
            this.onInputRequired = onInputRequired;
            return this;
        }
    }

    /** Calls {@code human.ask}; returns the task handle without waiting for a human. */
    public Task ask(AskRequest request) {
        return call(Tools.ASK_TOOL, request);
    }

    /** Calls {@code human.approve}; returns the task handle without waiting for a human. */
    public Task approve(ApproveRequest request) {
        return call(Tools.APPROVE_TOOL, request);
    }

    /** {@code tasks/get}. Prefer {@code waitForTerminal}, which respects {@code pollInterval}. */
    public Task get(String taskId) {
        try {
            return transport.getTask(taskId);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new HitlpTransportException("tasks/get " + taskId + " failed", e);
        }
    }

    /** {@code tasks/cancel}. */
    public Task cancel(String taskId) {
        try {
            return transport.cancelTask(taskId);
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new HitlpTransportException("tasks/cancel " + taskId + " failed", e);
        }
    }

    public Task waitForTerminal(Task task) throws InterruptedException {
        return waitForTerminal(task, new WaitOptions());
    }

    public Task waitForTerminal(String taskId) throws InterruptedException {
        return waitForTerminal(get(taskId), new WaitOptions());
    }

    public Task waitForTerminal(String taskId, WaitOptions options) throws InterruptedException {
        if (options.signal != null) options.signal.throwIfCancelled();
        return waitForTerminal(get(taskId), options);
    }

    /**
     * Polls {@code tasks/get} until the task is terminal, never more often than the
     * server's {@code pollInterval} (spec 7.4), and validates the decision record.
     * Throws {@link java.util.concurrent.CancellationException} when the signal is cancelled.
     */
    public Task waitForTerminal(Task task, WaitOptions options) throws InterruptedException {
        TaskStatus previous = null;
        while (!task.status().isTerminal()) {
            if (options.signal != null) options.signal.throwIfCancelled();
            if (task.status() == TaskStatus.INPUT_REQUIRED && previous != TaskStatus.INPUT_REQUIRED
                    && options.onInputRequired != null) {
                options.onInputRequired.accept(task);
            }
            previous = task.status();
            long interval = task.pollInterval() != null ? task.pollInterval() : defaultPollInterval;
            sleeper.sleep(Math.max(interval, 0), options.signal);
            task = get(task.taskId());
        }
        DecisionRecord r = task.result();
        if (r != null) {
            Validation.assertValid("approve".equals(r.primitive()) ? SchemaName.APPROVE_RESPONSE : SchemaName.ASK_RESPONSE, r);
        }
        return task;
    }

    public Resolution resume(Checkpoint checkpoint) throws InterruptedException {
        return resume(checkpoint, new WaitOptions());
    }

    /** Waits for a checkpointed task and interprets how it ended (rule R3). */
    public Resolution resume(Checkpoint checkpoint, WaitOptions options) throws InterruptedException {
        Task task = waitForTerminal(checkpoint.taskId(), options);
        DecisionRecord r = task.result();
        if (r != null && (!checkpoint.idempotencyKey().equals(r.idempotencyKey()) || !checkpoint.primitive().wire().equals(r.primitive()))) {
            throw new IllegalStateException("task " + checkpoint.taskId() + " does not match its checkpoint");
        }
        return Decisions.resolve(task);
    }

    private Task call(String name, Request request) {
        Tools.assertCallableTool(name);
        Validation.assertValid(request.primitive() == Primitive.ASK ? SchemaName.ASK_REQUEST : SchemaName.APPROVE_REQUEST, request);
        // Every attempt sends the same arguments, so the same idempotency key (R4):
        // a retry after a lost response returns the existing handle.
        Exception last = null;
        for (int attempt = 0; attempt <= callRetries; attempt++) {
            try {
                return transport.callTool(name, request.toMap());
            } catch (Exception e) {
                last = e;
            }
        }
        if (last instanceof RuntimeException re) throw re;
        throw new HitlpTransportException("tools/call " + name + " failed", last);
    }
}
