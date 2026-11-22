package com.example.agent.chat;

import java.time.Duration;
import java.util.Objects;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

import org.jspecify.annotations.Nullable;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.session.advisor.SessionMemoryAdvisor;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

/**
 * One turn of a conversation: its stop signal, the text streamed so far in the current
 * model round, and where it stands. A turn has several rounds when the model calls
 * tools; the session advisors store each round's reply when the round ends, so only the
 * round a stop cuts short is left for the caller to store. Once the reply has been sent
 * the turn is wrapping up (compaction) until it is {@link #finished()}.
 */
final class Turn {

    /** How long a turn waits for the previous one of its session to finish wrapping up. */
    private static final Duration WRAP_UP_WAIT = Duration.ofMinutes(2);

    private final @Nullable Turn previous;
    private final AtomicBoolean interrupted = new AtomicBoolean();
    private final Sinks.Empty<Void> stop = Sinks.empty();
    private final CountDownLatch finished = new CountDownLatch(1);
    private volatile boolean replied;

    private final StringBuilder roundText = new StringBuilder();
    private Object round;
    private boolean anyText;

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
     * none. The text of a new round is set apart from the previous round's.
     */
    synchronized String accept(ChatClientResponse response) {
        // The memory advisor names the stored request of each round on the context
        Object chunkRound = response.context().get(SessionMemoryAdvisor.REQUEST_EVENT_ID_CONTEXT_KEY);
        boolean newRound = !Objects.equals(chunkRound, round);
        if (newRound) {
            round = chunkRound;
            roundText.setLength(0);
        }
        String text = text(response);
        if (text.isEmpty()) {
            return "";
        }
        roundText.append(text);
        String shown = (newRound && anyText) ? "\n\n" + text : text;
        anyText = true;
        return shown;
    }

    /** The text of the round in progress. */
    synchronized String partialReply() {
        return roundText.toString();
    }

    private static String text(ChatClientResponse response) {
        if (response.chatResponse() == null || response.chatResponse().getResult() == null) {
            return "";
        }
        String text = response.chatResponse().getResult().getOutput().getText();
        return (text != null) ? text : "";
    }
}
