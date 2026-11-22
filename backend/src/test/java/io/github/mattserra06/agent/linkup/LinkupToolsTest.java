package io.github.mattserra06.agent.linkup;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The tools as the model calls them, against a local server: the request each option
 * produces, the result the model reads, and failures worded as results.
 */
class LinkupToolsTest {

    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-11-22T10:00:00Z"), ZoneOffset.UTC);

    private static final String SCHEMA = """
            {"type": "object", "properties": {"revenue": {"type": "number", "description": "In billion USD"}}}""";

    private static final String COMPACT_SCHEMA =
            "{\"type\":\"object\",\"properties\":{\"revenue\":{\"type\":\"number\",\"description\":\"In billion USD\"}}}";

    private final FakeLinkup linkup = new FakeLinkup();

    private final LinkupTools tools = tools(2000);

    @AfterEach
    void stopServer() {
        linkup.close();
    }

    // linkup_search: the request

    @Test
    void aPlainSearchSendsOnlyWhatTheApiRequires() {
        linkup.replies("{\"results\": []}");

        tools.search("NVIDIA Q4 2024 revenue", "fast", "searchResults", null, null, null, null, null, null, null,
                null, null, null);

        assertThat(linkup.call().method()).isEqualTo("POST");
        assertThat(linkup.call().path()).isEqualTo("/v1/search");
        assertThat(linkup.call().authorization()).isEqualTo("Bearer " + FakeLinkup.API_KEY);
        assertThat(linkup.call().json()).isEqualTo(json("""
                {"q": "NVIDIA Q4 2024 revenue", "depth": "fast", "outputType": "searchResults"}"""));
    }

    @ParameterizedTest
    @CsvSource({ "flash", "fast", "standard", "deep" })
    void everyDepthIsSentAsTheApiNamesIt(String depth) {
        linkup.replies("{\"results\": []}");

        tools.search("query", depth, "searchResults", null, null, null, null, null, null, null, null, null, null);

        assertThat(linkup.call().json().path("depth").asString()).isEqualTo(depth);
    }

    @Test
    void aSearchWithoutDepthOrOutputTypeIsAStandardSearchForResults() {
        linkup.replies("{\"results\": []}");

        tools.search("query", null, " ", null, null, null, null, null, null, null, null, null, null);

        assertThat(linkup.call().json()).isEqualTo(json("""
                {"q": "query", "depth": "standard", "outputType": "searchResults"}"""));
    }

    @Test
    void filtersImagesAndTheResultCountAreSentUnderTheApisNames() {
        linkup.replies("{\"results\": []}");

        tools.search("Latest ECB interest rate decision", "standard", "searchResults", null, null, null, true,
                "2026-01-01", "2026-03-31", null, List.of("ecb.europa.eu", " reuters.com "), List.of("wikipedia.org"), 5);

        assertThat(linkup.call().json()).isEqualTo(json("""
                {"q": "Latest ECB interest rate decision", "depth": "standard", "outputType": "searchResults",
                 "includeImages": true, "fromDate": "2026-01-01", "toDate": "2026-03-31",
                 "includeDomains": ["ecb.europa.eu", "reuters.com"], "excludeDomains": ["wikipedia.org"],
                 "maxResults": 5}"""));
    }

    @Test
    void sinceDaysBecomesAFromDateCountedFromToday() {
        linkup.replies("{\"results\": []}");

        tools.search("OpenAI news", "standard", "searchResults", null, null, null, null, null, null, 7, null, null,
                null);

        assertThat(linkup.call().json()).isEqualTo(json("""
                {"q": "OpenAI news", "depth": "standard", "outputType": "searchResults", "fromDate": "2026-11-15"}"""));
    }

    @Test
    void aSourcedAnswerCanAskForInlineCitations() {
        linkup.replies("{\"answer\": \"Answer\", \"sources\": []}");

        // includeSources belongs to the structured output: it is not sent here
        tools.search("query", "deep", "sourcedAnswer", SCHEMA, true, true, null, null, null, null, null, null, null);

        assertThat(linkup.call().json()).isEqualTo(json("""
                {"q": "query", "depth": "deep", "outputType": "sourcedAnswer", "includeInlineCitations": true}"""));
    }

    @Test
    void aStructuredSearchSendsItsSchemaAsJsonTextAndCanAskForSources() {
        linkup.replies("{\"data\": {\"revenue\": 245.1}, \"sources\": []}");

        // includeInlineCitations belongs to the sourced answer: it is not sent here
        tools.search("Microsoft 2024 revenue", "standard", "structured", SCHEMA, true, true, null, null, null, null,
                null, null, null);

        JsonNode body = linkup.call().json();
        assertThat(body.path("structuredOutputSchema").isString()).isTrue();
        assertThat(body).isEqualTo(JsonMapper.shared().createObjectNode()
                .put("q", "Microsoft 2024 revenue")
                .put("depth", "standard")
                .put("outputType", "structured")
                .put("structuredOutputSchema", COMPACT_SCHEMA)
                .put("includeSources", true));
    }

