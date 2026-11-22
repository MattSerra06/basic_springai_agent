package io.github.mattserra06.agent.linkup;

import java.time.Duration;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;

/**
 * Settings of the web tools backed by the Linkup API, under {@code agent.linkup} in
 * application.yaml.
 *
 * @param apiKey the Linkup API key; when it is blank the web tools are not given to the
 * model
 * @param baseUrl the root of the API, version included
 * @param connectTimeout how long a connection to the API may take
 * @param timeout how long one call to the API may take; a deep search takes up to 30 s
 * @param maxResultChars how much text one tool result may carry to the model: a fetched
 * page is cut there, and the passages of a search share it
 * @param instructions added to the system prompt when the web tools are on
 * @param research the research agent, slow and billed per task
 */
@Validated
@ConfigurationProperties("agent.linkup")
public record LinkupProperties(@Nullable String apiKey, @NotBlank String baseUrl, @NotNull Duration connectTimeout,
                               @NotNull Duration timeout, @Positive int maxResultChars, @NotBlank String instructions,
                               @NotNull @Valid Research research) {

    public boolean hasApiKey() {
        return StringUtils.hasText(apiKey);
    }

    /** Never prints the key. */
    @Override
    public String toString() {
        return "LinkupProperties[apiKey=%s, baseUrl=%s, connectTimeout=%s, timeout=%s, maxResultChars=%d, research=%s]"
                .formatted(hasApiKey() ? "***" : "(none)", baseUrl, connectTimeout, timeout, maxResultChars, research);
    }

    /**
     * @param enabled whether the model may start research tasks
     * @param pollInterval how often a running task is checked while the model waits for
     * it; Linkup rate-limits above one request per second
     * @param maxWait the longest one tool call waits for a task before it reports that
     * the task is still running
     */
    public record Research(boolean enabled, @NotNull Duration pollInterval, @NotNull Duration maxWait) {
    }
}
