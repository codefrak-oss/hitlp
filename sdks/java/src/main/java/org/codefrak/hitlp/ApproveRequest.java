package org.codefrak.hitlp;

import java.util.Map;

/** {@code human.approve} arguments (spec 4.2, 7.1). Construct with {@link #of}, which validates. */
public final class ApproveRequest extends Request {
    private ApproveRequest(Map<String, Object> fields) {
        super(fields);
    }

    /** Validates the arguments against {@code approve.request}; throws {@link HitlpValidationException}. */
    public static ApproveRequest of(Map<String, ?> fields) {
        Validation.assertValid(SchemaName.APPROVE_REQUEST, fields);
        return new ApproveRequest(Json.copy(fields));
    }

    @Override
    public Primitive primitive() {
        return Primitive.APPROVE;
    }

    public String action() {
        return (String) get("action");
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> payload() {
        return (Map<String, Object>) get("payload");
    }
}
