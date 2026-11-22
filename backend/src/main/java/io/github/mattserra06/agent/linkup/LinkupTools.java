package io.github.mattserra06.agent.linkup;

import java.time.Clock;
import java.time.LocalDate;
import java.util.List;

import io.github.mattserra06.agent.linkup.LinkupClient.FetchRequest;
import io.github.mattserra06.agent.linkup.LinkupClient.Findings;
import io.github.mattserra06.agent.linkup.LinkupClient.Page;
import io.github.mattserra06.agent.linkup.LinkupClient.SearchRequest;
import io.github.mattserra06.agent.linkup.ToolSupport.InvalidArgument;
import org.jspecify.annotations.Nullable;
import org.springframework.ai.tool.annotation.Tool;
import org.springframework.ai.tool.annotation.ToolParam;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The web tools given to the model: {@code linkup_search}, {@code linkup_fetch} and
 * {@code linkup_credit_balance}. The parameters are those of the Linkup API, under the
 * same names; the descriptions tell the model when to pick each option. The options
 * that take one value of a list are strings checked here rather than enums, so that a
 * wrong value comes back to the model as a result it can correct instead of failing the
 * run.
 */
public class LinkupTools {

    static final List<String> DEPTHS = List.of("flash", "fast", "standard", "deep");
    static final List<String> SEARCH_OUTPUT_TYPES = List.of("searchResults", "sourcedAnswer", "structured");
    static final List<String> FETCH_MODES = List.of("standard", "pro");

    private final LinkupClient client;
    private final int maxResultChars;
    private final Clock clock;

    /** @param clock gives today's date, for {@code sinceDays} and for dating the results */
    public LinkupTools(LinkupClient client, LinkupProperties properties, Clock clock) {
        this.client = client;
        this.maxResultChars = properties.maxResultChars();
        this.clock = clock;
    }

