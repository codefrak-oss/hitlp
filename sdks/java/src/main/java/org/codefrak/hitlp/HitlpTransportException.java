package org.codefrak.hitlp;

/** A checked exception from the {@link TaskTransport}, rethrown unchecked by the client. */
public class HitlpTransportException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    public HitlpTransportException(String message, Throwable cause) {
        super(message, cause);
    }
}
