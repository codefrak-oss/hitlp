package org.codefrak.hitlp;

import java.util.List;
import java.util.Map;

/** The Ask primitive (spec 4.1). */
public final class Ask {
    private Ask() {}

    public static Input input() {
        return new Input();
    }

    /** Builds and validates {@code human.ask} arguments. */
    public static AskRequest buildAsk(Input input) {
        Map<String, Object> req = Envelope.buildEnvelope(input);
        req.put("question", input.question);
        req.put("responseSchema", input.responseSchema);
        if (input.options != null) req.put("options", input.options);
        return AskRequest.of(req);
    }

    public static final class Input extends EnvelopeInput<Input> {
        String question;
        Object responseSchema;
        List<Map<String, ?>> options;

        public Input question(String question) {
            this.question = question;
            return this;
        }

        /** JSON Schema for the answer. Free text must be asked for with {@code {type: "string"}} (spec 4.1). */
        public Input responseSchema(Map<String, ?> responseSchema) {
            this.responseSchema = responseSchema;
            return this;
        }

        public Input responseSchema(boolean responseSchema) {
            this.responseSchema = responseSchema;
            return this;
        }

        /** Each {@code {value, label}}. */
        public Input options(List<Map<String, ?>> options) {
            this.options = options;
            return this;
        }
    }
}
