package io.github.mattserra06.agent.linkup;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import io.github.mattserra06.agent.linkup.LinkupException.Kind;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.util.Assert;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * The Linkup HTTP API (https://docs.linkup.so): web search, page fetch, research tasks
 * and the credit balance. Every call sends the API key as a bearer token and either
 * returns what the API answered or throws a {@link LinkupException} that says what went
 * wrong. The key is never logged nor put in an exception.
 */
public class LinkupClient {

    private static final Logger log = LoggerFactory.getLogger(LinkupClient.class);

    static final JsonMapper JSON = JsonMapper.builder().build();

    private final HttpClient http;
    private final String baseUrl;
    private final String apiKey;
    private final Duration timeout;

    public LinkupClient(LinkupProperties properties) {
        Assert.state(properties.hasApiKey(), "The Linkup client needs an API key");
        this.http = HttpClient.newBuilder().connectTimeout(properties.connectTimeout()).build();
        this.baseUrl = properties.baseUrl().replaceAll("/+$", "");
        this.apiKey = properties.apiKey().strip();
        this.timeout = properties.timeout();
    }

    /** {@code POST /search}. */
    public Findings search(SearchRequest request) {
        JsonNode answer = call("/search", request.body());
        boolean structured = "structured".equals(request.outputType());
        if (structured && Boolean.TRUE.equals(request.includeSources())) {
            // Asking for the sources moves the structured object under "data"
            return new Findings(null, sources(required(answer, "sources")), required(answer, "data"));
        }
        return structured ? new Findings(null, List.of(), answer) : findings(answer);
    }

    /** {@code POST /fetch}. */
    public Page fetch(FetchRequest request) {
        JsonNode answer = call("/fetch", request.body());
        List<Image> images = new ArrayList<>();
        for (JsonNode image : answer.path("images")) {
            images.add(new Image(text(image, "alt"), required(image, "url").asString()));
        }
        String rawContent = text(answer, "rawContent");
        return new Page(required(answer, "markdown").asString(), answer.path("data").isObject() ? answer.get("data") : null,
                List.copyOf(images), (rawContent != null) ? rawContent : text(answer, "rawHtml"),
                text(answer, "contentType"));
    }

    /** {@code POST /research}: starts a task and returns at once; read it with {@link #research}. */
    public ResearchTask startResearch(ResearchRequest request) {
        return researchTask(call("/research", request.body()));
    }

    /** {@code GET /research/{id}}. */
    public ResearchTask research(String id) {
        return researchTask(call("/research/" + URLEncoder.encode(id, StandardCharsets.UTF_8), null));
    }

    /** {@code GET /credits/balance}: the credits left on the account. */
    public double creditBalance() {
        return required(call("/credits/balance", null), "balance").asDouble();
    }

    /**
     * Sends a JSON body with POST, or nothing with GET, and returns the JSON object the
     * API answered.
     */
    private JsonNode call(String path, @Nullable ObjectNode body) {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(timeout)
                .header("Authorization", "Bearer " + apiKey)
                .header("Accept", "application/json");
        if (body != null) {
            request.header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body)));
        }
        try {
            HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() / 100 != 2) {
                throw failure(response.statusCode(), response.body());
            }
            return object(response.statusCode(), response.body());
        }
        catch (HttpTimeoutException ex) {
            throw logged(path, new LinkupException(Kind.TIMEOUT, "no answer within " + timeout.toSeconds() + " s", ex));
        }
        catch (IOException ex) {
            throw logged(path, new LinkupException(Kind.UNREACHABLE, ex.toString(), ex));
        }
        catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw logged(path, new LinkupException(Kind.TIMEOUT, "the call was interrupted", ex));
        }
        catch (LinkupException ex) {
            throw logged(path, ex);
        }
    }

    private static LinkupException logged(String path, LinkupException failure) {
        log.warn("Linkup call {} failed: {}", path, failure.getMessage());
        return failure;
    }

    private static JsonNode object(int status, String body) {
        try {
            JsonNode answer = JSON.readTree(body);
            if (answer != null && answer.isObject()) {
                return answer;
            }
        }
        catch (JacksonException notJson) {
            // Reported below
        }
        throw new LinkupException(Kind.SERVER_ERROR, status, null, "the answer is not a JSON object", null);
    }

    /**
     * Reads the error payload the API sends with every failure:
     * {@code {"statusCode", "error": {"code", "message", "details": [{"field", "message"}]}}}.
     */
    private static LinkupException failure(int status, String body) {
        String code = null;
        String detail = null;
        try {
            JsonNode error = JSON.readTree(body).path("error");
            code = text(error, "code");
            StringBuilder message = new StringBuilder(error.path("message").asString(""));
            for (JsonNode fieldError : error.path("details")) {
                message.append((message.isEmpty()) ? "" : "; ")
                        .append(fieldError.path("field").asString(""))
                        .append(": ")
                        .append(fieldError.path("message").asString(""));
            }
            detail = message.toString();
        }
        catch (JacksonException notJson) {
            // A proxy answered, not the API: the status is all there is to say
        }
        return new LinkupException(kind(status, code), status, code, (detail == null || detail.isBlank()) ? null : detail,
                null);
    }

    private static Kind kind(int status, @Nullable String code) {
        String name = (code != null) ? code : "";
        return switch (status) {
            case 400 -> name.equals("SEARCH_QUERY_NO_RESULT") ? Kind.NO_RESULT
                    : name.startsWith("FETCH_") ? Kind.FETCH_FAILED : Kind.INVALID_REQUEST;
            // 402 is what the API answers when it sees no key: it then asks for an x402 payment
            case 401, 402, 403 -> Kind.UNAUTHORIZED;
            case 404 -> Kind.NOT_FOUND;
            case 429 -> switch (name) {
                case "INSUFFICIENT_FUNDS_CREDITS", "EXCEED_BUDGET_LIMIT" -> Kind.OUT_OF_CREDITS;
                case "TOO_MANY_REQUESTS", "TASKS_QUEUE_LIMIT_EXCEEDED" -> Kind.RATE_LIMITED;
                default -> Kind.TOO_MANY_REQUESTS;
            };
            case 504 -> Kind.TIMEOUT;
            default -> (status >= 500) ? Kind.SERVER_ERROR : Kind.INVALID_REQUEST;
        };
    }

    /** An answer with sources: {@code {"answer", "sources"}}, or {@code {"results"}} alone. */
    private static Findings findings(JsonNode answer) {
        if (answer.has("results")) {
            return new Findings(null, sources(answer.get("results")), null);
        }
        return new Findings(required(answer, "answer").asString(), sources(required(answer, "sources")), null);
    }

    private static List<Source> sources(JsonNode array) {
        List<Source> sources = new ArrayList<>();
        for (JsonNode source : array) {
            // A search result carries its passage as "content", the source of an answer as "snippet"
            String content = text(source, "content");
            sources.add(new Source(source.path("type").asString("text"), source.path("name").asString(""),
                    required(source, "url").asString(), (content != null) ? content : text(source, "snippet"),
                    text(source, "publishedAt")));
        }
        return List.copyOf(sources);
    }

    private static ResearchTask researchTask(JsonNode task) {
        String status = required(task, "status").asString();
        JsonNode output = task.path("output");
        Findings findings = null;
        if (output.isObject()) {
            boolean structured = "structured".equals(task.path("input").path("outputType").asString(""));
            findings = structured ? new Findings(null, List.of(), output) : findings(output);
        }
        return new ResearchTask(required(task, "id").asString(), status, text(task, "error"), findings);
    }

    private static JsonNode required(JsonNode node, String field) {
        JsonNode value = node.get(field);
        if (value == null || value.isNull()) {
            throw new LinkupException(Kind.SERVER_ERROR, "the answer has no '" + field + "'", null);
        }
        return value;
    }

    private static @Nullable String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return (value != null && value.isString()) ? value.stringValue() : null;
    }

    private static void put(ObjectNode body, String field, List<String> values) {
        if (!values.isEmpty()) {
            values.forEach(body.putArray(field)::add);
        }
    }

    /**
     * The parameters of a search, named as the API names them. {@code null} and empty
     * ones are left out of the request, so the API applies its defaults.
     *
     * @param query sent as {@code q}
     * @param depth {@code flash}, {@code fast}, {@code standard} or {@code deep}
     * @param outputType {@code searchResults}, {@code sourcedAnswer} or {@code structured}
     * @param structuredOutputSchema a JSON Schema, as JSON text; needed by {@code structured}
     */
    public record SearchRequest(String query, String depth, String outputType,
                                @Nullable String structuredOutputSchema, @Nullable Boolean includeSources,
                                @Nullable Boolean includeInlineCitations, @Nullable Boolean includeImages,
                                @Nullable LocalDate fromDate, @Nullable LocalDate toDate,
                                List<String> includeDomains, List<String> excludeDomains,
                                @Nullable Integer maxResults) {

        ObjectNode body() {
            ObjectNode body = JSON.createObjectNode()
                    .put("q", query)
                    .put("depth", depth)
                    .put("outputType", outputType);
            if (structuredOutputSchema != null) {
                body.put("structuredOutputSchema", structuredOutputSchema);
            }
            if (includeSources != null) {
                body.put("includeSources", includeSources);
            }
            if (includeInlineCitations != null) {
                body.put("includeInlineCitations", includeInlineCitations);
            }
            if (includeImages != null) {
                body.put("includeImages", includeImages);
            }
            if (fromDate != null) {
                body.put("fromDate", fromDate.toString());
            }
            if (toDate != null) {
                body.put("toDate", toDate.toString());
            }
            LinkupClient.put(body, "includeDomains", includeDomains);
            LinkupClient.put(body, "excludeDomains", excludeDomains);
            if (maxResults != null) {
                body.put("maxResults", maxResults);
            }
            return body;
        }
    }

    /**
     * The parameters of a page fetch, named as the API names them.
     *
     * @param mode {@code standard} or {@code pro}
     * @param schema a JSON Schema, as JSON text, of the data to extract from the page
     * @param instructions rules for that extraction; the API refuses them without a schema
     */
    public record FetchRequest(String url, @Nullable String mode, @Nullable Boolean renderJs,
                               @Nullable Boolean extractImages, @Nullable Boolean includeRawContent,
                               @Nullable String schema, @Nullable String instructions) {

        ObjectNode body() {
            ObjectNode body = JSON.createObjectNode().put("url", url);
            if (mode != null) {
                body.put("mode", mode);
            }
            if (renderJs != null) {
                body.put("renderJs", renderJs);
            }
            if (extractImages != null) {
                body.put("extractImages", extractImages);
            }
            if (includeRawContent != null) {
                body.put("includeRawContent", includeRawContent);
            }
            if (schema != null) {
                body.put("schema", schema);
            }
            if (instructions != null) {
                body.put("instructions", instructions);
            }
            return body;
        }
    }

    /**
     * The parameters of a research task, named as the API names them.
     *
     * @param query sent as {@code q}
     * @param outputType {@code sourcedAnswer} or {@code structured}
     * @param mode {@code answer}, {@code investigate} or {@code research}; the API picks
     * one when it is left out
     * @param reasoningDepth {@code S}, {@code M}, {@code L} or {@code XL}
     */
    public record ResearchRequest(String query, String outputType, @Nullable String mode,
                                  @Nullable String reasoningDepth, @Nullable String structuredOutputSchema,
                                  @Nullable LocalDate fromDate, @Nullable LocalDate toDate,
                                  List<String> includeDomains, List<String> excludeDomains) {

        ObjectNode body() {
            ObjectNode body = JSON.createObjectNode().put("q", query).put("outputType", outputType);
            if (mode != null) {
                body.put("mode", mode);
            }
            if (reasoningDepth != null) {
                body.put("reasoningDepth", reasoningDepth);
            }
            if (structuredOutputSchema != null) {
                body.put("structuredOutputSchema", structuredOutputSchema);
            }
            if (fromDate != null) {
                body.put("fromDate", fromDate.toString());
            }
            if (toDate != null) {
                body.put("toDate", toDate.toString());
            }
            LinkupClient.put(body, "includeDomains", includeDomains);
            LinkupClient.put(body, "excludeDomains", excludeDomains);
            return body;
        }
    }

    /**
     * What a search or a research found.
     *
     * @param answer the answer Linkup wrote, for the {@code sourcedAnswer} output
     * @param sources the search results, or the sources of the answer or of the data
     * @param data the object matching the caller's schema, for the {@code structured} output
     */
    public record Findings(@Nullable String answer, List<Source> sources, @Nullable JsonNode data) {
    }

    /**
     * @param type {@code text} or {@code image}
     * @param content the passage of the page that is relevant to the query; none for an image
     * @param publishedAt the publication date of the page (YYYY-MM-DD), when Linkup knows it
     */
    public record Source(String type, String name, String url, @Nullable String content,
                         @Nullable String publishedAt) {

        public boolean isImage() {
            return "image".equals(type);
        }
    }

    /**
     * A fetched page.
     *
     * @param data what was extracted for the request's schema
     * @param images the images of the page, when the request asked for them
     * @param rawContent the page as it was served, when the request asked for it
     * @param contentType what {@code rawContent} is, for instance {@code html}
     */
    public record Page(String markdown, @Nullable JsonNode data, List<Image> images, @Nullable String rawContent,
                       @Nullable String contentType) {
    }

    public record Image(@Nullable String alt, String url) {
    }

    /**
     * @param status {@code pending}, {@code processing}, {@code completed} or {@code failed}
     * @param error why it failed
     * @param output what it found, once completed
     */
    public record ResearchTask(String id, String status, @Nullable String error, @Nullable Findings output) {

        public boolean isOver() {
            return "completed".equals(status) || "failed".equals(status);
        }
    }
}
