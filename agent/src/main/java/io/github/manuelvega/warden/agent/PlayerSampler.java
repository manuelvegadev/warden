package io.github.manuelvega.warden.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import java.util.Collection;
import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.metadata.MetadataValue;

/**
 * Reads every online player's position on the main thread (microseconds), plus each world's clock
 * and weather, and hands the JSON to the client. Runs every 4 ticks. When the last player leaves
 * one empty list is sent, then nothing.
 */
public final class PlayerSampler {
    private final WardendClient client;
    private int lastCount = -1;

    public PlayerSampler(WardendClient client) {
        this.client = client;
    }

    public void tick() {
        if (!client.isReady()) {
            lastCount = -1;
            return;
        }
        Collection<? extends Player> players = Bukkit.getOnlinePlayers();
        if (players.isEmpty() && lastCount == 0) {
            return;
        }
        lastCount = players.size();
        client.sendText(encode(players, Bukkit.getWorlds()).toString());
    }

    static JsonObject encode(Collection<? extends Player> players, Collection<World> worlds) {
        JsonObject msg = new JsonObject();
        msg.addProperty("type", "players");
        msg.addProperty("t", System.currentTimeMillis());
        // Time of day and weather per world: what the viewer lights the scene with.
        JsonObject clocks = new JsonObject();
        for (World w : worlds) {
            JsonObject c = new JsonObject();
            c.addProperty("time", w.getTime() % 24000);
            c.addProperty("day", w.getFullTime() / 24000);
            c.addProperty("gameTime", w.getGameTime()); // never paused or set: what the clouds scroll by
            c.addProperty("rain", w.hasStorm());
            c.addProperty("thunder", w.isThundering());
            clocks.add(w.getName(), c);
        }
        msg.add("worlds", clocks);
        JsonArray arr = new JsonArray();
        for (Player p : players) {
            Location l = p.getLocation();
            JsonObject o = new JsonObject();
            o.addProperty("uuid", p.getUniqueId().toString());
            o.addProperty("name", p.getName());
            o.addProperty("world", l.getWorld().getName());
            o.addProperty("x", round(l.getX()));
            o.addProperty("y", round(l.getY()));
            o.addProperty("z", round(l.getZ()));
            o.addProperty("yaw", round(l.getYaw()));
            o.addProperty("pitch", round(l.getPitch()));
            o.addProperty("sneaking", p.isSneaking());
            o.addProperty("sprinting", p.isSprinting());
            // What the client animates from: the pose (standing, sneaking, swimming, fall_flying, …),
            // whether the feet touch the ground, creative flight, and water.
            o.addProperty("pose", p.getPose().name().toLowerCase());
            o.addProperty("onGround", p.isOnGround());
            o.addProperty("flying", p.isFlying());
            o.addProperty("inWater", p.isInWater());
            o.addProperty("gamemode", p.getGameMode().name().toLowerCase());
            o.addProperty("vanished", vanished(p));
            arr.add(o);
        }
        msg.add("players", arr);
        return msg;
    }

    /** Vanish plugins mark players with the "vanished" metadata; invisibility covers the potion effect. */
    @SuppressWarnings("deprecation")
    private static boolean vanished(Player p) {
        for (MetadataValue v : p.getMetadata("vanished")) {
            if (v.asBoolean()) {
                return true;
            }
        }
        return p.isInvisible();
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
