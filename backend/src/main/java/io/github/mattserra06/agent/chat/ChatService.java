package io.github.mattserra06.agent.chat;

import io.github.mattserra06.agent.session.Conversations;
import io.github.mattserra06.agent.session.SessionCompactor;
import io.github.mattserra06.agent.session.SessionView;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springaicommunity.agent.advisors.InterruptAdvisor;
import org.springaicommunity.agent.advisors.TurnInterruptedException;
import org.springframework.ai.chat.client.ChatClient;
import org.springframework.ai.session.advisor.SessionAdvisors;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.scheduler.Schedulers;

@Service
public class ChatService {

    private static final Logger log = LoggerFactory.getLogger(ChatService.class);

    private static final String FAILURE_MESSAGE = "L'appel au modèle a échoué. Consultez les logs du backend.";

    private final ChatClient chatClient;
    private final Conversations conversations;
    private final ActiveTurns activeTurns;
    private final RunStore runs;
    private final SessionCompactor compactor;

    public ChatService(ChatClient chatClient, Conversations conversations, ActiveTurns activeTurns, RunStore runs,
                       SessionCompactor compactor) {
        this.chatClient = chatClient;
        this.conversations = conversations;
        this.activeTurns = activeTurns;
        this.runs = runs;
        this.compactor = compactor;
    }

    /**
     * Accepts a message and answers it in the background: this returns at once, and the
     * reply is read from {@link RunStore#events} under the returned run. The run does
     * not depend on any client staying connected.
     *
     * @param sessionId the conversation to continue, or {@code null} to start one
     * @throws org.springframework.web.server.ResponseStatusException 404 for an unknown
     * session, 409 when the session is still generating a reply
     */
    public RunStarted start(@Nullable String sessionId, String message) {
        SessionView session = (sessionId != null) ? conversations.get(sessionId) : conversations.create(message);
        Turn turn = activeTurns.start(session.id());
        Run run;
        try {
            run = runs.create(session.id(), message);
        }
        catch (RuntimeException ex) {
            activeTurns.finish(session.id(), turn);
            throw ex;
        }
        work(run, turn)
                .subscribeOn(Schedulers.boundedElastic())
                .subscribe(event -> {
                }, error -> log.error("Run {} ended without telling its clients", run.id(), error));
        return new RunStarted(run.id(), session);
    }

    /**
     * One turn of the conversation, written to the run's log. The session advisors add
     * the stored history to the prompt and store the new messages.
     * <p>
     * A stop ({@link ActiveTurns#interrupt}) ends the turn in two ways. The model stream
     * is cut at once, which closes the model call, and what was streamed of the reply is
     * stored. And the {@link InterruptAdvisor}, which runs before every model request of
     * the tool-calling loop, refuses the next round, so a turn busy with tools does not
     * go back to the model.
     * <p>
     * Once the reply is complete the turn wraps up: the session is compacted if it has
     * grown too long. The next turn of the session waits for that, so the history never
     * changes under a running turn.
     */
    private Flux<ChatEvent> work(Run run, Turn turn) {
        String sessionId = run.sessionId();

        Flux<ChatEvent> reply = Flux.defer(() -> {
            // A stop does not shorten this wait: the previous turn must have settled the
            // history before this one reads it or adds to it
            turn.awaitPrevious();
            if (turn.isInterrupted()) {
                // Stopped before it began: the model is not called, and the message the
                // user sent stays in the conversation
                storeUnansweredMessage(run);
                return Flux.empty();
            }
            return chatClient.prompt()
                    .user(run.message())
                    .advisors(SessionAdvisors.session(sessionId))
                    .advisors(InterruptAdvisor.builder().interruptSignal(turn::isInterrupted).build())
                    .stream()
                    .chatClientResponse()
                    .map(turn::accept)
                    .filter(text -> !text.isEmpty())
                    .<ChatEvent>map(ChatEvent.Text::new)
                    .doOnComplete(turn::modelFinished)
                    .takeUntilOther(turn.interruption())
                    .onErrorResume(TurnInterruptedException.class, interruptedBetweenRounds -> Flux.empty());
        });

        Mono<ChatEvent> done = Mono.<ChatEvent>fromSupplier(() -> {
            // A stop that arrives once the model has finished cut nothing
            boolean cutShort = turn.wasCutShort();
            if (cutShort) {
                storeInterruptedReply(sessionId, turn);
            }
            return new ChatEvent.Done(cutShort);
        }).subscribeOn(Schedulers.boundedElastic());

        return Flux.concat(reply, done)
                .onErrorResume(error -> {
                    log.error("Run {} of session {} failed", run.id(), sessionId, error);
                    return Flux.just(new ChatEvent.Failed(FAILURE_MESSAGE));
                })
                .doOnNext(event -> {
                    if (event.endsRun()) {
                        // Before clients learn the run is over: their next message is
                        // then accepted, and its turn waits for this one to wrap up
                        turn.replied();
                    }
                    runs.append(run.id(), event);
                })
                .doFinally(signal -> wrapUp(sessionId, turn));
    }

    /** Ends the turn on a thread of its own: compaction is a model call. */
    private void wrapUp(String sessionId, Turn turn) {
        turn.replied();
        Schedulers.boundedElastic().schedule(() -> {
            try {
                compactor.compactIfNeeded(sessionId);
            }
            finally {
                activeTurns.finish(sessionId, turn);
            }
        });
    }

    private void storeInterruptedReply(String sessionId, Turn turn) {
        try {
            conversations.saveInterruptedReply(sessionId, turn.roundText(), turn.roundRequestEventId());
        }
        catch (RuntimeException ex) {
            // The session may be gone: deleting a conversation stops its turn first
            log.warn("Could not store the interrupted reply of session {}: {}", sessionId, ex.getMessage());
        }
    }

    private void storeUnansweredMessage(Run run) {
        try {
            conversations.saveUnansweredMessage(run.sessionId(), run.message());
        }
        catch (RuntimeException ex) {
            log.warn("Could not store the unanswered message of session {}: {}", run.sessionId(), ex.getMessage());
        }
    }

    /** What {@link #start} hands back: where to read the reply, and the conversation. */
    public record RunStarted(String runId, SessionView session) {
    }
}
