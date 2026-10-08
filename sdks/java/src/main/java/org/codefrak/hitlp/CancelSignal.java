package org.codefrak.hitlp;

import java.util.concurrent.CancellationException;

/**
 * Cancels a {@link HitlpClient#waitForTerminal} from another thread, the way an
 * {@code AbortSignal} does in the TypeScript SDK. Cancelling stops the wait only;
 * call {@link HitlpClient#cancel} to cancel the task itself.
 */
public final class CancelSignal {
    private volatile String reason;

    public synchronized void cancel(String reason) {
        if (this.reason != null) return;
        this.reason = reason != null ? reason : "cancelled";
        notifyAll();
    }

    public boolean isCancelled() {
        return reason != null;
    }

    public String reason() {
        return reason;
    }

    /** Throws {@link CancellationException} with the reason once cancelled. */
    public void throwIfCancelled() {
        String r = reason;
        if (r != null) throw new CancellationException(r);
    }

    /** Sleeps up to {@code millis}, waking at once on cancel. */
    synchronized void sleep(long millis) throws InterruptedException {
        long until = System.nanoTime() + millis * 1_000_000L;
        long left;
        while (reason == null && (left = until - System.nanoTime()) > 0) {
            wait(Math.max(1, left / 1_000_000L));
        }
        throwIfCancelled();
    }
}
