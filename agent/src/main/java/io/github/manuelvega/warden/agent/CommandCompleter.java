package io.github.manuelvega.warden.agent;

import com.destroystokyo.paper.event.server.AsyncTabCompleteEvent;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Level;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.Bukkit;
import org.bukkit.command.CommandSender;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Answers wardend's {@code complete} requests the way the server's own console completes a line
 * (ADR-024): {@link AsyncTabCompleteEvent} off the main thread first, which plugins that complete
 * asynchronously answer (with tooltips); otherwise the command map on the main thread.
 *
 * <p>A plugin's completer cannot be interrupted once it runs, so the tick is protected by keeping at
 * most one request waiting: a newer one replaces it (answered {@code superseded}), and one the main
 * thread has not answered within {@link #DEADLINE_MS} is answered {@code timeout} and its result
 * dropped. Every request gets exactly one answer.
 */
public final class CommandCompleter {
    static final long DEADLINE_MS = 500;
    /** More than any argument lists in practice (items are ~1500, but vanilla's stay in Beacon). */
    static final int MAX = 500;
    static final int MAX_LINE = 1024;

    private record Request(String id, String line, long at) {}

    private final JavaPlugin plugin;
    private final WardendClient client;
    private final ExecutorService worker = Executors.newSingleThreadExecutor(WardendClient.daemon("warden-agent-complete"));
    private final AtomicReference<Request> waiting = new AtomicReference<>();

    public CommandCompleter(JavaPlugin plugin, WardendClient client) {
        this.plugin = plugin;
        this.client = client;
    }

    /** Socket thread: queues the request, replacing one that has not started yet. */
    public void onRequest(JsonObject msg) {
        String id = WardendClient.str(msg, "id");
        if (id.isEmpty()) {
            return;
        }
        String line = WardendClient.str(msg, "line");
        if (line.startsWith("/")) {
            line = line.substring(1);
        }
        if (line.length() > MAX_LINE) {
            client.sendText(error(id, "line too long").toString());
            return;
        }
        Request prev = waiting.getAndSet(new Request(id, line, System.nanoTime()));
        if (prev != null) {
            client.sendText(error(prev.id(), "superseded").toString());
        }
        worker.execute(this::next);
    }

    public void shutdown() {
        worker.shutdownNow();
    }

    /** Worker thread: takes the newest waiting request, if a later task has not taken it already. */
    private void next() {
        Request r = waiting.getAndSet(null);
        if (r == null) {
            return;
        }
        JsonObject answer;
        try {
            answer = complete(r);
        } catch (RuntimeException e) {
            plugin.getLogger().log(Level.FINE, "completion of \"" + r.line() + "\" failed", e);
            answer = error(r.id(), "failed");
        }
        client.sendText(answer.toString());
    }

    private JsonObject complete(Request r) {
        CommandSender console = Bukkit.getConsoleSender();
        AsyncTabCompleteEvent event = new AsyncTabCompleteEvent(console, r.line(), true, null);
        if (!event.callEvent()) {
            return result(r.id(), List.of());
        }
        if (event.isHandled()) {
            List<Suggestion> out = new ArrayList<>();
            for (AsyncTabCompleteEvent.Completion c : event.completions()) {
                out.add(new Suggestion(c.suggestion(), plain(c.tooltip())));
            }
            return result(r.id(), out);
        }
        long left = DEADLINE_MS - TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - r.at());
        if (left <= 0) {
            return error(r.id(), "timeout");
        }
        Future<List<String>> sync = Bukkit.getScheduler().callSyncMethod(plugin,
                () -> Bukkit.getCommandMap().tabComplete(console, r.line()));
        List<String> texts;
        try {
            texts = sync.get(left, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            sync.cancel(false); // not started yet: it never runs; running: its result is dropped
            return error(r.id(), "timeout");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return error(r.id(), "failed");
        } catch (Exception e) {
            plugin.getLogger().log(Level.FINE, "completion of \"" + r.line() + "\" failed", e);
            return error(r.id(), "failed");
        }
        List<Suggestion> out = new ArrayList<>();
        if (texts != null) {
            for (String t : texts) {
                out.add(new Suggestion(t, ""));
            }
        }
        return result(r.id(), out);
    }

    record Suggestion(String text, String tooltip) {}

    /** The answer, deduplicated and capped at {@link #MAX} ({@code truncated} says when it was). */
    static JsonObject result(String id, List<Suggestion> suggestions) {
        JsonArray arr = new JsonArray();
        Set<String> seen = new HashSet<>();
        boolean truncated = false;
        for (Suggestion s : suggestions) {
            if (s.text() == null || s.text().isEmpty() || !seen.add(s.text())) {
                continue;
            }
            if (arr.size() == MAX) {
                truncated = true;
                break;
            }
            JsonObject o = new JsonObject();
            o.addProperty("text", s.text());
            if (!s.tooltip().isEmpty()) {
                o.addProperty("tooltip", s.tooltip());
            }
            arr.add(o);
        }
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "complete.result");
        msg.addProperty("id", id);
        msg.add("suggestions", arr);
        if (truncated) {
            msg.addProperty("truncated", true);
        }
        return msg;
    }

    static JsonObject error(String id, String error) {
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "complete.result");
        msg.addProperty("id", id);
        msg.addProperty("error", error);
        return msg;
    }

    private static String plain(Component c) {
        return c == null ? "" : CommandCatalog.clean(PlainTextComponentSerializer.plainText().serialize(c));
    }
}
