package io.github.mattserra06.agent.chat;

import java.time.Duration;
import java.util.List;

import io.github.mattserra06.agent.AgentProperties;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class RunOptionsTest {

    private final RunOptions options = new RunOptions(new AgentProperties("prompt", "user",
            List.of(new AgentProperties.Model("sol", "Sol"), new AgentProperties.Model("astra", "Astra")),
            new AgentProperties.Reasoning(List.of("low", "medium", "high"), "medium", "auto"),
            new AgentProperties.Compaction(100, 10), Duration.ofSeconds(15)));

    @Test
    void offersTheConfiguredChoicesWithTheFirstModelAsDefault() {
        RunOptions.Choices choices = options.choices();

        assertThat(choices.models()).extracting(AgentProperties.Model::id).containsExactly("sol", "astra");
        assertThat(choices.defaultModel()).isEqualTo("sol");
        assertThat(choices.reasoningEfforts()).containsExactly("low", "medium", "high");
        assertThat(choices.defaultReasoningEffort()).isEqualTo("medium");
    }

    @Test
    void usesTheDefaultsForWhatARequestDoesNotChoose() {
        assertThat(options.select(null, null)).isEqualTo(new RunOptions.Selection("sol", "medium", "auto"));
        assertThat(options.select("astra", null)).isEqualTo(new RunOptions.Selection("astra", "medium", "auto"));
        assertThat(options.select(null, "high")).isEqualTo(new RunOptions.Selection("sol", "high", "auto"));
    }

    @Test
    void asksForNoSummaryOfTheReasoningWhenNoneIsConfigured() {
        RunOptions quiet = new RunOptions(new AgentProperties("prompt", "user",
                List.of(new AgentProperties.Model("sol", "Sol")),
                new AgentProperties.Reasoning(List.of("low"), "low", " "),
                new AgentProperties.Compaction(100, 10), Duration.ofSeconds(15)));

        assertThat(quiet.select(null, null)).isEqualTo(new RunOptions.Selection("sol", "low", null));
    }

    @Test
    void refusesWhatIsNotOnOffer() {
        assertThatThrownBy(() -> options.select("other", null)).isInstanceOfSatisfying(
                ResponseStatusException.class, ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThatThrownBy(() -> options.select(null, "max")).isInstanceOfSatisfying(
                ResponseStatusException.class, ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void theDefaultEffortMustBeOneOfTheEffortsOnOffer() {
        assertThatThrownBy(() -> new AgentProperties.Reasoning(List.of("low", "high"), "medium", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("medium");
    }
}
