package org.codefrak.hitlp;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

/**
 * What an agent must store durably before it yields (rule R3): the task id and
 * the idempotency key, plus enough to check the result when it resumes.
 *
 * @param payloadDigest the request's payload digest, or null
 * @param createdAt an RFC 3339 date-time
 */
public record Checkpoint(int version, String taskId, String idempotencyKey, Primitive primitive, String payloadDigest, String createdAt) {
    public Checkpoint {
        Objects.requireNonNull(taskId, "taskId");
        Objects.requireNonNull(idempotencyKey, "idempotencyKey");
        Objects.requireNonNull(primitive, "primitive");
        Objects.requireNonNull(createdAt, "createdAt");
    }

    public static Checkpoint forTask(Task task, Request request, Primitive primitive) {
        return forTask(task, request, primitive, Instant.now());
    }

    public static Checkpoint forTask(Task task, Request request, Primitive primitive, Instant now) {
        return new Checkpoint(1, task.taskId(), request.idempotencyKey(), primitive, request.payloadDigest(), now.toString());
    }

    public String serialize() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("version", version);
        m.put("taskId", taskId);
        m.put("idempotencyKey", idempotencyKey);
        m.put("primitive", primitive.wire());
        if (payloadDigest != null) m.put("payloadDigest", payloadDigest);
        m.put("createdAt", createdAt);
        return Json.write(m);
    }

    /** Parses a serialized checkpoint; throws {@link IllegalArgumentException} for anything else. */
    public static Checkpoint parse(String text) {
        Map<String, Object> m;
        try {
            m = Json.parseObject(text);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("not a HITLP checkpoint", e);
        }
        Object digest = m.get("payloadDigest");
        if (!Integer.valueOf(1).equals(m.get("version"))
                || !(m.get("taskId") instanceof String taskId)
                || !(m.get("idempotencyKey") instanceof String key)
                || !("ask".equals(m.get("primitive")) || "approve".equals(m.get("primitive")))
                || !(m.get("createdAt") instanceof String createdAt)
                || (digest != null && !(digest instanceof String))) {
            throw new IllegalArgumentException("not a HITLP checkpoint");
        }
        return new Checkpoint(1, taskId, key, Primitive.fromWire((String) m.get("primitive")), (String) digest, createdAt);
    }
}
