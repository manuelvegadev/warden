package io.github.manuelvega.warden.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;
import org.bukkit.Bukkit;
import org.bukkit.command.Command;
import org.bukkit.command.PluginIdentifiableCommand;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServerLoadEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * The commands the console can run, for Beacon's completion (ADR-024): one entry per command with
 * its aliases, the plugin that registered it (empty for the server's own) and its description and
 * usage. Rebuilt every few seconds on the main thread and sent only when it changed, so commands a
 * plugin registers late, or a plugin enabled or disabled while the server runs, reach the panel
 * without a restart.
 */
public final class CommandCatalog implements Listener {
    /** One command as Beacon lists it. */
    public record Entry(String name, List<String> aliases, String plugin, String description, String usage) {}

    private final JavaPlugin plugin;
    private final WardendClient client;
    private String sent; // the last catalog wardend acknowledged on this socket; null after a (re)connection

    public CommandCatalog(JavaPlugin plugin, WardendClient client) {
        this.plugin = plugin;
        this.client = client;
    }

    /** A new socket knows nothing: the next tick sends the catalog whatever it holds. */
    public void onConnected() {
        plugin.getServer().getScheduler().runTask(plugin, () -> {
            sent = null;
            tick();
        });
    }

    /** The server finished starting (or reloading): every plugin has registered its commands by now. */
    @EventHandler(priority = EventPriority.MONITOR)
    public void onLoad(ServerLoadEvent e) {
        tick();
    }

    /** Main thread: rebuilds the catalog and sends it when it differs from what wardend holds. */
    public void tick() {
        if (!client.isReady()) {
            sent = null;
            return;
        }
        String msg = encode(entries(Bukkit.getCommandMap().getKnownCommands())).toString();
        if (msg.equals(sent)) {
            return;
        }
        sent = msg;
        client.sendText(msg);
    }

    /**
     * Groups the command map by command: every key that maps to the same command is one of its
     * labels. Namespaced keys (`luckperms:lp`) are left out, as the console's own completion does
     * for a bare prefix. The name is the command's own when the map still holds it under that name
     * (another plugin may have taken it), else the shortest label.
     */
    static List<Entry> entries(Map<String, Command> known) {
        Map<Command, TreeSet<String>> labels = new IdentityHashMap<>();
        for (Map.Entry<String, Command> e : known.entrySet()) {
            String key = e.getKey();
            if (key == null || key.isEmpty() || key.indexOf(':') >= 0 || e.getValue() == null) {
                continue;
            }
            labels.computeIfAbsent(e.getValue(), c -> new TreeSet<>()).add(key);
        }
        List<Entry> out = new ArrayList<>(labels.size());
        for (Map.Entry<Command, TreeSet<String>> e : labels.entrySet()) {
            Command cmd = e.getKey();
            TreeSet<String> keys = e.getValue();
            String name = keys.contains(cmd.getName()) ? cmd.getName() : shortest(keys);
            List<String> aliases = new ArrayList<>(keys);
            aliases.remove(name);
            out.add(new Entry(name, aliases, owner(cmd), clean(cmd.getDescription()), usage(cmd, name)));
        }
        out.sort((a, b) -> a.name().compareTo(b.name()));
        return out;
    }

    static JsonObject encode(List<Entry> entries) {
        JsonArray arr = new JsonArray();
        for (Entry e : entries) {
            JsonObject o = new JsonObject();
            o.addProperty("name", e.name());
            if (!e.aliases().isEmpty()) {
                JsonArray a = new JsonArray();
                e.aliases().forEach(a::add);
                o.add("aliases", a);
            }
            if (!e.plugin().isEmpty()) {
                o.addProperty("plugin", e.plugin());
            }
            if (!e.description().isEmpty()) {
                o.addProperty("description", e.description());
            }
            if (!e.usage().isEmpty()) {
                o.addProperty("usage", e.usage());
            }
            arr.add(o);
        }
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "commands");
        msg.add("commands", arr);
        return msg;
    }

    private static String owner(Command cmd) {
        if (cmd instanceof PluginIdentifiableCommand p && p.getPlugin() != null) {
            return p.getPlugin().getName();
        }
        return "";
    }

    private static String shortest(TreeSet<String> keys) {
        String best = keys.first();
        for (String k : keys) {
            if (k.length() < best.length()) {
                best = k;
            }
        }
        return best;
    }

    /**
     * The usage line with Bukkit's `<command>` placeholder filled in. Bukkit's default, a bare
     * `/<command>`, says nothing and is dropped.
     */
    static String usage(Command cmd, String name) {
        String u = clean(cmd.getUsage());
        if (u.isEmpty() || u.equals("/<command>") || u.equals("/" + name)) {
            return "";
        }
        return u.replace("<command>", name);
    }

    /** First line, trimmed, without legacy colour codes (`§a`). */
    static String clean(String s) {
        if (s == null) {
            return "";
        }
        int nl = s.indexOf('\n');
        if (nl >= 0) {
            s = s.substring(0, nl);
        }
        return s.replaceAll("§.", "").trim();
    }
}
