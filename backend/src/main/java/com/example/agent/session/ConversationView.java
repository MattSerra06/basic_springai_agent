package com.example.agent.session;

import java.util.List;

import org.jspecify.annotations.Nullable;

/**
 * A conversation as the UI opens it.
 *
 * @param activeRunId the run that is still answering the last message, whose events
 * carry the reply; {@code null} when the conversation is at rest
 */
public record ConversationView(SessionView session, List<MessageView> messages, @Nullable String activeRunId) {
}
