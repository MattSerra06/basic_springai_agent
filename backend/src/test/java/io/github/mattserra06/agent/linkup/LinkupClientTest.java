package io.github.mattserra06.agent.linkup;

import java.time.Duration;
import java.util.List;

import io.github.mattserra06.agent.linkup.LinkupClient.FetchRequest;
import io.github.mattserra06.agent.linkup.LinkupClient.Findings;
import io.github.mattserra06.agent.linkup.LinkupClient.Image;
import io.github.mattserra06.agent.linkup.LinkupClient.Page;
import io.github.mattserra06.agent.linkup.LinkupClient.ResearchTask;
import io.github.mattserra06.agent.linkup.LinkupClient.SearchRequest;
import io.github.mattserra06.agent.linkup.LinkupClient.Source;
import io.github.mattserra06.agent.linkup.LinkupException.Kind;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.assertj.core.api.Assertions.tuple;

/** The client against a local server: what it sends, how it reads answers and failures. */
@ExtendWith(OutputCaptureExtension.class)
class LinkupClientTest {

    private final FakeLinkup linkup = new FakeLinkup();

    private final LinkupClient client = new LinkupClient(linkup.properties());

    @AfterEach
    void stopServer() {
        linkup.close();
    }

    @Test
    void everyCallCarriesTheKeyAsABearerToken() {
        linkup.replies("{\"results\":[]}").replies("{\"markdown\":\"# Page\"}").replies("{\"balance\":1}");

        client.search(search("searchResults", null));
        client.fetch(new FetchRequest("https://example.com", null, null, null, null, null, null));
        client.creditBalance();

        assertThat(linkup.calls).extracting(FakeLinkup.Call::method, FakeLinkup.Call::path, FakeLinkup.Call::authorization)
                .containsExactly(
                        tuple("POST", "/v1/search", "Bearer " + FakeLinkup.API_KEY),
                        tuple("POST", "/v1/fetch", "Bearer " + FakeLinkup.API_KEY),
                        tuple("GET", "/v1/credits/balance", "Bearer " + FakeLinkup.API_KEY));
        assertThat(linkup.calls.getFirst().contentType()).isEqualTo("application/json");
    }

    @Test
    void readsSearchResultsWithTheirPassagesDatesAndImages() {
        linkup.replies("""
                {"results": [
                  {"type": "text", "name": "Microsoft 2024 Annual Report",
                   "url": "https://www.microsoft.com/investor/reports/ar24/index.html",
                   "content": "Microsoft Cloud revenue increased 23% to $137.4 billion.",
                   "favicon": "https://www.microsoft.com/favicon.ico", "publishedAt": "2024-07-30"},
                  {"type": "text", "name": "No date", "url": "https://example.com/a", "content": "Text", "favicon": ""},
                  {"type": "image", "name": "Satya Nadella", "url": "https://example.com/nadella.jpg"}
                ]}""");

        Findings findings = client.search(search("searchResults", null));

        assertThat(findings.answer()).isNull();
        assertThat(findings.data()).isNull();
        assertThat(findings.sources()).containsExactly(
                new Source("text", "Microsoft 2024 Annual Report",
                        "https://www.microsoft.com/investor/reports/ar24/index.html",
                        "Microsoft Cloud revenue increased 23% to $137.4 billion.", "2024-07-30"),
                new Source("text", "No date", "https://example.com/a", "Text", null),
                new Source("image", "Satya Nadella", "https://example.com/nadella.jpg", null, null));
        assertThat(findings.sources()).extracting(Source::isImage).containsExactly(false, false, true);
    }

    @Test
    void readsASourcedAnswerWhoseSourcesCarrySnippets() {
        linkup.replies("""
                {"answer": "Microsoft's revenue for fiscal year 2024 was $245.1 billion.",
                 "sources": [{"name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                              "snippet": "Revenue was $245.1 billion.", "favicon": ""}]}""");

        Findings findings = client.search(search("sourcedAnswer", null));

        assertThat(findings.answer()).isEqualTo("Microsoft's revenue for fiscal year 2024 was $245.1 billion.");
        assertThat(findings.sources()).containsExactly(
                new Source("text", "Annual Report", "https://www.microsoft.com/ar24", "Revenue was $245.1 billion.", null));
    }

