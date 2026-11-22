package com.example.agent.session;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

import com.example.agent.AgentProperties;
import com.example.agent.chat.Run;
import com.example.agent.chat.RunStore;
import org.jspecify.annotations.Nullable;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.MessageType;
import org.springframework.ai.session.CreateSessionRequest;
import org.springframework.ai.session.EventFilter;
import org.springframework.ai.session.Session;
import org.springframework.ai.session.SessionAttributes;
import org.springframework.ai.session.SessionEvent;
import org.springframework.ai.session.SessionService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.server.ResponseStatusException;

/** The user's conversations: each one is a Spring AI session. */
@Service
public class Conversations {

    static final String TITLE = "title";
    static final String INTERRUPTED = "interrupted";
    private static final int MAX_TITLE_LENGTH = 60;

    private final SessionService sessionService;
    private final RunStore runs;
    private final String user;

    public Conversations(SessionService sessionService, RunStore runs, AgentProperties properties) {
        this.sessionService = sessionService;
        this.runs = runs;
        this.user = properties.user();
    }

    /** Starts a conversation, titled after its first message. */
    public SessionView create(String firstMessage) {
        return view(sessionService.create(CreateSessionRequest.builder()
                .metadata(SessionAttributes.PRINCIPAL_NAME, user)
                .metadata(TITLE, title(firstMessage))
                .build()));
    }

    /** The conversations, newest first. */
    public List<SessionView> list() {
        return sessionService.findByMetadata(SessionAttributes.PRINCIPAL_NAME, user).stream()
                .map(Conversations::view)
                .sorted(Comparator.comparing(SessionView::createdAt).reversed())
                .toList();
    }

    public SessionView get(String sessionId) {
        Session session = sessionService.findById(sessionId);
        if (session == null || !user.equals(SessionAttributes.principalName(session))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown session " + sessionId);
        }
        return view(session);
    }

    public void delete(String sessionId) {
        sessionService.delete(get(sessionId).id());
    }

    /**
     * A conversation as the UI opens it: what was said, and the run that is still
     * answering, if any. For such a run the messages stop at its user message: its reply
     * is read from the run's events, from the first one.
     */
    public ConversationView open(String sessionId) {
        SessionView session = get(sessionId);
        Run activeRun = runs.findActive(sessionId).orElse(null);
        if (activeRun == null) {
            return new ConversationView(session, messages(sessionId, null), null);
        }
        List<MessageView> messages = new ArrayList<>(messages(sessionId, activeRun.startedAt()));
        messages.add(new MessageView("user", activeRun.message(), false));
        return new ConversationView(session, messages, activeRun.id());
    }

    /**
     * What was said, oldest first, read from the whole log: a compaction only changes
     * what is sent to the model, so the turns it summarized are still shown. Tool calls,
     * tool results and summaries are left out, and the replies of one turn (one per tool
     * round) are shown as one.
     * @param before only the messages stored before this instant; {@code null} for all
     */
    List<MessageView> messages(String sessionId, @Nullable Instant before) {
        List<MessageView> messages = new ArrayList<>();
        for (SessionEvent event : sessionService.getEvents(sessionId)) {
            if (!event.hasMessage() || event.isSynthetic() || !StringUtils.hasText(event.getMessage().getText())
                    || (before != null && !event.getTimestamp().isBefore(before))) {
                continue;
            }
            String text = event.getMessage().getText();
            boolean interrupted = Boolean.TRUE.equals(event.getMetadata().get(INTERRUPTED));
            if (event.getMessageType() == MessageType.USER) {
                messages.add(new MessageView("user", text, false));
            }
            else if (event.getMessageType() == MessageType.ASSISTANT) {
                MessageView previous = messages.isEmpty() ? null : messages.getLast();
                if (previous != null && previous.role().equals("assistant")) {
                    messages.removeLast();
                    text = previous.content() + "\n\n" + text;
                }
                messages.add(new MessageView("assistant", text, interrupted));
            }
        }
        return messages;
    }

    /**
     * Stores the part of a reply that was shown before a stop cut it, so that the
     * history matches what the user saw. Nothing is stored when the log already ends
     * with the model's reply: the stop then came between two tool rounds, after the
     * reply was stored.
     */
    public void saveInterruptedReply(String sessionId, String partialReply) {
        if (!StringUtils.hasText(partialReply)) {
            return;
        }
        List<SessionEvent> newest = sessionService.getEvents(sessionId, EventFilter.lastN(1));
        if (!newest.isEmpty() && newest.getLast().hasMessage()
                && newest.getLast().getMessageType() == MessageType.ASSISTANT) {
            SessionEvent last = newest.getLast();
            if (last.hasToolCalls() || partialReply.equals(last.getMessage().getText())) {
                return;
            }
        }
        sessionService.appendEvent(SessionEvent.builder()
                .sessionId(sessionId)
                .message(new AssistantMessage(partialReply))
                .metadata(INTERRUPTED, true)
                .build());
    }

    private static SessionView view(Session session) {
        Object title = session.metadata().get(TITLE);
        return new SessionView(session.id(), (title != null) ? title.toString() : "Conversation",
                session.createdAt());
    }

    private static String title(String firstMessage) {
        String oneLine = firstMessage.strip().replaceAll("\\s+", " ");
        return (oneLine.length() <= MAX_TITLE_LENGTH) ? oneLine : oneLine.substring(0, MAX_TITLE_LENGTH - 1) + "…";
    }
}
