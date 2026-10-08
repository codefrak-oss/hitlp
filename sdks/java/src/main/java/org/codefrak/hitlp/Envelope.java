package org.codefrak.hitlp;

import java.util.LinkedHashMap;
import java.util.Map;

/** The common request envelope (spec section 5). */
public final class Envelope {
    private Envelope() {}

    public static EnvelopeInput.Plain input() {
        return new EnvelopeInput.Plain();
    }

    /** The envelope fields, with a fresh idempotency key and priority {@code normal} by default. Not validated. */
    public static Map<String, Object> buildEnvelope(EnvelopeInput<?> input) {
        Map<String, Object> env = new LinkedHashMap<>();
        env.put("idempotencyKey", input.idempotencyKey != null ? input.idempotencyKey : Idempotency.newIdempotencyKey());
        env.put("deadline", input.deadline);
        env.put("defaultOnTimeout", input.defaultOnTimeout);
        env.put("priority", input.priority != null ? input.priority : "normal");
        if (input.requires != null) env.put("requires", input.requires);
        if (input.context != null) env.put("context", input.context);
        if (input.requester != null) env.put("requester", input.requester);
        return env;
    }
}
