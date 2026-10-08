package org.codefrak.hitlp;

/** The v1 primitives (spec section 4). */
public enum Primitive {
    ASK("ask"),
    APPROVE("approve");

    private final String wire;

    Primitive(String wire) {
        this.wire = wire;
    }

    /** The value on the wire, e.g. {@code "ask"}. */
    public String wire() {
        return wire;
    }

    /** Parses a wire value; throws for anything else. */
    public static Primitive fromWire(String value) {
        for (Primitive p : values()) if (p.wire.equals(value)) return p;
        throw new IllegalArgumentException("not a HITLP primitive: " + value);
    }
}
