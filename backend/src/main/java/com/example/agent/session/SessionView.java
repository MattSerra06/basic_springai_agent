package com.example.agent.session;

import java.time.Instant;

/** A conversation as the sidebar lists it. */
public record SessionView(String id, String title, Instant createdAt) {
}
