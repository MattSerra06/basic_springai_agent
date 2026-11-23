package io.github.mattserra06.agent.dashboard;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.ConcurrentHashMap;

import io.github.mattserra06.agent.eodhd.EodhdTools;
import org.springframework.ai.tool.ToolCallback;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;

/**
 * The tools an interface may call by itself: a dashboard drawn in the browser loads and
 * reloads its figures through them, without the model. Only tools that read data are
 * here, the market data ones; those that cost per call or act on the conversation are
 * the model's alone.
 * <p>
 * An answer is kept for a short while and given again to the same question, so that
 * several panels asking the same thing, or a dashboard that refreshes too eagerly, do not
 * spend the quota of the data provider. A failure is not kept: the next call asks again.
 */
public final class DataTools {

    /** A tool as an interface is told of it. */
    public record Spec(String name, String description, JsonNode inputSchema) {
    }

    /** A tool that answered with a failure, in words safe to show. */
    public static final class ToolFailedException extends RuntimeException {

        ToolFailedException(String message) {
            super(message);
        }
    }

    /** An answer, or the call that is fetching it, and when it was asked for. */
    private record Kept(CompletableFuture<JsonNode> answer, Instant at) {
    }

    /** Past this many answers, those no longer given again are forgotten. */
    private static final int MOST_ANSWERS_KEPT = 500;

    private final JsonMapper json = JsonMapper.shared();
    private final Map<String, ToolCallback> tools = new LinkedHashMap<>();
    private final Map<String, Kept> answers = new ConcurrentHashMap<>();
    private final Duration keptFor;
    private final Clock clock;

    /**
     * @param tools the tools interfaces may call
     * @param keptFor how long an answer is given again to the same question
     */
    public DataTools(List<ToolCallback> tools, Duration keptFor, Clock clock) {
        tools.forEach(tool -> this.tools.put(tool.getToolDefinition().name(), tool));
        this.keptFor = keptFor;
        this.clock = clock;
    }

    public List<String> names() {
        return List.copyOf(tools.keySet());
    }

    public List<Spec> specs() {
        return tools.values().stream()
                .map(tool -> new Spec(tool.getToolDefinition().name(), tool.getToolDefinition().description(),
                        json.readTree(tool.getToolDefinition().inputSchema())))
                .toList();
    }

    /**
     * Runs a tool and gives its answer as data: the JSON the tool wrote, or its text
     * when it is not JSON.
     * @param arguments the arguments of the call, a JSON object
     * @throws NoSuchElementException for a tool interfaces may not call
     * @throws ToolFailedException when the tool answered with a failure
     */
    public JsonNode call(String name, JsonNode arguments) {
        ToolCallback tool = tools.get(name);
        if (tool == null) {
            throw new NoSuchElementException("No data tool named " + name);
        }
        String question = name + ' ' + arguments;
        Instant now = clock.instant();
        CompletableFuture<JsonNode> mine = new CompletableFuture<>();
        Kept kept = answers.compute(question,
                (same, last) -> (last != null && fresh(last, now)) ? last : new Kept(mine, now));
        if (kept.answer() != mine) {
            // Asked a moment ago, or being asked right now by another panel
            try {
                return kept.answer().join();
            }
            catch (CompletionException failed) {
                if (failed.getCause() instanceof ToolFailedException told) {
                    throw new ToolFailedException(told.getMessage());
                }
                throw failed;
            }
        }
        try {
            String result = tool.call(arguments.toString());
            if (result != null && result.startsWith(EodhdTools.FAILURE)) {
                throw new ToolFailedException(result.substring(EodhdTools.FAILURE.length()));
            }
            JsonNode data = data(result);
            mine.complete(data);
            forgetOld(now);
            return data;
        }
        catch (RuntimeException failed) {
            answers.remove(question, kept);
            mine.completeExceptionally(failed);
            throw failed;
        }
    }

    private boolean fresh(Kept kept, Instant now) {
        return kept.at().plus(keptFor).isAfter(now);
    }

    private void forgetOld(Instant now) {
        if (answers.size() > MOST_ANSWERS_KEPT) {
            answers.values().removeIf(kept -> !fresh(kept, now));
        }
    }

    /**
     * What a tool answered, as data. An MCP tool answers a list of contents: the text of
     * a single one is the answer, read as JSON when it is; several are a list of theirs.
     */
    private JsonNode data(String result) {
        JsonNode read = read(result);
        if (!read.isArray() || read.isEmpty() || !read.get(0).isObject() || !read.get(0).has("text")) {
            return read;
        }
        if (read.size() == 1) {
            return read(read.get(0).path("text").asString());
        }
        ArrayNode all = json.createArrayNode();
        read.forEach(content -> all.add(read(content.path("text").asString())));
        return all;
    }

    /** A text as JSON when it is, as a JSON string otherwise. */
    private JsonNode read(String text) {
        if (text == null) {
            return JsonNodeFactory.instance.nullNode();
        }
        String trimmed = text.strip();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try {
                return json.readTree(trimmed);
            }
            catch (JacksonException notJson) {
                // a text that only looks like JSON
            }
        }
        return JsonNodeFactory.instance.stringNode(text);
    }
}
