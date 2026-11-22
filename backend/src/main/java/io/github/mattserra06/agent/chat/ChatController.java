package io.github.mattserra06.agent.chat;

import java.time.Duration;
import java.util.Map;

import io.github.mattserra06.agent.AgentProperties;
import jakarta.validation.Valid;
import org.jspecify.annotations.Nullable;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;

/**
 * Sending a message and reading the reply are two requests. The POST starts a run and
 * returns at once; the reply is produced in the background and read as Server-Sent
 * Events with a GET that can be dropped and resumed at will, so no request has to stay
 * open for as long as the model works.
 */
@RestController
@RequestMapping("/api/runs")
public class ChatController {

    private final ChatService chatService;
    private final RunStore runs;
    private final Duration heartbeat;

    public ChatController(ChatService chatService, RunStore runs, AgentProperties properties) {
        this.chatService = chatService;
        this.runs = runs;
        this.heartbeat = properties.streamHeartbeat();
    }

    /** Sends a message; the reply is read from {@code GET /api/runs/{id}/events}. */
    @PostMapping
    @ResponseStatus(HttpStatus.ACCEPTED)
    public ChatService.RunStarted start(@Valid @RequestBody ChatRequest request) {
        return chatService.start(request.sessionId(), request.message());
    }

    /**
     * The events of a run, for an {@code EventSource}. Every event carries its sequence
     * number as its id, and a request with a {@code Last-Event-ID} header, which a
     * browser sends by itself when it reconnects, gets the events after that one; without
     * the header, all of them from the start of the run.
     * <ul>
     * <li>default events — {@code {"text":"..."}}, the reply's text deltas;</li>
     * <li>{@code event:done} — {@code {"interrupted":false}}, last;</li>
     * <li>{@code event:failed} — {@code {"message":"..."}}, last, instead of
     * {@code done} when the run failed.</li>
     * </ul>
     * The stream ends after the last event: the client closes its {@code EventSource}
     * then, or the browser would reconnect. Comment lines are sent while the model is
     * silent, so that proxies do not take the connection for dead.
     */
    @GetMapping(path = "/{runId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Object>> events(@PathVariable String runId,
            @RequestHeader(name = "Last-Event-ID", required = false) @Nullable String lastEventId) {
        if (runs.find(runId).isEmpty()) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Unknown run " + runId);
        }
        Flux<ServerSentEvent<Object>> keepAlive = Flux.interval(heartbeat)
                .map(tick -> ServerSentEvent.<Object>builder().comment("keep-alive").build());
        return runs.events(runId, sequence(lastEventId))
                .map(ChatController::toServerSentEvent)
                .publish(events -> Flux.merge(events, keepAlive.takeUntilOther(events.then())));
    }

    private static long sequence(@Nullable String lastEventId) {
        try {
            return (lastEventId != null) ? Long.parseLong(lastEventId.strip()) : 0;
        }
        catch (NumberFormatException ex) {
            return 0;
        }
    }

    private static ServerSentEvent<Object> toServerSentEvent(RunEvent runEvent) {
        ServerSentEvent.Builder<Object> sse = ServerSentEvent.builder().id(String.valueOf(runEvent.sequence()));
        return switch (runEvent.event()) {
            case ChatEvent.Text text -> sse.data(Map.of("text", text.text())).build();
            case ChatEvent.Done done -> sse.event("done").data(Map.of("interrupted", done.interrupted())).build();
            case ChatEvent.Failed failed -> sse.event("failed").data(Map.of("message", failed.message())).build();
        };
    }
}
