package io.github.manuelvega.warden.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

/**
 * Entry point. Reads config.yml (written by wardend), opens the socket and schedules the two main-thread
 * jobs: positions every 4 ticks, chunk planning and snapshots every tick.
 */
public final class WardenAgentPlugin extends JavaPlugin {
    private WardendClient client;
    private ChunkTracker tracker;
    private BukkitTask playersTask;
    private BukkitTask chunksTask;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        AgentConfig cfg = AgentConfig.from(getConfig());
        if (!cfg.enabled()) {
            getLogger().warning("No token in config.yml: the agent stays idle. Enable the live view for this instance in Beacon.");
            return;
        }
        ChunkEncoder encoder = new ChunkEncoder(new BlockPalette());
        client = new WardendClient(getLogger(), cfg, () -> hello(cfg), known -> tracker.setKnown(known));
        tracker = new ChunkTracker(this, cfg, client, encoder);
        PlayerSampler sampler = new PlayerSampler(client);
        getServer().getPluginManager().registerEvents(tracker, this);
        playersTask = getServer().getScheduler().runTaskTimer(this, sampler::tick, 20L, 4L);
        chunksTask = getServer().getScheduler().runTaskTimer(this, tracker::tick, 20L, 1L);
        client.start();
        getLogger().info("Warden Agent " + getPluginMeta().getVersion() + " → " + cfg.url());
    }

    @Override
    public void onDisable() {
        if (playersTask != null) {
            playersTask.cancel();
        }
        if (chunksTask != null) {
            chunksTask.cancel();
        }
        if (tracker != null) {
            tracker.shutdown();
        }
        if (client != null) {
            client.close();
        }
    }

    private String hello(AgentConfig cfg) {
        JsonObject o = new JsonObject();
        o.addProperty("type", "hello");
        o.addProperty("token", cfg.token());
        o.addProperty("agent", "warden-agent/" + getPluginMeta().getVersion());
        o.addProperty("server", Bukkit.getName() + " " + Bukkit.getMinecraftVersion());
        JsonArray worlds = new JsonArray();
        for (World w : Bukkit.getWorlds()) {
            JsonObject wo = new JsonObject();
            wo.addProperty("name", w.getName());
            wo.addProperty("dimension", dimension(w));
            wo.addProperty("viewDistance", w.getViewDistance());
            wo.addProperty("minY", w.getMinHeight());
            wo.addProperty("maxY", w.getMaxHeight() - 1);
            worlds.add(wo);
        }
        o.add("worlds", worlds);
        return o.toString();
    }

    private static String dimension(World w) {
        return switch (w.getEnvironment()) {
            case NORMAL -> "overworld";
            case NETHER -> "the_nether";
            case THE_END -> "the_end";
            default -> w.getEnvironment().name().toLowerCase();
        };
    }
}
