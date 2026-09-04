package io.github.manuelvega.warden.agent;

import java.util.EnumSet;
import java.util.Set;
import java.util.function.Function;
import org.bukkit.Axis;
import org.bukkit.Color;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.block.BlockFace;
import org.bukkit.block.data.BlockData;
import org.bukkit.block.data.Directional;
import org.bukkit.block.data.Orientable;

/**
 * Maps a block type to what the viewer needs: the block key, the game's map colour (the viewer's
 * fallback for blocks its texture table does not know) and a few flags that are facts only the
 * server has (liquid, leaves tag, partial shape). The viewer owns colours and translucency.
 */
public class BlockPalette {
    /** Grass-coloured: tint by biome later. */
    public static final int FLAG_GRASS = 1;
    /** Foliage-coloured (leaves): tint by biome later. */
    public static final int FLAG_FOLIAGE = 2;
    /** A liquid (water, bubble column). */
    public static final int FLAG_WATER = 4;
    /** The cell also holds water: a waterlogged block, or a plant the game keeps in water. */
    public static final int FLAG_WATERLOGGED = 8;
    /** Solid but not a full cube (slabs, stairs, fences, glass): boxed for now. */
    public static final int FLAG_PARTIAL = 16;

    /**
     * How a block is turned, for the viewer to pick the right faces: 0 for blocks that have no
     * orientation, 1–3 an axis (x, y, z: logs, pillars), 4–9 a facing (down, up, north, south, west,
     * east: furnaces, dispensers, barrels, glazed terracotta).
     */
    public static final int ORIENT_NONE = 0;
    public static final int ORIENTS = 10;
    private static final Axis[] AXES = {Axis.X, Axis.Y, Axis.Z};
    private static final BlockFace[] FACINGS =
            {BlockFace.DOWN, BlockFace.UP, BlockFace.NORTH, BlockFace.SOUTH, BlockFace.WEST, BlockFace.EAST};
    /** Full-cube blocks whose look depends on their axis or facing, beyond logs, wood and stems. */
    private static final Set<Material> ORIENTED = EnumSet.of(Material.QUARTZ_PILLAR, Material.PURPUR_PILLAR,
            Material.BONE_BLOCK, Material.BASALT, Material.POLISHED_BASALT, Material.DEEPSLATE, Material.HAY_BLOCK,
            Material.FURNACE, Material.BLAST_FURNACE, Material.SMOKER, Material.DISPENSER, Material.DROPPER,
            Material.OBSERVER, Material.BARREL, Material.LOOM, Material.CHISELED_BOOKSHELF, Material.CARVED_PUMPKIN,
            Material.JACK_O_LANTERN, Material.BEE_NEST, Material.BEEHIVE, Material.PISTON, Material.STICKY_PISTON,
            Material.COMMAND_BLOCK, Material.CHAIN_COMMAND_BLOCK, Material.REPEATING_COMMAND_BLOCK,
            Material.CRAFTER, Material.VAULT, Material.TRIAL_SPAWNER);

    /**
     * Plants the game keeps in water with no waterlogged property of their own: their block
     * definition carries the water, so it is a fact of the type rather than of the placement.
     */
    private static final Set<Material> IN_WATER =
            EnumSet.of(Material.KELP, Material.KELP_PLANT, Material.SEAGRASS, Material.TALL_SEAGRASS);

    /** Bodyless blocks that carry a waterlogged property, beyond the coral fans and amethyst buds. */
    private static final Set<String> WATERLOGGABLE = Set.of("sea_pickle", "ladder", "chain", "lantern",
            "soul_lantern", "lightning_rod", "pointed_dripstone", "glow_lichen", "sculk_vein", "amethyst_cluster",
            "hanging_roots", "small_dripleaf", "big_dripleaf_stem", "mangrove_propagule");

    /** How the encoder treats a block. */
    public enum Kind {
        /** Not sent: air, plants, torches, rails and anything else without a solid body. */
        AIR,
        /** Ground: counts towards the bottom of the height band. */
        SOLID,
        /** Rendered but not ground: a tree canopy is not the surface. */
        LEAVES,
        /** Rendered translucent, not ground. */
        WATER
    }

    /**
     * One palette entry: the block key ("grass_block"), its map colour packed as 0xRRGGBB (the viewer's
     * fallback for blocks it has no texture colour for), flags, how the block is turned and the kind.
     */
    public record Entry(String name, int rgb, int flags, int orient, Kind kind) {
        public static final Entry AIR = new Entry("air", 0, 0, Kind.AIR);

        /**
         * The same block with water in its cell: the key and the colour stay as they are, so a
         * later viewer can draw the block itself, and the flag says what shares the cell with it.
         */
        public Entry waterlogged() {
            return (flags & FLAG_WATERLOGGED) != 0
                    ? this
                    : new Entry(name, rgb, flags | FLAG_WATERLOGGED, orient, Kind.WATER);
        }

        public Entry(String name, int rgb, int flags, Kind kind) {
            this(name, rgb, flags, ORIENT_NONE, kind);
        }

