package io.github.manuelvega.warden.agent;

import de.maxhenkel.voicechat.api.VoicechatConnection;
import de.maxhenkel.voicechat.api.VoicechatServerApi;
import de.maxhenkel.voicechat.api.audiochannel.AudioChannel;
import de.maxhenkel.voicechat.api.audiochannel.EntityAudioChannel;
import de.maxhenkel.voicechat.api.audiochannel.LocationalAudioChannel;
import de.maxhenkel.voicechat.api.audiochannel.StaticAudioChannel;
import java.util.UUID;
import java.util.function.Predicate;
import java.util.function.Supplier;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.World;
import org.bukkit.entity.Player;

/**
 * One Beacon speaker's channel (ADR-019 §2): static, locational or attached to a player, whichever
 * the frames ask for. Recreated when they ask for another kind, world or entity; position, distance
 * and whisper follow every frame. Frames arrive on the socket thread; the SVC API is thread-safe.
 */
final class SpeakSession {
    private final String by;
    private final Supplier<VoicechatServerApi> api;
    private final Predicate<UUID> allows;
    private final Logger log;
    private AudioChannel channel;
    private byte mode = -1;
    private String world;
    private UUID target;

    SpeakSession(String by, Supplier<VoicechatServerApi> api, Predicate<UUID> allows, Logger log) {
        this.by = by;
        this.api = api;
        this.allows = allows;
        this.log = log;
    }

    void play(SpeakFrame f) {
        VoicechatServerApi a = api.get();
        if (a == null) {
            return;
        }
        if (channel == null || channel.isClosed() || mode != f.mode() || changedTarget(f)) {
            if (!open(a, f)) {
                return;
            }
        }
        switch (f.mode()) {
            case SpeakFrame.MODE_LOCATIONAL -> {
                LocationalAudioChannel c = (LocationalAudioChannel) channel;
                c.updateLocation(a.createPosition(f.x(), f.y(), f.z()));
                c.setDistance(f.distance());
            }
            case SpeakFrame.MODE_ENTITY -> {
                EntityAudioChannel c = (EntityAudioChannel) channel;
                c.setWhispering(f.whisper());
                c.setDistance(f.distance());
            }
            default -> { }
        }
        channel.send(f.opus());
    }

    private boolean changedTarget(SpeakFrame f) {
        return switch (f.mode()) {
            case SpeakFrame.MODE_LOCATIONAL -> !f.world().equals(world);
            case SpeakFrame.MODE_ENTITY -> !f.target().equals(target);
            default -> false;
        };
    }

    /** Opens the channel the frame asks for; false (and no channel) when its world or player is not there. */
    private boolean open(VoicechatServerApi a, SpeakFrame f) {
        close();
        UUID id = UUID.randomUUID();
        AudioChannel c;
        switch (f.mode()) {
            case SpeakFrame.MODE_STATIC -> {
                // SVC's static channel is silent until it is given its listeners: everyone with a
                // voice connection, groups included.
                StaticAudioChannel sc = a.createStaticAudioChannel(id);
                sc.setBypassGroupIsolation(true);
                for (Player p : Bukkit.getOnlinePlayers()) {
                    VoicechatConnection conn = a.getConnectionOf(p.getUniqueId());
                    if (conn != null) {
                        sc.addTarget(conn);
                    }
                }
                c = sc;
            }
            case SpeakFrame.MODE_LOCATIONAL -> {
                World w = Bukkit.getWorld(f.world());
                if (w == null) {
                    return false;
                }
                c = a.createLocationalAudioChannel(id, a.fromServerLevel(w), a.createPosition(f.x(), f.y(), f.z()));
            }
            case SpeakFrame.MODE_ENTITY -> {
                Player p = Bukkit.getPlayer(f.target());
                if (p == null) {
                    return false;
                }
                c = a.createEntityAudioChannel(id, a.fromEntity(p));
            }
            default -> {
                return false;
            }
        }
        if (c == null) {
            return false;
        }
        c.setCategory(VoiceBridge.CATEGORY);
        c.setFilter(sp -> allows.test(sp.getUuid()));
        channel = c;
        mode = f.mode();
        world = f.world();
        target = f.target();
        log.info(by + " speaks from Beacon through a " + kindName(f.mode()) + " channel");
        return true;
    }

    private static String kindName(byte mode) {
        return switch (mode) {
            case SpeakFrame.MODE_STATIC -> "static (everyone)";
            case SpeakFrame.MODE_LOCATIONAL -> "locational";
            case SpeakFrame.MODE_ENTITY -> "entity";
            default -> "unknown";
        };
    }

    /** A player's voice connected while this session is open: a static channel needs to know. */
    void addTarget(VoicechatConnection conn) {
        if (channel instanceof StaticAudioChannel sc) {
            sc.addTarget(conn);
        }
    }

    void close() {
        if (channel != null) {
            try {
                channel.flush();
            } catch (RuntimeException e) {
                log.log(Level.FINE, "flush", e);
            }
            channel = null;
        }
        mode = -1;
    }
}
