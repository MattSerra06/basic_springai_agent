package io.github.mattserra06.agent.chat;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.client.ChatClientResponse;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.session.advisor.SessionMemoryAdvisor;

import static org.assertj.core.api.Assertions.assertThat;

class TurnTest {

    private final Turn turn = new Turn(null);

    @Test
    void showsTheTextOfARoundAsItComes() {
        assertThat(turn.accept(chunk("request-1", "Bon"))).isEqualTo("Bon");
        assertThat(turn.accept(chunk("request-1", "jour"))).isEqualTo("jour");

        assertThat(turn.roundText()).isEqualTo("Bonjour");
        assertThat(turn.roundRequestEventId()).isEqualTo("request-1");
    }

    @Test
    void setsANewRoundApartWithABlankLine() {
        turn.accept(chunk("request-1", "Je cherche."));

        assertThat(turn.accept(chunk("request-2", "Trouvé"))).isEqualTo("\n\nTrouvé");
        assertThat(turn.accept(chunk("request-2", "."))).isEqualTo(".");

        // Only the round in progress is left to store when a stop cuts it
        assertThat(turn.roundText()).isEqualTo("Trouvé.");
        assertThat(turn.roundRequestEventId()).isEqualTo("request-2");
    }

    @Test
    void keepsTheBlankLineWhenANewRoundStartsWithChunksWithoutText() {
        turn.accept(chunk("request-1", "Je cherche."));

        // A reasoning delta or the first, empty chunk of the next model call
        assertThat(turn.accept(chunk("request-2", ""))).isEmpty();
        assertThat(turn.accept(chunk("request-2", null))).isEmpty();

        assertThat(turn.accept(chunk("request-2", "Trouvé."))).isEqualTo("\n\nTrouvé.");
    }

    @Test
    void doesNotStartTheReplyWithABlankLine() {
        assertThat(turn.accept(chunk("request-1", ""))).isEmpty();
        assertThat(turn.accept(chunk("request-1", "Bonjour"))).isEqualTo("Bonjour");
    }

    @Test
    void forgetsTheTextOfARoundOnceTheNextOneStarts() {
        turn.accept(chunk("request-1", "Je cherche."));

        turn.accept(chunk("request-2", ""));

        assertThat(turn.roundText()).isEmpty();
    }

    @Test
    void aStopCutsTheReplyShortOnlyWhileTheModelIsStillReplying() {
        Turn stoppedInTime = new Turn(null);
        stoppedInTime.interrupt();
        assertThat(stoppedInTime.wasCutShort()).isTrue();

        Turn stoppedTooLate = new Turn(null);
        stoppedTooLate.modelFinished();
        stoppedTooLate.interrupt();
        assertThat(stoppedTooLate.isInterrupted()).isTrue();
        assertThat(stoppedTooLate.wasCutShort()).isFalse();

        assertThat(new Turn(null).wasCutShort()).isFalse();
    }

    private static ChatClientResponse chunk(String requestEventId, String text) {
        return ChatClientResponse.builder()
                .chatResponse(new ChatResponse(List.of(new Generation(new AssistantMessage(text)))))
                .context(Map.of(SessionMemoryAdvisor.REQUEST_EVENT_ID_CONTEXT_KEY, requestEventId))
                .build();
    }
}
