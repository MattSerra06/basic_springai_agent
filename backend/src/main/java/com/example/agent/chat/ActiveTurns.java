package com.example.agent.chat;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * The turns in progress, by session, so that a stop request can reach the right one. A
 * session takes one turn at a time: the session advisors rely on it, and so does
 * compaction, which must not rewrite the history under a turn that is using it.
 */
@Component
public class ActiveTurns {

    /** How long a new message waits for the previous turn's compaction to finish. */
    private static final Duration WRAP_UP_WAIT = Duration.ofMinutes(2);

    private final Map<String, Turn> turns = new ConcurrentHashMap<>();

    /**
     * Registers a new turn. When the session's previous turn has replied and is only
     * wrapping up (compacting), this waits for it; when it is still generating its reply,
     * the new turn is refused.
     * @throws ResponseStatusException 409 when the session is busy
     */
    Turn start(String sessionId) {
        Turn turn = new Turn();
        while (true) {
            Turn previous = turns.putIfAbsent(sessionId, turn);
            if (previous == null) {
                return turn;
            }
            if (!previous.awaitWrapUp(WRAP_UP_WAIT)) {
                throw new ResponseStatusException(HttpStatus.CONFLICT,
                        "A reply is already being generated for session " + sessionId);
            }
        }
    }

    void finish(String sessionId, Turn turn) {
        turns.remove(sessionId, turn);
        turn.finished();
    }

    /** Interrupts the session's turn; does nothing when none is running. */
    public void interrupt(String sessionId) {
        Turn turn = turns.get(sessionId);
        if (turn != null) {
            turn.interrupt();
        }
    }
}
