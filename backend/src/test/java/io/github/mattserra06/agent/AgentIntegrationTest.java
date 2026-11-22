package io.github.mattserra06.agent;

import java.time.Duration;
import java.util.List;

import io.github.mattserra06.agent.chat.ActiveTurns;
import io.github.mattserra06.agent.chat.ChatEvent;
import io.github.mattserra06.agent.chat.ChatService;
import io.github.mattserra06.agent.chat.RunEvent;
import io.github.mattserra06.agent.chat.RunStore;
import io.github.mattserra06.agent.session.ConversationView;
import io.github.mattserra06.agent.session.Conversations;
import io.github.mattserra06.agent.session.MessageView;
import io.github.mattserra06.agent.session.SessionView;
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
        "spring.ai.openai.api-key=test",
        "spring.datasource.url=jdbc:h2:mem:agent-test;DB_CLOSE_DELAY=-1",
        "agent.compaction.trigger-tokens=120",
        "agent.compaction.keep-tokens=40" })
class AgentIntegrationTest {

    private static final String LONG_TEXT = "The quick brown fox jumps over the lazy dog. ".repeat(6);

    private static final Duration TIMEOUT = Duration.ofSeconds(5);

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

        ChatService.RunStarted first = chatService.start(null, "Bonjour, je m'appelle Ada");

        SessionView session = first.session();
        assertThat(session.title()).isEqualTo("Bonjour, je m'appelle Ada");
        assertThat(eventsOf(first.runId())).containsExactly(
                new ChatEvent.Text("Bonjour "), new ChatEvent.Text("Ada !"), new ChatEvent.Done(false));
        assertThat(conversations.list()).extracting(SessionView::id).contains(session.id());

        model.repliesWith("Ada.");
        ChatService.RunStarted second = chatService.start(session.id(), "Quel est mon nom ?");

