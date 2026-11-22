package io.github.mattserra06.agent.chat;

/**
 * What a run produces, in order: Text, Thinking, ToolCall and ToolResult as they come,
 * then Done or Failed. Text is the reply; the others say what the model is doing while
 * the reply is not there yet, and are not part of it.
 */
public sealed interface ChatEvent {

    /** A piece of the reply. */
    record Text(String text) implements ChatEvent {
    }

    /** A piece of the model's own summary of its reasoning. */
    record Thinking(String text) implements ChatEvent {
    }

    /**
     * The model starts a tool.
     * @param id names the call within the run; its {@link ToolResult} carries the same
     * @param name the name of the tool
     * @param activity what the model says the call is for, in its words; empty when it
     * did not say
     * @param input the arguments of the call, as JSON; cut when very long
     */
    record ToolCall(String id, String name, String activity, String input) implements ChatEvent {
    }

    /**
     * A tool the model started is over.
     * @param id the id of its {@link ToolCall}
     * @param output what the tool answered, or why it failed; cut when very long
     * @param failed the tool threw: the model was told so, and the run goes on
     */
    record ToolResult(String id, String output, boolean failed) implements ChatEvent {
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
