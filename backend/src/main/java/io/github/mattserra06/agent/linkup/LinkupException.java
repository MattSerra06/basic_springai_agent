package io.github.mattserra06.agent.linkup;

import org.jspecify.annotations.Nullable;

/**
 * A call to the Linkup API that did not give a result. {@link #forModel()} words it as a
 * tool result: what went wrong, and whether trying again can help.
 */
public class LinkupException extends RuntimeException {

    /** What went wrong, as far as the caller can act on it. */
    public enum Kind {

        /** 400: a parameter the API refuses. */
        INVALID_REQUEST("Linkup refused the request. Correct the arguments and call again."),

        /** 400 SEARCH_QUERY_NO_RESULT. */
        NO_RESULT("The search found nothing. Rephrase the query or loosen the date and domain filters."),

        /** 400 FETCH_*: the page could not be read. */
        FETCH_FAILED("Linkup could not read this URL. Check the URL; for a page that blocks robots or needs "
                + "JavaScript, try again with mode pro or renderJs true. Files other than HTML and PDF, and pages "
                + "over 20 MB (PDF: 100 MB), cannot be fetched."),

        /** 401, 402, 403. */
        UNAUTHORIZED("Linkup rejected the API key of this server. Do not retry: tell the user that the "
                + "LINKUP_API_KEY configured on the backend is invalid or lacks the rights for this call."),

        /** 429 with a credit or budget code. */
        OUT_OF_CREDITS("The Linkup account has no credits left, or the key reached its budget limit. Do not "
                + "retry: tell the user to add credits on app.linkup.so."),

        /** 429 TOO_MANY_REQUESTS. */
        RATE_LIMITED("Linkup is rate-limiting this server: too many requests at once. Wait a few seconds "
                + "before trying again, and make fewer calls in parallel."),

        /** 429 without a code that tells credits and rate apart. */
        TOO_MANY_REQUESTS("Linkup answered 429: either too many requests at once, or the account is out of "
                + "credits. Try once more after a few seconds; if it fails again, tell the user to check the "
                + "credits on app.linkup.so."),

        /** 404: an unknown research task. */
        NOT_FOUND("Linkup does not know this identifier. Use the id returned by linkup_research_start."),

        /** No answer within the configured timeout, or 504 from the API. */
        TIMEOUT("Linkup did not answer in time. Try again once, with a lighter depth or a simpler query."),

        /** The API could not be reached. */
        UNREACHABLE("The Linkup API could not be reached from this server (network error). Try again once; "
                + "if it fails again, tell the user."),

        /** 5xx, or an answer that is not what the API documents. */
        SERVER_ERROR("Linkup failed on its side. Try again once; if it fails again, tell the user.");

        private final String advice;

        Kind(String advice) {
            this.advice = advice;
        }
    }

    private final Kind kind;
    private final @Nullable Integer status;
    private final @Nullable String code;
    private final @Nullable String detail;

    /**
     * @param status the HTTP status, when the API answered
     * @param code the error code of the API ({@code error.code}), when it gave one
     * @param detail what the API said went wrong, field errors included
     */
    public LinkupException(Kind kind, @Nullable Integer status, @Nullable String code, @Nullable String detail,
                           @Nullable Throwable cause) {
        super(describe(kind, status, code, detail), cause);
        this.kind = kind;
        this.status = status;
        this.code = code;
        this.detail = detail;
    }

    public LinkupException(Kind kind, String detail, @Nullable Throwable cause) {
        this(kind, null, null, detail, cause);
    }

    public Kind kind() {
        return kind;
    }

    public @Nullable Integer status() {
        return status;
    }

    public @Nullable String code() {
        return code;
    }

    /** What the API said went wrong. */
    public @Nullable String detail() {
        return detail;
    }

    /** The failure as a tool result the model can read and act on. */
    public String forModel() {
        StringBuilder text = new StringBuilder("Linkup error: ").append(kind.advice);
        if (detail != null && !detail.isBlank()) {
            text.append("\nDetails");
            if (status != null) {
                text.append(" (HTTP ").append(status).append((code != null) ? " " + code : "").append(')');
            }
            text.append(": ").append(detail);
        }
        return text.toString();
    }

    private static String describe(Kind kind, @Nullable Integer status, @Nullable String code,
                                   @Nullable String detail) {
        return "Linkup %s%s%s%s".formatted(kind, (status != null) ? " HTTP " + status : "",
                (code != null) ? " " + code : "", (detail != null) ? ": " + detail : "");
    }
}
