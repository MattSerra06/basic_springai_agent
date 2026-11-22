package io.github.mattserra06.agent.chat;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ActiveTurnsTest {

    private final ActiveTurns turns = new ActiveTurns();

    @Test
    void refusesASecondTurnWhileTheFirstIsStillReplying() {
        turns.start("s1");

        assertThatThrownBy(() -> turns.start("s1"))
                .isInstanceOfSatisfying(ResponseStatusException.class,
                        ex -> assertThat(ex.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        assertThatCode(() -> turns.start("s2")).doesNotThrowAnyException();
    }

    @Test
    void aTurnAcceptedDuringTheWrapUpOfThePreviousOneWaitsForIt() throws Exception {
        Turn first = turns.start("s1");
        first.replied();

        Turn second = turns.start("s1");
        CompletableFuture<Void> waiting = CompletableFuture.runAsync(second::awaitPrevious);

        assertThatThrownBy(() -> waiting.get(100, TimeUnit.MILLISECONDS))
                .isInstanceOf(java.util.concurrent.TimeoutException.class);
        turns.finish("s1", first);
        waiting.get(2, TimeUnit.SECONDS);
    }

    @Test
    void finishingAnOlderTurnLeavesTheNewerOneInPlace() {
        Turn first = turns.start("s1");
        first.replied();
        Turn second = turns.start("s1");

        turns.finish("s1", first);
        turns.interrupt("s1");

        assertThat(second.isInterrupted()).isTrue();
        assertThat(first.isInterrupted()).isFalse();
    }

    @Test
    void aSessionIsFreeOnceItsTurnHasFinished() {
        Turn first = turns.start("s1");
        turns.finish("s1", first);

        Turn second = turns.start("s1");

        // Nothing to wait for
        second.awaitPrevious();
    }

    @Test
    void interruptingASessionWithoutATurnDoesNothing() {
        assertThatCode(() -> turns.interrupt("nobody")).doesNotThrowAnyException();
    }
}
