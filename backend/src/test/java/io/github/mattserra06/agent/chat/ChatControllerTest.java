package io.github.mattserra06.agent.chat;

import java.time.Instant;

import io.github.mattserra06.agent.AgentProperties;
import io.github.mattserra06.agent.session.SessionView;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.server.ResponseStatusException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ChatController.class)
@TestPropertySource(properties = "agent.stream-heartbeat=50ms")
class ChatControllerTest {

    @TestConfiguration
    @EnableConfigurationProperties(AgentProperties.class)
    @Import(RunOptions.class)
    static class Config {

        @Bean
        InMemoryRunStore runStore() {
            return new InMemoryRunStore();
        }
    }

    @Autowired
    MockMvc mockMvc;

    @Autowired
    RunStore runs;

    @MockitoBean
    ChatService chatService;

    @Test
    void acceptsAMessageAndNamesTheRunToReadTheReplyFrom() throws Exception {
        given(chatService.start(null, "Hi", null, null)).willReturn(new ChatService.RunStarted("r1",
                new SessionView("s1", "Hi", Instant.parse("2026-01-01T00:00:00Z"))));

        mockMvc.perform(post("/api/runs").contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"Hi\"}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.runId").value("r1"))
                .andExpect(jsonPath("$.session.id").value("s1"))
                .andExpect(jsonPath("$.session.title").value("Hi"));
    }

    @Test
    void passesTheChosenModelAndReasoningEffortOn() throws Exception {
        given(chatService.start("s1", "Hi", "gpt-6.2-astra", "high")).willReturn(new ChatService.RunStarted("r1",
                new SessionView("s1", "Hi", Instant.parse("2026-01-01T00:00:00Z"))));

        mockMvc.perform(post("/api/runs").contentType(MediaType.APPLICATION_JSON).content("""
                        {"sessionId":"s1","message":"Hi","model":"gpt-6.2-astra","reasoningEffort":"high"}"""))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.runId").value("r1"));
    }

    @Test
    void listsTheModelsAndReasoningEffortsOnOffer() throws Exception {
        mockMvc.perform(get("/api/runs/options"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.models[0].id").value("gpt-6.2-sol"))
                .andExpect(jsonPath("$.models[0].label").value("GPT-6.2 Sol"))
                .andExpect(jsonPath("$.models[1].id").value("gpt-6.2-astra"))
                .andExpect(jsonPath("$.defaultModel").value("gpt-6.2-sol"))
                .andExpect(jsonPath("$.reasoningEfforts[0]").value("low"))
                .andExpect(jsonPath("$.reasoningEfforts[3]").value("xhigh"))
                .andExpect(jsonPath("$.defaultReasoningEffort").value("medium"));
    }

    @Test
    void rejectsBlankMessage() throws Exception {
        mockMvc.perform(post("/api/runs").contentType(MediaType.APPLICATION_JSON).content("{\"message\":\"  \"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void answersConflictWhenTheSessionIsStillReplying() throws Exception {
        given(chatService.start("s1", "Hi", null, null)).willThrow(new ResponseStatusException(HttpStatus.CONFLICT));

        mockMvc.perform(post("/api/runs").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":\"s1\",\"message\":\"Hi\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    void streamsTheEventsOfARunWithTheirSequenceAsId() throws Exception {
        Run run = endedRun();

        String body = events(run.id(), null);

        assertThat(body).containsSubsequence(
                "id:1", "{\"text\":\"Hel\"}",
                "id:2", "{\"text\":\"lo\"}",
                "id:3", "event:done", "{\"interrupted\":false}");
    }

    @Test
    void resumesAfterTheLastEventTheClientSaw() throws Exception {
        Run run = endedRun();

        String body = events(run.id(), "1");

        assertThat(body).contains("id:2", "id:3").doesNotContain("id:1", "Hel");
    }

    @Test
    void reportsAFailedRun() throws Exception {
        Run run = runs.create("s1", "Hi");
        runs.append(run.id(), new ChatEvent.Failed("Panne"));

        assertThat(events(run.id(), null)).containsSubsequence("id:1", "event:failed", "{\"message\":\"Panne\"}");
    }

    @Test
    void namesTheEventsThatSayWhatTheModelIsDoing() throws Exception {
        Run run = runs.create("s1", "Hi");
        runs.append(run.id(), new ChatEvent.Thinking("**Plan**"));
        runs.append(run.id(), new ChatEvent.ToolCall("linkup_search", "Je compare les prix"));
        runs.append(run.id(), new ChatEvent.Done(false));

        // The map of an event is written in no set order
        assertThat(events(run.id(), null)).containsSubsequence(
                "id:1", "event:thinking", "{\"text\":\"**Plan**\"}",
                "id:2", "event:tool", "id:3", "event:done")
                .contains("\"name\":\"linkup_search\"", "\"activity\":\"Je compare les prix\"");
    }

    @Test
    void sendsKeepAliveLinesWhileTheRunIsSilent() throws Exception {
        Run run = runs.create("s1", "Hi");
        MvcResult result = mockMvc.perform(get("/api/runs/{id}/events", run.id()))
                .andExpect(request().asyncStarted())
                .andReturn();

        Thread.sleep(300);
        runs.append(run.id(), new ChatEvent.Done(false));
        result.getAsyncResult();

        assertThat(result.getResponse().getContentAsString()).containsSubsequence(":keep-alive", "event:done");
    }

    @Test
    void answersNotFoundForAnUnknownRun() throws Exception {
        mockMvc.perform(get("/api/runs/nope/events")).andExpect(status().isNotFound());
    }

    private Run endedRun() {
        Run run = runs.create("s1", "Hi");
        runs.append(run.id(), new ChatEvent.Text("Hel"));
        runs.append(run.id(), new ChatEvent.Text("lo"));
        runs.append(run.id(), new ChatEvent.Done(false));
        return run;
    }

    private String events(String runId, String lastEventId) throws Exception {
        var request = get("/api/runs/{id}/events", runId);
        if (lastEventId != null) {
            request.header("Last-Event-ID", lastEventId);
        }
        MvcResult result = mockMvc.perform(request).andExpect(request().asyncStarted()).andReturn();
        result.getAsyncResult();
        return result.getResponse().getContentAsString();
    }
}
