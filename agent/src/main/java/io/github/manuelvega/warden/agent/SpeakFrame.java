package io.github.manuelvega.warden.agent;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * One Opus frame spoken from Beacon, as wardend relays it (ADR-019 §2, kind 3, little-endian):
 * {@code u8 sessionLen · session · u8 mode · u8 flags · u64 seq · f32 distance · mode-specific · opus},
 * where mode 1 (locational) carries {@code u8 worldLen · world · f64 x · f64 y · f64 z} and mode 2
 * (entity) a 16-byte UUID in RFC 4122 order. Mode 0 is static: everyone hears it, no position.
 */
public record SpeakFrame(String session, byte mode, boolean whisper, long seq, float distance, String world,
        double x, double y, double z, UUID target, byte[] opus) {

    public static final byte KIND = 3;
    public static final byte MODE_STATIC = 0;
    public static final byte MODE_LOCATIONAL = 1;
    public static final byte MODE_ENTITY = 2;
    public static final byte FLAG_WHISPER = 0b1;

    /** Decodes from a little-endian buffer positioned just after the kind byte. */
    public static SpeakFrame decode(ByteBuffer b) {
        b.order(ByteOrder.LITTLE_ENDIAN);
        String session = string(b, "session");
        need(b, 1 + 1 + 8 + 4, "header");
        byte mode = b.get();
        byte flags = b.get();
        long seq = b.getLong();
        float distance = b.getFloat();
        String world = null;
        double x = 0;
        double y = 0;
        double z = 0;
        UUID target = null;
        switch (mode) {
            case MODE_STATIC -> { }
            case MODE_LOCATIONAL -> {
                world = string(b, "world");
                need(b, 24, "position");
                x = b.getDouble();
                y = b.getDouble();
                z = b.getDouble();
            }
            case MODE_ENTITY -> {
                need(b, 16, "entity");
                target = new UUID(b.order(ByteOrder.BIG_ENDIAN).getLong(), b.getLong());
                b.order(ByteOrder.LITTLE_ENDIAN);
            }
            default -> throw new IllegalArgumentException("unknown speak mode " + mode);
        }
        byte[] opus = new byte[b.remaining()];
        b.get(opus);
        return new SpeakFrame(session, mode, (flags & FLAG_WHISPER) != 0, seq, distance, world, x, y, z, target, opus);
    }

    private static String string(ByteBuffer b, String what) {
        need(b, 1, what);
        int n = b.get() & 0xFF;
        need(b, n, what);
        byte[] raw = new byte[n];
        b.get(raw);
        return new String(raw, StandardCharsets.UTF_8);
    }

    private static void need(ByteBuffer b, int n, String what) {
        if (b.remaining() < n) {
            throw new IllegalArgumentException("speak frame too short for " + what);
        }
    }
}
