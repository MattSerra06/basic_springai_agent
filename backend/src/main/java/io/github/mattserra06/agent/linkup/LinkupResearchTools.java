package io.github.mattserra06.agent.linkup;

import java.time.Duration;
import java.time.LocalDate;
import java.util.List;

import io.github.mattserra06.agent.linkup.LinkupClient.ResearchRequest;
import io.github.mattserra06.agent.linkup.LinkupClient.ResearchTask;
import io.github.mattserra06.agent.linkup.ToolSupport.InvalidArgument;
import org.jspecify.annotations.Nullable;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import tools.jackson.databind.node.ObjectNode;

/**
 * The research agent of Linkup as two tools: a task runs for minutes on Linkup's side,
 * so {@code linkup_research_start} only starts it and {@code linkup_research_result}
 * reads where it stands, waiting a bounded time for it to finish. They are kept apart
 * from {@link LinkupTools} so that a deployment can leave them out: a task costs far
 * more than a search.
 */
public class LinkupResearchTools {

    static final List<String> MODES = List.of("answer", "investigate", "research");
    static final List<String> REASONING_DEPTHS = List.of("S", "M", "L", "XL");
    static final List<String> OUTPUT_TYPES = List.of("sourcedAnswer", "structured");

    /** How long {@code linkup_research_result} waits when the model does not say. */
    private static final Duration DEFAULT_WAIT = Duration.ofSeconds(30);

    private final LinkupClient client;
    private final int maxResultChars;
    private final Duration pollInterval;
    private final Duration maxWait;

    public LinkupResearchTools(LinkupClient client, LinkupProperties properties) {
        this.client = client;
        this.maxResultChars = properties.maxResultChars();
        this.pollInterval = properties.research().pollInterval();
        this.maxWait = properties.research().maxWait();
    }

    @Tool(name = "linkup_research_start", resultConverter = AsIsResultConverter.class, description = """
            Start a research task: an autonomous agent that investigates the web for several minutes, \
            cross-checks its sources and writes a sourced answer or report. It is slow (2 to 20 minutes) and \
            expensive (0.25 to 2.50 USD per task): use it only when the user explicitly asks for in-depth \
            research or a full report, or has agreed to it. For everything else use linkup_search, with \
            depth deep for multi-step questions. Returns the id of the task at once; read its result with \
            linkup_research_result.""")
    public String start(
            @ToolParam(description = """
                    The research brief. A short question works, a precise brief works better: the angles to \
                    cover, the entities to compare, the facts to verify, the constraints, and the structure \
                    expected from the answer.""")
            String query,
            @ToolParam(description = """
                    How thorough the agent is; latency and price grow with it. One of: \
                    S (2-5 min, about 0.25 USD): light coverage, short multi-step investigations. \
                    M (3-7 min, about 0.50 USD): balanced, for routine use. \
                    L (5-10 min, about 1.50 USD): thorough. \
                    XL (10-20 min, about 2.50 USD): exhaustive, when completeness matters more than time. \
                    Pick the lightest that fits: S or M unless the user asks for more.""")
            String reasoningDepth,
            @ToolParam(required = false, description = """
                    The kind of investigation. One of: \
                    answer: one precise, verified answer to a hard question that has a definite answer. \
                    investigate: a focused report that goes deep on a single subject or entity. \
                    research: a broad report organized by theme, covering many topics or entities. \
                    Left out, Linkup picks one from the question, which makes time and price less predictable.""")
            @Nullable String mode,
            @ToolParam(required = false, description = """
                    One of: sourcedAnswer, the default, a written answer with inline citations and its \
                    sources; structured, a JSON object that follows structuredOutputSchema.""")
            @Nullable String outputType,
            @ToolParam(required = false, description = """
                    Needed with outputType structured, unused otherwise: a JSON Schema written as JSON text, \
                    whose root has "type": "object".""")
            @Nullable String structuredOutputSchema,
            @ToolParam(required = false, description = """
                    Only pages published on or after this date, YYYY-MM-DD. Must be before toDate.""")
            @Nullable String fromDate,
            @ToolParam(required = false, description = """
                    Only pages published on or before this date, YYYY-MM-DD.""")
            @Nullable String toDate,
            @ToolParam(required = false, description = "Search only these domains (100 at most).")
            @Nullable List<String> includeDomains,
            @ToolParam(required = false, description = "Leave these domains out.")
            @Nullable List<String> excludeDomains) {
        return ToolSupport.answer("linkup_research_start", () -> {
            // No default: the depth sets the price, so the model has to choose it
            String depth = ToolSupport.oneOf("reasoningDepth", reasoningDepth, REASONING_DEPTHS, null);
            if (depth == null) {
                throw new InvalidArgument("reasoningDepth is required: S, M, L or XL.");
            }
            String type = ToolSupport.oneOf("outputType", outputType, OUTPUT_TYPES, "sourcedAnswer");
            boolean structured = "structured".equals(type);
            String schema = structured ? ToolSupport.schema("structuredOutputSchema", structuredOutputSchema) : null;
            if (structured && schema == null) {
                throw new InvalidArgument("outputType structured needs structuredOutputSchema.");
            }
            LocalDate from = ToolSupport.date("fromDate", fromDate);
            LocalDate to = ToolSupport.date("toDate", toDate);
            ToolSupport.inOrder(from, to);

            ResearchTask task = client.startResearch(new ResearchRequest(ToolSupport.required("query", query), type,
                    ToolSupport.oneOf("mode", mode, MODES, null), depth, schema, from, to,
                    ToolSupport.includedDomains(includeDomains),
                    ToolSupport.domains(excludeDomains)));
            return LinkupClient.JSON.createObjectNode()
                    .put("id", task.id())
                    .put("status", task.status())
                    .put("note", "The research is running. Tell the user it has started and how long it should "
                            + "take, then call linkup_research_result with this id.")
                    .toString();
        });
    }