    // linkup_search: the result

    @Test
    void searchResultsAreGivenToTheModelWithTodaysDateAndTheImagesApart() {
        linkup.replies("""
                {"results": [
                  {"type": "text", "name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                   "content": "Revenue was $245.1 billion.", "favicon": "https://www.microsoft.com/favicon.ico",
                   "publishedAt": "2024-07-30"},
                  {"type": "image", "name": "Chart", "url": "https://example.com/chart.png"}]}""");

        String result = tools.search("query", "standard", "searchResults", null, null, null, true, null, null, null,
                null, null, null);

        assertThat(json(result)).isEqualTo(json("""
                {"today": "2026-11-22",
                 "sources": [{"name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                              "publishedAt": "2024-07-30", "content": "Revenue was $245.1 billion."}],
                 "images": [{"name": "Chart", "url": "https://example.com/chart.png"}]}"""));
    }

    @Test
    void aSourcedAnswerIsGivenWithItsSources() {
        linkup.replies("""
                {"answer": "Revenue was $245.1 billion [1].",
                 "sources": [{"name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                              "snippet": "Revenue was $245.1 billion.", "favicon": ""}]}""");

        String result = tools.search("query", "standard", "sourcedAnswer", null, null, true, null, null, null, null,
                null, null, null);

        assertThat(json(result)).isEqualTo(json("""
                {"today": "2026-11-22", "answer": "Revenue was $245.1 billion [1].",
                 "sources": [{"name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                              "content": "Revenue was $245.1 billion."}]}"""));
    }

    @Test
    void structuredDataIsGivenAsItCameWithItsSourcesWhenAskedFor() {
        linkup.replies("{\"revenue\": 245.1}").replies("""
                {"data": {"revenue": 245.1},
                 "sources": [{"type": "text", "name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                              "content": "Revenue was $245.1 billion.", "favicon": ""}]}""");

        String alone = tools.search("query", "standard", "structured", SCHEMA, null, null, null, null, null, null,
                null, null, null);
        String withSources = tools.search("query", "standard", "structured", SCHEMA, true, null, null, null, null,
                null, null, null, null);

        assertThat(json(alone)).isEqualTo(json("{\"today\": \"2026-11-22\", \"data\": {\"revenue\": 245.1}, \"sources\": []}"));
        assertThat(json(withSources)).isEqualTo(json("""
                {"today": "2026-11-22", "data": {"revenue": 245.1},
                 "sources": [{"name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                              "content": "Revenue was $245.1 billion."}]}"""));
    }

    @Test
    void longPassagesShareTheSizeLimitOfAResult() {
        String passage = "x".repeat(900);
        linkup.replies("""
                {"results": [
                  {"type": "text", "name": "A", "url": "https://example.com/a", "content": "%s", "favicon": ""},
                  {"type": "text", "name": "B", "url": "https://example.com/b", "content": "short", "favicon": ""}]}"""
                .formatted(passage));

        String result = tools(1000).search("query", "standard", "searchResults", null, null, null, null, null, null,
                null, null, null, null);

        JsonNode sources = json(result).path("sources");
        assertThat(sources.get(0).path("content").asString())
                .startsWith("x".repeat(500) + " […cut, 400 more characters")
                .contains("linkup_fetch");
        assertThat(sources.get(1).path("content").asString()).isEqualTo("short");
    }

