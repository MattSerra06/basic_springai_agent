package io.github.mattserra06.agent.chat;

import java.time.Duration;
import java.util.Arrays;
import java.util.Objects;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.jspecify.annotations.Nullable;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.messages.part.MessagePart;
import org.springframework.ai.chat.messages.part.ReasoningPart;
import org.springframework.ai.chat.messages.part.StreamingParts;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.session.advisor.SessionMemoryAdvisor;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

/**
 * One turn of a conversation, the in-process side of a {@link Run}: its stop signal, the
 * text streamed so far in the current model round, and where it stands. A turn has
 * several rounds when the model calls tools; the session advisors store each round's
 * reply when the round ends, so only the round a stop cuts short is left for the caller
 * to store. Once the reply has been sent the turn is wrapping up (compaction) until it
 * is {@link #finished()}.
 */
final class Turn {

    /** How long a turn waits for the previous one of its session to finish wrapping up. */
    private static final Duration WRAP_UP_WAIT = Duration.ofMinutes(2);

    private final @Nullable Turn previous;
    private final AtomicBoolean interrupted = new AtomicBoolean();
    private final Sinks.Empty<Void> stop = Sinks.empty();
    private final CountDownLatch finished = new CountDownLatch(1);
    private volatile boolean replied;
    private volatile boolean modelFinished;

    // The round in progress; guarded by this
    private final StringBuilder roundText = new StringBuilder();
    private @Nullable Object round;
    private boolean anyText;
    private boolean separatorPending;
    private @Nullable Object thinkingStep;

    /**
     * @param previous the turn of the same session this one follows, when it is still
     * wrapping up
     */
    Turn(@Nullable Turn previous) {
        this.previous = previous;
    }

    boolean isInterrupted() {
        return interrupted.get();
    }

    void interrupt() {
        if (interrupted.compareAndSet(false, true)) {
            stop.tryEmitEmpty();
        }
    }

    /** Completes when the turn is interrupted. */
    Mono<Void> interruption() {
        return stop.asMono();
    }

    /** The model has streamed its whole reply: a stop that comes now cuts nothing. */
    void modelFinished() {
        modelFinished = true;
    }

    /** Whether a stop ended the turn before the model had finished its reply. */
    boolean wasCutShort() {
        return interrupted.get() && !modelFinished;
    }

    /** The reply has been sent; what is left is wrapping up. */
    void replied() {
        replied = true;
    }

    boolean hasReplied() {
        return replied;
    }

    void finished() {
        finished.countDown();
    }

    /**
     * Blocks until the previous turn of the session has finished wrapping up.
     * @throws IllegalStateException when it does not finish in time
     */
    void awaitPrevious() {
        if (previous == null) {
            return;
        }
        try {
            if (!previous.finished.await(WRAP_UP_WAIT.toMillis(), TimeUnit.MILLISECONDS)) {
                throw new IllegalStateException("The previous turn of the session did not finish in time");
            }
        }
        catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Interrupted while waiting for the previous turn", ex);
        }
    }

    /**
     * Takes a streamed chunk and returns the text to show for it, empty when it carries
     * none. The text of a new round is set apart from the previous round's by a blank
     * line, whichever chunk of the round brings its first text.
     */
    synchronized String accept(ChatClientResponse response) {
        // The memory advisor puts the id of the request it stored for the round (the
        // user message, then each batch of tool results) on the context of its chunks:
        // another id means another round has started
        Object chunkRound = response.context().get(SessionMemoryAdvisor.REQUEST_EVENT_ID_CONTEXT_KEY);
        if (!Objects.equals(chunkRound, round)) {
            round = chunkRound;
            roundText.setLength(0);
            separatorPending = anyText;
        }
        String text = text(response);
        if (text.isEmpty()) {
            return "";
        }
        roundText.append(text);
        String shown = separatorPending ? "\n\n" + text : text;
        separatorPending = false;
        anyText = true;
        return shown;
    }

    /**
     * Takes a streamed chunk and returns the piece of the model's reasoning it carries,
     * empty when it carries none: the summary the provider writes of it, or the reasoning
     * itself when the provider streams that. Each step of the reasoning is set apart from
     * the previous one by a blank line.
     */
    synchronized String thinking(ChatClientResponse response) {
        ChatResponse chatResponse = response.chatResponse();
        if (chatResponse == null || chatResponse.getResult() == null) {
            return "";
        }
        StringBuilder shown = new StringBuilder();
        for (MessagePart part : chatResponse.getResult().getOutput().getParts()) {
            if (!(part instanceof ReasoningPart reasoning)) {
                continue;
            }
            String piece = hasText(reasoning.summary()) ? reasoning.summary() : reasoning.text();
            if (!hasText(piece)) {
                continue; // the chunk that only brings what the provider wants replayed
            }
            // One model response has a step per content block that reasons
            Object step = Arrays.asList(chatResponse.getMetadata().getId(), StreamingParts.partIndex(part));
            if (thinkingStep != null && !thinkingStep.equals(step)) {
                shown.append("\n\n");
            }
            thinkingStep = step;
            shown.append(piece);
        }
        return shown.toString();
    }

    private static boolean hasText(@Nullable String text) {
        return text != null && !text.isEmpty();
    }

    /** The text streamed so far in the round in progress. */
    synchronized String roundText() {
        return roundText.toString();
    }

    /**
     * The id of the session event that stores the request of the round in progress, or
     * {@code null} before the first chunk. While it is the newest event of the session,
     * the round's reply has not been stored.
     */
    synchronized @Nullable String roundRequestEventId() {
        return (round instanceof String id) ? id : null;
    }

    private static String text(ChatClientResponse response) {
        if (response.chatResponse() == null || response.chatResponse().getResult() == null) {
            return "";
        }
        String text = response.chatResponse().getResult().getOutput().getText();
        return (text != null) ? text : "";
    }
}
