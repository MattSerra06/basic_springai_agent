package com.example.agent;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

/**
 * Settings of the agent, under {@code agent} in application.yaml.
 *
 * @param systemPrompt the system prompt sent with every request
 * @param user the owner of every session; there is no login yet, so one fixed name
 * @param compaction when and how much of a long conversation is summarized
 */
@Validated
@ConfigurationProperties("agent")
public record AgentProperties(@NotBlank String systemPrompt, @NotBlank String user,
                              @NotNull @Valid Compaction compaction) {

    /**
     * @param triggerTokens estimated size of the conversation sent to the model at which
     * a compaction runs
     * @param keepTokens how much of the most recent conversation stays verbatim; what is
     * older is replaced by a summary
     */
    public record Compaction(@Positive int triggerTokens, @Positive int keepTokens) {
    }
}
