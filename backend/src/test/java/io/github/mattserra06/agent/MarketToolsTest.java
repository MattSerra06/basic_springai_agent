package io.github.mattserra06.agent;

import java.time.Duration;
import java.util.List;

import io.github.mattserra06.agent.chat.ChatEvent;
import io.github.mattserra06.agent.chat.ChatService;
import io.github.mattserra06.agent.chat.RunEvent;
import io.github.mattserra06.agent.chat.RunStore;
import io.github.mattserra06.agent.eodhd.FakeEodhd;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.ToolCallingChatOptions;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import reactor.core.publisher.Flux;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The agent with an EODHD API key: the whole backend with a scripted model, and a local
 * MCP server in place of EODHD's.
 */
@SpringBootTest(properties = {
        "spring.ai.openai.api-key=test",
        "spring.datasource.url=jdbc:h2:mem:market-tools-test;DB_CLOSE_DELAY=-1",
        "agent.linkup.api-key=",
        "agent.eodhd.api-key=" + FakeEodhd.API_KEY,
        "agent.eodhd.tools=get_live_price_data,get_fundamentals_data" })
class MarketToolsTest {

    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    private static final FakeEodhd eodhd = new FakeEodhd();

    @DynamicPropertySource
    static void eodhdServer(DynamicPropertyRegistry registry) {
        registry.add("agent.eodhd.base-url", eodhd::baseUrl);
    }

    @AfterAll
    static void stopServer() {
        eodhd.close();
    }

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

    @BeforeEach
    void reset() {
        model.reset();
    }

    @Test
    void theModelIsGivenTheMarketDataToolsAndToldAboutThem() {
        converse("Bonjour");

        Prompt prompt = model.prompts.getLast();
        assertThat(((ToolCallingChatOptions) prompt.getOptions()).getToolCallbacks())
                .extracting(tool -> tool.getToolDefinition().name())
                .containsExactlyInAnyOrder("conversation_search", "get_live_price_data", "get_fundamentals_data");
        assertThat(prompt.getInstructions().stream()
                .filter(message -> message.getMessageType() == MessageType.SYSTEM)
                .map(Message::getText))
                .singleElement().asString().contains("EODHD", "SYMBOL.EXCHANGE")
                // An interface may load its figures through the same tools, and the model is told which
                .contains("Data tools an interface can call by itself, with Query: "
                        + "get_live_price_data, get_fundamentals_data.");
    }

    @Test
    void aPriceTheModelAsksForComesFromTheServerAndIsToldToTheRun() {
        eodhd.answers("{\"code\":\"AAPL.US\",\"close\":187.2}");
        model.repliesWith(prompt -> {
            if (prompt.getInstructions().getLast() instanceof ToolResponseMessage) {
                return Flux.just(new AssistantMessage("187,20 dollars."));
            }
            return Flux.just(AssistantMessage.builder()
                    .toolCalls(List.of(new AssistantMessage.ToolCall("call_1", "function", "get_live_price_data",
                            "{\"ticker\":\"AAPL.US\",\"activity\":\"Je regarde le cours d'Apple\"}")))
                    .build());
        });

        List<ChatEvent> events = converse("Combien vaut Apple ?");

        // What the call is for is the agent's business: the server only gets the ticker
        assertThat(eodhd.toolCalls()).last().satisfies(call -> assertThat(call.params().path("arguments"))
                .isEqualTo(JsonMapper.shared().readTree("{\"ticker\":\"AAPL.US\"}")));
        assertThat(events).hasSize(4);
        assertThat(events.get(0)).isEqualTo(new ChatEvent.ToolCall("1", "get_live_price_data",
                "Je regarde le cours d'Apple", "{\"ticker\":\"AAPL.US\"}"));
        assertThat(events.get(1)).isInstanceOfSatisfying(ChatEvent.ToolResult.class, result -> {
            assertThat(result.output()).contains("187.2");
            assertThat(result.failed()).isFalse();
        });
        assertThat(events.subList(2, 4)).containsExactly(new ChatEvent.Text("187,20 dollars."),
                new ChatEvent.Done(false));
    }

    /** Sends a message in a new conversation and waits for the run to end. */
    private List<ChatEvent> converse(String message) {
        String runId = chatService.start(null, message, null, null).runId();
        return runs.events(runId, 0).map(RunEvent::event).collectList().block(TIMEOUT);
    }
}
