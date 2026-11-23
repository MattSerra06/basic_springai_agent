package io.github.mattserra06.agent.dashboard;

import java.time.Duration;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Settings of the dashboards, under {@code agent.dashboards} in application.yaml.
 *
 * @param cache how long the answer of a data tool is given again to an interface that
 * asks the same thing
 * @param maxResultChars the longest answer of a data tool an interface may load; a longer
 * one is a failure, since half a JSON document cannot be drawn
 * @param instructions added to the system prompt when interfaces have data tools;
 * {@code {tools}} stands for their names
 */
@Validated
@ConfigurationProperties("agent.dashboards")
public record DashboardProperties(@NotNull Duration cache, @Positive int maxResultChars,
                                  @NotBlank String instructions) {

    /** The instructions, naming the tools. */
    public String instructions(Iterable<String> tools) {
        return instructions.strip().replace("{tools}", String.join(", ", tools));
    }
}
