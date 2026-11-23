package io.github.mattserra06.agent.eodhd;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.tool.ToolCallback;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;

class EodhdToolsTest {

    private final FakeEodhd server = new FakeEodhd();

    private EodhdTools tools = EodhdTools.off();

    @AfterEach
    void stop() {
        tools.close();
        server.close();
    }

    @Test
    void learnsTheToolsOfTheServerAndGivesTheModelThoseAskedFor() {
        tools = EodhdTools.connect(server.properties(List.of("get_live_price_data", "get_fundamentals_data"), 1000));

        assertThat(tools.on()).isTrue();
        assertThat(tools.callbacks()).extracting(tool -> tool.getToolDefinition().name())
                .containsExactly("get_live_price_data", "get_fundamentals_data");
        // Named and described as the server does, arguments included
        ToolCallback price = tools.callbacks().getFirst();
        assertThat(price.getToolDefinition().description()).isEqualTo("Fake get_live_price_data.");
        assertThat(JsonMapper.shared().readTree(price.getToolDefinition().inputSchema()).path("properties")
                .propertyNames()).containsExactly("ticker");
        // The key travels as the hosted server takes it: in the address of every request
        assertThat(server.calls).isNotEmpty().allSatisfy(
                call -> assertThat(call.query()).isEqualTo("apikey=" + FakeEodhd.API_KEY));
    }

    @Test
    void givesEveryToolOfTheServerWhenNoneIsNamed() {
        tools = EodhdTools.connect(server.properties(List.of(), 1000));

        assertThat(tools.callbacks()).extracting(tool -> tool.getToolDefinition().name())
                .containsExactlyElementsOf(FakeEodhd.TOOLS);
    }

    @Test
    void aCallIsSentToTheServerAndItsAnswerComesBack() {
        tools = EodhdTools.connect(server.properties(List.of("get_live_price_data"), 1000));
        server.answers("{\"code\":\"AAPL.US\",\"close\":187.2}");

        String result = tools.callbacks().getFirst().call("{\"ticker\":\"AAPL.US\"}");

        assertThat(result).contains("187.2");
        assertThat(server.toolCalls()).singleElement().satisfies(call -> {
            assertThat(call.params().path("name").asString()).isEqualTo("get_live_price_data");
            assertThat(call.params().path("arguments")).isEqualTo(
                    JsonMapper.shared().readTree("{\"ticker\":\"AAPL.US\"}"));
        });
    }

    @Test
    void aRefusalOfTheServerIsToldToTheModelWithoutTheKey() {
        tools = EodhdTools.connect(server.properties(List.of("get_live_price_data"), 1000));
        ToolCallback price = tools.callbacks().getFirst();

        // The tool itself refuses: a plan that does not cover the data, an unknown ticker
        server.refuses("Forbidden for token " + FakeEodhd.API_KEY + ": upgrade your plan");
        String refused = price.call("{\"ticker\":\"NOPE\"}");
        // The protocol refuses: the call never reached the tool
        server.fails("Invalid arguments for " + FakeEodhd.API_KEY);
        String failed = price.call("{}");

        // The words of the tool, not the objects of the client that carried them
        assertThat(refused).isEqualTo("EODHD error: Forbidden for token ***: upgrade your plan");
        assertThat(failed).startsWith("EODHD error: ").contains("Invalid arguments");
        assertThat(FakeEodhd.holdsKey(refused) || FakeEodhd.holdsKey(failed)).isFalse();
    }

    @Test
    void aFailureKeepsOnlyWhatTheToolSaid() {
        assertThat(EodhdTools.said("Error calling tool: [TextContent[annotations=null, text=Ticker NOPE not found, "
                + "meta=null], TextContent[annotations=null, text=Try AAPL.US, meta=null]]"))
                .isEqualTo("Ticker NOPE not found Try AAPL.US");
        assertThat(EodhdTools.said("Did not observe any item or terminal signal within 45000ms"))
                .isEqualTo("Did not observe any item or terminal signal within 45000ms");
    }

    @Test
    void anInterfaceGetsAResultWholeOrNotAtAll() {
        tools = EodhdTools.connect(server.properties(List.of("get_live_price_data"), 200));
        ToolCallback forInterfaces = tools.forInterfaces(10_000).getFirst();
        server.answers("x".repeat(5000));
        server.answers("x".repeat(20_000));

        // Longer than the model would read, and whole
        assertThat(forInterfaces.call("{\"ticker\":\"AAPL.US\"}")).contains("x".repeat(5000));
        assertThat(forInterfaces.call("{\"ticker\":\"AAPL.US\"}")).startsWith("EODHD error: the result has")
                .contains("Ask for less").hasSizeLessThan(300);
    }

    @Test
    void aVeryLongResultIsCut() {
        tools = EodhdTools.connect(server.properties(List.of("get_live_price_data"), 200));
        server.answers("x".repeat(5000));

        String result = tools.callbacks().getFirst().call("{\"ticker\":\"AAPL.US\"}");

        assertThat(result).hasSizeLessThan(400).contains("[Cut: the result has").contains("Ask for less");
    }

    @Test
    void withoutAKeyTheServerIsNotContacted() {
        tools = EodhdTools.connect(new EodhdProperties(" ", server.baseUrl(), "/v1/mcp", Duration.ofSeconds(1),
                Duration.ofSeconds(1), 1000, List.of(), "Use the market data tools."));

        assertThat(tools.on()).isFalse();
        assertThat(tools.callbacks()).isEmpty();
        assertThat(server.calls).isEmpty();
    }

    @Test
    void aServerThatCannotBeReachedLeavesTheAgentWithoutTheseTools() {
        EodhdProperties properties = server.properties(List.of(), 1000);
        server.close();

        tools = EodhdTools.connect(properties);

        assertThat(tools.on()).isFalse();
    }

    @Test
    void neverPrintsTheKey() {
        assertThat(server.properties(List.of(), 1000).toString()).doesNotContain(FakeEodhd.API_KEY);
        assertThat(EodhdTools.scrub("POST http://host/v1/mcp?apikey=" + FakeEodhd.API_KEY + " failed",
                FakeEodhd.API_KEY)).isEqualTo("POST http://host/v1/mcp?apikey=*** failed");
    }
}
