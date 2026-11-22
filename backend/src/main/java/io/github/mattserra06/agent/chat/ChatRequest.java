package io.github.mattserra06.agent.chat;

import jakarta.validation.constraints.NotBlank;
import org.jspecify.annotations.Nullable;

/**
 * @param sessionId the conversation to continue, or {@code null} to start a new one
 */
public record ChatRequest(@Nullable String sessionId, @NotBlank String message) {
}
