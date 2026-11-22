package com.example.agent.chat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
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
    void streamsTextDeltasAsServerSentEvents() throws Exception {
        given(chatService.stream("Hi")).willReturn(Flux.just("Hel", "lo"));

        String body = performStream("{\"message\":\"Hi\"}");

        assertThat(body).containsSubsequence("{\"text\":\"Hel\"}", "{\"text\":\"lo\"}");
    }

    @Test
    void reportsFailureAsErrorEvent() throws Exception {
        given(chatService.stream("Hi")).willReturn(Flux.error(new IllegalStateException("boom")));

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