    @Test
    void readsStructuredOutputAsTheObjectTheSchemaAskedFor() {
        linkup.replies("{\"companyName\": \"Microsoft\", \"revenueAmount\": 245.1, \"sources\": \"a field of the schema\"}");

        Findings findings = client.search(search("structured", null));

        assertThat(findings.sources()).isEmpty();
        assertThat(findings.data().path("companyName").asString()).isEqualTo("Microsoft");
        assertThat(findings.data().path("revenueAmount").asDouble()).isEqualTo(245.1);
        assertThat(findings.data().path("sources").asString()).isEqualTo("a field of the schema");
    }

    @Test
    void readsStructuredOutputWithSourcesFromUnderData() {
        linkup.replies("""
                {"data": {"companyName": "Microsoft"},
                 "sources": [{"type": "text", "name": "Annual Report", "url": "https://www.microsoft.com/ar24",
                              "content": "Revenue was $245.1 billion.", "favicon": ""}]}""");

        Findings findings = client.search(search("structured", true));

        assertThat(findings.data().toString()).isEqualTo("{\"companyName\":\"Microsoft\"}");
        assertThat(findings.sources()).extracting(Source::url).containsExactly("https://www.microsoft.com/ar24");
    }

    @Test
    void readsAFetchedPageWithEverythingItCanCarry() {
        linkup.replies("""
                {"markdown": "# Careers", "favicon": "https://favicons.linkup.so?domain=linkup.so",
                 "data": {"jobs": [{"position": "DevRel", "city": "Paris"}]},
                 "images": [{"alt": "Logo", "url": "https://linkup.so/logo.svg"}],
                 "rawContent": "<!doctype html><html></html>", "contentType": "html"}""");

        Page page = client.fetch(new FetchRequest("https://linkup.so/careers", null, null, null, null, null, null));

        assertThat(page.markdown()).isEqualTo("# Careers");
        assertThat(page.data().path("jobs").get(0).path("city").asString()).isEqualTo("Paris");
        assertThat(page.images()).containsExactly(new Image("Logo", "https://linkup.so/logo.svg"));
        assertThat(page.rawContent()).isEqualTo("<!doctype html><html></html>");
        assertThat(page.contentType()).isEqualTo("html");
    }

    @Test
    void readsAFetchedPageThatIsOnlyMarkdown() {
        linkup.replies("{\"markdown\": \"# Page\", \"favicon\": \"\"}");

        Page page = client.fetch(new FetchRequest("https://example.com", null, null, null, null, null, null));

        assertThat(page).isEqualTo(new Page("# Page", null, List.of(), null, null));
    }

    @Test
    void readsAResearchTaskAtEveryStage() {
        linkup.replies("""
                {"id": "task-1", "type": "research", "status": "pending", "error": null, "output": null,
                 "input": {"q": "Question", "outputType": "sourcedAnswer", "mode": "auto", "reasoningDepth": "S"},
                 "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z"}""")
                .replies("""
                        {"id": "task-1", "type": "research", "status": "completed", "error": null,
                         "input": {"q": "Question", "outputType": "sourcedAnswer"},
                         "output": {"answer": "A report [1].", "sources": [
                           {"name": "Source", "url": "https://example.com/s", "snippet": "Evidence.", "favicon": ""}]}}""")
                .replies("""
                        {"id": "task-2", "type": "research", "status": "completed", "error": null,
                         "input": {"q": "Question", "outputType": "structured"},
                         "output": {"answer": "a field of the schema", "count": 3}}""")
                .replies("""
                        {"id": "task-3", "type": "research", "status": "failed", "error": "No result",
                         "input": {"q": "Question", "outputType": "sourcedAnswer"}, "output": null}""");

        ResearchTask pending = client.research("task-1");
        ResearchTask completed = client.research("task-1");
        ResearchTask structured = client.research("task-2");
        ResearchTask failed = client.research("task-3");

        assertThat(pending).isEqualTo(new ResearchTask("task-1", "pending", null, null));
        assertThat(pending.isOver()).isFalse();
        assertThat(completed.isOver()).isTrue();
        assertThat(completed.output()).isEqualTo(new Findings("A report [1].",
                List.of(new Source("text", "Source", "https://example.com/s", "Evidence.", null)), null));
        assertThat(structured.output().answer()).isNull();
        assertThat(structured.output().data().path("count").asInt()).isEqualTo(3);
        assertThat(failed).isEqualTo(new ResearchTask("task-3", "failed", "No result", null));
        assertThat(failed.isOver()).isTrue();
        assertThat(linkup.calls).extracting(FakeLinkup.Call::method, FakeLinkup.Call::path)
                .contains(tuple("GET", "/v1/research/task-1"));
    }

