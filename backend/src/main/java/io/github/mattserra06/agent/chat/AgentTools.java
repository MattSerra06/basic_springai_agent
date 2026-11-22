package io.github.mattserra06.agent.chat;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

import org.jspecify.annotations.Nullable;
import org.springframework.ai.chat.model.ToolContext;
import org.springframework.ai.support.ToolCallbacks;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.annotation.ToolParam;
import org.springframework.ai.tool.augment.AugmentedToolCallbackProvider;
import org.springframework.ai.tool.definition.ToolDefinition;
import org.springframework.ai.tool.metadata.ToolMetadata;

/**
 * The tools of the agent. A run hands them to the model with one more argument each,
 * {@code activity}: a line that says what the call is for. It is read when the call
 * starts and taken out before the tool gets its arguments: the tools never see it. The
 * run is told of every call, when it starts and when it ends, so that the user can be
 * shown what the agent is doing and what came of it.
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
     * @param listener told of every call, on the thread that runs the tool
     */
    ToolCallback[] reportingTo(Listener listener) {
        AtomicInteger calls = new AtomicInteger();
        // The augmented tool reads the activity, then calls the tool itself on the same
        // thread: that is how the one hands the activity over to the other
        ThreadLocal<String> said = new ThreadLocal<>();
        ToolCallback[] reported = tools.stream()
                .map(tool -> new Reported(tool, listener, calls, said))
                .toArray(ToolCallback[]::new);
        return AugmentedToolCallbackProvider.<Activity>builder()
                .delegate(() -> reported)
                .argumentType(Activity.class)
                .argumentConsumer(event -> said.set((event.arguments() != null) ? event.arguments().text() : ""))
                .removeExtraArgumentsAfterProcessing(true)
                .build()
                .getToolCallbacks();
    }

    /** Hears of the tool calls of a run. */
    interface Listener {

        /**
         * A call starts.
         * @param id names the call within the run
         * @param tool the name of the tool
         * @param activity what the model says the call is for; empty when it did not say
         * @param input the arguments of the call, as JSON
         */
        void started(String id, String tool, String activity, String input);

        /**
         * A call is over.
         * @param output what the tool answered, or why it failed
         * @param failed the tool threw; the model is told so and the run goes on
         */
        void finished(String id, String output, boolean failed);
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

    /** A tool that tells the run when it is called and what it answers. */
    private static final class Reported implements ToolCallback {

        private final ToolCallback tool;
        private final Listener listener;
        private final AtomicInteger calls;
        private final ThreadLocal<String> said;

        Reported(ToolCallback tool, Listener listener, AtomicInteger calls, ThreadLocal<String> said) {
            this.tool = tool;
            this.listener = listener;
            this.calls = calls;
            this.said = said;
        }

        @Override
        public ToolDefinition getToolDefinition() {
            return tool.getToolDefinition();
        }

        @Override
        public ToolMetadata getToolMetadata() {
            return tool.getToolMetadata();
        }

        @Override
        public String call(String toolInput) {
            return report(toolInput, () -> tool.call(toolInput));
        }

        @Override
        public String call(String toolInput, @Nullable ToolContext toolContext) {
            return report(toolInput, () -> tool.call(toolInput, toolContext));
        }

        private String report(String input, Supplier<String> call) {
            String id = String.valueOf(calls.incrementAndGet());
            String activity = said.get();
            said.remove();
            listener.started(id, tool.getToolDefinition().name(), (activity != null) ? activity : "", input);
            try {
                String output = call.get();
                listener.finished(id, (output != null) ? output : "", false);
                return output;
            }
            catch (RuntimeException ex) {
                listener.finished(id, String.valueOf(ex.getMessage()), true);
                throw ex;
            }
        }
    }
}
