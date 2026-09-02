package io.github.manuelvega.warden.agent;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPOutputStream;
import org.bukkit.ChunkSnapshot;
import org.bukkit.Material;
import org.bukkit.block.Biome;

/**
 * Turns a chunk snapshot into the "WCK1" payload described in ADR-018: a height band of one byte per
 * block indexing a per-chunk colour palette, plus one biome per column. Runs off the main thread;
 * the snapshot is an immutable copy.
 */
public final class ChunkEncoder {
    public static final int MAGIC = 0x314B4357; // "WCK1" little-endian
    // One byte per block: a chunk with more distinct colours than this maps extras to the closest entry.
    private static final int MAX_PALETTE = 255;
    private static final int MAX_BIOMES = 255;
    /** Rows kept below the lowest ground level of the chunk, so cliffs into the next chunk still have sides. */
    private static final int BAND_MARGIN = 8;

    /** The gzip-compressed payload and the FNV-1a hash of the uncompressed bytes. */
    public record Encoded(byte[] gzip, long hash) {}

    private final BlockPalette palette;

    public ChunkEncoder(BlockPalette palette) {
        this.palette = palette;
    }

    /**
     * @param snap a snapshot taken with {@code includeMaxBlockY} and {@code includeBiome}
     * @param worldMinY the world's lowest block (e.g. -64)
     * @param worldMaxY the world's highest block (e.g. 319)
     */
    public Encoded encode(ChunkSnapshot snap, int worldMinY, int worldMaxY) {
        // Pass 1: per column, the top rendered block and the ground (first solid block from the top).
        int[] tops = new int[256];
        int maxTop = Integer.MIN_VALUE;
        int minGround = Integer.MAX_VALUE;
        for (int x = 0; x < 16; x++) {
            for (int z = 0; z < 16; z++) {
                int col = z * 16 + x;
                int y = Math.min(snap.getHighestBlockYAt(x, z), worldMaxY);
                int top = Integer.MIN_VALUE;
                int ground = Integer.MIN_VALUE;
                for (; y >= worldMinY; y--) {
                    BlockPalette.Entry e = palette.entry(snap.getBlockType(x, y, z));
                    if (e.kind() == BlockPalette.Kind.AIR) {
                        continue;
                    }
                    if (top == Integer.MIN_VALUE) {
                        top = y;
                    }
                    if (e.kind() == BlockPalette.Kind.SOLID) {
                        ground = y;
                        break;
                    }
                }
                if (top == Integer.MIN_VALUE) {
                    // A column of nothing (void, or only plants): pretend the floor is the world bottom.
                    top = worldMinY;
                    ground = worldMinY;
                } else if (ground == Integer.MIN_VALUE) {
                    ground = worldMinY;
                }
                tops[col] = top;
                maxTop = Math.max(maxTop, top);
                minGround = Math.min(minGround, ground);
            }
        }
        int yMin = Math.max(worldMinY, minGround - BAND_MARGIN);
        int yMax = Math.max(yMin, maxTop);
        int height = yMax - yMin + 1;

        // Pass 2: block indices into a palette built as we go. The per-material index is an int array
        // (no boxing per block); materials that share a colour and flags share a palette entry.
        List<BlockPalette.Entry> paletteList = new ArrayList<>();
        paletteList.add(BlockPalette.Entry.AIR);
        int[] indexByMaterial = new int[Material.values().length];
        java.util.Arrays.fill(indexByMaterial, -1);
        byte[] blocks = new byte[256 * height];
        for (int x = 0; x < 16; x++) {
            for (int z = 0; z < 16; z++) {
                int col = z * 16 + x;
                int base = (x * 16 + z) * height;
                int top = tops[col];
                for (int y = yMin; y <= top; y++) {
                    Material m = snap.getBlockType(x, y, z);
                    int idx = indexByMaterial[m.ordinal()];
                    if (idx < 0) {
                        BlockPalette.Entry e = palette.entry(m);
                        idx = e.kind() == BlockPalette.Kind.AIR ? 0 : indexOf(paletteList, e);
                        indexByMaterial[m.ordinal()] = idx;
                    }
                    if (idx != 0) {
                        blocks[base + (y - yMin)] = (byte) idx;
                    }
                }
            }
        }

        // Biomes: one per column, at the top block.
        Map<String, Integer> biomeIndex = new HashMap<>();
        List<String> biomeList = new ArrayList<>();
        byte[] biomes = new byte[256];
        for (int x = 0; x < 16; x++) {
            for (int z = 0; z < 16; z++) {
                int col = z * 16 + x;
                String key = biomeKey(snap, x, tops[col], z);
                Integer idx = biomeIndex.get(key);
                if (idx == null) {
                    if (biomeList.size() >= MAX_BIOMES) {
                        idx = 0;
                    } else {
                        idx = biomeList.size();
                        biomeList.add(key);
                        biomeIndex.put(key, idx);
                    }
                }
                biomes[col] = (byte) (int) idx;
            }
        }

        byte[] payload = serialize(snap.getX(), snap.getZ(), yMin, yMax, paletteList, biomeList, biomes, blocks);
        long hash = Fnv64.hash(payload, 0, payload.length);
        return new Encoded(gzip(payload), hash);
    }

