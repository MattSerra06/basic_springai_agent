package io.github.mattserra06.agent;

import java.time.Duration;
import java.util.List;
import java.util.function.Function;

import io.github.mattserra06.agent.chat.ChatEvent;
import io.github.mattserra06.agent.chat.ChatService;
import io.github.mattserra06.agent.chat.RunEvent;
import io.github.mattserra06.agent.chat.RunStore;
import io.github.mattserra06.agent.linkup.FakeLinkup;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.ToolCallingChatOptions;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import reactor.core.publisher.Flux;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The agent with a Linkup API key: the whole backend with a scripted model, and a local
 * server in place of the Linkup API.
 */
@SpringBootTest(properties = {
        "spring.ai.openai.api-key=test",
        "spring.datasource.url=jdbc:h2:mem:web-tools-test;DB_CLOSE_DELAY=-1",
        "agent.linkup.api-key=" + FakeLinkup.API_KEY })
class WebToolsTest {

    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    private static final FakeLinkup linkup = new FakeLinkup();

    @DynamicPropertySource
    static void linkupApi(DynamicPropertyRegistry registry) {
        registry.add("agent.linkup.base-url", linkup::baseUrl);
    }

    @AfterAll
    static void stopServer() {
        linkup.close();
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
        linkup.reset();
    }

    @Test
    void theModelIsGivenTheWebToolsAndToldAboutThem() {
        converse("Bonjour");

        Prompt prompt = model.prompts.getLast();
        assertThat(toolsOf(prompt)).extracting(tool -> tool.getToolDefinition().name()).containsExactlyInAnyOrder(
                "conversation_search", "linkup_search", "linkup_fetch", "linkup_credit_balance",
                "linkup_research_start", "linkup_research_result");
        assertThat(texts(prompt, MessageType.SYSTEM)).singleElement().asString()
                .contains("conversation_search", "linkup_search", "linkup_fetch");
    }

    @Test
    void theSearchToolTellsTheModelItsParametersAndWhichAreRequired() {
        converse("Bonjour");

        ToolCallback search = toolsOf(model.prompts.getLast()).stream()
                .filter(tool -> tool.getToolDefinition().name().equals("linkup_search"))
                .findFirst()
                .orElseThrow();
        JsonNode schema = JsonMapper.shared().readTree(search.getToolDefinition().inputSchema());

        // Its own parameters, and the line every tool asks for: what the call is for
        assertThat(schema.path("properties").propertyNames()).containsExactlyInAnyOrder("query", "depth",
                "outputType", "structuredOutputSchema", "includeSources", "includeInlineCitations", "includeImages",
                "fromDate", "toDate", "sinceDays", "includeDomains", "excludeDomains", "maxResults", "activity");
        assertThat(schema.path("required")).extracting(JsonNode::asString)
                .containsExactlyInAnyOrder("query", "depth", "outputType", "activity");
        assertThat(schema.path("properties").path("includeDomains").path("type").asString()).isEqualTo("array");
        assertThat(schema.path("properties").path("depth").path("description").asString())
                .contains("flash", "fast", "standard", "deep");
    }

    @Test
    void aSearchTheModelAsksForIsSentToLinkupAndComesBackAsAToolResult() {
        linkup.replies("""
                {"results": [{"type": "text", "name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                              "content": "Revenue was $245.1 billion.", "favicon": ""}]}""");
        model.repliesWith(callThenAnswer("linkup_search", """
                {"query": "Microsoft 2024 revenue", "depth": "fast", "outputType": "searchResults",
                 "includeDomains": ["microsoft.com"], "maxResults": 3,
                 "activity": " Je cherche le chiffre d'affaires 2024 de Microsoft "}""", "245,1 milliards."));

        List<ChatEvent> events = converse("Quel est le chiffre d'affaires 2024 de Microsoft ?");

        // What the call is for is told to the user, and is not an argument of the tool
        assertThat(linkup.call().authorization()).isEqualTo("Bearer " + FakeLinkup.API_KEY);
        assertThat(linkup.call().json()).isEqualTo(JsonMapper.shared().readTree("""
                {"q": "Microsoft 2024 revenue", "depth": "fast", "outputType": "searchResults",
                 "includeDomains": ["microsoft.com"], "maxResults": 3}"""));
        // The model reads the JSON the tool wrote, not that JSON quoted in a string
        JsonNode result = JsonMapper.shared().readTree(toolResult());
        assertThat(result.path("today").asString()).matches("\\d{4}-\\d{2}-\\d{2}");
        assertThat(result.path("sources")).isEqualTo(JsonMapper.shared().readTree("""
                [{"name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                  "content": "Revenue was $245.1 billion."}]"""));
        assertThat(events).containsExactly(new ChatEvent.Text("Je cherche."),
                new ChatEvent.ToolCall("linkup_search", "Je cherche le chiffre d'affaires 2024 de Microsoft"),
                new ChatEvent.Text("\n\n245,1 milliards."), new ChatEvent.Done(false));
    }

