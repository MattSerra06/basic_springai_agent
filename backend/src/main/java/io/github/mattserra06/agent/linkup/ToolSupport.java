package io.github.mattserra06.agent.linkup;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.function.Supplier;

import io.github.mattserra06.agent.linkup.LinkupClient.Findings;
import io.github.mattserra06.agent.linkup.LinkupClient.Source;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * What the Linkup tools share: checking the arguments the model sends, turning every
 * failure into a tool result the model can read, and writing what was found as JSON.
 */
final class ToolSupport {

    private static final Logger log = LoggerFactory.getLogger(ToolSupport.class);

    /** The least a passage keeps when many of them share the size limit of a result. */
    private static final int MIN_PASSAGE_CHARS = 300;

    private ToolSupport() {
    }

    /** An argument the model must correct; the message is written for it. */
    static final class InvalidArgument extends RuntimeException {

        InvalidArgument(String message) {
            super(message);
        }
    }

    /**
     * Runs a tool and returns its result. A failure becomes the result, never an
     * exception: the model reads what went wrong and the run goes on.
     */
    static String answer(String tool, Supplier<String> call) {
        try {
            return call.get();
        }
        catch (InvalidArgument ex) {
            return "Invalid call to " + tool + ": " + ex.getMessage();
        }
        catch (LinkupException ex) {
            return ex.forModel();
        }
        catch (RuntimeException ex) {
            log.error("Tool {} failed", tool, ex);
            return "Linkup error: " + tool + " failed unexpectedly (" + ex.getClass().getSimpleName()
                    + "). Do not retry: tell the user, the details are in the backend logs.";
        }
    }

    static String required(String name, @Nullable String value) {
        if (value == null || value.isBlank()) {
            throw new InvalidArgument(name + " is required.");
        }
        return value.strip();
    }

    static @Nullable String optional(@Nullable String value) {
        return (value == null || value.isBlank()) ? null : value.strip();
    }

    /** One of the values the API accepts for this parameter, or the fallback when none is given. */
    static @Nullable String oneOf(String name, @Nullable String value, List<String> allowed,
                                  @Nullable String fallback) {
        String given = optional(value);
        if (given == null) {
            return fallback;
        }
        return allowed.stream()
                .filter(given::equalsIgnoreCase)
                .findFirst()
                .orElseThrow(() -> new InvalidArgument(
                        "%s must be one of %s, not '%s'.".formatted(name, String.join(", ", allowed), given)));
    }

    static @Nullable LocalDate date(String name, @Nullable String value) {
        String given = optional(value);
        if (given == null) {
            return null;
        }
        try {
            return LocalDate.parse(given);
        }
        catch (DateTimeParseException ex) {
            throw new InvalidArgument("%s must be a date written YYYY-MM-DD, not '%s'.".formatted(name, given));
        }
    }

    static void inOrder(@Nullable LocalDate fromDate, @Nullable LocalDate toDate) {
        if (fromDate != null && toDate != null && !fromDate.isBefore(toDate)) {
            throw new InvalidArgument("fromDate (%s) must be before toDate (%s).".formatted(fromDate, toDate));
        }
    }

    /** A JSON Schema whose root is an object, as compact JSON text: what the API expects. */
    static @Nullable String schema(String name, @Nullable String value) {
        String given = optional(value);
        if (given == null) {
            return null;
        }
        JsonNode schema;
        try {
            schema = LinkupClient.JSON.readTree(given);
        }
        catch (JacksonException ex) {
            throw new InvalidArgument(name + " must be a JSON Schema written as JSON text; this is not valid JSON.");
        }
        if (schema == null || !schema.isObject() || !"object".equals(schema.path("type").asString(""))) {
            throw new InvalidArgument(name + " must be a JSON Schema whose root has \"type\": \"object\".");
        }
        return schema.toString();
    }

    /** The domains given, without blanks. The API takes at most 100 domains to search on. */
    static List<String> domains(@Nullable List<String> values) {
        if (values == null) {
            return List.of();
        }
        return values.stream()
                .filter(domain -> domain != null && !domain.isBlank())
                .map(String::strip)
                .toList();
    }

    static List<String> includedDomains(@Nullable List<String> values) {
        List<String> domains = domains(values);
        if (domains.size() > 100) {
            throw new InvalidArgument("includeDomains takes at most 100 domains.");
        }
        return domains;
    }

    /**
     * Writes what a search or a research found: the answer, the structured data, the
     * sources with their passages, and the images apart. The answer and the passages
     * together stay around {@code maxChars}.
     */
    static void write(ObjectNode result, Findings findings, int maxChars) {
        int left = maxChars;
        if (findings.answer() != null) {
            String answer = cut(findings.answer(), maxChars, "the answer is longer");
            result.put("answer", answer);
            left -= answer.length();
        }
        if (findings.data() != null) {
            result.set("data", findings.data());
        }
        List<Source> pages = findings.sources().stream().filter(source -> !source.isImage()).toList();
        List<Source> images = findings.sources().stream().filter(Source::isImage).toList();
        int perPassage = Math.max(MIN_PASSAGE_CHARS, left / Math.max(1, pages.size()));
        ArrayNode sources = result.putArray("sources");
        for (Source page : pages) {
            ObjectNode source = sources.addObject().put("name", page.name()).put("url", page.url());
            if (page.publishedAt() != null) {
                source.put("publishedAt", page.publishedAt());
            }
            if (page.content() != null) {
                source.put("content", cut(page.content(), perPassage, "read the page with linkup_fetch"));
            }
        }
        if (!images.isEmpty()) {
            ArrayNode list = result.putArray("images");
            images.forEach(image -> list.addObject().put("name", image.name()).put("url", image.url()));
        }
    }

    /** The text, or its first {@code maxChars} characters followed by a note saying what was left out. */
    static String cut(String text, int maxChars, String hint) {
        if (text.length() <= maxChars) {
            return text;
        }
        return text.substring(0, maxChars) + " […cut, %d more characters: %s]".formatted(text.length() - maxChars, hint);
    }
}
