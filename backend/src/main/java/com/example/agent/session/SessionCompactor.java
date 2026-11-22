package com.example.agent.session;

import com.example.agent.AgentProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.session.SessionService;
import org.springframework.ai.session.compaction.ChatModelSummarizer;
import org.springframework.ai.session.compaction.CompactionStrategy;
import org.springframework.ai.session.compaction.CompactionTrigger;
import org.springframework.ai.session.compaction.TokenCountTrigger;
import org.springframework.ai.session.compaction.WindowCompactionStrategy;
import org.springframework.stereotype.Component;

/**
 * Keeps long conversations within a token budget by recursive summarization: once the
 * conversation sent to the model passes the trigger, the oldest turns are replaced by a
 * summary written by the model, and each new summary is built on the previous one. The
 * most recent turns stay verbatim. Nothing is deleted: the summarized messages stay in
 * the session log, for the UI and for {@code conversation_search}.
 */
@Component
public class SessionCompactor {

    private static final Logger log = LoggerFactory.getLogger(SessionCompactor.class);

    private final SessionService sessionService;
    private final CompactionTrigger trigger;
    private final CompactionStrategy strategy;

    public SessionCompactor(SessionService sessionService, ChatModel chatModel, AgentProperties properties) {
        AgentProperties.Compaction compaction = properties.compaction();
        this.sessionService = sessionService;
        this.trigger = TokenCountTrigger.builder().threshold(compaction.triggerTokens()).build();
        this.strategy = WindowCompactionStrategy.builder()
                .tokenBudget(compaction.keepTokens())
                .summarizer(ChatModelSummarizer.builder(chatModel).build())
                .build();
    }

    /**
     * Compacts the session if it has grown past the trigger. Blocking: the summary is a
     * model call. Best-effort: a failure leaves the conversation as it is, and the next
     * turn tries again.
     */
    public void compactIfNeeded(String sessionId) {
        try {
            if (sessionService.findById(sessionId) == null) {
                return; // deleted while its last turn was ending
            }
            sessionService.compact(sessionId, trigger, strategy);
        }
        catch (RuntimeException ex) {
            log.warn("Compaction of session {} failed; it will be retried after the next turn", sessionId, ex);
        }
    }
}
