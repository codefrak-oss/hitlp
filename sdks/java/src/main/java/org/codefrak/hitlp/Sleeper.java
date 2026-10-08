package org.codefrak.hitlp;

/** How the client waits between polls; injectable for tests. */
@FunctionalInterface
public interface Sleeper {
    /** Sleeps {@code millis}; with a signal, throws {@link java.util.concurrent.CancellationException} on cancel. */
    void sleep(long millis, CancelSignal signal) throws InterruptedException;

    Sleeper REAL = (millis, signal) -> {
        if (signal == null) Thread.sleep(millis);
        else signal.sleep(millis);
    };
}
