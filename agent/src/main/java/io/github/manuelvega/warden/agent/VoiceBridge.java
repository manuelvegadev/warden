package io.github.manuelvega.warden.agent;

import com.google.gson.JsonObject;
import de.maxhenkel.voicechat.api.BukkitVoicechatService;
import de.maxhenkel.voicechat.api.VoicechatConnection;
import de.maxhenkel.voicechat.api.VoicechatPlugin;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.VolumeCategory;
import de.maxhenkel.voicechat.api.events.EventRegistration;
import de.maxhenkel.voicechat.api.events.MicrophonePacketEvent;
import de.maxhenkel.voicechat.api.events.PlayerConnectedEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStartedEvent;
import de.maxhenkel.voicechat.api.events.VoicechatServerStoppedEvent;
import de.maxhenkel.voicechat.api.packets.MicrophonePacket;
import java.nio.ByteBuffer;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * The Simple Voice Chat addon (ADR-019). Reports the voice server to wardend; while a Beacon
 * listener is active forwards every microphone frame as a kind-2 binary frame; and plays what
 * Beacon speaks (kind-3 frames) into one SVC audio channel per session — static, locational or
 * attached to a player, whichever the frames ask for. The mic handler runs on SVC's packet thread
 * and only enqueues; speak frames arrive on the socket thread and go straight to the channel (the
 * SVC API is thread-safe); the notifier and the consent dialogs run on the main thread.
 */
public final class VoiceBridge implements VoicechatPlugin, VoiceSupport {
    /** The volume category every Beacon channel uses, so players can turn the panel down in SVC's menu. */
    static final String CATEGORY = "beacon";

    private final JavaPlugin plugin;
    private final WardendClient client;
    private final AgentConfig cfg;
    private final VoiceNotifier notifier;
    private final VoiceConsent consent;
    private final Map<UUID, AtomicLong> sequences = new ConcurrentHashMap<>();
    private final Map<String, SpeakSession> sessions = new ConcurrentHashMap<>();
    private volatile VoicechatServerApi api; // set while the voice server runs
    private volatile boolean listening;

    /** Registers the addon; null when the service is missing (SVC loaded but not enabled yet). */
    static VoiceSupport register(JavaPlugin plugin, WardendClient client, AgentConfig cfg, VoiceNotifier notifier,
            VoiceConsent consent) {
        BukkitVoicechatService service = plugin.getServer().getServicesManager().load(BukkitVoicechatService.class);
        if (service == null) {
            return null;
        }
        VoiceBridge bridge = new VoiceBridge(plugin, client, cfg, notifier, consent);
        service.registerPlugin(bridge);
        client.on("voice.listen", o -> bridge.onListen(WardendClient.bool(o, "active"), WardendClient.str(o, "by")));
        client.on("voice.session", o -> bridge.onSession(
                WardendClient.str(o, "id"), WardendClient.str(o, "by"), WardendClient.bool(o, "open")));
        client.onBinary(SpeakFrame.KIND, bridge::onSpeak);
        return bridge;
    }

    private VoiceBridge(JavaPlugin plugin, WardendClient client, AgentConfig cfg, VoiceNotifier notifier,
            VoiceConsent consent) {
        this.plugin = plugin;
        this.client = client;
        this.cfg = cfg;
        this.notifier = notifier;
        this.consent = consent;
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
            VolumeCategory category = api.volumeCategoryBuilder()
                    .setId(CATEGORY)
                    .setName("Beacon")
                    .setDescription("Voices from the Beacon panel")
                    .build();
            api.registerVolumeCategory(category);
            sendInfo();
        });
        registration.registerEvent(VoicechatServerStoppedEvent.class, e -> {
            VoicechatServerApi a = api;
            api = null;
            sessions.clear();
            if (a != null) {
                a.unregisterVolumeCategory(CATEGORY);
            }
            sendInfo();
        });
        registration.registerEvent(MicrophonePacketEvent.class, this::onMic);
        // A static channel only reaches the connections added to it: whoever joins voice while a
        // Beacon "everyone" session is open must be added to it too.
        registration.registerEvent(PlayerConnectedEvent.class, e -> {
            VoicechatConnection conn = e.getConnection();
            if (conn == null) {
                return;
            }
            for (SpeakSession session : sessions.values()) {
                session.addTarget(conn);
            }
        });
    }

    // VoiceSupport

    @Override
    public void onConnected() {
        sendInfo();
    }

    @Override
    public boolean available() {
        return api != null;
    }

    @Override
    public void shutdown() {
        listening = false;
        sessions.clear();
        if (plugin.isEnabled()) {
            notifier.stop();
        }
    }

    // wardend's control messages (socket thread)

    /** wardend switched listening on or off; {@code by} lists who listens (it changes as people join). */
    void onListen(boolean active, String by) {
        String name = by.isBlank() ? "Someone" : by;
        if (active != listening) {
            listening = active;
            if (!active) {
                sequences.clear();
            }
        }
        runOnMain(() -> notifier.listening(active ? name : ""));
    }

    /** A Beacon speak session began or ended. */
    void onSession(String id, String by, boolean open) {
        String name = by.isBlank() ? "Someone" : by;
        if (open) {
            sessions.computeIfAbsent(id, k -> newSession(name));
        } else {
            SpeakSession s = sessions.remove(id);
            if (s != null) {
                s.close();
            }
        }
        runOnMain(() -> notifier.speaking(name, open));
    }

    private SpeakSession newSession(String by) {
        return new SpeakSession(by, () -> api, consent::allows, plugin.getLogger());
    }

    // Audio (SVC packet thread in, socket thread out)

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
        if (!consent.allows(speaker)) {
            return;
        }
        long seq = sequences.computeIfAbsent(speaker, k -> new AtomicLong()).getAndIncrement();
        client.sendBinary(VoiceFrame.encode(packet.isWhispering(), conn.isInGroup(), speaker, seq, opus));
    }

    /** A kind-3 frame from wardend: one Opus frame of a Beacon session, with where it should sound. */
    private void onSpeak(ByteBuffer buf) {
        if (api == null) {
            return;
        }
        SpeakFrame f = SpeakFrame.decode(buf);
        // wardend may have opened the session before we (re)connected: create it quietly.
        sessions.computeIfAbsent(f.session(), k -> newSession("Beacon")).play(f);
    }

    // Internals

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
