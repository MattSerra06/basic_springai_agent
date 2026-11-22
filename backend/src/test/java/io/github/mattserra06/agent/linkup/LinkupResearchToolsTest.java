package io.github.mattserra06.agent.linkup;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

/** The research tools as the model calls them, against a local server. */
class LinkupResearchToolsTest {

    private static final String PENDING = task("pending", "sourcedAnswer", "null", "null");

    private static final String PROCESSING = task("processing", "sourcedAnswer", "null", "null");

    private static final String COMPLETED = task("completed", "sourcedAnswer", "null", """
            {"answer": "Microsoft Cloud rose 23% [1].",
             "sources": [{"name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                          "snippet": "Microsoft Cloud revenue increased 23%.", "favicon": ""}]}""");

    private final FakeLinkup linkup = new FakeLinkup();

    private final LinkupResearchTools tools = tools(Duration.ofSeconds(2));

    @AfterEach
    void stopServer() {
        linkup.close();
    }

    @Test
    void startingAResearchSendsOnlyWhatWasChosenAndReturnsTheTaskId() {
        linkup.replies(PENDING);

        String result = tools.start("Compare the 2024 cloud revenue growth of Microsoft, Amazon, and Google.", "S",
                null, null, null, null, null, null, null);

        assertThat(linkup.call().method()).isEqualTo("POST");
        assertThat(linkup.call().path()).isEqualTo("/v1/research");
        assertThat(linkup.call().authorization()).isEqualTo("Bearer " + FakeLinkup.API_KEY);
        assertThat(linkup.call().json()).isEqualTo(json("""
                {"q": "Compare the 2024 cloud revenue growth of Microsoft, Amazon, and Google.",
                 "outputType": "sourcedAnswer", "reasoningDepth": "S"}"""));
        assertThat(json(result).path("id").asString()).isEqualTo("task-1");
        assertThat(json(result).path("status").asString()).isEqualTo("pending");
        assertThat(json(result).path("note").asString()).contains("linkup_research_result");
    }

    @Test
    void everyResearchOptionIsSentUnderTheApisName() {
        linkup.replies(PENDING);
        String schema = "{\"type\": \"object\", \"properties\": {\"providers\": {\"type\": \"array\"}}}";

        tools.start("European AI inference providers", "xl", "research", "structured", schema, "2026-01-01",
                "2026-06-30", List.of("mistral.ai"), List.of("wikipedia.org"));

        assertThat(linkup.call().json()).isEqualTo(JsonMapper.shared().createObjectNode()
                .put("q", "European AI inference providers")
                .put("outputType", "structured")
                .put("mode", "research")
                .put("reasoningDepth", "XL")
                .put("structuredOutputSchema", "{\"type\":\"object\",\"properties\":{\"providers\":{\"type\":\"array\"}}}")
                .put("fromDate", "2026-01-01")
                .put("toDate", "2026-06-30")
                .set("includeDomains", json("[\"mistral.ai\"]"))
                .set("excludeDomains", json("[\"wikipedia.org\"]")));
    }

