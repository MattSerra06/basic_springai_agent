package com.example.agent.chat;

import java.time.Duration;
import java.util.NoSuchElementException;

import org.junit.jupiter.api.Test;
import reactor.test.StepVerifier;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class InMemoryRunStoreTest {

    private final InMemoryRunStore store = new InMemoryRunStore();

    @Test
    void replaysTheLogThenFollowsItUntilTheRunEnds() {
        Run run = store.create("s1", "Hi");
        store.append(run.id(), new ChatEvent.Text("a"));

        StepVerifier.create(store.events(run.id(), 0))
                .expectNext(new RunEvent(1, new ChatEvent.Text("a")))
                .then(() -> store.append(run.id(), new ChatEvent.Text("b")))
                .expectNext(new RunEvent(2, new ChatEvent.Text("b")))
                .then(() -> store.append(run.id(), new ChatEvent.Done(false)))
                .expectNext(new RunEvent(3, new ChatEvent.Done(false)))
                .expectComplete()
                .verify(Duration.ofSeconds(2));
    }

    @Test
    void resumesAfterTheLastEventSeenEvenOnceTheRunHasEnded() {
        Run run = store.create("s1", "Hi");
        store.append(run.id(), new ChatEvent.Text("a"));
        store.append(run.id(), new ChatEvent.Text("b"));
        store.append(run.id(), new ChatEvent.Done(true));

        StepVerifier.create(store.events(run.id(), 1))
                .expectNext(new RunEvent(2, new ChatEvent.Text("b")), new RunEvent(3, new ChatEvent.Done(true)))
                .expectComplete()
                .verify(Duration.ofSeconds(2));
        StepVerifier.create(store.events(run.id(), 3)).expectComplete().verify(Duration.ofSeconds(2));
    }

    @Test
    void aRunIsActiveUntilItsLastEvent() {
        Run run = store.create("s1", "Hi");
        assertThat(store.findActive("s1")).contains(run);
        assertThat(store.findActive("s2")).isEmpty();

        store.append(run.id(), new ChatEvent.Failed("boom"));

        assertThat(store.findActive("s1")).isEmpty();
        assertThat(store.find(run.id())).contains(run);
        assertThatThrownBy(() -> store.append(run.id(), new ChatEvent.Text("late")))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void forgetsEndedRunsAfterTheRetention() {
        InMemoryRunStore shortLived = new InMemoryRunStore(Duration.ZERO);
        Run ended = shortLived.create("s1", "Hi");
        shortLived.append(ended.id(), new ChatEvent.Done(false));
        Run running = shortLived.create("s2", "Hi");

        shortLived.create("s3", "Hi");

        assertThat(shortLived.find(ended.id())).isEmpty();
        assertThat(shortLived.find(running.id())).contains(running);
        assertThatThrownBy(() -> shortLived.events(ended.id(), 0)).isInstanceOf(NoSuchElementException.class);
    }
}