    @Tool(name = "linkup_research_result", resultConverter = AsIsResultConverter.class, description = """
            Where a research task started with linkup_research_start stands: its status is pending or \
            processing while it runs, then completed, with the answer and its sources or the structured \
            data, or failed, with the reason. The call waits up to waitSeconds for the task to finish. A \
            task takes minutes: when it is still running after a call or two, tell the user that the \
            research is in progress and give them the id, rather than calling again and again; it can be \
            read later, in a following message.""")
    public String result(
            @ToolParam(description = "The id returned by linkup_research_start.")
            String id,
            @ToolParam(required = false, description = """
                    How many seconds to wait for the task to finish before answering; 30 when left out, 0 to \
                    read the status at once. The server caps it.""")
            @Nullable Integer waitSeconds) {
        return ToolSupport.answer("linkup_research_result", () -> {
            String taskId = ToolSupport.required("id", id);
            Duration wait = (waitSeconds != null) ? Duration.ofSeconds(Math.max(0, waitSeconds)) : DEFAULT_WAIT;
            long started = System.nanoTime();
            ResearchTask task = await(taskId, (wait.compareTo(maxWait) > 0) ? maxWait : wait);

            ObjectNode result = LinkupClient.JSON.createObjectNode().put("id", task.id()).put("status", task.status());
            if (task.error() != null) {
                result.put("error", task.error());
            }
            if (task.output() != null) {
                ToolSupport.write(result, task.output(), maxResultChars);
            }
            if (!task.isOver()) {
                result.put("note", "Still running after %d s. Tell the user the research is in progress; read it "
                        .formatted(Duration.ofNanos(System.nanoTime() - started).toSeconds())
                        + "again later with this id.");
            }
            return result.toString();
        });
    }

    /** Reads the task, again every poll interval until it is over or the wait has run out. */
    private ResearchTask await(String id, Duration wait) {
        long deadline = System.nanoTime() + wait.toNanos();
        ResearchTask task = client.research(id);
        while (!task.isOver()) {
            long left = deadline - System.nanoTime();
            if (left <= 0) {
                break;
            }
            try {
                Thread.sleep(Duration.ofNanos(Math.min(left, pollInterval.toNanos())));
            }
            catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                break;
            }
            task = client.research(id);
        }
        return task;
    }
}