    @Test
    void aResearchIdCannotReachAnotherPathOfTheApi() {
        linkup.replies(404, "{\"statusCode\":404,\"error\":{\"code\":\"TASK_NOT_FOUND\",\"message\":\"Not found\"}}");

        assertThatThrownBy(() -> client.research("../credits/balance?x=1")).isInstanceOf(LinkupException.class);

        assertThat(linkup.call().path()).isEqualTo("/v1/research/..%2Fcredits%2Fbalance%3Fx%3D1");
    }

    @Test
    void readsTheCreditBalance() {
        linkup.replies("{\"balance\": 123.456}");

        assertThat(client.creditBalance()).isEqualTo(123.456);
    }

    @ParameterizedTest
    @CsvSource(delimiter = '|', value = {
            "400 | VALIDATION_ERROR | INVALID_REQUEST",
            "400 | SEARCH_QUERY_NO_RESULT | NO_RESULT",
            "400 | FETCH_TARGET_UNREACHABLE | FETCH_FAILED",
            "400 | FETCH_UNSUPPORTED_CONTENT_TYPE | FETCH_FAILED",
            "401 | UNAUTHORIZED | UNAUTHORIZED",
            "402 | PAYMENT_REQUIRED | UNAUTHORIZED",
            "403 | FORBIDDEN | UNAUTHORIZED",
            "404 | TASK_NOT_FOUND | NOT_FOUND",
            "409 | CONFLICT | INVALID_REQUEST",
            "429 | INSUFFICIENT_FUNDS_CREDITS | OUT_OF_CREDITS",
            "429 | EXCEED_BUDGET_LIMIT | OUT_OF_CREDITS",
            "429 | TOO_MANY_REQUESTS | RATE_LIMITED",
            "429 | SOMETHING_NEW | TOO_MANY_REQUESTS",
            "500 | INTERNAL_SERVER_ERROR | SERVER_ERROR",
            "504 | REQUEST_DEADLINE_EXCEEDED | TIMEOUT" })
    void tellsTheFailuresOfTheApiApart(int status, String code, Kind expected) {
        linkup.replies(status, """
                {"statusCode": %d, "error": {"code": "%s", "message": "What went wrong", "details": []}}"""
                .formatted(status, code));

        LinkupException failure = catchThrowableOfType(LinkupException.class,
                () -> client.search(search("searchResults", null)));

        assertThat(failure.kind()).isEqualTo(expected);
        assertThat(failure.status()).isEqualTo(status);
        assertThat(failure.code()).isEqualTo(code);
        assertThat(failure.detail()).isEqualTo("What went wrong");
    }

    @Test
    void reportsTheFieldsAValidationErrorNames() {
        linkup.replies(400, """
                {"statusCode": 400, "error": {"code": "VALIDATION_ERROR", "message": "Validation failed", "details": [
                  {"field": "outputType", "message": "outputType must be one of the following values: sourcedAnswer, searchResults, structured"},
                  {"field": "depth", "message": "depth is required"}]}}""");

        LinkupException failure = catchThrowableOfType(LinkupException.class,
                () -> client.search(search("searchResults", null)));

        assertThat(failure.detail()).isEqualTo("Validation failed; outputType: outputType must be one of the following "
                + "values: sourcedAnswer, searchResults, structured; depth: depth is required");
    }

