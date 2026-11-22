package com.example.agent.chat;

import com.example.agent.session.SessionView;

/** What a turn streams to the client, in order: Started?, Text*, Done. */
public sealed interface ChatEvent {

    /** The first message of a conversation created the session. */
    record Started(SessionView session) implements ChatEvent {
    }

    record Text(String text) implements ChatEvent {
    }

    /** The turn is over; {@code interrupted} when a stop ended it. */
    record Done(boolean interrupted) implements ChatEvent {
    }
}
