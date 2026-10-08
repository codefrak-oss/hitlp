package org.codefrak.hitlp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class BuildersTest {
    @Test
    void buildAskProducesFlatHumanAskArgumentsWithEnvelopeDefaults() {
        AskRequest req = Ask.buildAsk(Ask.input()
                .idempotencyKey("inv-993-currency")
                .deadline(Instant.parse("2026-10-09T09:00:00Z"))
                .defaultOnTimeout("escalate")
                .requires(Map.of("capabilities", List.of("finance.invoice")))
                .question("Which currency is invoice 993 in?")
                .responseSchema(Map.of("type", "string", "enum", List.of("EUR", "USD", "GBP"))));
        Map<String, Object> want = new LinkedHashMap<>();
        want.put("idempotencyKey", "inv-993-currency");
        want.put("deadline", "2026-10-09T09:00:00Z");
        want.put("defaultOnTimeout", "escalate");
        want.put("priority", "normal");
        want.put("requires", Map.of("capabilities", List.of("finance.invoice")));
        want.put("question", "Which currency is invoice 993 in?");
        want.put("responseSchema", Map.of("type", "string", "enum", List.of("EUR", "USD", "GBP")));
        assertEquals(want, req.toMap());
        assertTrue(Validation.validate("ask.request", req).valid());
    }

    @Test
    void buildApproveDefaultsDefaultOnTimeoutToRejectAndMintsAKey() {
        ApproveRequest req = Approve.buildApprove(Approve.input()
                .deadline("2026-10-15T12:00:00Z")
                .action("Deploy release 4.21 to production")
                .payload(Map.of("service", "billing", "version", "4.21.0"))
                .payloadDigest("sha256:9f2c1e0a")
                .scope(Map.of("maxUses", 1, "notAfter", "2026-10-16T00:00:00Z")));
        assertEquals("reject", req.defaultOnTimeout());
        assertFalse(req.idempotencyKey().isEmpty());
        assertTrue(Validation.validate(SchemaName.APPROVE_REQUEST, req).valid());
    }

    @Test
    void buildEnvelopeGivesAValidEnvelope() {
        Map<String, Object> env = Envelope.buildEnvelope(Envelope.input().deadline("2026-10-15T12:00:00Z").defaultOnTimeout("fail"));
        assertTrue(Validation.validate(SchemaName.ENVELOPE, env).valid());
    }

    @Test
    void buildersRefuseRequestsTheSchemaRejects() {
        assertThrows(HitlpValidationException.class, () -> Ask.buildAsk(Ask.input()
                .deadline("soon").defaultOnTimeout("fail").question("q").responseSchema(Map.of("type", "string"))));
        assertThrows(HitlpValidationException.class, () -> Approve.buildApprove(Approve.input()
                .deadline("2026-10-15T12:00:00Z").action("").payload(Map.of())));
    }

    @Test
    void eachNewRequestGetsAFreshIdempotencyKey() {
        Approve.Input input = Approve.input().deadline("2026-10-15T12:00:00Z").action("x").payload(Map.of());
        assertNotEquals(Approve.buildApprove(input).idempotencyKey(), Approve.buildApprove(input).idempotencyKey());
        assertTrue(Idempotency.newIdempotencyKey("inv").startsWith("inv-"));
    }
}
