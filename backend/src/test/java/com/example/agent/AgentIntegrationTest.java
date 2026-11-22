package com.example.agent;

import java.time.Duration;
import java.util.List;

import com.example.agent.chat.ActiveTurns;
import com.example.agent.chat.ChatEvent;
import com.example.agent.chat.ChatService;
import com.example.agent.session.Conversations;
import com.example.agent.session.MessageView;
import com.example.agent.session.SessionView;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.chat.messages.ToolResponseMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.test.StepVerifier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

/** The whole backend on an in-memory database, with a scripted model. */
@SpringBootTest(properties = {
        "spring.ai.anthropic.api-key=test",
        "spring.datasource.url=jdbc:h2:mem:agent-test;DB_CLOSE_DELAY=-1",
        "agent.compaction.trigger-tokens=120",
        "agent.compaction.keep-tokens=40" })
class AgentIntegrationTest {

    private static final String LONG_TEXT = "The quick brown fox jumps over the lazy dog. ".repeat(6);

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
    Conversations conversations;

    @Autowired
    ActiveTurns activeTurns;

    @Autowired
    StubChatModel model;

    @BeforeEach
    void resetModel() {
        model.reset();
    }

    @Test
    void aNewConversationIsStoredListedAndContinued() {
        model.repliesWith("Bonjour ", "Ada !");

        List<ChatEvent> first = chatService.stream(null, "Bonjour, je m'appelle Ada").collectList().block();

        assertThat(first).hasSize(4);
        SessionView session = ((ChatEvent.Started) first.get(0)).session();
        assertThat(session.title()).isEqualTo("Bonjour, je m'appelle Ada");
        assertThat(first.subList(1, 4)).containsExactly(
                new ChatEvent.Text("Bonjour "), new ChatEvent.Text("Ada !"), new ChatEvent.Done(false));
        assertThat(conversations.list()).extracting(SessionView::id).contains(session.id());

        model.repliesWith("Ada.");
        List<ChatEvent> second = chatService.stream(session.id(), "Quel est mon nom ?").collectList().block();

        // No Started event for an existing session, and the model was sent the history
        assertThat(second).containsExactly(new ChatEvent.Text("Ada."), new ChatEvent.Done(false));
        assertThat(texts(model.prompts.getLast(), MessageType.USER, MessageType.ASSISTANT)).containsExactly(
                "Bonjour, je m'appelle Ada", "Bonjour Ada !", "Quel est mon nom ?");
        assertThat(conversations.messages(session.id())).containsExactly(
                new MessageView("user", "Bonjour, je m'appelle Ada", false),
                new MessageView("assistant", "Bonjour Ada !", false),
                new MessageView("user", "Quel est mon nom ?", false),
                new MessageView("assistant", "Ada.", false));
    }

