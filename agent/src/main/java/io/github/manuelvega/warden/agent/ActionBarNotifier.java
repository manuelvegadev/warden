package io.github.manuelvega.warden.agent;

import java.util.LinkedHashSet;
import java.util.Set;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.Bukkit;
import org.bukkit.Sound;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitTask;

/**
 * The {@code notify} rendering: a chat line and a soft chime when Beacon's first activity begins and
 * when the last ends, and an action bar line re-sent every two seconds while anything is active, so
 * it never fades. Listening and speaking share the line ("Admin is listening · Ana is speaking from
 * Beacon"); a push-to-talk press while someone already listens changes the line, not the chat.
 * Players who join mid-session get the same.
 */
public final class ActionBarNotifier implements VoiceNotifier, Listener {
    // Minecraft's fonts have no emoji; the note is in the default font.
    private static final String MARK = "♪ ";
    private static final long RESEND_TICKS = 40L;

    private final Plugin plugin;
    private BukkitTask task;
    private String listeners = "";
    private final Set<String> speakers = new LinkedHashSet<>();

    public ActionBarNotifier(Plugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public void listening(String by) {
        listeners = by == null ? "" : by;
        refresh();
    }

    @Override
    public void speaking(String by, boolean on) {
        if (on) {
            speakers.add(by);
        } else {
            speakers.remove(by);
        }
        refresh();
    }

    @Override
    public void stop() {
        listeners = "";
        speakers.clear();
        refresh();
    }

    private boolean active() {
        return !listeners.isEmpty() || !speakers.isEmpty();
    }

    private void refresh() {
        if (active()) {
            if (task == null) {
                Component line = bar();
                for (Player p : Bukkit.getOnlinePlayers()) {
                    p.sendMessage(line);
                    p.playSound(p.getLocation(), Sound.BLOCK_NOTE_BLOCK_PLING, 0.4f, 1.4f);
                }
                task = Bukkit.getScheduler().runTaskTimer(plugin, this::resend, RESEND_TICKS, RESEND_TICKS);
            }
            resend();
        } else if (task != null) {
            task.cancel();
            task = null;
            Component line = Component.text(MARK + "Beacon's voice session ended", NamedTextColor.GRAY);
            for (Player p : Bukkit.getOnlinePlayers()) {
                p.sendActionBar(Component.empty());
                p.sendMessage(line);
                p.playSound(p.getLocation(), Sound.BLOCK_NOTE_BLOCK_PLING, 0.3f, 0.8f);
            }
        }
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent e) {
        if (task == null) {
            return;
        }
        Component line = bar();
        e.getPlayer().sendMessage(line);
        e.getPlayer().sendActionBar(line);
    }

    private void resend() {
        Component bar = bar();
        for (Player p : Bukkit.getOnlinePlayers()) {
            p.sendActionBar(bar);
        }
    }

    /** "Admin is listening", "Ana is speaking", or both joined with a dot. */
    private String describe() {
        StringBuilder s = new StringBuilder();
        if (!listeners.isEmpty()) {
            s.append(listeners).append(listeners.contains(",") ? " are listening" : " is listening");
        }
        if (!speakers.isEmpty()) {
            if (s.length() > 0) {
                s.append(" · ");
            }
            s.append(String.join(", ", speakers)).append(speakers.size() > 1 ? " are speaking" : " is speaking");
        }
        return s.toString();
    }

    /** The one line, for the chat and the action bar alike. */
    private Component bar() {
        return Component.text(MARK + describe() + " from Beacon", NamedTextColor.AQUA);
    }
}
