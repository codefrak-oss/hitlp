package org.codefrak.hitlp;

import java.util.List;

/** The outcome of {@link Validation#validate}. */
public record ValidationResult(boolean valid, List<String> errors) {
    public ValidationResult {
        errors = List.copyOf(errors);
    }
}
