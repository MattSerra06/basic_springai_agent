package com.example.agent.chat;

import java.time.Instant;

import com.example.agent.session.SessionView;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.BDDMockito.given;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.request;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(ChatController.class)
class ChatControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    ChatService chatService;

    @Test
    void streamsANewConversationAsServerSentEvents() throws Exception {
        given(chatService.stream(null, "Hi")).willReturn(Flux.just(
                new ChatEvent.Started(new SessionView("s1", "Hi", Instant.parse("2026-01-01T00:00:00Z"))),
                new ChatEvent.Text("Hel"), new ChatEvent.Text("lo"), new ChatEvent.Done(false)));

        String body = performStream("{\"message\":\"Hi\"}");

        assertThat(body).containsSubsequence(
                "event:session", "\"id\":\"s1\"", "\"title\":\"Hi\"",
                "{\"text\":\"Hel\"}", "{\"text\":\"lo\"}",
                "event:done", "{\"interrupted\":false}");
    }

    @Test
    void continuesTheSessionNamedInTheRequest() throws Exception {
        given(chatService.stream("s1", "Hi")).willReturn(Flux.just(new ChatEvent.Done(true)));

        String body = performStream("{\"sessionId\":\"s1\",\"message\":\"Hi\"}");

        assertThat(body).contains("event:done", "{\"interrupted\":true}").doesNotContain("event:session");
    }

    @Test
    void reportsFailureAsErrorEvent() throws Exception {
        given(chatService.stream(null, "Hi")).willReturn(Flux.error(new IllegalStateException("boom")));

        String body = performStream("{\"message\":\"Hi\"}");

        assertThat(body).contains("event:error").doesNotContain("boom");
    }

    @Test
    void rejectsBlankMessage() throws Exception {
        mockMvc.perform(post("/api/chat/stream")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"message\":\"  \"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void answersNotFoundForAnUnknownSession() throws Exception {
        given(chatService.stream("nope", "Hi")).willThrow(new ResponseStatusException(HttpStatus.NOT_FOUND));

        mockMvc.perform(post("/api/chat/stream")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":\"nope\",\"message\":\"Hi\"}"))
                .andExpect(status().isNotFound());
    }

    private String performStream(String json) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/chat/stream")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json))
                .andExpect(request().asyncStarted())
                .andReturn();
        result.getAsyncResult();
        return result.getResponse().getContentAsString();
    }
}
