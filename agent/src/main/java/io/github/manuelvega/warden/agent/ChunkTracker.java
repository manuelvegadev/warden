package io.github.manuelvega.warden.agent;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Level;
import java.util.logging.Logger;
import org.bukkit.Bukkit;
import org.bukkit.ChunkSnapshot;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.BlockState;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockBurnEvent;
import org.bukkit.event.block.BlockExplodeEvent;
import org.bukkit.event.block.BlockFadeEvent;
import org.bukkit.event.block.BlockFormEvent;
import org.bukkit.event.block.BlockFromToEvent;
import org.bukkit.event.block.BlockPistonExtendEvent;
import org.bukkit.event.block.BlockPistonRetractEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.event.block.BlockSpreadEvent;
import org.bukkit.event.block.LeavesDecayEvent;
import org.bukkit.event.entity.EntityChangeBlockEvent;
import org.bukkit.event.entity.EntityExplodeEvent;
import org.bukkit.event.player.PlayerBucketEmptyEvent;
import org.bukkit.event.player.PlayerBucketFillEvent;
import org.bukkit.event.world.StructureGrowEvent;
import org.bukkit.plugin.Plugin;

/**
 * Decides which chunks to send and when. Every second the chunks within the radius of each online
 * player are wanted; a wanted chunk is snapshotted (a few per tick, main thread) when it was never
 * sent, when a block change marked it dirty and the resend interval passed, or when the reconcile
 * interval passed. Encoding, hashing and sending happen on a worker thread; a chunk whose hash did
 * not change is not sent.
 */
public final class ChunkTracker implements Listener {
    private record Ref(World world, int cx, int cz) {
        long key() {
            return key(cx, cz);
        }

        static long key(int cx, int cz) {
            return ((long) cx << 32) | (cz & 0xffffffffL);
        }
    }

    private static final class Sent {
        long hash;
        long at; // millis of the last snapshot that reached the encoder

        Sent(long hash, long at) {
            this.hash = hash;
            this.at = at;
        }
    }

    private final Plugin plugin;
    private final Logger log;
    private final AgentConfig cfg;
    private final WardendClient client;
    private final ChunkEncoder encoder;
    // Per world (by name): what wardend has, and what changed since. `sent` is touched from the main
    // thread and the worker, `dirty` from event handlers (main thread) and the main-thread planner.
    private final Map<String, Map<Long, Sent>> sent = new ConcurrentHashMap<>();
    private final Map<String, Map<Long, Long>> dirty = new ConcurrentHashMap<>();
    private final ArrayDeque<Ref> queue = new ArrayDeque<>();
    private final Set<Ref> queued = new HashSet<>();
    private final AtomicInteger inFlight = new AtomicInteger();
    private final ExecutorService worker = Executors.newSingleThreadExecutor(WardendClient.daemon("warden-agent-encode"));
    private int ticks;
    private long lastReconcile = System.currentTimeMillis();
    private static final int MAX_IN_FLIGHT = 64;

    public ChunkTracker(Plugin plugin, AgentConfig cfg, WardendClient client, ChunkEncoder encoder) {
        this.plugin = plugin;
        this.log = plugin.getLogger();
        this.cfg = cfg;
        this.client = client;
        this.encoder = encoder;
    }

    /** wardend told us what it holds: seed the sent table so unchanged chunks are not resent after a restart. */
    public void setKnown(WardendClient.Known known) {
        Map<String, Map<Long, Sent>> fresh = new ConcurrentHashMap<>();
        for (Map.Entry<String, JsonArray> e : known.byWorld().entrySet()) {
            Map<Long, Sent> m = new ConcurrentHashMap<>();
            for (JsonElement el : e.getValue()) {
                if (!el.isJsonArray() || el.getAsJsonArray().size() < 3) {
                    continue;
                }
                JsonArray a = el.getAsJsonArray();
                try {
                    long hash = Long.parseUnsignedLong(a.get(2).getAsString(), 16);
                    m.put(Ref.key(a.get(0).getAsInt(), a.get(1).getAsInt()), new Sent(hash, 0));
                } catch (RuntimeException ignored) {
                    // a malformed entry only costs one resend
                }
            }
            fresh.put(e.getKey(), m);
        }
        sent.clear();
        sent.putAll(fresh);
        // A fresh connection means a fresh planner: whatever was queued for the old socket is stale.
        Bukkit.getScheduler().runTask(plugin, () -> {
            queue.clear();
            queued.clear();
        });
    }

    /** Main thread, every tick: plan once a second, then drain a few snapshots. */
    public void tick() {
        if (!client.isReady()) {
            return;
        }
        if (ticks++ % 20 == 0) {
            plan();
        }
        int budget = cfg.snapshotsPerTick();
        while (budget-- > 0 && !queue.isEmpty() && inFlight.get() < MAX_IN_FLIGHT) {
            Ref ref = queue.pollFirst();
            queued.remove(ref);
            snapshot(ref);
        }
    }

