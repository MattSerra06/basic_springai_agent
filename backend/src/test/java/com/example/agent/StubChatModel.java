package com.example.agent;

import java.time.Duration;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;

import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.ChatOptions;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.model.tool.ToolCallingChatOptions;
import reactor.core.publisher.Flux;

/**
 * A scripted model: streams what the test tells it to, answers summary requests with
 * {@code SUMMARY n}, and remembers every prompt it was sent.
 */
public class StubChatModel implements ChatModel {

    /** The prompts of the streamed (conversation) calls. */
    public final List<Prompt> prompts = new CopyOnWriteArrayList<>();

    /** The prompts of the blocking calls: the summarizer's. */
    public final List<Prompt> summaryPrompts = new CopyOnWriteArrayList<>();

    private volatile Function<Prompt, Flux<AssistantMessage>> script;

    private volatile Duration summaryDuration;

    public StubChatModel() {
        reset();
    }

    public void reset() {
        prompts.clear();
        summaryPrompts.clear();
        summaryDuration = Duration.ZERO;
        repliesWith("OK");
    }

    /** Every turn streams these chunks. */
    public void repliesWith(String... chunks) {
        script = prompt -> Flux.fromArray(chunks).map(AssistantMessage::new);
    }

    /** Every turn streams these chunks, one per interval. */
    public void repliesSlowlyWith(Duration interval, String... chunks) {
        script = prompt -> Flux.fromArray(chunks).delayElements(interval).map(AssistantMessage::new);
    }

    public void repliesWith(Function<Prompt, Flux<AssistantMessage>> script) {
        this.script = script;
    }

    /** Tool-calling options, so that the ChatClient runs its tool-calling loop. */
    @Override
    public ChatOptions getOptions() {
        return ToolCallingChatOptions.builder().build();
    }

    /** Every summary takes this long to write. */
    public void summarizesIn(Duration duration) {
        summaryDuration = duration;
    }

    @Override
    public ChatResponse call(Prompt prompt) {
        summaryPrompts.add(prompt);
        try {
            Thread.sleep(summaryDuration);
        }
        catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
        }
        return new ChatResponse(List.of(new Generation(new AssistantMessage("SUMMARY " + summaryPrompts.size()))));
    }

    @Override
    public Flux<ChatResponse> stream(Prompt prompt) {
        prompts.add(prompt);
        return script.apply(prompt).map(message -> new ChatResponse(List.of(new Generation(message))));
    }
}
