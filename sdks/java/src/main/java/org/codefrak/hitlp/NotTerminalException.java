package org.codefrak.hitlp;

/** {@link Decisions#resolve} was given a task that is still running. */
public class NotTerminalException extends IllegalStateException {
    private static final long serialVersionUID = 1L;

    public NotTerminalException(Task task) {
        super("task " + task.taskId() + " is " + task.status().wire() + ", not terminal");
    }
}
