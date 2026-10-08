package org.codefrak.hitlp;

import java.util.UUID;

/** Idempotency keys (rule R4). */
public final class Idempotency {
    private Idempotency() {}

    /**
     * A fresh idempotency key for a new logical request (rule R4). Reuse the key
     * you got here on every retry of that request; never mint a new one to retry.
     */
    public static String newIdempotencyKey() {
        return newIdempotencyKey(null);
    }

    public static String newIdempotencyKey(String prefix) {
        String id = UUID.randomUUID().toString();
        return prefix != null && !prefix.isEmpty() ? prefix + "-" + id : id;
    }
}
