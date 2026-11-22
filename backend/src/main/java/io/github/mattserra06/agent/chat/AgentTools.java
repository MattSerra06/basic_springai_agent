package io.github.mattserra06.agent.chat;

import java.util.ArrayList;
import java.util.List;

import org.jspecify.annotations.Nullable;
import org.springframework.ai.support.ToolCallbacks;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.ai.tool.augment.AugmentedToolCallbackProvider;

/**
 * The tools of the agent. A run hands them to the model with one more argument each,
 * {@code activity}: a line that says what the call is for. It is read when the call
 * starts, so that the user can be shown what the agent is doing, and taken out before the
 * tool gets its arguments: the tools never see it.
 */
public final class AgentTools {

    private final List<ToolCallback> tools;

    /**
     * @param toolObjects objects with {@code @Tool} methods, or tool callbacks
     */
    public AgentTools(List<?> toolObjects) {
        List<ToolCallback> callbacks = new ArrayList<>();
        for (Object tool : toolObjects) {
            if (tool instanceof ToolCallback callback) {
                callbacks.add(callback);
            }
            else {
                callbacks.addAll(List.of(ToolCallbacks.from(tool)));
            }
        }
        this.tools = List.copyOf(callbacks);
    }

    /**
     * The tools for one run.
     * @param listener told of every call when it starts, on the thread that runs the tool
     */
    ToolCallback[] reportingTo(Listener listener) {
        return AugmentedToolCallbackProvider.<Activity>builder()
                .delegate(() -> tools.toArray(ToolCallback[]::new))
                .argumentType(Activity.class)
                .argumentConsumer(event -> listener.called(event.toolDefinition().name(),
                        (event.arguments() != null) ? event.arguments().text() : ""))
                .removeExtraArgumentsAfterProcessing(true)
                .build()
                .getToolCallbacks();
    }

    /** Hears of the tool calls of a run. */
    @FunctionalInterface
    interface Listener {

        /**
         * @param tool the name of the tool
         * @param activity what the model says the call is for; empty when it did not say
         */
        void called(String tool, String activity);
    }

    /** What is added to the arguments of every tool. */
    record Activity(
            @ToolParam(description = """
                    One short sentence for the user to read while this call runs: what you are doing \
                    and what for, in the language the user writes in, without naming the tool. \
                    At most 12 words, no final period. \
                    Example: Je cherche les horaires des trains Paris-Lyon de demain""") @Nullable String activity) {

        String text() {
            return (activity != null) ? activity.strip() : "";
        }
    }
}