    /** The palette index of an entry, adding it once per (colour, flags); past the cap, the closest colour. */
    private static int indexOf(List<BlockPalette.Entry> list, BlockPalette.Entry e) {
        for (int i = 1; i < list.size(); i++) {
            if (list.get(i).key() == e.key()) {
                return i;
            }
        }
        if (list.size() >= MAX_PALETTE) {
            return nearest(list, e);
        }
        list.add(e);
        return list.size() - 1;
    }

    private static String biomeKey(ChunkSnapshot snap, int x, int y, int z) {
        try {
            Biome b = snap.getBiome(x, y, z);
            return b == null ? "unknown" : b.getKey().getKey();
        } catch (RuntimeException e) {
            return "unknown";
        }
    }

    /** With a saturated palette, the visually closest existing entry stands in. */
    private static int nearest(List<BlockPalette.Entry> list, BlockPalette.Entry e) {
        int best = 1;
        long bestD = Long.MAX_VALUE;
        for (int i = 1; i < list.size(); i++) {
            BlockPalette.Entry o = list.get(i);
            if ((o.flags() & BlockPalette.FLAG_WATER) != (e.flags() & BlockPalette.FLAG_WATER)) {
                continue;
            }
            long dr = ((o.rgb() >> 16) & 0xff) - ((e.rgb() >> 16) & 0xff);
            long dg = ((o.rgb() >> 8) & 0xff) - ((e.rgb() >> 8) & 0xff);
            long db = (o.rgb() & 0xff) - (e.rgb() & 0xff);
            long d = dr * dr + dg * dg + db * db;
            if (d < bestD) {
                bestD = d;
                best = i;
            }
        }
        return best;
    }

    static byte[] serialize(int cx, int cz, int yMin, int yMax, List<BlockPalette.Entry> paletteList,
            List<String> biomeList, byte[] biomes, byte[] blocks) {
        List<byte[]> biomeBytes = new ArrayList<>(biomeList.size());
        int biomeLen = 0;
        for (String b : biomeList) {
            byte[] bytes = b.getBytes(StandardCharsets.UTF_8);
            if (bytes.length > 255) {
                bytes = java.util.Arrays.copyOf(bytes, 255);
            }
            biomeBytes.add(bytes);
            biomeLen += 1 + bytes.length;
        }
        int size = 4 + 4 + 4 + 2 + 2 + 2 + 1 + 1 + paletteList.size() * 4 + biomeLen + 256 + blocks.length;
        ByteBuffer buf = ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN);
        buf.putInt(MAGIC);
        buf.putInt(cx);
        buf.putInt(cz);
        buf.putShort((short) yMin);
        buf.putShort((short) yMax);
        buf.putShort((short) paletteList.size());
        buf.put((byte) biomeList.size());
        buf.put((byte) 0);
        for (BlockPalette.Entry e : paletteList) {
            buf.put((byte) ((e.rgb() >> 16) & 0xff));
            buf.put((byte) ((e.rgb() >> 8) & 0xff));
            buf.put((byte) (e.rgb() & 0xff));
            buf.put((byte) e.flags());
        }
        for (byte[] b : biomeBytes) {
            buf.put((byte) b.length);
            buf.put(b);
        }
        buf.put(biomes);
        buf.put(blocks);
        return buf.array();
    }

    private static byte[] gzip(byte[] payload) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(payload.length / 4 + 64);
        try (GZIPOutputStream gz = new GZIPOutputStream(out)) {
            gz.write(payload);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }
}
