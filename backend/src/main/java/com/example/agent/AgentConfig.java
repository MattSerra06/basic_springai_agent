package com.example.agent;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.session.SessionService;
import org.springframework.ai.session.advisor.SessionAdvisors;
import org.springframework.ai.session.tool.SessionRecallTools;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AgentConfig {

    /**
     * The agent's ChatClient. Every call runs on a session: the session advisors prepend
     * the stored history to the prompt and store the new messages, and
     * {@code conversation_search} lets the model find messages a compaction took out of
     * its context. Compaction itself runs between turns, see
     * {@link com.example.agent.session.SessionCompactor}.
     */
    @Bean
    ChatClient agentChatClient(ChatClient.Builder builder, SessionService sessionService,
                               AgentProperties properties) {
        return builder
                .defaultSystem(properties.systemPrompt())
                .defaultAdvisors(SessionAdvisors.builder(sessionService).sessionIdInToolContext(true).build())
                .defaultTools(SessionRecallTools.builder(sessionService).build())
                .build();
    }
}