    @Test
    void aFailureThatIsNotTheApisJsonKeepsItsStatus() {
        linkup.replies(502, "<html>Bad Gateway</html>").replies(429, "");

        LinkupException gateway = catchThrowableOfType(LinkupException.class, client::creditBalance);
        LinkupException tooMany = catchThrowableOfType(LinkupException.class, client::creditBalance);

        assertThat(gateway.kind()).isEqualTo(Kind.SERVER_ERROR);
        assertThat(gateway.status()).isEqualTo(502);
        assertThat(gateway.detail()).isNull();
        assertThat(tooMany.kind()).isEqualTo(Kind.TOO_MANY_REQUESTS);
    }

    @Test
    void anAnswerThatIsNotWhatTheApiDocumentsIsAFailure() {
        linkup.replies("not json").replies("[1, 2]").replies("{\"sources\": []}").replies("{\"favicon\": \"\"}");

        assertThat(catchThrowableOfType(LinkupException.class, client::creditBalance).kind()).isEqualTo(Kind.SERVER_ERROR);
        assertThat(catchThrowableOfType(LinkupException.class, client::creditBalance).kind()).isEqualTo(Kind.SERVER_ERROR);
        // A sourced answer without its answer, a page without its markdown
        assertThat(catchThrowableOfType(LinkupException.class, () -> client.search(search("sourcedAnswer", null))).kind())
                .isEqualTo(Kind.SERVER_ERROR);
        assertThat(catchThrowableOfType(LinkupException.class,
                () -> client.fetch(new FetchRequest("https://example.com", null, null, null, null, null, null))).kind())
                .isEqualTo(Kind.SERVER_ERROR);
    }

    @Test
    void givesUpWhenTheApiDoesNotAnswerInTime() {
        LinkupClient impatient = new LinkupClient(linkup.properties(Duration.ofMillis(200), 2000));
        linkup.repliesAfter(Duration.ofSeconds(2), 200, "{\"balance\": 1}");

        LinkupException failure = catchThrowableOfType(LinkupException.class, impatient::creditBalance);

        assertThat(failure.kind()).isEqualTo(Kind.TIMEOUT);
        assertThat(failure.status()).isNull();
    }

    @Test
    void reportsAnApiThatCannotBeReached() {
        LinkupProperties properties = linkup.properties();
        linkup.close();

        LinkupException failure = catchThrowableOfType(LinkupException.class,
                () -> new LinkupClient(properties).creditBalance());

        assertThat(failure.kind()).isEqualTo(Kind.UNREACHABLE);
    }

    @Test
    void neverWritesTheKeyInItsFailuresNorInTheLogs(CapturedOutput output) {
        linkup.replies(401, "{\"statusCode\":401,\"error\":{\"code\":\"UNAUTHORIZED\",\"message\":\"Invalid API key\"}}");

        LinkupException failure = catchThrowableOfType(LinkupException.class, client::creditBalance);

        assertThat(output).contains("Linkup call /credits/balance failed").doesNotContain(FakeLinkup.API_KEY);
        assertThat(failure.getMessage()).doesNotContain(FakeLinkup.API_KEY);
        assertThat(failure.forModel()).doesNotContain(FakeLinkup.API_KEY);
        assertThat(linkup.properties().toString()).doesNotContain(FakeLinkup.API_KEY);
    }

    @Test
    void refusesToBeBuiltWithoutAKey() {
        LinkupProperties keyless = new LinkupProperties(" ", linkup.baseUrl(), Duration.ofSeconds(1),
                Duration.ofSeconds(1), 2000, "Search the web.", linkup.properties().research());

        assertThat(keyless.hasApiKey()).isFalse();
        assertThatThrownBy(() -> new LinkupClient(keyless)).isInstanceOf(IllegalStateException.class);
    }

    private static SearchRequest search(String outputType, Boolean includeSources) {
        return new SearchRequest("What is Microsoft's 2024 revenue?", "standard", outputType, null, includeSources,
                null, null, null, null, List.of(), List.of(), null);
    }
}
