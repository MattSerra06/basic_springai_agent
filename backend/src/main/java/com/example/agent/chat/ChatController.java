package com.example.agent.chat;

import java.util.Map;

import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;

@RestController
@RequestMapping("/api/chat")
public class ChatController {

    private static final Logger log = LoggerFactory.getLogger(ChatController.class);

    private final ChatService chatService;

    public ChatController(ChatService chatService) {
        this.chatService = chatService;
    }

    /**
     * Sends a message and streams the reply as Server-Sent Events:
     * <ul>
     * <li>{@code event:session} — {@code {"id","title","createdAt"}}, first, when the
     * message started a new conversation;</li>
     * <li>default events — {@code {"text":"..."}}, the reply's text deltas;</li>
     * <li>{@code event:done} — {@code {"interrupted":false}}, last;</li>
     * <li>{@code event:error} — {@code {"message":"..."}}, instead of {@code done} when
     * the turn failed, because the HTTP status is already sent by then.</li>
     * </ul>
     */
    @PostMapping(path = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Object>> stream(@Valid @RequestBody ChatRequest request) {
        return chatService.stream(request.sessionId(), request.message())
                .map(ChatController::toServerSentEvent)
                .onErrorResume(error -> {
                    log.error("Chat stream failed", error);
                    return Flux.just(ServerSentEvent
                            .<Object>builder(Map.of("message",
                                    "L'appel au modèle a échoué. Consultez les logs du backend."))
                            .event("error")
                            .build());
                });
    }

    private static ServerSentEvent<Object> toServerSentEvent(ChatEvent event) {
        return switch (event) {
            case ChatEvent.Started started ->
                ServerSentEvent.<Object>builder(started.session()).event("session").build();
            case ChatEvent.Text text -> ServerSentEvent.<Object>builder(Map.of("text", text.text())).build();
            case ChatEvent.Done done ->
                ServerSentEvent.<Object>builder(Map.of("interrupted", done.interrupted())).event("done").build();
        };
    }
}
