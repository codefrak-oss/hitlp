package org.codefrak.hitlp;

/** Thrown for {@code human.do}, {@code human.inform} and {@code human.escalate}. */
public class ReservedToolException extends IllegalArgumentException {
    private static final long serialVersionUID = 1L;

    public ReservedToolException(String name) {
        super(name + " is reserved by HITLP v1 and must not be called");
    }
}
