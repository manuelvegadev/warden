package io.github.manuelvega.warden.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;

/**
 * The WebSocket to wardend's agent listener. Reconnects with backoff, sends {@code hello} on every
 * (re)connection and hands {@code hello.ok} to the tracker. Sends are serialised on one thread
 * because the JDK client refuses overlapping sends.
 */
public final class WardendClient {
    /** Chunk hashes wardend already holds, keyed by world: [cx, cz, hex hash]. */
    public record Known(Map<String, JsonArray> byWorld) {}

    private final Logger log;
    private final AgentConfig cfg;
    private final Supplier<String> hello;
    private final Consumer<Known> onHelloOk;
    private final ScheduledExecutorService timer = Executors.newSingleThreadScheduledExecutor(daemon("warden-agent-timer"));
    private final ExecutorService sender = Executors.newSingleThreadExecutor(daemon("warden-agent-send"));
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final AtomicReference<WebSocket> socket = new AtomicReference<>();
    private final ConcurrentHashMap<String, Consumer<JsonObject>> handlers = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<Byte, Consumer<ByteBuffer>> binaryHandlers = new ConcurrentHashMap<>();
    private volatile boolean ready; // hello.ok received on the current socket
    private volatile boolean closed;
    private int attempt;

    public WardendClient(Logger log, AgentConfig cfg, Supplier<String> hello, Consumer<Known> onHelloOk) {
        this.log = log;
        this.cfg = cfg;
        this.hello = hello;
        this.onHelloOk = onHelloOk;
    }

    public void start() {
        timer.execute(this::connect);
    }

    /**
     * Registers the handler for one wardend message type ({@code hello.ok} and {@code error} are
     * built in). Called on the socket thread with the parsed message.
     */
    public void on(String type, Consumer<JsonObject> handler) {
        handlers.put(type, handler);
    }

    /**
     * Registers the handler for one kind of binary message from wardend (its first byte). Called on
     * the socket thread with a little-endian buffer positioned just after the kind byte; the buffer
     * is the handler's to keep.
     */
    public void onBinary(byte kind, Consumer<ByteBuffer> handler) {
        binaryHandlers.put(kind, handler);
    }

    /** True once wardend accepted the hello on the live socket. */
    public boolean isReady() {
        return ready && socket.get() != null;
    }

    public void sendText(String text) {
        send(ws -> ws.sendText(text, true));
    }

    public void sendBinary(ByteBuffer data) {
        send(ws -> ws.sendBinary(data, true));
    }

    /** Sends on the live socket, one message at a time; a failed send drops the socket and reconnects. */
    private void send(Function<WebSocket, CompletableFuture<WebSocket>> op) {
        WebSocket ws = socket.get();
        if (ws == null || !ready) {
            return;
        }
        enqueue(ws, op);
    }

    private void enqueue(WebSocket ws, Function<WebSocket, CompletableFuture<WebSocket>> op) {
        sender.execute(() -> {
            try {
                op.apply(ws).join();
            } catch (RuntimeException e) {
                dropped(ws, e);
            }
        });
    }

    public void close() {
        closed = true;
        WebSocket ws = socket.getAndSet(null);
        ready = false;
        if (ws != null) {
            try {
                ws.sendClose(WebSocket.NORMAL_CLOSURE, "plugin disabled").get(2, TimeUnit.SECONDS);
            } catch (Exception ignored) {
                ws.abort();
            }
        }
        sender.shutdownNow();
        timer.shutdownNow();
    }

    private void connect() {
        if (closed) {
            return;
        }
        URI uri;
        try {
            uri = URI.create(cfg.url());
        } catch (IllegalArgumentException e) {
            log.severe("Invalid wardend url in config.yml: " + cfg.url());
            return;
        }
        http.newWebSocketBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .buildAsync(uri, new Listener())
                .whenComplete((ws, err) -> {
                    if (err != null) {
                        if (attempt == 0) {
                            log.warning("Cannot reach wardend at " + cfg.url() + ": " + rootMessage(err) + " (retrying)");
                        }
                        scheduleReconnect();
                        return;
                    }
                    socket.set(ws);
                    // hello bypasses the ready check: it is what makes the socket ready.
                    enqueue(ws, w -> w.sendText(hello.get(), true));
                });
    }

    private void scheduleReconnect() {
        if (closed) {
            return;
        }
        attempt++;
        long delay = Math.min(30_000, 1000L << Math.min(attempt, 5));
        timer.schedule(this::connect, delay, TimeUnit.MILLISECONDS);
    }

