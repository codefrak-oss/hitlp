package org.codefrak.hitlp;

import java.util.Collections;
import java.util.Map;

/**
 * The decision record (spec section 6); it is the task result. A read-only view
 * of the JSON object, with accessors for the fields the SDK interprets.
 */
public final class DecisionRecord {
    private final Map<String, Object> fields;

    private DecisionRecord(Map<String, Object> fields) {
        this.fields = Collections.unmodifiableMap(fields);
    }

    /** Wraps a record as plain JSON values. Not validated: the client validates what the server sends. */
    public static DecisionRecord of(Map<String, ?> fields) {
        return new DecisionRecord(Json.copy(fields));
    }

    public String requestId() {
        return (String) fields.get("requestId");
    }

    public String idempotencyKey() {
        return (String) fields.get("idempotencyKey");
    }

    /** {@code ask} or {@code approve}, as on the wire. */
    public String primitive() {
        return (String) fields.get("primitive");
    }

    /** {@code answered}, {@code approved}, {@code rejected}, {@code timed_out} or {@code cancelled}. */
    public String outcome() {
        return (String) fields.get("outcome");
    }

    /** The raw answer; prefer {@link Decisions#answerOf}. */
    public Object answer() {
        return fields.get("answer");
    }

    public String reason() {
        return (String) fields.get("reason");
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> decidedBy() {
        return (Map<String, Object>) fields.get("decidedBy");
    }

    public String decidedAt() {
        return (String) fields.get("decidedAt");
    }

    public String payloadDigest() {
        return (String) fields.get("payloadDigest");
    }

    public Object get(String field) {
        return fields.get(field);
    }

    public Map<String, Object> toMap() {
        return Json.copy(fields);
    }

    @Override
    public String toString() {
        return Json.write(fields);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof DecisionRecord d && d.fields.equals(fields);
    }

    @Override
    public int hashCode() {
        return fields.hashCode();
    }
}
