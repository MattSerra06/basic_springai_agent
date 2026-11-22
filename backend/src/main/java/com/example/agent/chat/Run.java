package com.example.agent.chat;

import java.time.Instant;

/**
 * One message sent to a conversation and the work of answering it, done in the
 * background. Its events are read from a {@link RunStore}.
 *
 * @param message the user message the run answers
 */
public record Run(String id, String sessionId, String message, Instant startedAt) {
}
