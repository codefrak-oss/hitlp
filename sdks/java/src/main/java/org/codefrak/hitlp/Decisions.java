package org.codefrak.hitlp;

/** Interpreting decision records and terminal tasks (spec sections 6, 7.3). */
public final class Decisions {
    private Decisions() {}

    /**
     * True only for an {@code approved} Approve decision. Any other terminal state,
     * a timeout included, is not approval (rule R2). When the request carried a
     * {@code payloadDigest}, the record must carry the same one (spec 4.2).
     */
    public static boolean isApproved(DecisionRecord record, String requestPayloadDigest) {
        if (record == null || !"approve".equals(record.primitive()) || !"approved".equals(record.outcome())) return false;
        return verifyPayloadDigest(record, requestPayloadDigest);
    }

    public static boolean isApproved(DecisionRecord record, Request request) {
        return isApproved(record, request == null ? null : request.payloadDigest());
    }

    public static boolean isApproved(DecisionRecord record, Checkpoint checkpoint) {
        return isApproved(record, checkpoint == null ? null : checkpoint.payloadDigest());
    }

    /** Without a request: true for any {@code approved} Approve decision. */
    public static boolean isApproved(DecisionRecord record) {
        return isApproved(record, (String) null);
    }

    /**
     * Checks that the record is bound to the payload the request sent. True when
     * the request had no digest; false when it had one the record does not repeat.
     */
    public static boolean verifyPayloadDigest(DecisionRecord record, String requestPayloadDigest) {
        if (requestPayloadDigest == null) return true;
        return requestPayloadDigest.equals(record.payloadDigest());
    }

    public static boolean verifyPayloadDigest(DecisionRecord record, Request request) {
        return verifyPayloadDigest(record, request == null ? null : request.payloadDigest());
    }

    /** The answer of an {@code answered} Ask decision, or null for any other outcome. */
    public static Object answerOf(DecisionRecord record) {
        return record != null && "ask".equals(record.primitive()) && "answered".equals(record.outcome()) ? record.answer() : null;
    }

    /** {@link #answerOf(DecisionRecord)}, cast to the type the response schema promises. */
    public static <T> T answerOf(DecisionRecord record, Class<T> type) {
        return type.cast(answerOf(record));
    }

    /** Interprets a terminal task. Throws {@link NotTerminalException} for a task that is still running. */
    public static Resolution resolve(Task task) {
        if (!task.status().isTerminal()) throw new NotTerminalException(task);
        if (task.status() == TaskStatus.COMPLETED) {
            if (task.result() == null) {
                throw new IllegalStateException("task " + task.taskId() + " is completed without a decision record");
            }
            return new Resolution(Resolution.Kind.DECIDED, task.result(), null);
        }
        Resolution.Kind kind = task.status() == TaskStatus.FAILED ? Resolution.Kind.FAILED : Resolution.Kind.CANCELLED;
        return new Resolution(kind, task.result(), task.statusMessage());
    }
}
