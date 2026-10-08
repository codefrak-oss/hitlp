package org.codefrak.hitlp;

/** MCP Tasks statuses (spec 7.3). */
public enum TaskStatus {
    WORKING("working"),
    INPUT_REQUIRED("input_required"),
    COMPLETED("completed"),
    FAILED("failed"),
    CANCELLED("cancelled");

    private final String wire;

    TaskStatus(String wire) {
        this.wire = wire;
    }

    public String wire() {
        return wire;
    }

    /** True for {@code completed}, {@code failed} and {@code cancelled}. */
    public boolean isTerminal() {
        return this == COMPLETED || this == FAILED || this == CANCELLED;
    }

    public static TaskStatus fromWire(String value) {
        for (TaskStatus s : values()) if (s.wire.equals(value)) return s;
        throw new IllegalArgumentException("not an MCP task status: " + value);
    }
}
