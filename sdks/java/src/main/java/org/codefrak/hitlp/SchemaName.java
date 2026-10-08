package org.codefrak.hitlp;

/** The spec's schemas, vendored in {@code src/main/resources/hitlp/schemas}. */
public enum SchemaName {
    ENVELOPE("envelope"),
    DECISION_RECORD("decision-record"),
    ASK_REQUEST("ask.request"),
    ASK_RESPONSE("ask.response"),
    APPROVE_REQUEST("approve.request"),
    APPROVE_RESPONSE("approve.response");

    private final String id;

    SchemaName(String id) {
        this.id = id;
    }

    /** The name the spec uses, e.g. {@code "ask.request"}. */
    public String id() {
        return id;
    }

    public static SchemaName fromId(String id) {
        for (SchemaName n : values()) if (n.id.equals(id)) return n;
        throw new IllegalArgumentException("unknown schema " + id);
    }
}
