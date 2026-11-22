package io.github.mattserra06.agent.openui;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;

import jakarta.validation.constraints.NotNull;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.core.io.Resource;
import org.springframework.validation.annotation.Validated;

/**
 * Settings of the generated interface, under {@code agent.openui} in application.yaml.
 * <p>
 * When it is on, the model writes its replies in OpenUI Lang, a small language of
 * component calls, and the frontend draws them: tables, charts, maps, forms. The prompt
 * that teaches the model the language and the components is generated from the
 * frontend's catalogue ({@code npm run openui:prompt} in {@code frontend/}), so that
 * what the model may write is exactly what the frontend can draw. Only the open-source
 * part of OpenUI is used: the model is the one the agent already calls.
 *
 * @param enabled whether replies are written as an interface; when off they are plain
 * text, which the frontend shows as such
 * @param prompt the generated prompt, added to the system prompt
 */
@Validated
@ConfigurationProperties("agent.openui")
public record OpenUiProperties(boolean enabled, @NotNull Resource prompt) {

    /** The text of {@link #prompt}. */
    public String instructions() {
        try {
            return prompt.getContentAsString(StandardCharsets.UTF_8).strip();
        }
        catch (IOException ex) {
            throw new UncheckedIOException("Cannot read the OpenUI prompt " + prompt
                    + "; generate it with `npm run openui:prompt` in frontend/", ex);
        }
    }
}
