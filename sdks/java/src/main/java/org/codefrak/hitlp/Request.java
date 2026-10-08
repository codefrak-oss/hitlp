package org.codefrak.hitlp;

import java.util.Collections;
import java.util.Map;

/**
 * Validated tool arguments: the envelope plus the primitive's body, flattened
 * (spec 7.1). Immutable; {@link #toMap()} gives a fresh copy to send.
 */
public abstract sealed class Request permits AskRequest, ApproveRequest {
    private final Map<String, Object> fields;

    Request(Map<String, Object> fields) {
        this.fields = Collections.unmodifiableMap(Json.copy(fields));
    }

    public abstract Primitive primitive();

    public String idempotencyKey() {
        return (String) fields.get("idempotencyKey");
    }

    public String deadline() {
        return (String) fields.get("deadline");
    }

    public String defaultOnTimeout() {
        return (String) fields.get("defaultOnTimeout");
    }

    /** The payload digest of an Approve request, or null. */
    public String payloadDigest() {
        return (String) fields.get("payloadDigest");
    }

    /** One top-level field, or null. Nested values are read-only views of the request. */
    public Object get(String field) {
        return fields.get(field);
    }

    /** A deep, mutable copy of the arguments, as JSON values. */
    public Map<String, Object> toMap() {
        return Json.copy(fields);
    }

    @Override
    public String toString() {
        return Json.write(fields);
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof Request r && r.getClass() == getClass() && r.fields.equals(fields);
    }

    @Override
    public int hashCode() {
        return fields.hashCode();
    }
}
