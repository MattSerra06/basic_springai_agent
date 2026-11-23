package io.github.mattserra06.agent;

import java.time.Duration;
import java.util.List;

import io.github.mattserra06.agent.chat.ChatEvent;
import io.github.mattserra06.agent.chat.ChatService;
import io.github.mattserra06.agent.chat.RunEvent;
import io.github.mattserra06.agent.chat.RunStore;
import io.github.mattserra06.agent.openui.OpenUiProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The generated interface: the model is taught OpenUI Lang by the system prompt, and
 * what it writes reaches the client untouched, as the text of the reply.
 */
@SpringBootTest(properties = {
        "spring.ai.openai.api-key=test",
        "spring.datasource.url=jdbc:h2:mem:generated-interface-test;DB_CLOSE_DELAY=-1",
        "agent.linkup.api-key=" })
class GeneratedInterfaceTest {

    private static final Duration TIMEOUT = Duration.ofSeconds(10);

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

    @Autowired
    OpenUiProperties openUi;

    @BeforeEach
    void reset() {
        model.reset();
    }

    @Test
    void theSystemPromptEndsWithTheOpenUiPromptWordForWord() {
        answer("Bonjour");

        String system = systemPrompt();
        // The agent's own instructions come first, the language of the replies last
        assertThat(system).startsWith("You are a helpful assistant.");
        assertThat(system).endsWith(openUi.instructions());
        // Braces and backslashes of the prompt are not taken for a template's
        assertThat(system)
                .contains("root = Response(")
                .contains("sources?: {title: string, url: string, publisher?: string}[]")
                .contains("{ required: true, email: true")
                .contains("separated by \\n\\n");
    }

    @Test
    void theGeneratedPromptTeachesTheCatalogueOfTheFrontend() {
        assertThat(openUi.instructions())
                .contains("TextContent(text: string")
                .contains("Table(headers: string[]")
                .contains("Map(markers: Marker[]")
                .contains("Form(name: string, buttons: Buttons, fields: FormControl[])")
                .contains("@ToAssistant")
                // The open-source prompt, not the configuration block of OpenUI's gateway
                .doesNotContain("openui:config");
    }

    @Test
    void aReplyInOpenUiLangIsStreamedAsItIsWritten() {
        String program = """
                root = Response([t, tbl], srcs)
                t = TextContent("Deux offres, \\"Basique\\" et {Pro} [1].")
                tbl = Table(["Offre", "Prix"], [["Basique", 9], ["Pro", 19]])
                srcs = [{title: "Tarifs", url: "https://example.com/tarifs"}]""";
        model.repliesWith(program.substring(0, 40), program.substring(40));

        List<ChatEvent> events = answer("Compare les offres");

        assertThat(events).last().isEqualTo(new ChatEvent.Done(false));
        assertThat(events.stream()
                .filter(ChatEvent.Text.class::isInstance)
                .map(event -> ((ChatEvent.Text) event).text())
                .reduce("", String::concat)).isEqualTo(program);
    }

    private List<ChatEvent> answer(String message) {
        String runId = chatService.start(null, message, null, null).runId();
        return runs.events(runId, 0).map(RunEvent::event).collectList().block(TIMEOUT);
    }

    private String systemPrompt() {
        return model.prompts.getLast().getInstructions().stream()
                .filter(message -> message.getMessageType() == MessageType.SYSTEM)
                .map(Message::getText)
                .reduce("", String::concat);
    }
}