    @Test
    void aFailureOfLinkupIsToldToTheModelAndTheRunGoesOn() {
        linkup.replies(429, """
                {"statusCode": 429, "error": {"code": "INSUFFICIENT_FUNDS_CREDITS", "message": "No credits left"}}""");
        model.repliesWith(callThenAnswer("linkup_fetch", "{\"url\": \"https://example.com\"}", "Plus de crédits."));

        List<ChatEvent> events = converse("Lis https://example.com");

        assertThat(toolResult()).startsWith("Linkup error: The Linkup account has no credits left")
                .doesNotContain(FakeLinkup.API_KEY);
        // A call that does not say what it is for is reported all the same
        assertThat(events).containsExactly(new ChatEvent.Text("Je cherche."), new ChatEvent.ToolCall("linkup_fetch", ""),
                new ChatEvent.Text("\n\nPlus de crédits."), new ChatEvent.Done(false));
    }

    @Test
    void argumentsTheApiWouldRefuseAreToldToTheModelAndTheRunGoesOn() {
        model.repliesWith(callThenAnswer("linkup_search", """
                {"query": "news", "depth": "ultra", "outputType": "searchResults"}""", "Je corrige."));

        List<ChatEvent> events = converse("Quoi de neuf ?");

        assertThat(toolResult()).startsWith("Invalid call to linkup_search: depth must be one of");
        assertThat(linkup.calls).isEmpty();
        assertThat(events).last().isEqualTo(new ChatEvent.Done(false));
    }

    @Test
    void anArgumentOfTheWrongTypeIsToldToTheModelAndTheRunGoesOn() {
        model.repliesWith(callThenAnswer("linkup_search", """
                {"query": "news", "depth": "fast", "outputType": "searchResults", "maxResults": "many"}""",
                "Je corrige."));

        List<ChatEvent> events = converse("Quoi de neuf ?");

        // Spring AI refuses the call before the tool runs, and says why to the model
        assertThat(linkup.calls).isEmpty();
        assertThat(toolResult()).contains("Integer", "\"many\"");
        assertThat(events).last().isEqualTo(new ChatEvent.Done(false));
    }

    /**
     * A model that says something and calls a tool, then, given the tool result, answers.
     */
    private static Function<Prompt, Flux<AssistantMessage>> callThenAnswer(String tool, String arguments,
            String answer) {
        return prompt -> {
            if (prompt.getInstructions().getLast() instanceof ToolResponseMessage) {
                return Flux.just(new AssistantMessage(answer));
            }
            return Flux.just(new AssistantMessage("Je cherche."), AssistantMessage.builder()
                    .toolCalls(List.of(new AssistantMessage.ToolCall("call_1", "function", tool, arguments)))
                    .build());
        };
    }

    /** Sends a message in a new conversation and waits for the run to end. */
    private List<ChatEvent> converse(String message) {
        String runId = chatService.start(null, message, null, null).runId();
        return runs.events(runId, 0).map(RunEvent::event).collectList().block(TIMEOUT);
    }

    /** What the tool answered, as the model was sent it. */
    private String toolResult() {
        ToolResponseMessage message = (ToolResponseMessage) model.prompts.getLast().getInstructions().getLast();
        return message.getResponses().getFirst().responseData();
    }

    private static List<ToolCallback> toolsOf(Prompt prompt) {
        return ((ToolCallingChatOptions) prompt.getOptions()).getToolCallbacks();
    }

    private static List<String> texts(Prompt prompt, MessageType type) {
        return prompt.getInstructions().stream()
                .filter(message -> message.getMessageType() == type)
                .map(Message::getText)
                .toList();
    }
}
