package org.codefrak.hitlp;

import java.util.Map;

/** {@code human.ask} arguments (spec 4.1, 7.1). Construct with {@link #of}, which validates. */
public final class AskRequest extends Request {
    private AskRequest(Map<String, Object> fields) {
        super(fields);
    }

    /** Validates the arguments against {@code ask.request}; throws {@link HitlpValidationException}. */
    public static AskRequest of(Map<String, ?> fields) {
        Validation.assertValid(SchemaName.ASK_REQUEST, fields);
        return new AskRequest(Json.copy(fields));
    }

    @Override
    public Primitive primitive() {
        return Primitive.ASK;
    }

    public String question() {
        return (String) get("question");
    }
}
