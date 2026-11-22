package io.github.mattserra06.agent.chat;

/**
 * An event of a run with its place in the run's log.
 *
 * @param sequence 1 for the first event of the run, then 2, 3, ...; a client that reconnects
 * names the last one it saw to get what follows
 */
public record RunEvent(long sequence, ChatEvent event) {
}
