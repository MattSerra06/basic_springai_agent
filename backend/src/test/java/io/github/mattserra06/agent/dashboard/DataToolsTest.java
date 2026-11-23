package io.github.mattserra06.agent.dashboard;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.function.Function;

import org.junit.jupiter.api.Test;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.ToolDefinition;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class DataToolsTest {

    private final List<String> asked = new ArrayList<>();

    private final Now now = new Now();

    @Test
    void tellsAnInterfaceTheToolsItMayCall() {
        DataTools tools = tools(input -> "{}");

        assertThat(tools.names()).containsExactly("get_live_price_data");
        assertThat(tools.specs()).singleElement().satisfies(spec -> {
            assertThat(spec.name()).isEqualTo("get_live_price_data");
            assertThat(spec.description()).isEqualTo("A quote.");
            assertThat(spec.inputSchema().path("properties").propertyNames()).containsExactly("ticker");
        });
    }

    @Test
    void givesTheJsonOfAnMcpToolRatherThanItsEnvelope() {
        DataTools tools = tools(input -> """
                [{"type":"text","text":"{\\"code\\":\\"AAPL.US\\",\\"close\\":187.2}"}]""");

        JsonNode data = tools.call("get_live_price_data", json("{\"ticker\":\"AAPL.US\"}"));

        assertThat(data).isEqualTo(json("{\"code\":\"AAPL.US\",\"close\":187.2}"));
        assertThat(asked).containsExactly("{\"ticker\":\"AAPL.US\"}");
    }

    @Test
    void givesSeveralContentsAsAListAndATextThatIsNotJsonAsAString() {
        DataTools tools = tools(input -> input.contains("MANY") ? """
                [{"type":"text","text":"[1,2]"},{"type":"text","text":"closed today"}]""" : "No quote yet");

        assertThat(tools.call("get_live_price_data", json("{\"ticker\":\"MANY\"}")))
                .isEqualTo(json("[[1,2],\"closed today\"]"));
        assertThat(tools.call("get_live_price_data", json("{\"ticker\":\"NONE\"}")).asString())
                .isEqualTo("No quote yet");
    }

    @Test
    void givesAgainTheAnswerOfAMomentAgoThenAsksAnew() {
        DataTools tools = tools(input -> "{\"asked\":" + asked.size() + "}");
        JsonNode apple = json("{\"ticker\":\"AAPL.US\"}");

        JsonNode first = tools.call("get_live_price_data", apple);
        now.passes(Duration.ofSeconds(29));
        JsonNode again = tools.call("get_live_price_data", apple);
        // Another question is another answer
        JsonNode other = tools.call("get_live_price_data", json("{\"ticker\":\"MC.PA\"}"));
        now.passes(Duration.ofSeconds(2));
        JsonNode later = tools.call("get_live_price_data", apple);

        assertThat(again).isEqualTo(first).isEqualTo(json("{\"asked\":1}"));
        assertThat(other).isEqualTo(json("{\"asked\":2}"));
        assertThat(later).isEqualTo(json("{\"asked\":3}"));
    }

    @Test
    void aFailureIsToldAndNotKept() {
        DataTools tools = tools(input -> (asked.size() == 1) ? "EODHD error: no credits left" : "{\"close\":1}");
        JsonNode apple = json("{\"ticker\":\"AAPL.US\"}");

        assertThatThrownBy(() -> tools.call("get_live_price_data", apple))
                .isInstanceOf(DataTools.ToolFailedException.class).hasMessage("no credits left");
        assertThat(tools.call("get_live_price_data", apple)).isEqualTo(json("{\"close\":1}"));
    }

    @Test
    void refusesAToolItDoesNotHave() {
        DataTools tools = tools(input -> "{}");

        assertThatThrownBy(() -> tools.call("linkup_search", json("{}"))).isInstanceOf(NoSuchElementException.class);
        assertThat(asked).isEmpty();
    }

    private DataTools tools(Function<String, String> answer) {
        ToolCallback tool = new ToolCallback() {

            @Override
            public ToolDefinition getToolDefinition() {
                return ToolDefinition.builder()
                        .name("get_live_price_data")
                        .description("A quote.")
                        .inputSchema("{\"type\":\"object\",\"properties\":{\"ticker\":{\"type\":\"string\"}}}")
                        .build();
            }

            @Override
            public String call(String toolInput) {
                asked.add(toolInput);
                return answer.apply(toolInput);
            }
        };
        return new DataTools(List.of(tool), Duration.ofSeconds(30), now);
    }

    private static JsonNode json(String text) {
        return JsonMapper.shared().readTree(text);
    }

    /** A clock the test moves. */
    private static final class Now extends Clock {

        private Instant instant = Instant.parse("2026-01-01T00:00:00Z");

        void passes(Duration time) {
            instant = instant.plus(time);
        }

        @Override
        public Instant instant() {
            return instant;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }
}
