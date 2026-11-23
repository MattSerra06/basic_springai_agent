package io.github.mattserra06.agent.eodhd;

import java.time.Duration;
import java.util.List;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.util.StringUtils;
import org.springframework.validation.annotation.Validated;

/**
 * Settings of the market data tools, which are those of the EODHD MCP server, under
 * {@code agent.eodhd} in application.yaml.
 *
 * @param apiKey the EODHD API key; when it is blank the server is not contacted and the
 * model is not given its tools
 * @param baseUrl the root of the MCP server
 * @param endpoint the path of its Streamable HTTP endpoint; the key is added to it as
 * the {@code apikey} parameter, which is how the hosted server takes it
 * @param connectTimeout how long a connection to the server may take
 * @param timeout how long one request to the server, a tool call included, may take
 * @param maxResultChars how much text one tool result may carry to the model; a longer
 * one is cut there
 * @param tools the names of the tools given to the model, among those the server has;
 * empty for all of them
 * @param instructions added to the system prompt when the tools are on
 */
@Validated
@ConfigurationProperties("agent.eodhd")
public record EodhdProperties(@Nullable String apiKey, @NotBlank String baseUrl, @NotBlank String endpoint,
                              @NotNull Duration connectTimeout, @NotNull Duration timeout,
                              @Positive int maxResultChars, @Nullable List<String> tools,
                              @NotBlank String instructions) {

    public EodhdProperties {
        tools = (tools != null) ? List.copyOf(tools) : List.of();
    }

    public boolean hasApiKey() {
        return StringUtils.hasText(apiKey);
    }

    /** Never prints the key. */
    @Override
    public String toString() {
        return "EodhdProperties[apiKey=%s, baseUrl=%s, endpoint=%s, connectTimeout=%s, timeout=%s, maxResultChars=%d, tools=%s]"
                .formatted(hasApiKey() ? "***" : "(none)", baseUrl, endpoint, connectTimeout, timeout, maxResultChars,
                        tools);
    }
}