    @Tool(name = "linkup_search", resultConverter = AsIsResultConverter.class, description = """
            Search the live web. Use it for current facts, recent events, specific people, companies or \
            products, and anything you are not sure of or that may have changed since your training. \
            Returns the sources (name, URL, publication date when known, relevant passage) and today's date; \
            cite the URLs you rely on. To read a whole page, call linkup_fetch with its URL. Several \
            independent searches can be made in parallel.""")
    public String search(
            @ToolParam(description = """
                    What to find. With depth flash or fast: a short keyword query, like 'NVIDIA Q4 2024 revenue'; \
                    instructions are not understood. With depth standard or deep: an instruction that says what \
                    to retrieve and from where, not what to conclude, for example 'Find the pricing page of \
                    Datadog and extract the plan names and per-host prices'; with deep, name the steps in order \
                    ('First find X. Then scrape it. Then extract Y.'). A URL written in the query is read by \
                    standard (one URL) and by deep (several). For LinkedIn, give the exact profile or company \
                    URL followed by 'Return the profile details.' or 'Return the recent posts.'. Do not write \
                    date ranges in the query: use fromDate, toDate or sinceDays.""")
            String query,
            @ToolParam(description = """
                    How much work the search does. One of: \
                    fast (about 1 s): one keyword lookup, no page reading; the choice for a simple fact. \
                    flash (under 200 ms, alpha): the same with the lowest latency and a rougher ranking. \
                    standard (1-3 s): the query is interpreted and can fan out into several searches, and one \
                    URL given in the query can be read; the choice when the question has several parts or \
                    carries instructions. \
                    deep (5-30 s, about ten times the price): several rounds of searching and reading where a \
                    step depends on what the previous one found (find a page, then read it); only when \
                    standard was not or cannot be enough.""")
            String depth,
            @ToolParam(description = """
                    The shape of the result. One of: \
                    searchResults: the ranked sources with their relevant passages, for you to reason over; \
                    the usual choice. \
                    sourcedAnswer: an answer written by Linkup, with its sources; when a ready-made answer \
                    is enough. \
                    structured: a JSON object that follows structuredOutputSchema; to extract named fields \
                    (prices, dates, lists of items).""")
            String outputType,
            @ToolParam(required = false, description = """
                    Needed with outputType structured, unused otherwise: a JSON Schema written as JSON text, \
                    whose root has "type": "object". Keep it shallow and give each property a description; \
                    word the query so that its answer contains the fields asked for.""")
            @Nullable String structuredOutputSchema,
            @ToolParam(required = false, description = """
                    With outputType structured only: true to also get the sources the data comes from.""")
            @Nullable Boolean includeSources,
            @ToolParam(required = false, description = """
                    With outputType sourcedAnswer only: true to get the citations inline in the answer.""")
            @Nullable Boolean includeInlineCitations,
            @ToolParam(required = false, description = """
                    true to also get relevant images (name and URL), when the user wants pictures.""")
            @Nullable Boolean includeImages,
            @ToolParam(required = false, description = """
                    Only pages published on or after this date, YYYY-MM-DD. Must be before toDate.""")
            @Nullable String fromDate,
            @ToolParam(required = false, description = """
                    Only pages published on or before this date, YYYY-MM-DD.""")
            @Nullable String toDate,
            @ToolParam(required = false, description = """
                    Only pages published in the last N days, counted from today: 1 for since yesterday, 7 for \
                    the last week, 30 for the last month. Use it for 'recent' or 'latest' requests when you \
                    do not know today's date; cannot be combined with fromDate.""")
            @Nullable Integer sinceDays,
            @ToolParam(required = false, description = """
                    Search only these domains (100 at most), for example ["lemonde.fr", "service-public.fr"]: \
                    when the user names the sources, or when only official or trusted ones will do.""")
            @Nullable List<String> includeDomains,
            @ToolParam(required = false, description = """
                    Leave these domains out of the results.""")
            @Nullable List<String> excludeDomains,
            @ToolParam(required = false, description = """
                    The most sources to return; left out, Linkup returns its default (10 to 20). Lower it \
                    (3 to 5) for a simple fact, raise it for a broad survey; the price of the search does not \
                    depend on it.""")
            @Nullable Integer maxResults) {
        return ToolSupport.answer("linkup_search", () -> {
            String type = ToolSupport.oneOf("outputType", outputType, SEARCH_OUTPUT_TYPES, "searchResults");
            boolean structured = "structured".equals(type);
            String schema = structured ? ToolSupport.schema("structuredOutputSchema", structuredOutputSchema) : null;
            if (structured && schema == null) {
                throw new InvalidArgument("outputType structured needs structuredOutputSchema.");
            }
            LocalDate today = LocalDate.now(clock);
            LocalDate from = ToolSupport.date("fromDate", fromDate);
            if (sinceDays != null) {
                if (from != null) {
                    throw new InvalidArgument("give either fromDate or sinceDays, not both.");
                }
                if (sinceDays < 1) {
                    throw new InvalidArgument("sinceDays must be 1 or more.");
                }
                from = today.minusDays(sinceDays);
            }
            LocalDate to = ToolSupport.date("toDate", toDate);
            ToolSupport.inOrder(from, to);
            if (maxResults != null && maxResults < 1) {
                throw new InvalidArgument("maxResults must be 1 or more.");
            }

            Findings findings = client.search(new SearchRequest(ToolSupport.required("query", query),
                    ToolSupport.oneOf("depth", depth, DEPTHS, "standard"), type, schema,
                    structured ? includeSources : null,
                    "sourcedAnswer".equals(type) ? includeInlineCitations : null, includeImages, from, to,
                    ToolSupport.includedDomains(includeDomains),
                    ToolSupport.domains(excludeDomains), maxResults));

            ObjectNode result = LinkupClient.JSON.createObjectNode().put("today", today.toString());
            ToolSupport.write(result, findings, maxResultChars);
            return result.toString();
        });
    }

