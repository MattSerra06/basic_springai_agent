package io.github.mattserra06.agent.eodhd;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * A local MCP server standing in for EODHD's: it speaks Streamable HTTP as far as a
 * client that lists and calls tools needs, answers tool calls with what the test
 * scripted, and remembers every request it received.
 */
public final class FakeEodhd implements AutoCloseable {

    /** A request as the server received it; {@code rpc} is the JSON-RPC method of a POST. */
    public record Call(String httpMethod, String query, String rpc, JsonNode params) {
    }

    private record Reply(String text, boolean toolError, String protocolError) {
    }

    /** A key no real account has; tests check that it only ever travels in the address. */
    public static final String API_KEY = "eodhd-test-key-51c0";

    /** The tools the server has, the last one being outside the default choice of the agent. */
    public static final List<String> TOOLS = List.of("get_live_price_data", "get_fundamentals_data",
            "get_mp_praams_report_equity_by_ticker");

    public final List<Call> calls = new CopyOnWriteArrayList<>();

    private final Queue<Reply> replies = new ConcurrentLinkedQueue<>();
    private final JsonMapper json = JsonMapper.shared();
    private final HttpServer server;

    public FakeEodhd() {
        try {
            server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        }
        catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
        server.createContext("/", this::handle);
        server.start();
    }

    /** What to give as {@code agent.eodhd.base-url}. */
    public String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    /** Settings that point a client at this server, with {@link #API_KEY} as its key. */
    public EodhdProperties properties(List<String> tools, int maxResultChars) {
        return new EodhdProperties(API_KEY, baseUrl(), "/v1/mcp", Duration.ofSeconds(2), Duration.ofSeconds(5),
                maxResultChars, tools, "Use the market data tools.");
    }

    /** The next tool call answers this text. */
    public void answers(String text) {
        replies.add(new Reply(text, false, null));
    }

    /** The next tool call is refused by the tool itself: a result marked as an error. */
    public void refuses(String text) {
        replies.add(new Reply(text, true, null));
    }

    /** The next tool call fails at the level of the protocol: a JSON-RPC error. */
    public void fails(String message) {
        replies.add(new Reply(null, false, message));
    }

    /** The tool calls received, in order. */
    public List<Call> toolCalls() {
        return calls.stream().filter(call -> "tools/call".equals(call.rpc())).toList();
    }

    public void reset() {
        calls.clear();
        replies.clear();
    }

    @Override
    public void close() {
        server.stop(0);
    }

    private void handle(HttpExchange exchange) throws IOException {
        try (exchange) {
            String query = exchange.getRequestURI().getRawQuery();
            if (!"POST".equals(exchange.getRequestMethod())) {
                calls.add(new Call(exchange.getRequestMethod(), query, null, null));
                // No stream of its own to listen to, and nothing to do to end a session
                exchange.sendResponseHeaders("GET".equals(exchange.getRequestMethod()) ? 405 : 200, -1);
                return;
            }
            JsonNode request = json.readTree(exchange.getRequestBody().readAllBytes());
            String rpc = request.path("method").asString();
            calls.add(new Call("POST", query, rpc, request.path("params")));
            if (!request.has("id")) {
                exchange.sendResponseHeaders(202, -1); // a notification: nothing to answer
                return;
            }
            ObjectNode response = json.createObjectNode().put("jsonrpc", "2.0");
            response.set("id", request.get("id"));
            answer(rpc, request.path("params"), response);
            byte[] body = json.writeValueAsBytes(response);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, body.length);
            exchange.getResponseBody().write(body);
        }
    }

    private void answer(String rpc, JsonNode params, ObjectNode response) {
        switch (rpc) {
            case "initialize" -> {
                ObjectNode result = response.putObject("result");
                result.put("protocolVersion", params.path("protocolVersion").asString("2025-06-18"));
                result.putObject("capabilities").putObject("tools").put("listChanged", false);
                result.putObject("serverInfo").put("name", "fake-eodhd").put("version", "1");
            }
            case "tools/list" -> {
                ArrayNode tools = response.putObject("result").putArray("tools");
                for (String name : TOOLS) {
                    ObjectNode tool = tools.addObject().put("name", name).put("description", "Fake " + name + ".");
                    ObjectNode schema = tool.putObject("inputSchema").put("type", "object");
                    schema.putObject("properties").putObject("ticker").put("type", "string")
                            .put("description", "SYMBOL.EXCHANGE");
                    schema.putArray("required").add("ticker");
                }
            }
            case "tools/call" -> {
                Reply reply = replies.poll();
                if (reply != null && reply.protocolError() != null) {
                    response.putObject("error").put("code", -32602).put("message", reply.protocolError());
                    return;
                }
                ObjectNode result = response.putObject("result");
                result.putArray("content").addObject().put("type", "text")
                        .put("text", (reply != null) ? reply.text() : "{}");
                result.put("isError", reply != null && reply.toolError());
            }
            case "ping" -> response.putObject("result");
            default -> response.putObject("error").put("code", -32601).put("message", "Method not found: " + rpc);
        }
    }

    /** Whether a text holds the key, plain or as an address carries it. */
    public static boolean holdsKey(String text) {
        return text.contains(API_KEY)
                || text.contains(java.net.URLEncoder.encode(API_KEY, StandardCharsets.UTF_8));
    }
}
