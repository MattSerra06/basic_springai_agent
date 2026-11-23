package io.github.mattserra06.agent.dashboard;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Component;

/**
 * The dashboards the user kept, in memory: they are gone when the application stops.
 * A dashboard is the interface the agent wrote, as its OpenUI Lang program; its figures
 * are not kept, they are loaded again each time it is drawn.
 */
@Component
public class DashboardStore {

    /** Past this many, keeping one more forgets the oldest. */
    static final int MOST_KEPT = 100;

    /**
     * @param program the interface, in OpenUI Lang
     */
    public record Dashboard(String id, String title, String program, Instant createdAt) {
    }

    /** A dashboard as a list shows it. */
    public record Entry(String id, String title, Instant createdAt) {
    }

    private final Deque<Dashboard> dashboards = new ArrayDeque<>();

    public synchronized Dashboard keep(String title, String program) {
        Dashboard dashboard = new Dashboard(UUID.randomUUID().toString(), title.strip(), program, Instant.now());
        dashboards.addFirst(dashboard);
        while (dashboards.size() > MOST_KEPT) {
            dashboards.removeLast();
        }
        return dashboard;
    }

    /** The most recent first. */
    public synchronized List<Entry> list() {
        return dashboards.stream()
                .map(dashboard -> new Entry(dashboard.id(), dashboard.title(), dashboard.createdAt()))
                .toList();
    }

    public synchronized Optional<Dashboard> find(String id) {
        return dashboards.stream().filter(dashboard -> dashboard.id().equals(id)).findFirst();
    }

    /** @return whether there was one to forget */
    public synchronized boolean forget(String id) {
        return dashboards.removeIf(dashboard -> dashboard.id().equals(id));
    }
}
