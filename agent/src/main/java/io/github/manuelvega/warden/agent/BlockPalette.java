package io.github.manuelvega.warden.agent;

import java.util.function.Function;
import org.bukkit.Color;
import org.bukkit.Material;
import org.bukkit.Tag;

/**
 * Maps a block type to what the viewer needs: an average colour and a few flags. The colour is the
 * game's own map colour (what an in-game map shows for the block), so there is no table of ours to
 * maintain when Mojang adds blocks.
 */
public class BlockPalette {
    /** Grass-coloured: tint by biome later. */
    public static final int FLAG_GRASS = 1;
    /** Foliage-coloured (leaves): tint by biome later. */
    public static final int FLAG_FOLIAGE = 2;
    /** Rendered translucent. */
    public static final int FLAG_WATER = 4;
    /** Reserved. */
    public static final int FLAG_TRANSLUCENT = 8;
    /** Solid but not a full cube (slabs, stairs, fences, glass): boxed for now. */
    public static final int FLAG_PARTIAL = 16;

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

    /** One palette entry: colour packed as 0xRRGGBB, plus flags and the kind. */
    public record Entry(int rgb, int flags, Kind kind) {
        public static final Entry AIR = new Entry(0, 0, Kind.AIR);

        /** The palette key: colour and flags together identify a distinct entry. */
        public int key() {
            return (rgb << 8) | flags;
        }
    }

    private final Function<Material, Color> mapColor;
    // Indexed by Material ordinal: an array read per block on the encode thread, no hashing or boxing.
    // Entries are immutable, so a racy double classification is harmless.
    private final Entry[] cache = new Entry[Material.values().length];

    /** Production palette: the colour comes from {@code BlockData#getMapColor()}. */
    public BlockPalette() {
        this(m -> m.createBlockData().getMapColor());
    }

    /** Tests inject the colour lookup, which otherwise needs a running server. */
    public BlockPalette(Function<Material, Color> mapColor) {
        this.mapColor = mapColor;
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
        if (m == Material.WATER || m == Material.BUBBLE_COLUMN) {
            return new Entry(rgb(m), FLAG_WATER, Kind.WATER);
        }
        if (Tag.LEAVES.isTagged(m)) {
            return new Entry(rgb(m), FLAG_FOLIAGE, Kind.LEAVES);
        }
        if (m == Material.GRASS_BLOCK) {
            return new Entry(rgb(m), FLAG_GRASS, Kind.SOLID);
        }
        if (m == Material.LAVA || m.isOccluding()) {
            return new Entry(rgb(m), 0, Kind.SOLID);
        }
        if (m.isSolid()) {
            return new Entry(rgb(m), FLAG_PARTIAL, Kind.SOLID);
        }
        return Entry.AIR;
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