    @Tool(name = "linkup_fetch", resultConverter = AsIsResultConverter.class, description = """
            Read one web page or PDF whose URL you know, as clean markdown. Use it when the user gives a \
            URL, or after linkup_search when the passages are not enough and you need the whole page. It \
            reads this URL only and follows no link. It is anonymous: a page behind a login comes back as a \
            logged-out visitor sees it, and LinkedIn URLs must go through linkup_search instead. Only HTML \
            and PDF: archives, images and videos are refused.""")
    public String fetch(
            @ToolParam(description = "The http or https URL of the page.")
            String url,
            @ToolParam(required = false, description = """
                    true to run the JavaScript of the page before reading it. Needed by pages rendered in the \
                    browser (single-page apps, dashboards, many recent sites): use it when unsure, and always \
                    when a first fetch came back nearly empty, with 'Loading...' or with sections missing. \
                    Slower and five times the price: leave it out for plainly static pages (articles, \
                    documentation, Wikipedia) and for PDFs.""")
            @Nullable Boolean renderJs,
            @ToolParam(required = false, description = """
                    How the page is retrieved. One of: standard, the default, for ordinary pages; pro, with a \
                    much higher success rate on pages that are hard to retrieve (sites that block robots), at \
                    five times the price: use it to try again when standard failed or returned a block page.""")
            @Nullable String mode,
            @ToolParam(required = false, description = """
                    true to also get the list of the images of the page (URL and alt text).""")
            @Nullable Boolean extractImages,
            @ToolParam(required = false, description = """
                    true to also get the page as it was served (the raw HTML) with its content type: only \
                    when the markdown loses a structure you need, like a complex table. It is large.""")
            @Nullable Boolean includeRawContent,
            @ToolParam(required = false, description = """
                    To also extract typed data from this page: a JSON Schema written as JSON text, whose root \
                    has "type": "object". The property descriptions say what to look for; what is not on the \
                    page is left out, never invented. Keep it shallow: plain fields and one level of arrays. \
                    The result then has a data object next to the markdown.""")
            @Nullable String schema,
            @ToolParam(required = false, description = """
                    With schema only: rules for the extraction that the schema cannot say, like 'public list \
                    prices only' or 'amounts in USD'. 4000 characters at most.""")
            @Nullable String instructions,
            @ToolParam(required = false, description = """
                    Where the returned markdown starts, in characters; 0 when left out. A long page is cut: \
                    its result then gives the nextOffset to pass here to read on.""")
            @Nullable Integer offset) {
        return ToolSupport.answer("linkup_fetch", () -> {
            String address = ToolSupport.required("url", url);
            if (!address.matches("(?i)https?://\\S+")) {
                throw new InvalidArgument("url must be a full http or https URL, not '" + address + "'.");
            }
            String extractionSchema = ToolSupport.schema("schema", schema);
            String rules = ToolSupport.optional(instructions);
            if (rules != null && extractionSchema == null) {
                throw new InvalidArgument("instructions only applies with a schema.");
            }
            if (rules != null && rules.length() > 4000) {
                throw new InvalidArgument("instructions is limited to 4000 characters.");
            }
            int start = (offset != null) ? offset : 0;
            if (start < 0) {
                throw new InvalidArgument("offset must be 0 or more.");
            }

            Page page = client.fetch(new FetchRequest(address, ToolSupport.oneOf("mode", mode, FETCH_MODES, null),
                    renderJs, extractImages, includeRawContent, extractionSchema, rules));

            String markdown = page.markdown();
            if (start > 0 && start >= markdown.length()) {
                throw new InvalidArgument(
                        "offset %d is past the end of the page, which has %d characters.".formatted(start, markdown.length()));
            }
            int end = Math.min(markdown.length(), start + maxResultChars);
            ObjectNode result = LinkupClient.JSON.createObjectNode()
                    .put("url", address)
                    .put("markdown", markdown.substring(start, end));
            if (start > 0 || end < markdown.length()) {
                result.put("totalChars", markdown.length());
            }
            if (end < markdown.length()) {
                result.put("nextOffset", end);
            }
            if (page.data() != null) {
                result.set("data", page.data());
            }
            if (!page.images().isEmpty()) {
                ArrayNode images = result.putArray("images");
                page.images().forEach(image -> images.addObject().put("alt", image.alt()).put("url", image.url()));
            }
            if (page.rawContent() != null) {
                result.put("contentType", page.contentType());
                result.put("rawContent", ToolSupport.cut(page.rawContent(), maxResultChars, "the raw content is longer"));
            }
            return result.toString();
        });
    }

    @Tool(name = "linkup_credit_balance", resultConverter = AsIsResultConverter.class, description = """
            The credits left on the Linkup account that pays for the web tools. Use it when the user asks, \
            or to check after a tool reported that the credits may be exhausted.""")
    public String creditBalance() {
        return ToolSupport.answer("linkup_credit_balance",
                () -> LinkupClient.JSON.createObjectNode().put("balance", client.creditBalance()).toString());
    }
}
