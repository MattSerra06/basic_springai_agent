package io.github.mattserra06.agent;

import io.github.mattserra06.agent.eodhd.FakeEodhd;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * What a dashboard asks of the backend, over HTTP: the whole backend, with a local MCP
 * server in place of EODHD's.
 */
@SpringBootTest(properties = {
        "spring.ai.openai.api-key=test",
        "spring.datasource.url=jdbc:h2:mem:dashboards-test;DB_CLOSE_DELAY=-1",
        "agent.linkup.api-key=",
        "agent.eodhd.api-key=" + FakeEodhd.API_KEY,
        "agent.eodhd.tools=get_live_price_data,get_fundamentals_data",
        // What the model may read of a result is far less than what an interface loads
        "agent.eodhd.max-result-chars=100",
        "agent.dashboards.max-result-chars=1000" })
@AutoConfigureMockMvc
class DashboardsTest {

    private static final FakeEodhd eodhd = new FakeEodhd();

    @DynamicPropertySource
    static void eodhdServer(DynamicPropertyRegistry registry) {
        registry.add("agent.eodhd.base-url", eodhd::baseUrl);
    }

    @AfterAll
    static void stopServer() {
        eodhd.close();
    }

    @Autowired
    MockMvc mockMvc;

    @BeforeEach
    void reset() {
        eodhd.reset();
    }

    @Test
    void anInterfaceIsToldTheDataToolsAndNoOther() throws Exception {
        mockMvc.perform(get("/api/tools"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].name").value("get_live_price_data"))
                .andExpect(jsonPath("$[0].description").value("Fake get_live_price_data."))
                .andExpect(jsonPath("$[0].inputSchema.properties.ticker.type").value("string"))
                .andExpect(jsonPath("$[1].name").value("get_fundamentals_data"));
    }

    @Test
    void anInterfaceCallsADataToolAndGetsItsJsonWhole() throws Exception {
        // Longer than the model would be given: an interface cannot draw half a document
        String name = "Apple Inc. ".repeat(20).strip();
        eodhd.answers("{\"code\":\"AAPL.US\",\"close\":187.2,\"name\":\"" + name + "\"}");

        mockMvc.perform(post("/api/tools/get_live_price_data").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ticker\":\"AAPL.US\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.code").value("AAPL.US"))
                .andExpect(jsonPath("$.data.close").value(187.2))
                .andExpect(jsonPath("$.data.name").value(name));

        assertThat(eodhd.toolCalls()).singleElement().satisfies(call -> {
            assertThat(call.params().path("name").asString()).isEqualTo("get_live_price_data");
            assertThat(call.params().path("arguments")).isEqualTo(
                    JsonMapper.shared().readTree("{\"ticker\":\"AAPL.US\"}"));
        });
    }

    @Test
    void theSameQuestionAMomentLaterDoesNotReachTheServerAgain() throws Exception {
        eodhd.answers("{\"close\":712.4}");

        for (int panel = 0; panel < 3; panel++) {
            mockMvc.perform(post("/api/tools/get_live_price_data").contentType(MediaType.APPLICATION_JSON)
                            .content("{\"ticker\":\"MC.PA\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.close").value(712.4));
        }

        assertThat(eodhd.toolCalls()).hasSize(1);
    }

    @Test
    void aToolThatFailsIsABadGatewayThatSaysWhyWithoutTheKey() throws Exception {
        eodhd.refuses("Forbidden for token " + FakeEodhd.API_KEY + ": upgrade your plan");

        mockMvc.perform(post("/api/tools/get_fundamentals_data").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ticker\":\"NOPE.US\"}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error").value(containsString("upgrade your plan")))
                .andExpect(content().string(not(containsString(FakeEodhd.API_KEY))));
    }

    @Test
    void anAnswerTooLongToLoadIsAFailureRatherThanHalfADocument() throws Exception {
        eodhd.answers("{\"history\":\"" + "x".repeat(2000) + "\"}");

        mockMvc.perform(post("/api/tools/get_fundamentals_data").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"ticker\":\"LONG.US\"}"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.error").value(containsString("Ask for less")));
    }

    @Test
    void aToolThatIsNotADataToolCannotBeCalled() throws Exception {
        // The model's own tools, and those of the server the agent was not given
        for (String tool : new String[] { "conversation_search", "get_mp_praams_report_equity_by_ticker", "nope" }) {
            mockMvc.perform(post("/api/tools/" + tool).contentType(MediaType.APPLICATION_JSON).content("{}"))
                    .andExpect(status().isNotFound());
        }
        assertThat(eodhd.toolCalls()).isEmpty();
    }

    @Test
    void argumentsThatAreNotAnObjectAreRefused() throws Exception {
        mockMvc.perform(post("/api/tools/get_live_price_data").contentType(MediaType.APPLICATION_JSON)
                        .content("[\"AAPL.US\"]"))
                .andExpect(status().isBadRequest());
        assertThat(eodhd.toolCalls()).isEmpty();
    }

    @Test
    void aDashboardIsKeptListedOpenedAndForgotten() throws Exception {
        String program = "root = Stack([price])\nprice = Query(\"get_live_price_data\", {ticker: \"AAPL.US\"}, {})";
        String kept = mockMvc.perform(post("/api/dashboards").contentType(MediaType.APPLICATION_JSON)
                        .content(JsonMapper.shared().writeValueAsString(
                                java.util.Map.of("title", "Apple", "program", program))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.title").value("Apple"))
                .andExpect(jsonPath("$.program").value(program))
                .andExpect(jsonPath("$.createdAt").isString())
                .andReturn().getResponse().getContentAsString();
        JsonNode dashboard = JsonMapper.shared().readTree(kept);
        String id = dashboard.path("id").asString();

        mockMvc.perform(get("/api/dashboards"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value(id))
                .andExpect(jsonPath("$[0].title").value("Apple"))
                .andExpect(jsonPath("$[0].program").doesNotExist());
        mockMvc.perform(get("/api/dashboards/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.program").value(program));

        mockMvc.perform(delete("/api/dashboards/" + id)).andExpect(status().isNoContent());
        mockMvc.perform(get("/api/dashboards/" + id)).andExpect(status().isNotFound());
        mockMvc.perform(delete("/api/dashboards/" + id)).andExpect(status().isNotFound());
    }

    @Test
    void aDashboardWithoutATitleOrAProgramIsRefused() throws Exception {
        mockMvc.perform(post("/api/dashboards").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\" \",\"program\":\"root = Stack([])\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/dashboards").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Apple\"}"))
                .andExpect(status().isBadRequest());
    }
}
