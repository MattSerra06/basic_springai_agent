package com.example.agent.chat;

import com.example.agent.session.Conversations;
import com.example.agent.session.SessionCompactor;
import com.example.agent.session.SessionView;
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
import reactor.core.publisher.SignalType;
import reactor.core.scheduler.Schedulers;

@Service
public class ChatService {

    private static final Logger log = LoggerFactory.getLogger(ChatService.class);

    private final ChatClient chatClient;
    private final Conversations conversations;
    private final ActiveTurns activeTurns;
    private final SessionCompactor compactor;

    public ChatService(ChatClient chatClient, Conversations conversations, ActiveTurns activeTurns,
                       SessionCompactor compactor) {
        this.chatClient = chatClient;
        this.conversations = conversations;
        this.activeTurns = activeTurns;
        this.compactor = compactor;
    }

    /**
     * Runs one turn of a conversation and streams the reply. The session advisors add
     * the stored history to the prompt and store the new messages.
     * <p>
     * A stop ({@link ActiveTurns#interrupt}) ends the turn in two ways. The stream is cut
     * at once, which closes the model call, and what was shown of the reply is stored.
     * And the {@link InterruptAdvisor}, which runs before every model request of the
     * tool-calling loop, refuses the next round, so a turn busy with tools does not go
     * back to the model. A client that goes away counts as a stop.
     * <p>
     * Once the reply is sent the turn wraps up in the background: the session is
     * compacted if it has grown too long. The next message of the session waits for that,
     * so the history never changes under a running turn.
     *
     * @param sessionId the conversation to continue, or {@code null} to start one
     * @throws org.springframework.web.server.ResponseStatusException 404 for an unknown
     * session, 409 when the session is still generating a reply
     */
    public Flux<ChatEvent> stream(@Nullable String sessionId, String message) {
        SessionView session = (sessionId != null) ? conversations.get(sessionId) : conversations.create(message);
        Turn turn = activeTurns.start(session.id());

        Flux<ChatEvent> reply = chatClient.prompt()
                .user(message)
                .advisors(SessionAdvisors.session(session.id()))
                .advisors(InterruptAdvisor.builder().interruptSignal(turn::isInterrupted).build())
                .stream()
                .chatClientResponse()
                .map(turn::accept)
                .filter(text -> !text.isEmpty())
                .<ChatEvent>map(ChatEvent.Text::new)
                .takeUntilOther(turn.interruption())
                .onErrorResume(TurnInterruptedException.class, interruptedBetweenRounds -> Flux.empty());

        Mono<ChatEvent> done = Mono.<ChatEvent>fromSupplier(() -> {
            if (turn.isInterrupted()) {
                storeInterruptedReply(session.id(), turn);
            }
            return new ChatEvent.Done(turn.isInterrupted());
        }).subscribeOn(Schedulers.boundedElastic());

        Flux<ChatEvent> started = (sessionId == null) ? Flux.just(new ChatEvent.Started(session)) : Flux.empty();
        return Flux.concat(started, reply, done)
                .doFinally(signal -> wrapUp(session.id(), turn, signal == SignalType.CANCEL));
    }

    /** Ends the turn off the request thread: compaction is a model call. */
    private void wrapUp(String sessionId, Turn turn, boolean clientWentAway) {
        turn.replied();
        Schedulers.boundedElastic().schedule(() -> {
            try {
                if (clientWentAway) {
                    turn.interrupt();
                    storeInterruptedReply(sessionId, turn);
                }
                compactor.compactIfNeeded(sessionId);
            }
            finally {
                activeTurns.finish(sessionId, turn);
            }
        });
    }

    private void storeInterruptedReply(String sessionId, Turn turn) {
        try {
            conversations.saveInterruptedReply(sessionId, turn.partialReply());
        }
        catch (RuntimeException ex) {
            // The session may be gone: deleting a conversation stops its turn first
            log.warn("Could not store the interrupted reply of session {}: {}", sessionId, ex.getMessage());
        }
    }
}
