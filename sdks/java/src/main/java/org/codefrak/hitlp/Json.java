package org.codefrak.hitlp;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;

/** JSON plumbing shared by the SDK: one ObjectMapper, plain values in and out. */
final class Json {
    static final ObjectMapper MAPPER = new ObjectMapper();
    private static final TypeReference<Map<String, Object>> MAP = new TypeReference<>() {};

    private Json() {}

    static JsonNode toNode(Object value) {
        return MAPPER.valueToTree(value);
    }

    /** A deep, mutable copy of a JSON object made of plain values. */
    static Map<String, Object> copy(Map<String, ?> value) {
        return MAPPER.convertValue(value, MAP);
    }

    static Map<String, Object> parseObject(String text) {
        try {
            return MAPPER.readValue(text, MAP);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("not a JSON object: " + e.getOriginalMessage(), e);
        }
    }

    static String write(Object value) {
        try {
            return MAPPER.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException(e);
        }
    }
}
