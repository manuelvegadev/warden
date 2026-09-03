package io.github.manuelvega.warden.agent;

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
 * The {@code notify} rendering: a chat line and a soft chime when a session starts or stops, and an
 * action bar line re-sent every two seconds while it lasts, so it never fades. Players who join
 * mid-session get the same.
 */
public final class ActionBarNotifier implements VoiceNotifier, Listener {
    // Minecraft's fonts have no emoji; the note is in the default font.
    private static final String MARK = "♪ ";
    private static final long RESEND_TICKS = 40L;

    private final Plugin plugin;
    private BukkitTask task;
    private String by;

    public ActionBarNotifier(Plugin plugin) {
        this.plugin = plugin;
    }

    @Override
    public void start(String by) {
        this.by = by;
        Component line = joinLine();
        for (Player p : Bukkit.getOnlinePlayers()) {
            p.sendMessage(line);
            p.playSound(p.getLocation(), Sound.BLOCK_NOTE_BLOCK_PLING, 0.4f, 1.4f);
            p.sendActionBar(bar());
        }
        if (task == null) {
            task = Bukkit.getScheduler().runTaskTimer(plugin, this::resend, RESEND_TICKS, RESEND_TICKS);
        }
    }

    @Override
    public void stop() {
        if (task == null) {
            return;
        }
        task.cancel();
        task = null;
        Component line = Component.text(MARK + by + " stopped listening", NamedTextColor.GRAY);
        for (Player p : Bukkit.getOnlinePlayers()) {
            p.sendActionBar(Component.empty());
            p.sendMessage(line);
            p.playSound(p.getLocation(), Sound.BLOCK_NOTE_BLOCK_PLING, 0.3f, 0.8f);
        }
        by = null;
    }

    @EventHandler
    public void onPlayerJoin(PlayerJoinEvent e) {
        if (task == null) {
            return;
        }
        e.getPlayer().sendMessage(joinLine());
        e.getPlayer().sendActionBar(bar());
    }

    private void resend() {
        Component bar = bar();
        for (Player p : Bukkit.getOnlinePlayers()) {
            p.sendActionBar(bar);
        }
    }

    private Component joinLine() {
        return Component.text(MARK + by + " is listening to voice chat from Beacon", NamedTextColor.AQUA);
    }

    private Component bar() {
        return Component.text(MARK + by + " is listening from Beacon", NamedTextColor.AQUA);
    }
}
