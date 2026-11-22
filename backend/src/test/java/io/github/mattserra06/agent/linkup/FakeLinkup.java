package io.github.mattserra06.agent.linkup;

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

/**
 * A local HTTP server standing in for the Linkup API: it answers what the test scripted,
 * one reply per request and in order, and remembers every request it received.
 */
public final class FakeLinkup implements AutoCloseable {

    /** A request as the server received it. */
    public record Call(String method, String path, String authorization, String contentType, String body) {

        public JsonNode json() {
            return JsonMapper.shared().readTree(body);
        }
    }

    private record Reply(int status, String body, Duration delay) {
    }

    /** A key no real account has; tests check that it never leaves the Authorization header. */
    public static final String API_KEY = "test-key-7f3a91c2";

    public final List<Call> calls = new CopyOnWriteArrayList<>();

    private final Queue<Reply> replies = new ConcurrentLinkedQueue<>();
    private final HttpServer server;

    public FakeLinkup() {
        try {
            server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        }
        catch (IOException ex) {
            throw new UncheckedIOException(ex);
        }
        server.createContext("/", this::handle);
        server.start();
    }

    /** What to give as {@code agent.linkup.base-url}. */
    public String baseUrl() {
        return "http://127.0.0.1:" + server.getAddress().getPort() + "/v1";
    }

    /** Settings that point a client at this server, with {@link #API_KEY} as its key. */
    public LinkupProperties properties() {
        return properties(Duration.ofSeconds(5), 2000);
    }

    public LinkupProperties properties(Duration timeout, int maxResultChars) {
        return new LinkupProperties(API_KEY, baseUrl(), Duration.ofSeconds(2), timeout, maxResultChars, "Search the web.",
                new LinkupProperties.Research(true, Duration.ofMillis(10), Duration.ofSeconds(2)));
    }

    /** The next request that has no reply yet gets this one. */
    public FakeLinkup replies(int status, String body) {
        return repliesAfter(Duration.ZERO, status, body);
    }

    public FakeLinkup replies(String body) {
        return replies(200, body);
    }

    public FakeLinkup repliesAfter(Duration delay, int status, String body) {
        replies.add(new Reply(status, body, delay));
        return this;
    }

    /** The only request received. */
    public Call call() {
        if (calls.size() != 1) {
            throw new AssertionError("Expected one request, got " + calls.size() + ": " + calls);
        }
        return calls.getFirst();
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
            calls.add(new Call(exchange.getRequestMethod(), exchange.getRequestURI().getRawPath(),
                    exchange.getRequestHeaders().getFirst("Authorization"),
                    exchange.getRequestHeaders().getFirst("Content-Type"),
                    new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
            Reply reply = replies.poll();
            if (reply == null) {
                reply = new Reply(500, "{\"error\":{\"code\":\"NOT_SCRIPTED\",\"message\":\"The test scripted no reply\"}}",
                        Duration.ZERO);
            }
            try {
                Thread.sleep(reply.delay());
            }
            catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
            byte[] body = reply.body().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(reply.status(), (body.length == 0) ? -1 : body.length);
            exchange.getResponseBody().write(body);
        }
    }
}
