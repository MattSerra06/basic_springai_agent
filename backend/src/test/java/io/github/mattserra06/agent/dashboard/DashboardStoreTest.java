package io.github.mattserra06.agent.dashboard;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DashboardStoreTest {

    private final DashboardStore store = new DashboardStore();

    @Test
    void keepsADashboardAndListsTheMostRecentFirst() {
        DashboardStore.Dashboard first = store.keep(" Apple ", "root = Stack([])");
        DashboardStore.Dashboard second = store.keep("LVMH", "root = Card([])");

        assertThat(first.title()).isEqualTo("Apple");
        assertThat(store.list()).extracting(DashboardStore.Entry::id).containsExactly(second.id(), first.id());
        assertThat(store.find(first.id())).contains(first);
        assertThat(store.find("nope")).isEmpty();
    }

    @Test
    void forgetsADashboardOnce() {
        DashboardStore.Dashboard kept = store.keep("Apple", "root = Stack([])");

        assertThat(store.forget(kept.id())).isTrue();
        assertThat(store.forget(kept.id())).isFalse();
        assertThat(store.list()).isEmpty();
    }

    @Test
    void forgetsTheOldestPastItsLimit() {
        DashboardStore.Dashboard oldest = store.keep("0", "root = Stack([])");
        for (int count = 1; count <= DashboardStore.MOST_KEPT; count++) {
            store.keep(String.valueOf(count), "root = Stack([])");
        }

        assertThat(store.list()).hasSize(DashboardStore.MOST_KEPT);
        assertThat(store.find(oldest.id())).isEmpty();
    }
}
