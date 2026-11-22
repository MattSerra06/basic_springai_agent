package io.github.mattserra06.agent.chat;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.jspecify.annotations.Nullable;
import org.springframework.stereotype.Component;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

/**
 * Runs kept in memory. A run that has ended stays readable for a while, so that a client
 * that lost its connection near the end can still get the last events; after that the
 * reply is read from the session, where it is stored.
 */
@Component
public class InMemoryRunStore implements RunStore {

    private static final Duration DEFAULT_RETENTION = Duration.ofMinutes(10);

    private final Map<String, Entry> entries = new ConcurrentHashMap<>();
    private final Duration retention;

    public InMemoryRunStore() {
        this(DEFAULT_RETENTION);
    }

    InMemoryRunStore(Duration retention) {
        this.retention = retention;
    }

    @Override
    public Run create(String sessionId, String message) {
        forgetOldRuns();
        Run run = new Run(UUID.randomUUID().toString(), sessionId, message, Instant.now());
        entries.put(run.id(), new Entry(run));
        return run;
    }

    @Override
    public Optional<Run> find(String runId) {
        return Optional.ofNullable(entries.get(runId)).map(entry -> entry.run);
    }

    @Override
    public Optional<Run> findActive(String sessionId) {
        return entries.values().stream()
                .filter(entry -> entry.run.sessionId().equals(sessionId) && entry.endedAt == null)
                .map(entry -> entry.run)
                .findFirst();
    }

    @Override
    public void append(String runId, ChatEvent event) {
        entry(runId).append(event);
    }

    @Override
    public Flux<RunEvent> events(String runId, long afterSequence) {
        // The sink replays the whole log to each subscriber, then goes on live
        return entry(runId).log.asFlux().filter(event -> event.sequence() > afterSequence);
    }

    private Entry entry(String runId) {
        Entry entry = entries.get(runId);
        if (entry == null) {
            throw new NoSuchElementException("Unknown run " + runId);
        }
        return entry;
    }

    private void forgetOldRuns() {
        Instant limit = Instant.now().minus(retention);
        entries.values().removeIf(entry -> {
            Instant endedAt = entry.endedAt;
            // Not isBefore: two readings of the clock can be equal, on Windows above all
            return endedAt != null && !endedAt.isAfter(limit);
        });
    }

    private static final class Entry {

        final Run run;
        final Sinks.Many<RunEvent> log = Sinks.many().replay().all();
        long lastSequence;
        volatile @Nullable Instant endedAt;

        Entry(Run run) {
            this.run = run;
        }

        synchronized void append(ChatEvent event) {
            if (endedAt != null) {
                throw new IllegalStateException("Run " + run.id() + " has ended");
            }
            log.tryEmitNext(new RunEvent(++lastSequence, event)).orThrow();
            if (event.endsRun()) {
                endedAt = Instant.now();
                log.tryEmitComplete().orThrow();
            }
        }
    }
}