    private void plan() {
        long now = System.currentTimeMillis();
        boolean reconcile = cfg.reconcileMillis() > 0 && now - lastReconcile >= cfg.reconcileMillis();
        if (reconcile) {
            lastReconcile = now;
        }
        List<Ref> wanted = new ArrayList<>();
        Set<Ref> seen = new HashSet<>();
        for (Player p : Bukkit.getOnlinePlayers()) {
            Location l = p.getLocation();
            World w = l.getWorld();
            if (w == null) {
                continue;
            }
            int r = Math.min(cfg.radius(), w.getViewDistance());
            int pcx = l.getBlockX() >> 4;
            int pcz = l.getBlockZ() >> 4;
            // Nearest first, walking each ring's perimeter: the order a viewer following this player wants.
            for (int ring = 0; ring <= r; ring++) {
                for (int d = -ring; d <= ring; d++) {
                    want(wanted, seen, w, pcx + d, pcz - ring);
                    want(wanted, seen, w, pcx + d, pcz + ring);
                    if (Math.abs(d) != ring) {
                        want(wanted, seen, w, pcx - ring, pcz + d);
                        want(wanted, seen, w, pcx + ring, pcz + d);
                    }
                }
            }
        }
        for (Ref ref : wanted) {
            if (queued.contains(ref) || !ref.world().isChunkLoaded(ref.cx(), ref.cz())) {
                continue;
            }
            String worldName = ref.world().getName();
            Sent s = sent.computeIfAbsent(worldName, k -> new ConcurrentHashMap<>()).get(ref.key());
            Long d = s == null ? null : dirty.getOrDefault(worldName, Map.of()).get(ref.key());
            boolean need = s == null || reconcile || (d != null && d > s.at && now - s.at >= cfg.resendMillis());
            if (need) {
                queue.addLast(ref);
                queued.add(ref);
            }
        }
    }

    private static void want(List<Ref> wanted, Set<Ref> seen, World w, int cx, int cz) {
        Ref ref = new Ref(w, cx, cz);
        if (seen.add(ref)) {
            wanted.add(ref);
        }
    }

    private void snapshot(Ref ref) {
        World w = ref.world();
        if (!w.isChunkLoaded(ref.cx(), ref.cz())) {
            return;
        }
        ChunkSnapshot snap;
        try {
            snap = w.getChunkAt(ref.cx(), ref.cz()).getChunkSnapshot(true, true, false);
        } catch (RuntimeException e) {
            log.log(Level.FINE, "snapshot failed", e);
            return;
        }
        long at = System.currentTimeMillis();
        int minY = w.getMinHeight();
        int maxY = w.getMaxHeight() - 1;
        String worldName = w.getName();
        inFlight.incrementAndGet();
        worker.execute(() -> {
            try {
                ChunkEncoder.Encoded enc = encoder.encode(snap, minY, maxY);
                Map<Long, Sent> m = sent.computeIfAbsent(worldName, k -> new ConcurrentHashMap<>());
                Sent prev = m.get(ref.key());
                if (prev != null && prev.hash == enc.hash()) {
                    prev.at = at;
                    return;
                }
                m.put(ref.key(), new Sent(enc.hash(), at));
                client.sendBinary(frame(worldName, ref.cx(), ref.cz(), enc));
            } catch (RuntimeException e) {
                log.log(Level.WARNING, "encoding chunk " + ref.cx() + "," + ref.cz() + " failed", e);
            } finally {
                inFlight.decrementAndGet();
            }
        });
    }

    /** The binary frame of ADR-018: kind, world name, cx, cz, hash, gzip payload. */
    static ByteBuffer frame(String world, int cx, int cz, ChunkEncoder.Encoded enc) {
        byte[] name = world.getBytes(StandardCharsets.UTF_8);
        if (name.length > 255) {
            name = java.util.Arrays.copyOf(name, 255);
        }
        ByteBuffer buf = ByteBuffer.allocate(1 + 1 + name.length + 4 + 4 + 8 + enc.gzip().length)
                .order(ByteOrder.LITTLE_ENDIAN);
        buf.put((byte) 1);
        buf.put((byte) name.length);
        buf.put(name);
        buf.putInt(cx);
        buf.putInt(cz);
        buf.putLong(enc.hash());
        buf.put(enc.gzip());
        buf.flip();
        return buf;
    }

    public void shutdown() {
        worker.shutdownNow();
    }

    // ---- dirty tracking: every event that changes what the surface looks like ----

    private void mark(Block b) {
        mark(b.getWorld(), b.getX() >> 4, b.getZ() >> 4);
    }

    private void mark(World w, int cx, int cz) {
        dirty.computeIfAbsent(w.getName(), k -> new ConcurrentHashMap<>())
                .put(Ref.key(cx, cz), System.currentTimeMillis());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBreak(BlockBreakEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPlace(BlockPlaceEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBurn(BlockBurnEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onFade(BlockFadeEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onForm(BlockFormEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onSpread(BlockSpreadEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onFlow(BlockFromToEvent e) {
        mark(e.getToBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onDecay(LeavesDecayEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onGrow(StructureGrowEvent e) {
        for (BlockState s : e.getBlocks()) {
            mark(s.getBlock());
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onEntityExplode(EntityExplodeEvent e) {
        for (Block b : e.blockList()) {
            mark(b);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockExplode(BlockExplodeEvent e) {
        for (Block b : e.blockList()) {
            mark(b);
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onEntityChange(EntityChangeBlockEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPistonExtend(BlockPistonExtendEvent e) {
        for (Block b : e.getBlocks()) {
            mark(b);
            mark(b.getRelative(e.getDirection()));
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onPistonRetract(BlockPistonRetractEvent e) {
        for (Block b : e.getBlocks()) {
            mark(b);
            mark(b.getRelative(e.getDirection()));
        }
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBucketEmpty(PlayerBucketEmptyEvent e) {
        mark(e.getBlock());
    }

    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBucketFill(PlayerBucketFillEvent e) {
        mark(e.getBlock());
    }
}
