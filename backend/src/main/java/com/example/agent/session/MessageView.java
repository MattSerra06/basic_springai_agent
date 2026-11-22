package com.example.agent.session;

/**
 * A message of a conversation as the UI shows it.
 *
 * @param role {@code user} or {@code assistant}
 * @param interrupted whether the reply was cut short by a stop
 */
public record MessageView(String role, String content, boolean interrupted) {
}
