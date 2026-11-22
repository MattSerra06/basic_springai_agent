package io.github.mattserra06.agent.chat;

/**
 * What a run produces, in order: Text, Thinking and ToolCall as they come, then Done or
 * Failed. Text is the reply; Thinking and ToolCall say what the model is doing while the
 * reply is not there yet, and are not part of it.
 */
public sealed interface ChatEvent {

    /** A piece of the reply. */
    record Text(String text) implements ChatEvent {
    }

    /** A piece of the model's own summary of its reasoning. */
    record Thinking(String text) implements ChatEvent {
    }

    /**
     * The model runs a tool.
     * @param name the name of the tool
     * @param activity what the model says the call is for, in its words; empty when it
     * did not say
     */
    record ToolCall(String name, String activity) implements ChatEvent {
    }

    /** The run is over; {@code interrupted} when a stop ended it. */
    record Done(boolean interrupted) implements ChatEvent {
    }

    /** The run is over because it failed; {@code message} is safe to show to the user. */
    record Failed(String message) implements ChatEvent {
    }

    /** Whether no event follows this one. */
    default boolean endsRun() {
        return this instanceof Done || this instanceof Failed;
    }
}
