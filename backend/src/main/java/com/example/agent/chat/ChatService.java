package com.example.agent.chat;

import org.springframework.ai.chat.client.ChatClient;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import reactor.core.publisher.Flux;

@Service
public class ChatService {

    private final ChatClient chatClient;

    public ChatService(ChatClient.Builder chatClientBuilder,
                       @Value("${agent.system-prompt}") String systemPrompt) {
        this.chatClient = chatClientBuilder
                .defaultSystem(systemPrompt)
                .build();
    }

    /**
     * Streams the model's answer to a single user message. Stateless: no
     * conversation history is sent, each call is an independent exchange.
     */
    public Flux<String> stream(String message) {
        return chatClient.prompt()
                .user(message)
                .stream()
                .content();
    }
}
