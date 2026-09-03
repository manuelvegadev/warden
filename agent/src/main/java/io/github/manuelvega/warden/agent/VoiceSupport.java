package io.github.manuelvega.warden.agent;

import java.util.logging.Level;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * What the plugin sees of the voice bridge (ADR-019). {@link #detect} returns the real bridge when
 * Simple Voice Chat is installed and a stub otherwise, so no class of the addon API is ever touched
 * on a server without it.
 */
public interface VoiceSupport {
    /** hello.ok arrived: report {@code voice.info} to wardend. */
    void onConnected();

    void shutdown();

    static VoiceSupport detect(JavaPlugin plugin, WardendClient client, AgentConfig cfg, VoiceNotifier notifier) {
        if (plugin.getServer().getPluginManager().getPlugin("voicechat") == null) {
            return new Absent();
        }
        try {
            VoiceSupport bridge = VoiceBridge.register(plugin, client, cfg, notifier);
            if (bridge != null) {
                plugin.getLogger().info("Simple Voice Chat found: voice bridge registered");
                return bridge;
            }
            plugin.getLogger().warning("Simple Voice Chat is installed but exposes no service; voice stays off");
        } catch (NoClassDefFoundError | RuntimeException e) {
            plugin.getLogger().log(Level.WARNING, "Simple Voice Chat is installed but its API could not be used; voice stays off", e);
        }
        return new Absent();
    }

    /**
     * No Simple Voice Chat. Nothing to report: wardend treats an agent that says nothing about voice
     * as "not available", and resets that state whenever the agent disconnects.
     */
    final class Absent implements VoiceSupport {
        @Override
        public void onConnected() {}

        @Override
        public void shutdown() {}
    }
}
