package io.github.manuelvega.warden.agent;

import org.bukkit.configuration.file.FileConfiguration;

/** The values of config.yml, validated. wardend writes the file; see the resource for the meaning of each key. */
public record AgentConfig(String url, String token, int radius, int snapshotsPerTick, int resendMillis,
        int reconcileMillis) {

    public static AgentConfig from(FileConfiguration c) {
        return new AgentConfig(
                c.getString("url", "ws://127.0.0.1:8481/agent/v1").trim(),
                c.getString("token", "").trim(),
                Math.clamp(c.getInt("radius", 10), 1, 32),
                Math.clamp(c.getInt("snapshots-per-tick", 4), 1, 64),
                Math.clamp(c.getInt("resend-seconds", 5), 1, 3600) * 1000,
                Math.clamp(c.getInt("reconcile-seconds", 300), 0, 86400) * 1000);
    }

    public boolean enabled() {
        return !token.isEmpty() && !url.isEmpty();
    }
}
