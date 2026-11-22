package io.github.mattserra06.agent.chat;

/** What a run produces, in order: Text*, then Done or Failed. */
public sealed interface ChatEvent {

    /** A piece of the reply. */
    record Text(String text) implements ChatEvent {
    }

    /** The run is over; {@code interrupted} when a stop ended it. */
    record Done(boolean interrupted) implements ChatEvent {
    }

    /** The run is over because it failed; {@code message} is safe to show to the user. */
    record Failed(String message) implements ChatEvent {
    }

    /** Whether no event follows this one. */
    default boolean endsRun() {
        return !(this instanceof Text);
    }
}
