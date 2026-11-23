package io.github.mattserra06.agent.eodhd;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

import io.modelcontextprotocol.client.McpClient;
import io.modelcontextprotocol.client.McpSyncClient;
import io.modelcontextprotocol.client.transport.HttpClientStreamableHttpTransport;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.model.ToolContext;
import org.springframework.ai.mcp.SyncMcpToolCallbackProvider;
import org.springframework.ai.tool.ToolCallback;
import org.springframework.ai.tool.definition.ToolDefinition;
import org.springframework.ai.tool.metadata.ToolMetadata;

/**
 * The market data tools: those of the EODHD MCP server, reached over Streamable HTTP and
 * handed to the model as they are named and described there.
 * <p>
 * The server is contacted once, when the application starts, to learn its tools. Without
 * an API key, or when it cannot be reached then, the agent runs without these tools: the
 * application starts all the same.
 * <p>
 * A call that fails, whether the server refuses it (an unknown ticker, a plan that does
 * not cover the data, no credits left) or cannot be reached, is told to the model as the
 * result of the tool, so that the run goes on. The key is part of the address of the
 * server: it is taken out of anything said or logged about a failure.
 */
public final class EodhdTools implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(EodhdTools.class);

    /** How the result of a call that failed starts. */
    public static final String FAILURE = "EODHD error: ";

    private final @Nullable McpSyncClient client;
    private final List<Guarded> callbacks;

    private EodhdTools(@Nullable McpSyncClient client, List<Guarded> callbacks) {
        this.client = client;
        this.callbacks = List.copyOf(callbacks);
    }

    /** No tools: no key, or a server that could not be reached. */
    public static EodhdTools off() {
        return new EodhdTools(null, List.of());
    }

    /**
     * Connects to the server and learns its tools. Never throws: a failure is logged and
     * leaves the agent without these tools.
     */
    public static EodhdTools connect(EodhdProperties properties) {
        if (!properties.hasApiKey()) {
            log.info("Market data tools are off: no EODHD API key (EODHD_API_KEY)");
            return off();
        }
        String key = properties.apiKey().strip();
        McpSyncClient client = null;
        try {
            var transport = HttpClientStreamableHttpTransport.builder(properties.baseUrl())
                    .endpoint(properties.endpoint() + "?apikey=" + URLEncoder.encode(key, StandardCharsets.UTF_8))
                    .connectTimeout(properties.connectTimeout())
                    .build();
            client = McpClient.sync(transport)
                    .requestTimeout(properties.timeout())
                    .initializationTimeout(properties.timeout())
                    .build();
            client.initialize();

            List<String> wanted = properties.tools();
            ToolCallback[] found = SyncMcpToolCallbackProvider.builder()
                    .mcpClients(client)
                    .toolFilter((connection, tool) -> wanted.isEmpty() || wanted.contains(tool.name()))
                    .build()
                    .getToolCallbacks();
            List<Guarded> callbacks = new ArrayList<>();
            for (ToolCallback tool : found) {
                callbacks.add(new Guarded(tool, key, properties.maxResultChars(), false));
            }
            List<String> names = callbacks.stream().map(tool -> tool.getToolDefinition().name()).toList();
            List<String> missing = wanted.stream().filter(name -> !names.contains(name)).toList();
            if (!missing.isEmpty()) {
                log.warn("The EODHD server has no tool named {}: check agent.eodhd.tools", missing);
            }
            log.info("Market data tools are on: {} EODHD tools {}", names.size(), names);
            return new EodhdTools(client, callbacks);
        }
        catch (RuntimeException ex) {
            log.warn("Market data tools are off: the EODHD MCP server could not be used ({})", scrub(describe(ex), key));
            close(client);
            return off();
        }
    }

    /** The tools to give to the model; empty when they are off. */
    public List<ToolCallback> callbacks() {
        return List.copyOf(callbacks);
    }

    /**
     * The same tools for an interface that loads its figures by itself. It needs a
     * result whole, since half a JSON document cannot be read: one longer than the
     * limit is a failure instead of being cut.
     * @param maxResultChars the longest result an interface may load
     */
    public List<ToolCallback> forInterfaces(int maxResultChars) {
        return callbacks.stream()
                .map(tool -> (ToolCallback) new Guarded(tool.tool, tool.key, maxResultChars, true))
                .toList();
    }

    public boolean on() {
        return !callbacks.isEmpty();
    }

    @Override
    public void close() {
        close(client);
    }

    private static void close(@Nullable McpSyncClient client) {
        if (client != null) {
            try {
                client.closeGracefully();
            }
            catch (RuntimeException ex) {
                log.debug("The connection to the EODHD server did not close cleanly: {}", ex.toString());
            }
        }
    }

    /** An exception and what caused it, on one line. */
    private static String describe(Throwable failure) {
        StringBuilder text = new StringBuilder();
        for (Throwable cause = failure; cause != null && text.length() < 400; cause = cause.getCause()) {
            String message = (cause.getMessage() != null) ? cause.getMessage() : cause.getClass().getSimpleName();
            if (text.indexOf(message) < 0) {
                text.append(text.isEmpty() ? "" : ": ").append(message);
            }
        }
        return text.toString();
    }

    /** How the MCP client prints a text a tool answered, inside the message of a failure. */
    private static final Pattern PRINTED_TEXT = Pattern.compile("TextContent\\[annotations=.*?, text=(.*?), meta=.*?]",
            Pattern.DOTALL);

    /**
     * What a tool that refused a call said. The MCP client reports such a refusal with
     * the content of the answer printed as Java objects: only the words of the tool are
     * worth reading, by the model as by the user of a dashboard.
     */
    static String said(String failure) {
        List<String> texts = PRINTED_TEXT.matcher(failure).results().map(match -> match.group(1).strip()).toList();
        return texts.isEmpty() ? failure : String.join(" ", texts);
    }

    /** The key, plain or as it stands in an address, never leaves in a message. */
    static String scrub(String text, String key) {
        return text.replace(key, "***").replace(URLEncoder.encode(key, StandardCharsets.UTF_8), "***");
    }

    /**
     * A tool of the server as it is called here: its failure is the result of the call
     * rather than the end of the run, and a very long result is cut for the model, or
     * refused when it must be whole.
     */
    private static final class Guarded implements ToolCallback {

        private final ToolCallback tool;
        private final String key;
        private final int maxResultChars;
        private final boolean whole;

        Guarded(ToolCallback tool, String key, int maxResultChars, boolean whole) {
            this.tool = tool;
            this.key = key;
            this.maxResultChars = maxResultChars;
            this.whole = whole;
        }

        @Override
        public ToolDefinition getToolDefinition() {
            return tool.getToolDefinition();
        }

        @Override
        public ToolMetadata getToolMetadata() {
            return tool.getToolMetadata();
        }

        @Override
        public String call(String toolInput) {
            return call(toolInput, null);
        }

        @Override
        public String call(String toolInput, @Nullable ToolContext toolContext) {
            try {
                String result = tool.call(toolInput, toolContext);
                if (result != null && result.length() > maxResultChars) {
                    String less = "Ask for less: a shorter period, fewer fields, one ticker.";
                    if (whole) {
                        return FAILURE + "the result has " + result.length() + " characters, more than the "
                                + maxResultChars + " an interface may load. " + less;
                    }
                    return result.substring(0, maxResultChars) + "\n[Cut: the result has " + result.length()
                            + " characters. " + less + "]";
                }
                return result;
            }
            catch (RuntimeException ex) {
                String failure = scrub(said(describe(ex)), key);
                log.warn("EODHD tool {} failed: {}", tool.getToolDefinition().name(), failure);
                return FAILURE + failure;
            }
        }
    }
}
