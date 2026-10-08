package org.codefrak.hitlp;

import java.util.Map;

/** The Approve primitive (spec 4.2). */
public final class Approve {
    private Approve() {}

    public static Input input() {
        return new Input();
    }

    /** Builds and validates {@code human.approve} arguments. */
    public static ApproveRequest buildApprove(Input input) {
        Map<String, Object> req = Envelope.buildEnvelope(input);
        // Defaults to reject, the spec's recommended default for Approve (section 5).
        if (input.defaultOnTimeout == null) req.put("defaultOnTimeout", "reject");
        req.put("action", input.action);
        req.put("payload", input.payload);
        if (input.payloadDigest != null) req.put("payloadDigest", input.payloadDigest);
        if (input.scope != null) req.put("scope", input.scope);
        return ApproveRequest.of(req);
    }

    public static final class Input extends EnvelopeInput<Input> {
        String action;
        Map<String, ?> payload;
        String payloadDigest;
        Map<String, ?> scope;

        public Input action(String action) {
            this.action = action;
            return this;
        }

        public Input payload(Map<String, ?> payload) {
            this.payload = payload;
            return this;
        }

        public Input payloadDigest(String payloadDigest) {
            this.payloadDigest = payloadDigest;
            return this;
        }

        /** {@code {maxUses?, notAfter?}}. */
        public Input scope(Map<String, ?> scope) {
            this.scope = scope;
            return this;
        }
    }
}