    // linkup_search: arguments the model must correct

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "'' | standard | searchResults | | | | | query is required",
            "q | thorough | searchResults | | | | | depth must be one of flash, fast, standard, deep, not 'thorough'",
            "q | standard | answer | | | | | outputType must be one of searchResults, sourcedAnswer, structured",
            "q | standard | structured | | | | | outputType structured needs structuredOutputSchema",
            "q | standard | structured | {not json | | | | structuredOutputSchema must be a JSON Schema written as JSON text",
            "q | standard | structured | {\"type\": \"array\"} | | | | whose root has \"type\": \"object\"",
            "q | standard | searchResults | | last week | | | fromDate must be a date written YYYY-MM-DD, not 'last week'",
            "q | standard | searchResults | | | 31/03/2026 | | toDate must be a date written YYYY-MM-DD",
            "q | standard | searchResults | | 2026-03-31 | 2026-01-01 | | fromDate (2026-03-31) must be before toDate (2026-01-01)",
            "q | standard | searchResults | | 2026-03-31 | | 7 | give either fromDate or sinceDays, not both",
            "q | standard | searchResults | | | | 0 | sinceDays must be 1 or more" })
    void aWrongArgumentComesBackAsAResultWithoutCallingTheApi(String query, String depth, String outputType,
            String schema, String fromDate, String toDate, Integer sinceDays, String expected) {
        String result = tools.search(query, depth, outputType, schema, null, null, null, fromDate, toDate, sinceDays,
                null, null, null);

        assertThat(result).startsWith("Invalid call to linkup_search: ").contains(expected);
        assertThat(linkup.calls).isEmpty();
    }

    @Test
    void tooManyDomainsOrAResultCountOfZeroIsRefusedBeforeTheApi() {
        List<String> domains = java.util.stream.IntStream.range(0, 101).mapToObj(i -> "site" + i + ".com").toList();

        assertThat(tools.search("q", "standard", "searchResults", null, null, null, null, null, null, null, domains,
                null, null)).isEqualTo("Invalid call to linkup_search: includeDomains takes at most 100 domains.");
        assertThat(tools.search("q", "standard", "searchResults", null, null, null, null, null, null, null, null,
                null, 0)).isEqualTo("Invalid call to linkup_search: maxResults must be 1 or more.");
        assertThat(linkup.calls).isEmpty();
    }

    // linkup_fetch

    @Test
    void aPlainFetchSendsOnlyTheUrl() {
        linkup.replies("{\"markdown\": \"# Linkup docs\", \"favicon\": \"\"}");

        String result = tools.fetch("https://docs.linkup.so", null, null, null, null, null, null, null);

        assertThat(linkup.call().path()).isEqualTo("/v1/fetch");
        assertThat(linkup.call().json()).isEqualTo(json("{\"url\": \"https://docs.linkup.so\"}"));
        assertThat(json(result)).isEqualTo(json("{\"url\": \"https://docs.linkup.so\", \"markdown\": \"# Linkup docs\"}"));
    }

    @Test
    void everyFetchOptionIsSentUnderTheApisName() {
        linkup.replies("""
                {"markdown": "# Careers", "favicon": "",
                 "data": {"jobs": [{"position": "DevRel"}]},
                 "images": [{"alt": "Logo", "url": "https://linkup.so/logo.svg"}],
                 "rawContent": "<html></html>", "contentType": "html"}""");

        String result = tools.fetch("https://www.linkup.so/careers", true, "pro", true, true, SCHEMA,
                "Use public list prices only.", null);

        assertThat(linkup.call().json()).isEqualTo(JsonMapper.shared().createObjectNode()
                .put("url", "https://www.linkup.so/careers")
                .put("mode", "pro")
                .put("renderJs", true)
                .put("extractImages", true)
                .put("includeRawContent", true)
                .put("schema", COMPACT_SCHEMA)
                .put("instructions", "Use public list prices only."));
        assertThat(json(result)).isEqualTo(json("""
                {"url": "https://www.linkup.so/careers", "markdown": "# Careers",
                 "data": {"jobs": [{"position": "DevRel"}]},
                 "images": [{"alt": "Logo", "url": "https://linkup.so/logo.svg"}],
                 "contentType": "html", "rawContent": "<html></html>"}"""));
    }

    @Test
    void aLongPageIsCutAndReadOnFromTheOffsetItGives() {
        String page = "a".repeat(1000) + "b".repeat(500);
        String reply = "{\"markdown\": \"" + page + "\", \"favicon\": \"\"}";
        linkup.replies(reply).replies(reply);
        LinkupTools small = tools(1000);

        JsonNode first = json(small.fetch("https://example.com/long", null, null, null, null, null, null, null));
        JsonNode second = json(small.fetch("https://example.com/long", null, null, null, null, null, null,
                first.path("nextOffset").asInt()));

        assertThat(first.path("markdown").asString()).isEqualTo("a".repeat(1000));
        assertThat(first.path("totalChars").asInt()).isEqualTo(1500);
        assertThat(first.path("nextOffset").asInt()).isEqualTo(1000);
        assertThat(second.path("markdown").asString()).isEqualTo("b".repeat(500));
        assertThat(second.path("totalChars").asInt()).isEqualTo(1500);
        assertThat(second.has("nextOffset")).isFalse();
        // The offset is the tool's own: the API is asked for the same page again
        assertThat(linkup.calls).extracting(FakeLinkup.Call::body).containsOnly("{\"url\":\"https://example.com/long\"}");
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "'' | | | | | url is required",
            "docs.linkup.so | | | | | url must be a full http or https URL, not 'docs.linkup.so'",
            "file:///etc/passwd | | | | | url must be a full http or https URL",
            "https://example.com | premium | | | | mode must be one of standard, pro, not 'premium'",
            "https://example.com | | [1] | | | schema must be a JSON Schema whose root has \"type\": \"object\"",
            "https://example.com | | | Prices in USD | | instructions only applies with a schema",
            "https://example.com | | | | -1 | offset must be 0 or more" })
    void aWrongFetchArgumentComesBackAsAResultWithoutCallingTheApi(String url, String mode, String schema,
            String instructions, Integer offset, String expected) {
        String result = tools.fetch(url, null, mode, null, null, schema, instructions, offset);

        assertThat(result).startsWith("Invalid call to linkup_fetch: ").contains(expected);
        assertThat(linkup.calls).isEmpty();
    }

    @Test
    void anOffsetPastTheEndOfThePageSaysHowLongThePageIs() {
        linkup.replies("{\"markdown\": \"short\", \"favicon\": \"\"}");

        assertThat(tools.fetch("https://example.com", null, null, null, null, null, null, 50)).isEqualTo(
                "Invalid call to linkup_fetch: offset 50 is past the end of the page, which has 5 characters.");
    }

    // linkup_credit_balance

    @Test
    void theCreditBalanceIsReadFromTheAccount() {
        linkup.replies("{\"balance\": 123.456}");

        assertThat(tools.creditBalance()).isEqualTo("{\"balance\":123.456}");
        assertThat(linkup.call().method()).isEqualTo("GET");
        assertThat(linkup.call().path()).isEqualTo("/v1/credits/balance");
    }

    // Failures of the API, worded for the model

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "401 | UNAUTHORIZED | Invalid API key | rejected the API key",
            "429 | INSUFFICIENT_FUNDS_CREDITS | No credits left | has no credits left",
            "429 | TOO_MANY_REQUESTS | Too many requests | rate-limiting this server",
            "400 | SEARCH_QUERY_NO_RESULT | No result | The search found nothing",
            "500 | INTERNAL_SERVER_ERROR | Oops | Linkup failed on its side",
            "504 | REQUEST_DEADLINE_EXCEEDED | Deadline exceeded | did not answer in time" })
    void aFailureOfTheApiIsAResultTheModelCanActOn(int status, String code, String message, String expected) {
        linkup.replies(status, """
                {"statusCode": %d, "error": {"code": "%s", "message": "%s", "details": []}}"""
                .formatted(status, code, message));

        String result = tools.search("query", "standard", "searchResults", null, null, null, null, null, null, null,
                null, null, null);

        assertThat(result).startsWith("Linkup error: ")
                .contains(expected)
                .endsWith("Details (HTTP %d %s): %s".formatted(status, code, message))
                .doesNotContain(FakeLinkup.API_KEY);
    }

    @Test
    void aValidationErrorOfTheApiNamesTheFieldToCorrect() {
        linkup.replies(400, """
                {"statusCode": 400, "error": {"code": "VALIDATION_ERROR", "message": "Validation failed",
                 "details": [{"field": "toDate", "message": "toDate must be later than 1970-01-01"}]}}""");

        String result = tools.search("query", "standard", "searchResults", null, null, null, null, null,
                "1960-01-01", null, null, null, null);

        assertThat(result).isEqualTo("Linkup error: Linkup refused the request. Correct the arguments and call again.\n"
                + "Details (HTTP 400 VALIDATION_ERROR): Validation failed; toDate: toDate must be later than 1970-01-01");
    }

    @Test
    void aPageThatCannotBeFetchedSaysWhatToTryNext() {
        linkup.replies(400, """
                {"statusCode": 400, "error": {"code": "FETCH_TARGET_UNREACHABLE", "message": "Target unreachable",
                 "details": []}}""");

        String result = tools.fetch("https://example.com/blocked", null, null, null, null, null, null, null);

        assertThat(result).startsWith("Linkup error: Linkup could not read this URL.")
                .contains("mode pro", "renderJs true")
                .endsWith("Details (HTTP 400 FETCH_TARGET_UNREACHABLE): Target unreachable");
    }

    @Test
    void aTimeoutIsAResultToo() {
        linkup.repliesAfter(Duration.ofSeconds(2), 200, "{\"results\": []}");
        LinkupTools impatient = new LinkupTools(new LinkupClient(linkup.properties(Duration.ofMillis(200), 2000)),
                linkup.properties(), CLOCK);

        String result = impatient.search("query", "deep", "searchResults", null, null, null, null, null, null, null,
                null, null, null);

        assertThat(result).startsWith("Linkup error: Linkup did not answer in time.");
    }

    @Test
    void anUnreachableApiIsAResultToo() {
        linkup.close();

        assertThat(tools.creditBalance()).startsWith("Linkup error: The Linkup API could not be reached");
    }

    private LinkupTools tools(int maxResultChars) {
        LinkupProperties properties = linkup.properties(Duration.ofSeconds(5), maxResultChars);
        return new LinkupTools(new LinkupClient(properties), properties, CLOCK);
    }

    private static JsonNode json(String text) {
        return JsonMapper.shared().readTree(text);
    }
}
