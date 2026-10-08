package org.codefrak.hitlp;

import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaValidatorsConfig;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Validation against the spec's JSON schemas (2020-12, formats asserted), vendored
 * from spec/schemas by sdks/scripts/sync-schemas.mjs.
 */
public final class Validation {
    private static final String ID = "https://github.com/codefrak-oss/hitlp/spec/schemas/";
    private static final Map<SchemaName, JsonSchema> SCHEMAS = new EnumMap<>(SchemaName.class);

    static {
        JsonSchemaFactory factory = JsonSchemaFactory.getInstance(
                SpecVersion.VersionFlag.V202012,
                b -> b.schemaMappers(m -> m.mapPrefix(ID, "classpath:hitlp/schemas/")));
        SchemaValidatorsConfig config = SchemaValidatorsConfig.builder().formatAssertionsEnabled(true).build();
        for (SchemaName name : SchemaName.values()) {
            JsonSchema schema = factory.getSchema(SchemaLocation.of(ID + name.id() + ".schema.json"), config);
            schema.initializeValidators();
            SCHEMAS.put(name, schema);
        }
    }

    private Validation() {}

    /** Validates a value (plain JSON values, or a {@link Request}) against one of the spec's schemas. */
    public static ValidationResult validate(SchemaName schema, Object value) {
        Object plain = value instanceof Request r ? r.toMap() : value instanceof DecisionRecord d ? d.toMap() : value;
        Set<ValidationMessage> messages = SCHEMAS.get(schema).validate(Json.toNode(plain));
        List<String> errors = messages.stream().map(ValidationMessage::getMessage).sorted().toList();
        return new ValidationResult(errors.isEmpty(), errors);
    }

    /** Validates against the schema the spec names, e.g. {@code "ask.request"}. */
    public static ValidationResult validate(String schema, Object value) {
        return validate(SchemaName.fromId(schema), value);
    }

    /** Throws {@link HitlpValidationException} unless the value is valid. */
    public static void assertValid(SchemaName schema, Object value) {
        ValidationResult r = validate(schema, value);
        if (!r.valid()) throw new HitlpValidationException(schema, r.errors());
    }
}
