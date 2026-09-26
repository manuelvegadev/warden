package io.github.manuelvega.warden.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.logging.Level;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Runs wardend's {@code run} requests (ADR-025): one console command on the main thread, as a
 * sender with the console's permissions whose feedback comes here instead of going to the console,
 * so nothing reaches the console or latest.log. The reply is collected until it has been quiet for
 * {@link #QUIET_MS} (plugins may answer a tick later), at most {@link #MAX_WAIT_MS} from run()
 * start (plus ~20ms polling step), and answered as plain text lines. Every request gets exactly
 * one answer. Requests run one at a time.
 */
public final class CommandRunner {
    static final long QUIET_MS = 200;
    static final long MAX_WAIT_MS = 2000;
    static final int MAX_LINES = 200;

    private final JavaPlugin plugin;
    private final WardendClient client;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(WardendClient.daemon("warden-agent-run"));

    public CommandRunner(JavaPlugin plugin, WardendClient client) {
        this.plugin = plugin;
        this.client = client;
    }

    /** Socket thread: queues the request. */
    public void onRequest(JsonObject msg) {
        String id = WardendClient.str(msg, "id");
        if (id.isEmpty()) {
            return;
        }
        String command = WardendClient.str(msg, "command").trim();
        if (command.startsWith("/")) {
            command = command.substring(1);
        }
        if (command.isEmpty() || command.length() > CommandCompleter.MAX_LINE) {
            client.sendText(error(id, "invalid command").toString());
            return;
        }
        String line = command;
        worker.execute(() -> client.sendText(run(id, line).toString()));
    }

    public void shutdown() {
        worker.shutdownNow();
    }

    private JsonObject run(String id, String command) {
        long start = System.nanoTime();
        Collector out = new Collector(MAX_LINES);
        Future<Boolean> sync;
        try {
            sync = Bukkit.getScheduler().callSyncMethod(plugin, () -> {
                CommandSender sender = Bukkit.createCommandSender(c -> out.add(PlainTextComponentSerializer.plainText().serialize(c)));
                return Bukkit.dispatchCommand(sender, command);
            });
        } catch (RuntimeException e) {
            plugin.getLogger().log(Level.FINE, "scheduling \"" + command + "\" failed", e);
            return error(id, "failed");
        }
        try {
            sync.get(MAX_WAIT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            sync.cancel(false);
            return error(id, "timeout");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return error(id, "failed");
        } catch (Exception e) {
            plugin.getLogger().log(Level.FINE, "running \"" + command + "\" failed", e);
            return error(id, "failed");
        }
        // The quiet wait starts now that the command has run: a busy main thread that took longer
        // than QUIET_MS to get to it must not count as the reply having gone quiet.
        out.ranNow();
        // Budget the quiet wait against the time remaining from run() start.
        long elapsed = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);
        long remaining = Math.max(0, MAX_WAIT_MS - elapsed);
        try {
            out.awaitQuiet(QUIET_MS, remaining);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return result(id, out.lines());
    }

    /** Lines a command sent back, thread-safe: the main thread adds, the worker waits and reads. */
    static final class Collector {
        private final int max;
        private final List<String> lines = new ArrayList<>();
        private long lastAt = System.nanoTime();

        Collector(int max) {
            this.max = max;
        }

        /** One message; a message may hold several lines. Colour codes are dropped. */
        synchronized void add(String message) {
            for (String l : message.split("\n", -1)) {
                String clean = CommandCatalog.clean(l);
                if (!clean.isEmpty() && lines.size() < max) {
                    lines.add(clean);
                }
            }
            lastAt = System.nanoTime();
        }

        /** The command has just run: the quiet period counts from here, not from the request. */
        synchronized void ranNow() {
            lastAt = System.nanoTime();
        }

        synchronized List<String> lines() {
            return List.copyOf(lines);
        }

        /** Returns once nothing arrived for {@code quietMs}, or after {@code maxMs} in all. */
        void awaitQuiet(long quietMs, long maxMs) throws InterruptedException {
            long start = System.nanoTime();
            while (true) {
                long now = System.nanoTime();
                long sinceLast;
                synchronized (this) {
                    sinceLast = TimeUnit.NANOSECONDS.toMillis(now - lastAt);
                }
                if (sinceLast >= quietMs || TimeUnit.NANOSECONDS.toMillis(now - start) >= maxMs) {
                    return;
                }
                Thread.sleep(20);
            }
        }
    }

    static JsonObject result(String id, List<String> lines) {
        JsonArray arr = new JsonArray();
        lines.forEach(arr::add);
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "run.result");
        msg.addProperty("id", id);
        msg.add("lines", arr);
        return msg;
    }

    static JsonObject error(String id, String error) {
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "run.result");
        msg.addProperty("id", id);
        msg.addProperty("error", error);
        return msg;
    }
}
