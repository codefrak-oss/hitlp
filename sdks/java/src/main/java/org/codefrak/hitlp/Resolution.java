package org.codefrak.hitlp;

/**
 * How a terminal task ended, from the agent's point of view (spec 7.3).
 *
 * @param kind decided, failed or cancelled
 * @param record the decision record; always present when decided, else maybe null
 * @param message the server's status message for failed or cancelled, or null
 */
public record Resolution(Kind kind, DecisionRecord record, String message) {
    public enum Kind {
        DECIDED,
        FAILED,
        CANCELLED
    }
}
