package io.github.manuelvega.warden.agent;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Map;
import java.util.zip.GZIPInputStream;
import org.bukkit.ChunkSnapshot;
import org.bukkit.Color;
import org.bukkit.Material;
import org.junit.jupiter.api.Test;

/**
 * Pins the WCK1 layout against a hand-made world: the same bytes Beacon's decoder test reads.
 * {@link ChunkSnapshot} is a proxy answering only the calls the encoder makes; {@link Material}
 * classification that needs a server (tags, map colours) is stubbed through the palette.
 */
class ChunkEncoderTest {
    private static final int MIN_Y = -64;
    private static final int MAX_Y = 319;

    /** Flat world at y=63 (stone) with grass on top at y=64, a 3-block oak trunk with a leaf cube at (5,5), water pool at (10..11, 10..11). */
    private static ChunkSnapshot flatWorld() {
        return (ChunkSnapshot) Proxy.newProxyInstance(ChunkSnapshot.class.getClassLoader(), new Class<?>[] {ChunkSnapshot.class},
                (proxy, method, args) -> switch (method.getName()) {
                    case "getX" -> 3;
                    case "getZ" -> -2;
                    case "getHighestBlockYAt" -> highest((int) args[0], (int) args[1]);
                    case "getBlockType" -> block((int) args[0], (int) args[1], (int) args[2]);
                    case "getBiome" -> null; // encoder falls back to "unknown"
                    case "toString" -> "flatWorld";
                    default -> throw new UnsupportedOperationException(method.getName());
                });
    }

    private static int highest(int x, int z) {
        if (x == 5 && z == 5) {
            return 69;
        }
        if (x == 1 && z == 0) {
            return 65; // the snow layer blocks motion, so the heightmap counts it
        }
        if (x >= 4 && x <= 6 && z >= 4 && z <= 6) {
            return 69;
        }
        return 64;
    }

    private static Material block(int x, int y, int z) {
        if (x >= 10 && x <= 11 && z >= 10 && z <= 11) {
            if (y == 64 || y == 63) {
                return Material.WATER;
            }
            if (y <= 62) {
                return Material.SAND;
            }
            return Material.AIR;
        }
        if (x == 5 && z == 5 && y >= 65 && y <= 67) {
            return Material.OAK_LOG;
        }
        if (x >= 4 && x <= 6 && z >= 4 && z <= 6 && y >= 68 && y <= 69) {
            return Material.OAK_LEAVES;
        }
        if (y == 64) {
            return Material.GRASS_BLOCK;
        }
        if (y == 65 && x == 0 && z == 0) {
            return Material.SHORT_GRASS;
        }
        if (y == 65 && x == 1 && z == 0) {
            return Material.SNOW; // a snow layer: the grass under it is sent as snow
        }
        if (y < 64 && y >= MIN_Y) {
            return Material.STONE;
        }
        return Material.AIR;
    }

    /** Colours by material; everything the real palette asks the server for is answered here. */
    private static BlockPalette palette() {
        Map<Material, Integer> colors = Map.of(
                Material.STONE, 0x707070,
                Material.GRASS_BLOCK, 0x7fb238,
                Material.OAK_LOG, 0x8f7748,
                Material.OAK_LEAVES, 0x007c00,
                Material.WATER, 0x4040ff,
                Material.SAND, 0xf7e9a3,
                Material.SNOW_BLOCK, 0xf9fefe);
        return new BlockPalette(m -> {
            Integer c = colors.get(m);
            return c == null ? null : Color.fromRGB(c);
        }) {
            // Tag lookups and keys need a server; classify by constant instead.
            @Override
            public Entry entry(Material m) {
                if (m == Material.OAK_LEAVES) {
                    return new Entry("oak_leaves", 0x007c00, BlockPalette.FLAG_FOLIAGE, Kind.LEAVES);
                }
                if (m == Material.WATER) {
                    return new Entry("water", 0x4040ff, BlockPalette.FLAG_WATER, Kind.WATER);
                }
                if (m == Material.GRASS_BLOCK) {
                    return new Entry("grass_block", 0x7fb238, BlockPalette.FLAG_GRASS, Kind.SOLID);
                }
                if (m == Material.SHORT_GRASS || m == Material.SNOW || m == Material.AIR) {
                    return Entry.AIR;
                }
                Integer c = colors.get(m);
                return new Entry(m.name().toLowerCase(), c == null ? 0x808080 : c, 0, Kind.SOLID);
            }
        };
    }

    private static byte[] gunzip(byte[] gz) throws IOException {
        try (GZIPInputStream in = new GZIPInputStream(new ByteArrayInputStream(gz))) {
            return in.readAllBytes();
        }
    }

