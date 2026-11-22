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
     * Server-Sent Events stream. Each text delta is a default event
     * {@code data:{"text":"..."}}; a failure is reported as a final
     * {@code event:error} because the HTTP status is already sent by then.
     */
    @PostMapping(path = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Map<String, String>>> stream(@Valid @RequestBody ChatRequest request) {
        return chatService.stream(request.message())
                .map(text -> ServerSentEvent.builder(Map.of("text", text)).build())
                .onErrorResume(error -> {
                    log.error("Chat stream failed", error);
                    return Flux.just(ServerSentEvent
                            .builder(Map.of("message", "L'appel au modèle a échoué. Consultez les logs du backend."))
                            .event("error")
                            .build());
                });
    }
}