    /** A send failed: the socket is gone. Forget it and reconnect (once; later sends on the same socket are no-ops). */
    private void dropped(WebSocket ws, Throwable err) {
        if (socket.compareAndSet(ws, null)) {
            ready = false;
            log.log(Level.FINE, "send failed", err);
            ws.abort();
            scheduleReconnect();
        }
    }

    private static String rootMessage(Throwable t) {
        while (t.getCause() != null) {
            t = t.getCause();
        }
        return t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
    }

    private final class Listener implements WebSocket.Listener {
        private final StringBuilder text = new StringBuilder();
        // The JDK client may deliver one message in several parts.
        private final ByteArrayOutputStream binary = new ByteArrayOutputStream();

        @Override
        public void onOpen(WebSocket ws) {
            ws.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            text.append(data);
            if (last) {
                String msg = text.toString();
                text.setLength(0);
                handle(ws, msg);
            }
            ws.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onBinary(WebSocket ws, ByteBuffer data, boolean last) {
            if (last && binary.size() == 0) {
                // The usual case, one part: hand the handler the buffer itself, no copy.
                dispatch(data.slice().order(ByteOrder.LITTLE_ENDIAN));
            } else {
                byte[] part = new byte[data.remaining()];
                data.get(part);
                binary.write(part, 0, part.length);
                if (last) {
                    byte[] msg = binary.toByteArray();
                    binary.reset();
                    dispatch(ByteBuffer.wrap(msg).order(ByteOrder.LITTLE_ENDIAN));
                }
            }
            ws.request(1);
            return null;
        }

        /** Routes one whole binary message by its first byte; the handler gets the buffer positioned after it. */
        private void dispatch(ByteBuffer msg) {
            if (!msg.hasRemaining()) {
                return;
            }
            byte kind = msg.get();
            Consumer<ByteBuffer> handler = binaryHandlers.get(kind);
            if (handler == null) {
                return;
            }
            try {
                handler.accept(msg);
            } catch (RuntimeException e) {
                log.log(Level.FINE, "binary message of kind " + kind + " rejected", e);
            }
        }

        @Override
        public CompletionStage<?> onClose(WebSocket ws, int statusCode, String reason) {
            if (socket.compareAndSet(ws, null)) {
                ready = false;
                log.info("wardend closed the connection (" + statusCode + " " + reason + ")");
                scheduleReconnect();
            }
            return null;
        }

        @Override
        public void onError(WebSocket ws, Throwable error) {
            if (socket.compareAndSet(ws, null)) {
                ready = false;
                log.log(Level.FINE, "socket error", error);
                scheduleReconnect();
            }
        }

        private void handle(WebSocket ws, String msg) {
            JsonObject o;
            try {
                o = JsonParser.parseString(msg).getAsJsonObject();
            } catch (RuntimeException e) {
                return;
            }
            String type = str(o, "type");
            switch (type) {
                case "hello.ok" -> {
                    Map<String, JsonArray> known = new HashMap<>();
                    if (o.has("known") && o.get("known").isJsonObject()) {
                        for (Map.Entry<String, JsonElement> e : o.getAsJsonObject("known").entrySet()) {
                            if (e.getValue().isJsonArray()) {
                                known.put(e.getKey(), e.getValue().getAsJsonArray());
                            }
                        }
                    }
                    attempt = 0;
                    ready = true;
                    log.info("Connected to wardend");
                    onHelloOk.accept(new Known(known));
                }
                case "error" -> log.warning("wardend: " + (o.has("message") ? str(o, "message") : msg));
                default -> {
                    Consumer<JsonObject> handler = handlers.get(type);
                    if (handler != null) {
                        handler.accept(o);
                    }
                }
            }
        }
    }

    /** A null-safe boolean field of a wardend message; false when absent. */
    static boolean bool(JsonObject o, String k) {
        return o.has(k) && !o.get(k).isJsonNull() && o.get(k).getAsBoolean();
    }

    /** A null-safe string field of a wardend message; empty when absent. */
    static String str(JsonObject o, String k) {
        return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : "";
    }

    /** A named daemon thread factory, shared with the tracker's encode thread. */
    static java.util.concurrent.ThreadFactory daemon(String name) {
        return r -> {
            Thread t = new Thread(r, name);
            t.setDaemon(true);
            return t;
        };
    }
}
