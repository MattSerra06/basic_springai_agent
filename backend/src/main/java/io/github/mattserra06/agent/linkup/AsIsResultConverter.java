package io.github.mattserra06.agent.linkup;

import java.lang.reflect.Type;

import org.jspecify.annotations.Nullable;
import org.springframework.ai.tool.execution.ToolCallResultConverter;

/**
 * Hands the text a Linkup tool returns to the model as it is. The default converter
 * serializes every result to JSON, a string included: the JSON a tool wrote would reach
 * the model quoted and escaped, and so would a plain message.
 */
public final class AsIsResultConverter implements ToolCallResultConverter {

    @Override
    public String convert(@Nullable Object result, @Nullable Type returnType) {
        return String.valueOf(result);
    }
}
