package com.example.agent.session;

import java.util.List;

import com.example.agent.chat.ActiveTurns;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/sessions")
public class SessionController {

    private final Conversations conversations;
    private final ActiveTurns activeTurns;

    public SessionController(Conversations conversations, ActiveTurns activeTurns) {
        this.conversations = conversations;
        this.activeTurns = activeTurns;
    }

    @GetMapping
    public List<SessionView> list() {
        return conversations.list();
    }

    @GetMapping("/{sessionId}/messages")
    public List<MessageView> messages(@PathVariable String sessionId) {
        return conversations.messages(sessionId);
    }

    /** Stops the reply being generated for the session, if any. */
    @PostMapping("/{sessionId}/interrupt")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void interrupt(@PathVariable String sessionId) {
        activeTurns.interrupt(sessionId);
    }

    @DeleteMapping("/{sessionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String sessionId) {
        activeTurns.interrupt(sessionId);
        conversations.delete(sessionId);
    }
}