    @Test
    void conversationsAreKeptApartAndCanBeDeleted() {
        String first = start("Sujet A").id();
        String second = start("Sujet B").id();

        chatService.stream(second, "Suite B").blockLast();

        assertThat(texts(model.prompts.getLast(), MessageType.USER)).containsExactly("Sujet B", "Suite B");
        assertThat(conversations.list()).extracting(SessionView::id).contains(first, second);

        conversations.delete(first);

        assertThat(conversations.list()).extracting(SessionView::id).contains(second).doesNotContain(first);
        assertThatThrownBy(() -> chatService.stream(first, "Encore ?"))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void aStopCutsTheReplyAndStoresWhatWasShown() {
        String sessionId = start("Premier message").id();
        model.repliesSlowlyWith(Duration.ofMillis(100), "un ", "deux ", "trois ", "quatre ", "cinq ", "six ");

        StepVerifier.create(chatService.stream(sessionId, "Compte jusqu'à six"))
                .expectNext(new ChatEvent.Text("un "))
                .expectNext(new ChatEvent.Text("deux "))
                .then(() -> activeTurns.interrupt(sessionId))
                .expectNext(new ChatEvent.Done(true))
                .expectComplete()
                .verify(Duration.ofSeconds(5));

        assertThat(conversations.messages(sessionId)).endsWith(
                new MessageView("user", "Compte jusqu'à six", false),
                new MessageView("assistant", "un deux ", true));

        // The session is free again, and the next turn sees the interrupted reply
        model.repliesWith("D'accord.");
        chatService.stream(sessionId, "Continue").blockLast();
        assertThat(texts(model.prompts.getLast(), MessageType.ASSISTANT)).contains("un deux ");
    }

    @Test
    void aClientThatGoesAwayStopsTheTurn() {
        String sessionId = start("Premier message").id();
        model.repliesSlowlyWith(Duration.ofMillis(100), "un ", "deux ", "trois ", "quatre ");

        StepVerifier.create(chatService.stream(sessionId, "Compte"))
                .expectNext(new ChatEvent.Text("un "))
                .thenCancel()
                .verify(Duration.ofSeconds(5));

        await().atMost(Duration.ofSeconds(5)).untilAsserted(() -> assertThat(conversations.messages(sessionId))
                .endsWith(new MessageView("assistant", "un ", true)));
    }

    @Test
    void aSessionTakesOneTurnAtATime() {
        String sessionId = start("Premier message").id();
        model.repliesSlowlyWith(Duration.ofMillis(200), "un ", "deux ");

        Flux<ChatEvent> running = chatService.stream(sessionId, "Compte");

        assertThatThrownBy(() -> chatService.stream(sessionId, "Et moi ?"))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        running.blockLast();
    }

    @Test
    void aLongConversationIsSummarizedRecursively() {
        model.repliesWith(LONG_TEXT);
        model.summarizesIn(Duration.ofMillis(300));
        String sessionId = start("FIRST " + LONG_TEXT).id();

        // Past the trigger, the oldest turn leaves the prompt and its summary stands in.
        // The next message waits for the summary instead of racing it.
        chatService.stream(sessionId, "SECOND " + LONG_TEXT).blockLast();
        chatService.stream(sessionId, "THIRD " + LONG_TEXT).blockLast();

        assertThat(model.summaryPrompts).hasSize(1);
        List<String> sent = texts(model.prompts.getLast(), MessageType.USER, MessageType.ASSISTANT);
        assertThat(sent).contains("SUMMARY 1").noneMatch(text -> text.startsWith("FIRST"));
        assertThat(sent.getLast()).startsWith("THIRD");

        // A later summary is built on the previous one
        chatService.stream(sessionId, "FOURTH " + LONG_TEXT).blockLast();
        assertThat(model.summaryPrompts).hasSizeGreaterThanOrEqualTo(2);
        assertThat(model.summaryPrompts.get(1).getContents()).contains("PRIOR SUMMARY", "SUMMARY 1");

        // The UI still shows everything that was said, and none of the summaries
        List<MessageView> shown = conversations.messages(sessionId);
        assertThat(shown.getFirst().content()).startsWith("FIRST");
        assertThat(shown).noneMatch(message -> message.content().startsWith("SUMMARY"));
    }

    @Test
    void deletingAConversationStopsItsReply() {
        String sessionId = start("Premier message").id();
        model.repliesSlowlyWith(Duration.ofMillis(100), "un ", "deux ", "trois ", "quatre ", "cinq ");

        StepVerifier.create(chatService.stream(sessionId, "Compte"))
                .expectNext(new ChatEvent.Text("un "))
                .then(() -> {
                    activeTurns.interrupt(sessionId);
                    conversations.delete(sessionId);
                })
                .expectNext(new ChatEvent.Done(true))
                .expectComplete()
                .verify(Duration.ofSeconds(5));

        assertThat(conversations.list()).extracting(SessionView::id).doesNotContain(sessionId);
    }

    @Test
    void theModelCanSearchWhatACompactionTookOutOfItsContext() {
        String sessionId = start("Mon code secret est PAPAYE-42").id();

        // First round: the model calls conversation_search; second round: it answers
        model.repliesWith(prompt -> {
            boolean hasToolResult = prompt.getInstructions().getLast() instanceof ToolResponseMessage;
            if (hasToolResult) {
                return Flux.just(new AssistantMessage("Trouvé."));
            }
            // As a provider streams it: the text first, the tool call in a chunk of its own
            return Flux.just(new AssistantMessage("Je cherche."), AssistantMessage.builder()
                    .toolCalls(List.of(new AssistantMessage.ToolCall("call_1", "function", "conversation_search",
                            "{\"query\":\"secret\"}")))
                    .build());
        });

        List<ChatEvent> events = chatService.stream(sessionId, "Quel est mon code ?").collectList().block();

        assertThat(events).containsExactly(
                new ChatEvent.Text("Je cherche."), new ChatEvent.Text("\n\nTrouvé."), new ChatEvent.Done(false));
        ToolResponseMessage toolResult = (ToolResponseMessage) model.prompts.getLast().getInstructions().getLast();
        assertThat(toolResult.getResponses().getFirst().responseData()).contains("PAPAYE-42");
        assertThat(conversations.messages(sessionId)).endsWith(
                new MessageView("user", "Quel est mon code ?", false),
                new MessageView("assistant", "Je cherche.\n\nTrouvé.", false));
    }

    private SessionView start(String firstMessage) {
        List<ChatEvent> events = chatService.stream(null, firstMessage).collectList().block();
        return ((ChatEvent.Started) events.getFirst()).session();
    }

    private static List<String> texts(Prompt prompt, MessageType... types) {
        List<MessageType> wanted = List.of(types);
        return prompt.getInstructions().stream()
                .filter(message -> wanted.contains(message.getMessageType()))
                .map(Message::getText)
                .toList();
    }
}
