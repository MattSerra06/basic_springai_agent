package io.github.mattserra06.agent;

import java.time.Duration;

import io.github.mattserra06.agent.chat.ChatService;
import io.github.mattserra06.agent.chat.RunStore;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.ToolCallingChatOptions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import static org.assertj.core.api.Assertions.assertThat;

/** The agent without a Linkup API key: it starts and answers, without the web tools. */
@SpringBootTest(properties = {
        "spring.ai.openai.api-key=test",
        "spring.datasource.url=jdbc:h2:mem:web-tools-off-test;DB_CLOSE_DELAY=-1",
        "agent.linkup.api-key=",
        "agent.eodhd.api-key=" })
class WebToolsOffTest {

    @TestConfiguration
    static class StubModelConfig {

        @Bean
        @Primary
        StubChatModel stubChatModel() {
            return new StubChatModel();
        }
    }

    @Autowired
    ChatService chatService;

    @Autowired
    RunStore runs;

    @Autowired
    StubChatModel model;

    @Test
    void theModelIsNotGivenTheWebToolsNorToldAboutThem() {
        String runId = chatService.start(null, "Bonjour", null, null).runId();
        runs.events(runId, 0).collectList().block(Duration.ofSeconds(10));

        Prompt prompt = model.prompts.getLast();
        assertThat(((ToolCallingChatOptions) prompt.getOptions()).getToolCallbacks())
                .extracting(tool -> tool.getToolDefinition().name())
                .containsExactly("conversation_search");
        assertThat(prompt.getInstructions())
                .filteredOn(message -> message.getMessageType() == MessageType.SYSTEM)
                .singleElement()
                .satisfies(system -> assertThat(system.getText()).doesNotContain("linkup"));
    }
}
