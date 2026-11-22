package io.github.mattserra06.agent;

import java.time.Clock;
import java.util.ArrayList;
import java.util.List;

import io.github.mattserra06.agent.chat.AgentTools;
import io.github.mattserra06.agent.linkup.LinkupClient;
import io.github.mattserra06.agent.linkup.LinkupProperties;
import io.github.mattserra06.agent.linkup.LinkupResearchTools;
import io.github.mattserra06.agent.linkup.LinkupTools;
import io.github.mattserra06.agent.openui.OpenUiProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.session.SessionService;
import org.springframework.ai.session.advisor.SessionAdvisors;
import org.springframework.ai.session.tool.SessionRecallTools;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AgentConfig {

    private static final Logger log = LoggerFactory.getLogger(AgentConfig.class);

    /**
     * The agent's ChatClient. Every call runs on a session: the session advisors prepend
     * the stored history to the prompt and store the new messages, and
     * {@code conversation_search} lets the model find messages a compaction took out of
     * its context. Compaction itself runs between turns, see
     * {@link io.github.mattserra06.agent.session.SessionCompactor}.
     * <p>
     * With a Linkup API key the model also gets the web tools, and the system prompt
     * says so; without one the agent simply runs without them.
     * <p>
     * With the generated interface on, the system prompt ends with the OpenUI prompt:
     * the model then writes its replies as component calls, which the frontend draws.
     * Nothing else changes: a reply is still text, streamed through the same events.
     */
    @Bean
    ChatClient agentChatClient(ChatClient.Builder builder, SessionService sessionService,
                               AgentProperties properties, LinkupProperties linkup, OpenUiProperties openUi) {
        String systemPrompt = properties.systemPrompt();
        if (linkup.hasApiKey()) {
            systemPrompt = systemPrompt.strip() + "\n" + linkup.instructions().strip();
        }
        if (openUi.enabled()) {
            systemPrompt = systemPrompt.strip() + "\n\n" + openUi.instructions();
            log.info("Generated interface is on: replies are written in OpenUI Lang");
        }
        else {
            log.info("Generated interface is off: replies are plain text");
        }
        return builder
                .defaultSystem(systemPrompt)
                .defaultAdvisors(SessionAdvisors.builder(sessionService).sessionIdInToolContext(true).build())
                .build();
    }

    /**
     * The tools of the agent. They are not set on the ChatClient: each run hands them to
     * the model itself, so that it hears what every call is for (see {@link AgentTools}).
     */
    @Bean
    AgentTools agentTools(SessionService sessionService, LinkupProperties linkup) {
        List<Object> tools = new ArrayList<>();
        tools.add(SessionRecallTools.builder(sessionService).build());
        if (linkup.hasApiKey()) {
            LinkupClient client = new LinkupClient(linkup);
            tools.add(new LinkupTools(client, linkup, Clock.systemDefaultZone()));
            if (linkup.research().enabled()) {
                tools.add(new LinkupResearchTools(client, linkup));
            }
            log.info("Web tools are on: Linkup search and fetch{}", linkup.research().enabled() ? ", research" : "");
        }
        else {
            log.info("Web tools are off: no Linkup API key (LINKUP_API_KEY)");
        }
        return new AgentTools(tools);
    }
}
