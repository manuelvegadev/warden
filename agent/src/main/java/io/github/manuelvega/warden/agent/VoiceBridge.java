package io.github.manuelvega.warden.agent;

import com.google.gson.JsonObject;
import de.maxhenkel.voicechat.api.BukkitVoicechatService;
import de.maxhenkel.voicechat.api.VoicechatConnection;
import de.maxhenkel.voicechat.api.VoicechatPlugin;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.events.EventRegistration;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStartedEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStoppedEvent;
import de.maxhenkel.voicechat.api.packets.MicrophonePacket;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * The Simple Voice Chat addon (ADR-019, phase 1). Reports the voice server to wardend and, while a
 * Beacon listener is active, forwards every microphone frame as a kind-2 binary frame. The mic
 * handler runs on SVC's packet thread and only enqueues; the notifier runs on the main thread.
 */
public final class VoiceBridge implements VoicechatPlugin, VoiceSupport {
    private final JavaPlugin plugin;
    private final WardendClient client;
    private final AgentConfig cfg;
    private final VoiceNotifier notifier;
    private final Map<UUID, AtomicLong> sequences = new ConcurrentHashMap<>();
    private volatile VoicechatServerApi api; // set while the voice server runs
    private volatile boolean listening;
    private volatile String listenerName = "";

    /** Registers the addon; null when the service is missing (SVC loaded but not enabled yet). */
    static VoiceSupport register(JavaPlugin plugin, WardendClient client, AgentConfig cfg, VoiceNotifier notifier) {
        BukkitVoicechatService service = plugin.getServer().getServicesManager().load(BukkitVoicechatService.class);
        if (service == null) {
            return null;
        }
        VoiceBridge bridge = new VoiceBridge(plugin, client, cfg, notifier);
        service.registerPlugin(bridge);
        client.on("voice.listen", o -> bridge.onListen(
                o.has("active") && o.get("active").getAsBoolean(),
                o.has("by") && !o.get("by").isJsonNull() ? o.get("by").getAsString() : ""));
        return bridge;
    }

    private VoiceBridge(JavaPlugin plugin, WardendClient client, AgentConfig cfg, VoiceNotifier notifier) {
        this.plugin = plugin;
        this.client = client;
        this.cfg = cfg;
        this.notifier = notifier;
    }

    // VoicechatPlugin

    @Override
    public String getPluginId() {
        return "warden";
    }

    @Override
    public void registerEvents(EventRegistration registration) {
        registration.registerEvent(VoicechatServerStartedEvent.class, e -> {
            api = e.getVoicechat();
            sendInfo();
        });
        registration.registerEvent(VoicechatServerStoppedEvent.class, e -> {
            api = null;
            sendInfo();
        });
        registration.registerEvent(MicrophonePacketEvent.class, this::onMic);
    }

    // VoiceSupport

    @Override
    public void onConnected() {
        sendInfo();
    }

    /** wardend switched listening on or off. Called on the socket thread. */
    void onListen(boolean active, String by) {
        String name = by == null || by.isBlank() ? "Someone" : by;
        if (active == listening && (!active || name.equals(listenerName))) {
            return;
        }
        listening = active;
        listenerName = active ? name : "";
        if (!active) {
            sequences.clear();
        }
        runOnMain(active ? () -> notifier.start(name) : notifier::stop);
    }

    @Override
    public void shutdown() {
        listening = false;
        if (plugin.isEnabled()) {
            notifier.stop();
        }
    }

    // Internals

    private void onMic(MicrophonePacketEvent e) {
        if (!listening || !client.isReady()) {
            return;
        }
        VoicechatConnection conn = e.getSenderConnection();
        if (conn == null) {
            return;
        }
        MicrophonePacket packet = e.getPacket();
        byte[] opus = packet.getOpusEncodedData();
        if (opus == null) {
            return;
        }
        UUID speaker = conn.getPlayer().getUuid();
        long seq = sequences.computeIfAbsent(speaker, k -> new AtomicLong()).getAndIncrement();
        client.sendBinary(VoiceFrame.encode(packet.isWhispering(), conn.isInGroup(), speaker, seq, opus));
    }

    /** {@code voice.info}: whether the voice server runs, its version, distances and the consent policy. */
    private void sendInfo() {
        VoicechatServerApi a = api;
        JsonObject o = new JsonObject();
        o.addProperty("type", "voice.info");
        o.addProperty("available", a != null);
        Plugin svc = Bukkit.getPluginManager().getPlugin("voicechat");
        if (svc != null) {
            o.addProperty("plugin", svc.getPluginMeta().getVersion());
        }
        if (a != null) {
            double distance = a.getVoiceChatDistance();
            double whisper;
            try {
                whisper = a.getServerConfig().getDouble("whisper_distance", distance / 8D);
            } catch (RuntimeException ex) {
                whisper = distance / 8D;
            }
            o.addProperty("distance", distance);
            o.addProperty("whisper", whisper);
        }
        o.addProperty("policy", cfg.voiceConsent());
        client.sendText(o.toString());
    }

    private void runOnMain(Runnable r) {
        try {
            Bukkit.getScheduler().runTask(plugin, r);
        } catch (IllegalStateException | IllegalArgumentException ignored) {
            // the plugin is disabling; the notifier is stopped by shutdown()
        }
    }
}
