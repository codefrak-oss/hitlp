package org.codefrak.hitlp;

import java.time.Instant;
import java.util.Map;

/**
 * Envelope fields a builder takes (spec section 5); the key and priority get
 * defaults. Fluent: each setter returns this.
 */
public class EnvelopeInput<T extends EnvelopeInput<T>> {
    String idempotencyKey;
    String deadline;
    String defaultOnTimeout;
    String priority;
    Map<String, ?> requires;
    Map<String, ?> context;
    Boolean requiresHuman;
    Map<String, ?> asserted;

    @SuppressWarnings("unchecked")
    private T self() {
        return (T) this;
    }

    /** Defaults to a fresh key. Pass the stored key when re-building a retried request. */
    public T idempotencyKey(String key) {
        this.idempotencyKey = key;
        return self();
    }

    public T deadline(Instant deadline) {
        this.deadline = deadline.toString();
        return self();
    }

    /** An RFC 3339 date-time. */
    public T deadline(String deadline) {
        this.deadline = deadline;
        return self();
    }

    /** {@code reject}, {@code escalate}, {@code cancel} or {@code fail}. */
    public T defaultOnTimeout(String defaultOnTimeout) {
        this.defaultOnTimeout = defaultOnTimeout;
        return self();
    }

    /** {@code low}, {@code normal} (the default), {@code high} or {@code urgent}. */
    public T priority(String priority) {
        this.priority = priority;
        return self();
    }

    /** {@code {capabilities?, roles?}}. */
    public T requires(Map<String, ?> requires) {
        this.requires = requires;
        return self();
    }

    /** {@code {summary?, links?, data?}}. */
    public T context(Map<String, ?> context) {
        this.context = context;
        return self();
    }

    /** True skips the proxy's rule and model layers (spec 5.4). */
    public T requiresHuman(boolean requiresHuman) {
        this.requiresHuman = requiresHuman;
        return self();
    }

    /** {@code {why?, onBehalfOf?, recommendation?, lineage?, asOf?}}: what the requester says (spec 5.1). */
    public T asserted(Map<String, ?> asserted) {
        this.asserted = asserted;
        return self();
    }

    /** The plain envelope input, for {@link Envelope#buildEnvelope}. */
    public static final class Plain extends EnvelopeInput<Plain> {}
}