    @Test
    void layoutAndBand() throws IOException {
        ChunkEncoder enc = new ChunkEncoder(palette());
        ChunkEncoder.Encoded out = enc.encode(flatWorld(), MIN_Y, MAX_Y);
        byte[] payload = gunzip(out.gzip());
        assertEquals(Fnv64.hash(payload, 0, payload.length), out.hash());

        ByteBuffer b = ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(ChunkEncoder.MAGIC, b.getInt());
        assertEquals(3, b.getInt());
        assertEquals(-2, b.getInt());
        int yMin = b.getShort();
        int yMax = b.getShort();
        // Ground is the sand under the pool at y=62; the band keeps 8 rows below it. Top is the canopy.
        assertEquals(62 - 8, yMin);
        assertEquals(69, yMax);
        int paletteLen = b.getShort() & 0xffff;
        int biomeLen = b.get() & 0xff;
        b.get(); // reserved
        // air, grass, stone, snow block, leaves, log, water, sand — first seen walking each column top-down
        assertEquals(8, paletteLen);
        int[][] pal = new int[paletteLen][4];
        String[] names = new String[paletteLen];
        for (int i = 0; i < paletteLen; i++) {
            for (int k = 0; k < 4; k++) {
                pal[i][k] = b.get() & 0xff;
            }
            byte[] nb = new byte[b.get() & 0xff];
            b.get(nb);
            names[i] = new String(nb, java.nio.charset.StandardCharsets.UTF_8);
        }
        assertArrayEquals(new int[] {0, 0, 0, 0}, pal[0]);
        assertEquals("air", names[0]);
        assertEquals("grass_block", names[1]);
        assertEquals("stone", names[2]);
        assertEquals(1, biomeLen);
        int len = b.get() & 0xff;
        byte[] name = new byte[len];
        b.get(name);
        assertEquals("unknown", new String(name, java.nio.charset.StandardCharsets.UTF_8));
        byte[] biomes = new byte[256];
        b.get(biomes);
        int height = yMax - yMin + 1;
        byte[] blocks = new byte[256 * height];
        b.get(blocks);
        assertEquals(0, b.remaining());

        // Column (0,0): grass at 64 with a plant on top that must be air; stone below.
        int base = 0;
        int grass = blocks[base + (64 - yMin)] & 0xff;
        assertEquals(BlockPalette.FLAG_GRASS, pal[grass][3]);
        assertEquals(0, blocks[base + (65 - yMin)]);
        int stone = blocks[base + (63 - yMin)] & 0xff;
        assertEquals(0x70, pal[stone][0]);
        // Column (1,0): a snow layer sits on the grass, which is therefore sent as a snow block.
        int snowy = blocks[(1 * 16 + 0) * height + (64 - yMin)] & 0xff;
        assertEquals("snow_block", names[snowy]);
        assertEquals(0, blocks[(1 * 16 + 0) * height + (65 - yMin)]);
        // Column (5,5): trunk 65..67, leaves 68..69.
        base = (5 * 16 + 5) * height;
        int log = blocks[base + (66 - yMin)] & 0xff;
        assertEquals(0x8f, pal[log][0]);
        int leaves = blocks[base + (69 - yMin)] & 0xff;
        assertEquals(BlockPalette.FLAG_FOLIAGE, pal[leaves][3]);
        // Column (10,10): water at 63..64 over sand.
        base = (10 * 16 + 10) * height;
        int water = blocks[base + (64 - yMin)] & 0xff;
        assertEquals(BlockPalette.FLAG_WATER, pal[water][3]);
        int sand = blocks[base + (62 - yMin)] & 0xff;
        assertEquals(0xf7, pal[sand][0]);
        // Air above every top.
        assertEquals(0, blocks[base + (65 - yMin)]);
    }

    @Test
    void hashChangesWithContent() {
        ChunkEncoder enc = new ChunkEncoder(palette());
        ChunkEncoder.Encoded a = enc.encode(flatWorld(), MIN_Y, MAX_Y);
        ChunkEncoder.Encoded b = enc.encode(flatWorld(), MIN_Y, MAX_Y);
        assertEquals(a.hash(), b.hash());
        ChunkSnapshot other = (ChunkSnapshot) Proxy.newProxyInstance(ChunkSnapshot.class.getClassLoader(),
                new Class<?>[] {ChunkSnapshot.class}, (proxy, method, args) -> switch (method.getName()) {
                    case "getX" -> 3;
                    case "getZ" -> -2;
                    case "getHighestBlockYAt" -> 64;
                    case "getBlockType" -> (int) args[1] <= 64 ? Material.STONE : Material.AIR;
                    case "getBiome" -> null;
                    default -> throw new UnsupportedOperationException(method.getName());
                });
        assertNotEquals(a.hash(), enc.encode(other, MIN_Y, MAX_Y).hash());
    }

    @Test
    void frameHeader() {
        ChunkEncoder.Encoded enc = new ChunkEncoder.Encoded(new byte[] {9, 8, 7}, 0x0123456789abcdefL);
        ByteBuffer f = ChunkTracker.frame("world_nether", 7, -9, enc);
        assertEquals(1, f.get());
        int n = f.get() & 0xff;
        byte[] name = new byte[n];
        f.get(name);
        assertEquals("world_nether", new String(name, java.nio.charset.StandardCharsets.UTF_8));
        assertEquals(7, f.getInt());
        assertEquals(-9, f.getInt());
        assertEquals(0x0123456789abcdefL, f.getLong());
        byte[] rest = new byte[f.remaining()];
        f.get(rest);
        assertArrayEquals(new byte[] {9, 8, 7}, rest);
        assertEquals("0123456789abcdef", String.format("%016x", enc.hash()));
    }
}
