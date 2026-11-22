package io.github.mattserra06.agent.chat;

import java.util.Optional;

import reactor.core.publisher.Flux;

/**
 * The runs and their event logs. A run's events are written by the worker that answers
 * the message and read by any number of clients, at any time: while the run is going,
 * after a reconnection, or once it has ended.
 * <p>
 * {@link InMemoryRunStore} keeps them in this process. A database-backed store (a
 * {@code run} table, a {@code run_event} table keyed by run id and sequence, and
 * LISTEN/NOTIFY or polling for the live tail) can replace it without touching the
 * callers. With several instances the stop signal needs the same treatment: today
 * {@link ActiveTurns} only reaches a run that works in this process.
 */
public interface RunStore {

    Run create(String sessionId, String message);

    Optional<Run> find(String runId);

    /** The run of the session that has not ended yet, if any. */
    Optional<Run> findActive(String sessionId);

    /**
     * Appends an event to the run's log. The log is closed by the first event that
     * {@link ChatEvent#endsRun() ends the run}.
     */
    void append(String runId, ChatEvent event);

    /**
     * The events of the run after the given sequence, 0 for all of them: first the ones
     * already in the log, then the new ones as they are appended. Completes after the
     * event that ends the run.
     * @throws java.util.NoSuchElementException for an unknown run
     */
    Flux<RunEvent> events(String runId, long afterSequence);
}