        // Same session, and the model was sent the history
        assertThat(second.session()).isEqualTo(conversations.get(session.id()));
        assertThat(eventsOf(second.runId())).containsExactly(new ChatEvent.Text("Ada."), new ChatEvent.Done(false));
        assertThat(texts(model.prompts.getLast(), MessageType.USER, MessageType.ASSISTANT)).containsExactly(
                "Bonjour, je m'appelle Ada", "Bonjour Ada !", "Quel est mon nom ?");
        assertThat(conversations.open(session.id())).isEqualTo(new ConversationView(conversations.get(session.id()),
                List.of(new MessageView("user", "Bonjour, je m'appelle Ada", false),
                        new MessageView("assistant", "Bonjour Ada !", false),
                        new MessageView("user", "Quel est mon nom ?", false),
                        new MessageView("assistant", "Ada.", false)),
                null));
    }

    @Test
    void aRunGoesOnWithoutAnyClientAndCanBeReadAfterwards() {
        String sessionId = converse(null, "Premier message").session().id();
        model.repliesSlowlyWith(Duration.ofMillis(50), "un ", "deux ", "trois ");

        String runId = chatService.start(sessionId, "Compte").runId();

        // Nobody reads the events, the reply is produced and stored all the same
        await().atMost(TIMEOUT).untilAsserted(() -> assertThat(conversations.open(sessionId).messages())
                .endsWith(new MessageView("assistant", "un deux trois ", false)));

        // A client that comes late gets everything, one that reconnects only what it missed
        assertThat(runs.events(runId, 0).collectList().block(TIMEOUT)).extracting(RunEvent::sequence)
                .containsExactly(1L, 2L, 3L, 4L);
        assertThat(runs.events(runId, 2).collectList().block(TIMEOUT)).containsExactly(
                new RunEvent(3, new ChatEvent.Text("trois ")), new RunEvent(4, new ChatEvent.Done(false)));
    }

    @Test
    void aConversationOpenedDuringARunNamesItAndStopsAtItsMessage() {
        String sessionId = converse(null, "Premier message").session().id();
        model.repliesSlowlyWith(Duration.ofMillis(100), "un ", "deux ", "trois ", "quatre ");

        String runId = chatService.start(sessionId, "Compte").runId();
        runs.events(runId, 0).blockFirst(TIMEOUT);
        ConversationView during = conversations.open(sessionId);

        // The reply in progress is not among the messages: it is read from the run
        assertThat(during.activeRunId()).isEqualTo(runId);
        assertThat(during.messages()).containsExactly(
                new MessageView("user", "Premier message", false),
                new MessageView("assistant", "OK", false),
                new MessageView("user", "Compte", false));

        eventsOf(runId);
        ConversationView after = conversations.open(sessionId);
        assertThat(after.activeRunId()).isNull();
        assertThat(after.messages()).endsWith(new MessageView("assistant", "un deux trois quatre ", false));
    }

    @Test
    void conversationsAreKeptApartAndCanBeDeleted() {
        String first = converse(null, "Sujet A").session().id();
        String second = converse(null, "Sujet B").session().id();

        converse(second, "Suite B");

        assertThat(texts(model.prompts.getLast(), MessageType.USER)).containsExactly("Sujet B", "Suite B");
        assertThat(conversations.list()).extracting(SessionView::id).contains(first, second);

        conversations.delete(first);

        assertThat(conversations.list()).extracting(SessionView::id).contains(second).doesNotContain(first);
        assertThatThrownBy(() -> chatService.start(first, "Encore ?"))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND));
    }

    @Test
    void aStopCutsTheReplyAndStoresWhatWasStreamed() {
        String sessionId = converse(null, "Premier message").session().id();
        model.repliesSlowlyWith(Duration.ofMillis(100), "un ", "deux ", "trois ", "quatre ", "cinq ", "six ");

        String runId = chatService.start(sessionId, "Compte jusqu'à six").runId();

        StepVerifier.create(runs.events(runId, 0).map(RunEvent::event))
                .expectNext(new ChatEvent.Text("un "))
                .expectNext(new ChatEvent.Text("deux "))
                .then(() -> activeTurns.interrupt(sessionId))
                .expectNext(new ChatEvent.Done(true))
                .expectComplete()
                .verify(TIMEOUT);

        assertThat(conversations.open(sessionId).messages()).endsWith(
                new MessageView("user", "Compte jusqu'à six", false),
                new MessageView("assistant", "un deux ", true));

        // The session is free again, and the next turn sees the interrupted reply
        model.repliesWith("D'accord.");
        converse(sessionId, "Continue");
        assertThat(texts(model.prompts.getLast(), MessageType.ASSISTANT)).contains("un deux ");
    }

    @Test
    void aSessionTakesOneTurnAtATime() {
        String sessionId = converse(null, "Premier message").session().id();
        model.repliesSlowlyWith(Duration.ofMillis(200), "un ", "deux ");

        String runId = chatService.start(sessionId, "Compte").runId();

        assertThatThrownBy(() -> chatService.start(sessionId, "Et moi ?"))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        eventsOf(runId);
    }

    @Test
    void aFailedModelCallEndsTheRunWithAMessageForTheUser() {
        String sessionId = converse(null, "Premier message").session().id();
        model.repliesWith(prompt -> Flux.error(new IllegalStateException("secret upstream detail")));

        List<ChatEvent> events = converse(sessionId, "Et là ?").events();

        assertThat(events).hasSize(1);
        assertThat(events.getFirst()).isInstanceOfSatisfying(ChatEvent.Failed.class,
                failed -> assertThat(failed.message()).isNotBlank().doesNotContain("secret"));

        // The session is not left busy
        model.repliesWith("Me revoilà.");
        assertThat(converse(sessionId, "Encore").events()).contains(new ChatEvent.Text("Me revoilà."));
    }

    @Test
    void aLongConversationIsSummarizedRecursively() {
        model.repliesWith(LONG_TEXT);
        model.summarizesIn(Duration.ofMillis(300));
        String sessionId = converse(null, "FIRST " + LONG_TEXT).session().id();

        // Past the trigger, the oldest turn leaves the prompt and its summary stands in.
        // The next message is accepted at once and its turn waits for the summary.
        converse(sessionId, "SECOND " + LONG_TEXT);
        converse(sessionId, "THIRD " + LONG_TEXT);

        List<String> sent = texts(model.prompts.getLast(), MessageType.USER, MessageType.ASSISTANT);
        assertThat(sent).contains("SUMMARY 1").noneMatch(text -> text.startsWith("FIRST"));
        assertThat(sent.getLast()).startsWith("THIRD");
        assertThat(model.summaryPrompts.getFirst().getContents()).contains("FIRST").doesNotContain("SUMMARY");

        // A later summary is built on the previous one. Summaries are written after the
        // run has ended, hence the wait.
        converse(sessionId, "FOURTH " + LONG_TEXT);
        await().atMost(TIMEOUT).until(() -> model.summaryPrompts.size() >= 2);
        assertThat(model.summaryPrompts.get(1).getContents()).contains("SUMMARY 1");

        // The UI still shows everything that was said, and none of the summaries
        List<MessageView> shown = conversations.open(sessionId).messages();
        assertThat(shown.getFirst().content()).startsWith("FIRST");
        assertThat(shown).noneMatch(message -> message.content().startsWith("SUMMARY"));
    }

    @Test
    void deletingAConversationStopsItsReply() {
        String sessionId = converse(null, "Premier message").session().id();
        model.repliesSlowlyWith(Duration.ofMillis(100), "un ", "deux ", "trois ", "quatre ", "cinq ");

        String runId = chatService.start(sessionId, "Compte").runId();

        StepVerifier.create(runs.events(runId, 0).map(RunEvent::event))
                .expectNext(new ChatEvent.Text("un "))
                .then(() -> {
                    activeTurns.interrupt(sessionId);
                    conversations.delete(sessionId);
                })
                .expectNext(new ChatEvent.Done(true))
                .expectComplete()
                .verify(TIMEOUT);

        assertThat(conversations.list()).extracting(SessionView::id).doesNotContain(sessionId);
    }

    @Test
    void theModelCanSearchWhatACompactionTookOutOfItsContext() {
        model.repliesWith(LONG_TEXT);
        String sessionId = converse(null, "Mon code secret est PAPAYE-42. " + LONG_TEXT).session().id();
        converse(sessionId, "SECOND " + LONG_TEXT);

        model.repliesWith(searchThenAnswer("Je cherche.", Flux.just(new AssistantMessage("Trouvé."))));
        List<ChatEvent> events = converse(sessionId, "Quel est mon code ?").events();

        // The first turn was summarized away: the model no longer has the code in its prompt...
        Prompt firstRound = model.prompts.get(model.prompts.size() - 2);
        assertThat(texts(firstRound, MessageType.USER, MessageType.ASSISTANT))
                .anyMatch(text -> text.startsWith("SUMMARY"))
                .noneMatch(text -> text.contains("PAPAYE-42"));

        // ...and gets it back from the tool, which searches the whole log
        assertThat(events).containsExactly(
                new ChatEvent.Text("Je cherche."), new ChatEvent.Text("\n\nTrouvé."), new ChatEvent.Done(false));
        ToolResponseMessage toolResult = (ToolResponseMessage) model.prompts.getLast().getInstructions().getLast();
        assertThat(toolResult.getResponses().getFirst().responseData()).contains("PAPAYE-42");
        assertThat(conversations.open(sessionId).messages()).endsWith(
                new MessageView("user", "Quel est mon code ?", false),
                new MessageView("assistant", "Je cherche.\n\nTrouvé.", false));
    }

    @Test
    void aStopBetweenTwoToolRoundsDoesNotStoreTheFirstRoundTwice() {
        String sessionId = converse(null, "Mon code secret est PAPAYE-42").session().id();
        // The second round never gets to say anything
        model.repliesWith(searchThenAnswer("Je cherche.", Flux.never()));

        String runId = chatService.start(sessionId, "Quel est mon code ?").runId();
        int promptsBefore = model.prompts.size();
        await().atMost(TIMEOUT).until(() -> model.prompts.size() > promptsBefore
                && model.prompts.getLast().getInstructions().getLast() instanceof ToolResponseMessage);
        activeTurns.interrupt(sessionId);

        assertThat(eventsOf(runId)).containsExactly(new ChatEvent.Text("Je cherche."), new ChatEvent.Done(true));
        assertThat(conversations.open(sessionId).messages()).endsWith(
                new MessageView("user", "Quel est mon code ?", false),
                new MessageView("assistant", "Je cherche.", false));
    }

    @Test
    void aStopDuringTheSecondToolRoundStoresOnlyWhatThatRoundStreamed() {
        String sessionId = converse(null, "Mon code secret est PAPAYE-42").session().id();
        model.repliesWith(searchThenAnswer("Je cherche.",
                Flux.concat(Flux.just(new AssistantMessage("Trouvé : ")), Flux.never())));

        String runId = chatService.start(sessionId, "Quel est mon code ?").runId();

        StepVerifier.create(runs.events(runId, 0).map(RunEvent::event))
                .expectNext(new ChatEvent.Text("Je cherche."))
                .expectNext(new ChatEvent.Text("\n\nTrouvé : "))
                .then(() -> activeTurns.interrupt(sessionId))
                .expectNext(new ChatEvent.Done(true))
                .expectComplete()
                .verify(TIMEOUT);

        assertThat(conversations.open(sessionId).messages()).endsWith(
                new MessageView("user", "Quel est mon code ?", false),
                new MessageView("assistant", "Je cherche.\n\nTrouvé : ", true));
    }

    @Test
    void aTurnStoppedWhileItWaitsForACompactionKeepsItsMessage() {
        model.repliesWith(LONG_TEXT);
        String sessionId = converse(null, "FIRST " + LONG_TEXT).session().id();
        model.holdSummaries();
        converse(sessionId, "SECOND " + LONG_TEXT);
        int promptsBefore = model.prompts.size();

        // The second turn is compacting: the third is accepted, waits, and is stopped there
        String runId = chatService.start(sessionId, "THIRD").runId();
        activeTurns.interrupt(sessionId);
        model.releaseSummaries();

        assertThat(eventsOf(runId)).containsExactly(new ChatEvent.Done(true));
        assertThat(model.prompts).hasSize(promptsBefore);
        assertThat(conversations.open(sessionId).messages()).endsWith(new MessageView("user", "THIRD", false));

        // The model sees the unanswered message on the next turn
        converse(sessionId, "FOURTH");
        assertThat(texts(model.prompts.getLast(), MessageType.USER)).containsSubsequence("THIRD", "FOURTH");
    }

    /**
     * A model that answers a question in two rounds: it says something and calls
     * conversation_search, then, given the tool result, streams the second round.
     */
    private static java.util.function.Function<Prompt, Flux<AssistantMessage>> searchThenAnswer(String firstRound,
            Flux<AssistantMessage> secondRound) {
        return prompt -> {
            if (prompt.getInstructions().getLast() instanceof ToolResponseMessage) {
                return secondRound;
            }
            // As a provider streams it: the text first, the tool call in a chunk of its own
            return Flux.just(new AssistantMessage(firstRound), AssistantMessage.builder()
                    .toolCalls(List.of(new AssistantMessage.ToolCall("call_1", "function", "conversation_search",
                            "{\"query\":\"secret\"}")))
                    .build());
        };
    }

    /** Sends a message and waits for the run to end. */
    private Exchange converse(String sessionId, String message) {
        ChatService.RunStarted started = chatService.start(sessionId, message);
        return new Exchange(started.session(), eventsOf(started.runId()));
    }

    private List<ChatEvent> eventsOf(String runId) {
        return runs.events(runId, 0).map(RunEvent::event).collectList().block(TIMEOUT);
    }

    private static List<String> texts(Prompt prompt, MessageType... types) {
        List<MessageType> wanted = List.of(types);
        return prompt.getInstructions().stream()
                .filter(message -> wanted.contains(message.getMessageType()))
                .map(Message::getText)
                .toList();
    }

    private record Exchange(SessionView session, List<ChatEvent> events) {
    }
}
