package io.github.mattserra06.agent.chat;

import java.util.List;

import io.github.mattserra06.agent.AgentProperties;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * What can be chosen for a run: the model that answers and how hard it reasons. The
 * choices come from the configuration; a request can only pick among them, so a client
 * cannot make the backend call a model nobody offered.
 */
@Component
public class RunOptions {

    private final List<AgentProperties.Model> models;
    private final AgentProperties.Reasoning reasoning;

    public RunOptions(AgentProperties properties) {
        this.models = List.copyOf(properties.models());
        this.reasoning = properties.reasoning();
    }

    /** The choices and their defaults, for the UI. */
    public Choices choices() {
        return new Choices(models, models.getFirst().id(), reasoning.efforts(), reasoning.defaultEffort());
    }

    /**
     * The settings of a run: what the request asks for, the defaults where it asks for
     * nothing.
     * @throws ResponseStatusException 400 for a model or an effort that is not on offer
     */
    public Selection select(@Nullable String model, @Nullable String reasoningEffort) {
        if (model != null && models.stream().noneMatch(offered -> offered.id().equals(model))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown model " + model);
        }
        if (reasoningEffort != null && !reasoning.efforts().contains(reasoningEffort)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown reasoning effort " + reasoningEffort);
        }
        return new Selection((model != null) ? model : models.getFirst().id(),
                (reasoningEffort != null) ? reasoningEffort : reasoning.defaultEffort());
    }

    /** The settings one run is answered with. */
    public record Selection(String model, String reasoningEffort) {
    }

    /**
     * @param reasoningEfforts from the lightest to the heaviest
     */
    public record Choices(List<AgentProperties.Model> models, String defaultModel, List<String> reasoningEfforts,
                          String defaultReasoningEffort) {
    }
}
