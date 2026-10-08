package org.codefrak.hitlp;

import java.util.List;

/** The v1 tool names (spec 7.1) and the reserved ones (spec section 4). */
public final class Tools {
    public static final String ASK_TOOL = "human.ask";
    public static final String APPROVE_TOOL = "human.approve";
    /** Reserved by the spec (section 4); never callable through this SDK. */
    public static final List<String> RESERVED_TOOLS = List.of("human.do", "human.inform", "human.escalate");

    private Tools() {}

    /** Throws {@link ReservedToolException} for a reserved name, and for any other non-v1 tool. */
    public static void assertCallableTool(String name) {
        if (RESERVED_TOOLS.contains(name)) throw new ReservedToolException(name);
        if (!ASK_TOOL.equals(name) && !APPROVE_TOOL.equals(name)) {
            throw new IllegalArgumentException(name + " is not a HITLP v1 tool");
        }
    }
}
