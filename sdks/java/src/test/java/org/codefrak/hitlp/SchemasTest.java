package org.codefrak.hitlp;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.io.InputStream;
import java.util.Map;
import java.util.function.Consumer;
import java.util.stream.Stream;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.api.Test;

class SchemasTest {
    // src/test/resources/hitlp/examples is vendored from spec/examples.
    static Map<String, Object> load(String file) throws IOException {
        try (InputStream in = SchemasTest.class.getResourceAsStream("/hitlp/examples/" + file)) {
            return new ObjectMapper().readValue(in, new TypeReference<Map<String, Object>>() {});
        }
    }

    @ParameterizedTest(name = "spec example {0} validates against {1}")
    @CsvSource({
        "ask.request.json, ask.request",
        "ask.response.json, ask.response",
        "approve.request.json, approve.request",
        "approve.response.json, approve.response",
    })
    void specExampleValidates(String file, String schema) throws IOException {
        ValidationResult r = Validation.validate(schema, load(file));
        assertTrue(r.valid(), String.join("; ", r.errors()));
    }

    static Stream<Arguments> invalid() {
        return Stream.of(
                bad("missing deadline", "ask.request", v -> v.remove("deadline")),
                bad("bad defaultOnTimeout", "approve.request", v -> v.put("defaultOnTimeout", "approve")),
                bad("deadline not a date-time", "approve.request", v -> v.put("deadline", "tomorrow")),
                bad("ask without responseSchema", "ask.request", v -> v.remove("responseSchema")),
                bad("answered without answer", "ask.response", v -> v.remove("answer")),
                bad("timed_out decided by a human", "ask.response", v -> {
                    v.put("outcome", "timed_out");
                    v.remove("answer");
                }),
                bad("approve result with an answer", "approve.response", v -> v.put("answer", "yes")),
                bad("ask result with outcome approved", "ask.response", v -> v.put("outcome", "approved")));
    }

    static Arguments bad(String name, String schema, Consumer<Map<String, Object>> mutate) {
        return Arguments.of(name, schema, mutate);
    }

    @ParameterizedTest(name = "rejects: {0}")
    @MethodSource("invalid")
    void rejects(String name, String schema, Consumer<Map<String, Object>> mutate) throws IOException {
        Map<String, Object> v = load(schema + ".json");
        mutate.accept(v);
        assertFalse(Validation.validate(schema, v).valid());
    }

    @Test
    void unknownSchemaIsAnError() {
        assertThrows(IllegalArgumentException.class, () -> Validation.validate("nope", Map.of()));
    }
}