        /** The same block, turned. */
        public Entry turned(int orient) {
            return orient == this.orient ? this : new Entry(name, rgb, flags, orient, kind);
        }
    }

    private final Function<Material, Color> mapColor;
    // Indexed by Material ordinal: an array read per block on the encode thread, no hashing or boxing.
    // Entries are immutable, so a racy double classification is harmless.
    private final Entry[] cache = new Entry[Material.values().length];
    private final Boolean[] orientedCache = new Boolean[Material.values().length];
    private final Boolean[] waterCache = new Boolean[Material.values().length];

    /** Production palette: the colour comes from {@code BlockData#getMapColor()}. */
    public BlockPalette() {
        this(m -> m.createBlockData().getMapColor());
    }

    /** Tests inject the colour lookup, which otherwise needs a running server. */
    public BlockPalette(Function<Material, Color> mapColor) {
        this.mapColor = mapColor;
    }

    /**
     * A thin cover that repaints the block under it. A snow layer is not a block of its own in the
     * viewer, but the grass beneath wears white in the game (its snowy side texture), so the whole
     * cube is sent as snow. Carpets and moss carpets would fit the same rule.
     */
    public Material coverOf(Material above) {
        return above == Material.SNOW ? Material.SNOW_BLOCK : null;
    }

    /**
     * Whether the block's faces depend on how it is turned, so the encoder should read its block
     * data (a slower call than the type) for the orientation. Decided by name and a list, not by
     * the block data's interfaces, so it also works without a running server.
     */
    public boolean oriented(Material m) {
        Boolean o = orientedCache[m.ordinal()];
        if (o == null) {
            String name = m.name().toLowerCase();
            o = ORIENTED.contains(m) || name.endsWith("_log") || name.endsWith("_wood") || name.endsWith("_stem")
                    || name.endsWith("_hyphae") || name.endsWith("_glazed_terracotta");
            orientedCache[m.ordinal()] = o;
        }
        return o;
    }

    /**
     * Whether a block the encoder would drop always stands in water: kelp and seagrass, whose
     * block definition holds the water rather than their block data.
     */
    public boolean inWater(Material m) {
        return IN_WATER.contains(m);
    }

    /**
     * Whether a block the encoder would drop may hold water in its own cell, so the encoder reads
     * its block data to find out. Decided by name and a list, as {@link #oriented}, so it also
     * works without a running server.
     */
    public boolean mayHoldWater(Material m) {
        Boolean w = waterCache[m.ordinal()];
        if (w == null) {
            String name = m.name().toLowerCase();
            w = WATERLOGGABLE.contains(name) || name.endsWith("_coral_fan") || name.endsWith("_coral_wall_fan")
                    || name.endsWith("_amethyst_bud");
            waterCache[m.ordinal()] = w;
        }
        return w;
    }

    /** The orientation code of a block's data: its axis or its facing, or none. */
    public static int orientOf(BlockData data) {
        if (data instanceof Orientable o) {
            Axis axis = o.getAxis();
            for (int i = 0; i < AXES.length; i++) {
                if (AXES[i] == axis) {
                    return 1 + i;
                }
            }
        } else if (data instanceof Directional d) {
            BlockFace facing = d.getFacing();
            for (int i = 0; i < FACINGS.length; i++) {
                if (FACINGS[i] == facing) {
                    return 4 + i;
                }
            }
        }
        return ORIENT_NONE;
    }

    public Entry entry(Material m) {
        Entry e = cache[m.ordinal()];
        if (e == null) {
            e = classify(m);
            cache[m.ordinal()] = e;
        }
        return e;
    }

    private Entry classify(Material m) {
        if (!m.isBlock() || m.isAir()) {
            return Entry.AIR;
        }
        String name = m.getKey().getKey();
        if (m == Material.WATER || m == Material.BUBBLE_COLUMN) {
            return new Entry(name, rgb(m), FLAG_WATER, Kind.WATER);
        }
        if (Tag.LEAVES.isTagged(m)) {
            return new Entry(name, rgb(m), FLAG_FOLIAGE, Kind.LEAVES);
        }
        if (m == Material.GRASS_BLOCK) {
            return new Entry(name, rgb(m), FLAG_GRASS, Kind.SOLID);
        }
        if (m == Material.LAVA || m.isOccluding()) {
            return new Entry(name, rgb(m), 0, Kind.SOLID);
        }
        if (m.isSolid()) {
            return new Entry(name, rgb(m), FLAG_PARTIAL, Kind.SOLID);
        }
        // No body of its own, so nothing is drawn for it; the key and colour are kept because the
        // cell may still hold water, and then the entry is sent with the waterlogged flag.
        return new Entry(name, rgb(m), 0, Kind.AIR);
    }

    private int rgb(Material m) {
        Color c;
        try {
            c = mapColor.apply(m);
        } catch (RuntimeException e) {
            c = null;
        }
        if (c == null) {
            return 0x808080;
        }
        return (c.getRed() << 16) | (c.getGreen() << 8) | c.getBlue();
    }
}