    @ParameterizedTest
    @CsvSource({ "answer", "investigate", "research" })
    void everyModeIsSentAsTheApiNamesIt(String mode) {
        linkup.replies(PENDING);

        tools.start("question", "M", mode, null, null, null, null, null, null);

        assertThat(linkup.call().json().path("mode").asString()).isEqualTo(mode);
        assertThat(linkup.call().json().path("reasoningDepth").asString()).isEqualTo("M");
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "'' | S | | | | | query is required",
            "q | | | | | | reasoningDepth is required: S, M, L or XL",
            "q | XXL | | | | | reasoningDepth must be one of S, M, L, XL, not 'XXL'",
            "q | S | auto-pilot | | | | mode must be one of answer, investigate, research",
            "q | S | | searchResults | | | outputType must be one of sourcedAnswer, structured",
            "q | S | | structured | | | outputType structured needs structuredOutputSchema",
            "q | S | | | 2026-06-30 | 2026-01-01 | fromDate (2026-06-30) must be before toDate (2026-01-01)" })
    void aWrongArgumentComesBackAsAResultWithoutStartingAPaidTask(String query, String depth, String mode,
            String outputType, String fromDate, String toDate, String expected) {
        String result = tools.start(query, depth, mode, outputType, null, fromDate, toDate, null, null);

        assertThat(result).startsWith("Invalid call to linkup_research_start: ").contains(expected);
        assertThat(linkup.calls).isEmpty();
    }

    @Test
    void theResultIsWaitedForUntilTheTaskCompletes() {
        linkup.replies(PENDING).replies(PROCESSING).replies(COMPLETED);

        String result = tools.result("task-1", 2);

        assertThat(linkup.calls).extracting(FakeLinkup.Call::method, FakeLinkup.Call::path)
                .hasSize(3)
                .containsOnly(org.assertj.core.api.Assertions.tuple("GET", "/v1/research/task-1"));
        assertThat(json(result)).isEqualTo(json("""
                {"id": "task-1", "status": "completed", "answer": "Microsoft Cloud rose 23% [1].",
                 "sources": [{"name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                              "content": "Microsoft Cloud revenue increased 23%."}]}"""));
    }

    @Test
    void aStructuredResultIsGivenAsItCame() {
        linkup.replies(task("completed", "structured", "null", "{\"providers\": [\"Mistral\"]}"));

        assertThat(json(tools.result("task-1", 0))).isEqualTo(json("""
                {"id": "task-1", "status": "completed", "data": {"providers": ["Mistral"]}, "sources": []}"""));
    }

    @Test
    void aTaskThatIsStillRunningIsReportedAsSuchOnceTheWaitIsOver() {
        linkup.replies(PROCESSING);

        JsonNode result = json(tools.result("task-1", 0));

        assertThat(linkup.calls).hasSize(1);
        assertThat(result.path("status").asString()).isEqualTo("processing");
        assertThat(result.path("note").asString()).startsWith("Still running after 0 s.");
        assertThat(result.has("answer")).isFalse();
    }

    @Test
    void theWaitIsCappedByTheServer() {
        LinkupResearchTools capped = tools(Duration.ofMillis(60));
        for (int i = 0; i < 50; i++) {
            linkup.replies(PROCESSING);
        }

        long started = System.nanoTime();
        JsonNode result = json(capped.result("task-1", 3600));

        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(2));
        assertThat(result.path("status").asString()).isEqualTo("processing");
        assertThat(linkup.calls.size()).isBetween(1, 10);
    }

    @Test
    void aFailedTaskGivesItsReason() {
        linkup.replies(task("failed", "sourcedAnswer", "\"The research returned no result\"", "null"));

        assertThat(json(tools.result("task-1", 30))).isEqualTo(json("""
                {"id": "task-1", "status": "failed", "error": "The research returned no result"}"""));
    }

    @Test
    void failuresOfTheApiAreResultsTheModelCanActOn() {
        linkup.replies(404, "{\"statusCode\": 404, \"error\": {\"code\": \"TASK_NOT_FOUND\", \"message\": \"Task not found\"}}")
                .replies(429, "{\"statusCode\": 429, \"error\": {\"code\": \"INSUFFICIENT_FUNDS_CREDITS\", \"message\": \"No credits\"}}");

        assertThat(tools.result("unknown", 0)).isEqualTo("Linkup error: Linkup does not know this identifier. Use the "
                + "id returned by linkup_research_start.\nDetails (HTTP 404 TASK_NOT_FOUND): Task not found");
        assertThat(tools.start("question", "S", null, null, null, null, null, null, null))
                .startsWith("Linkup error: The Linkup account has no credits left")
                .doesNotContain(FakeLinkup.API_KEY);
        assertThat(tools.result(" ", 0)).isEqualTo("Invalid call to linkup_research_result: id is required.");
    }

    private LinkupResearchTools tools(Duration maxWait) {
        LinkupProperties defaults = linkup.properties();
        LinkupProperties properties = new LinkupProperties(defaults.apiKey(), defaults.baseUrl(),
                defaults.connectTimeout(), defaults.timeout(), defaults.maxResultChars(), defaults.instructions(),
                new LinkupProperties.Research(true, Duration.ofMillis(10), maxWait));
        return new LinkupResearchTools(new LinkupClient(properties), properties);
    }

    /** A research task as the API returns it from POST /research and GET /research/{id}. */
    private static String task(String status, String outputType, String error, String output) {
        return """
                {"id": "task-1", "type": "research", "status": "%s", "error": %s, "output": %s,
                 "input": {"q": "question", "outputType": "%s", "mode": "auto", "reasoningDepth": "S"},
                 "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:08:42.000Z"}"""
                .formatted(status, error, output, outputType);
    }

    private static JsonNode json(String text) {
        return JsonMapper.shared().readTree(text);
    }
}
