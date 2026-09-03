package io.github.manuelvega.warden.agent;

import java.io.File;
import java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.configuration.file.YamlConfiguration;
import org.bukkit.plugin.Plugin;

/**
 * Each player's answer to "may Beacon hear you and speak to you?" (ADR-019 §1). Under the
 * {@code notify} policy nobody is asked and everyone is allowed; under {@code ask} a player who
 * denied is neither heard nor spoken to, and one who has not answered yet is allowed until they do.
 * Answers persist in {@code plugins/WardenAgent/voice-consent.yml}.
 */
public final class VoiceConsent {
    public static final String ALLOWED = "allowed";
    public static final String DENIED = "denied";
    public static final String UNSET = "unset";

    private final Plugin plugin;
    private final Logger log;
    private final File file;
    private final boolean ask;
    private final Map<UUID, Boolean> answers = new ConcurrentHashMap<>();

    public VoiceConsent(Plugin plugin, String policy) {
        this.plugin = plugin;
        this.log = plugin.getLogger();
        this.file = new File(plugin.getDataFolder(), "voice-consent.yml");
        this.ask = "ask".equals(policy);
        load();
    }

    /** Whether players are asked at all. */
    public boolean asks() {
        return ask;
    }

    /** May Beacon hear this player and speak to them? */
    public boolean allows(UUID player) {
        return !ask || !Boolean.FALSE.equals(answers.get(player));
    }

    /** {@code allowed}, {@code denied} or {@code unset}, what the panel shows on the name tag. */
    public String state(UUID player) {
        Boolean a = answers.get(player);
        return a == null ? UNSET : a ? ALLOWED : DENIED;
    }

    public void set(UUID player, boolean allowed) {
        answers.put(player, allowed);
        save();
    }

    private void load() {
        if (!file.exists()) {
            return;
        }
        YamlConfiguration y = YamlConfiguration.loadConfiguration(file);
        for (String key : y.getKeys(false)) {
            try {
                answers.put(UUID.fromString(key), ALLOWED.equals(y.getString(key)));
            } catch (IllegalArgumentException ignored) {
                // not a uuid: somebody edited the file by hand
            }
        }
    }

    private void save() {
        YamlConfiguration y = new YamlConfiguration();
        for (Map.Entry<UUID, Boolean> e : answers.entrySet()) {
            y.set(e.getKey().toString(), e.getValue() ? ALLOWED : DENIED);
        }
        Bukkit.getScheduler().runTaskAsynchronously(plugin, () -> {
            try {
                file.getParentFile().mkdirs();
                y.save(file);
            } catch (IOException e) {
                log.log(Level.WARNING, "Could not save voice-consent.yml", e);
            }
        });
    }
}
