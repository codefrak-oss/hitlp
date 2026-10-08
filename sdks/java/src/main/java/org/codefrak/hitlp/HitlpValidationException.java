package org.codefrak.hitlp;

import java.util.List;

/** A request or decision record that its schema rejects. */
public class HitlpValidationException extends IllegalArgumentException {
    private static final long serialVersionUID = 1L;

    private final SchemaName schema;
    private final transient List<String> errors;

    public HitlpValidationException(SchemaName schema, List<String> errors) {
        super("invalid " + schema.id() + ": " + String.join("; ", errors));
        this.schema = schema;
        this.errors = List.copyOf(errors);
    }

    public SchemaName schema() {
        return schema;
    }

    public List<String> errors() {
        return errors;
    }
}
