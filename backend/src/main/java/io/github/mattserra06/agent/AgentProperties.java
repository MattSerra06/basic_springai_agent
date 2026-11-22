package io.github.mattserra06.agent;

import java.time.Duration;
import java.util.List;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Settings of the agent, under {@code agent} in application.yaml.
 *
 * @param systemPrompt the system prompt sent with every request
 * @param user the owner of every session; there is no login yet, so one fixed name
 * @param models the models a message can be answered with; the first is the default
 * @param reasoning how hard the model can be asked to think
 * @param compaction when and how much of a long conversation is summarized
 * @param streamHeartbeat how often a keep-alive line is sent on an event stream while
 * the model is silent; keep it under the idle timeout of the proxies in front
 */
@Validated
@ConfigurationProperties("agent")
public record AgentProperties(@NotBlank String systemPrompt, @NotBlank String user,
                              @NotEmpty List<@Valid Model> models, @NotNull @Valid Reasoning reasoning,
                              @NotNull @Valid Compaction compaction, @NotNull Duration streamHeartbeat) {

    /**
     * @param id the model name sent to the provider
     * @param label the name shown in the UI
     */
    public record Model(@NotBlank String id, @NotBlank String label) {
    }

    /**
     * @param efforts the reasoning efforts on offer, from the lightest to the heaviest,
     * as the provider names them
     * @param defaultEffort the one used when a message names none; one of
     * {@code efforts}
     * @param summary how the model sums up its reasoning as it goes, as the provider
     * names it; the summary is what the UI shows while the model thinks. Empty to ask
     * for none
     */
    public record Reasoning(@NotEmpty List<@NotBlank String> efforts, @NotBlank String defaultEffort,
                            @Nullable String summary) {

        public Reasoning {
            if (efforts != null && defaultEffort != null && !efforts.contains(defaultEffort)) {
                throw new IllegalArgumentException(
                        "agent.reasoning.default-effort '%s' is not one of agent.reasoning.efforts %s"
                                .formatted(defaultEffort, efforts));
            }
        }
    }

    /**
     * @param triggerTokens estimated size of the conversation sent to the model at which
     * a compaction runs
     * @param keepTokens how much of the most recent conversation stays verbatim; what is
     * older is replaced by a summary
     */
    public record Compaction(@Positive int triggerTokens, @Positive int keepTokens) {
    }
}
