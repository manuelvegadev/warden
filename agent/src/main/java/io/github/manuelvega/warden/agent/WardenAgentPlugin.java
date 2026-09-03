package io.github.manuelvega.warden.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.command.PluginCommand;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

/**
 * Entry point. Reads config.yml (written by wardend), opens the socket and schedules the two main-thread
 * jobs: positions every 4 ticks, chunk planning and snapshots every tick. Registers the voice bridge
 * when Simple Voice Chat is present (ADR-019).
 */
public final class WardenAgentPlugin extends JavaPlugin {
    private WardendClient client;
    private ChunkTracker tracker;
    private VoiceSupport voice;
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
        client = new WardendClient(getLogger(), cfg, () -> hello(cfg), known -> {
            tracker.setKnown(known);
            voice.onConnected();
        });
        tracker = new ChunkTracker(this, cfg, client, encoder);
        VoiceConsent consent = new VoiceConsent(this, cfg.voiceConsent());
        PlayerSampler sampler = new PlayerSampler(client, consent.asks() ? consent::state : null);
        getServer().getPluginManager().registerEvents(tracker, this);
        // How players learn about Beacon's voice sessions: the action bar always; under the ask
        // policy, the consent dialog too.
        ActionBarNotifier bar = new ActionBarNotifier(this);
        getServer().getPluginManager().registerEvents(bar, this);
        VoiceNotifier notifier = bar;
        if (consent.asks()) {
            ConsentPrompter prompter = new ConsentPrompter(this, consent);
            getServer().getPluginManager().registerEvents(prompter, this);
            notifier = VoiceNotifier.all(bar, prompter);
        }
        voice = VoiceSupport.detect(this, client, cfg, notifier, consent);
        WardenCommand command = new WardenCommand(consent, () -> voice.available());
        PluginCommand warden = getCommand("warden");
        if (warden != null) {
            warden.setExecutor(command);
            warden.setTabCompleter(command);
        }
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
        if (voice != null) {
            voice.shutdown();
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
