package io.github.mattserra06.agent.session;

import java.time.Instant;
import java.util.List;

import io.github.mattserra06.agent.chat.ActiveTurns;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.web.server.ResponseStatusException;

import static org.mockito.BDDMockito.given;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(SessionController.class)
class SessionControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockitoBean
    Conversations conversations;

    @MockitoBean
    ActiveTurns activeTurns;

    @Test
    void listsConversations() throws Exception {
        given(conversations.list())
                .willReturn(List.of(new SessionView("s1", "Bonjour", Instant.parse("2026-01-01T00:00:00Z"))));

        mockMvc.perform(get("/api/sessions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].id").value("s1"))
                .andExpect(jsonPath("$[0].title").value("Bonjour"))
                .andExpect(jsonPath("$[0].createdAt").value("2026-01-01T00:00:00Z"));
    }

    @Test
    void opensAConversationWithItsMessagesAndItsActiveRun() throws Exception {
        given(conversations.open("s1")).willReturn(new ConversationView(
                new SessionView("s1", "Bonjour", Instant.parse("2026-01-01T00:00:00Z")),
                List.of(new MessageView("user", "Bonjour", false), new MessageView("assistant", "Salut", true)),
                "r1"));

        mockMvc.perform(get("/api/sessions/s1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.session.title").value("Bonjour"))
                .andExpect(jsonPath("$.messages[0].role").value("user"))
                .andExpect(jsonPath("$.messages[1].content").value("Salut"))
                .andExpect(jsonPath("$.messages[1].interrupted").value(true))
                .andExpect(jsonPath("$.activeRunId").value("r1"));
    }

    @Test
    void answersNotFoundForAnUnknownConversation() throws Exception {
        given(conversations.open("nope")).willThrow(new ResponseStatusException(HttpStatus.NOT_FOUND));

        mockMvc.perform(get("/api/sessions/nope")).andExpect(status().isNotFound());
    }

    @Test
    void interruptsTheRunningTurn() throws Exception {
        mockMvc.perform(post("/api/sessions/s1/interrupt")).andExpect(status().isNoContent());

        verify(activeTurns).interrupt("s1");
    }

    @Test
    void stopsTheRunningTurnBeforeDeleting() throws Exception {
        mockMvc.perform(delete("/api/sessions/s1")).andExpect(status().isNoContent());

        InOrder order = inOrder(activeTurns, conversations);
        order.verify(activeTurns).interrupt("s1");
        order.verify(conversations).delete("s1");
    }
}
