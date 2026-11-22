package io.github.mattserra06.agent.chat;

import jakarta.validation.constraints.NotBlank;
import org.jspecify.annotations.Nullable;

/**
 * The body of {@code POST /api/runs}.
 *
 * @param sessionId the conversation to continue, or {@code null} to start a new one
 * @param model the model that answers, one of those offered; {@code null} for the default
 * @param reasoningEffort how hard the model reasons, one of the efforts offered;
 * {@code null} for the default
 */
public record ChatRequest(@Nullable String sessionId, @NotBlank String message, @Nullable String model,
                          @Nullable String reasoningEffort) {
}
