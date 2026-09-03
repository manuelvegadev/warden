package io.github.manuelvega.warden.agent;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.UUID;

/**
 * The binary frame that carries one Opus frame of a player's voice to wardend (ADR-019, kind 2):
 * {@code u8 2 · u8 flags · UUID speaker (16 bytes, RFC 4122 order) · u64 seq (little-endian) · opus}.
 */
public final class VoiceFrame {
    public static final byte KIND = 2;
    public static final byte FLAG_WHISPER = 0b01;
    public static final byte FLAG_GROUP = 0b10;
    public static final int HEADER = 1 + 1 + 16 + 8;

    private VoiceFrame() {}

    public static ByteBuffer encode(boolean whisper, boolean group, UUID speaker, long seq, byte[] opus) {
        ByteBuffer b = ByteBuffer.allocate(HEADER + opus.length).order(ByteOrder.LITTLE_ENDIAN);
        b.put(KIND);
        byte flags = 0;
        if (whisper) {
            flags |= FLAG_WHISPER;
        }
        if (group) {
            flags |= FLAG_GROUP;
        }
        b.put(flags);
        // The UUID keeps the byte order of its canonical text, so every side can compare it to a string.
        b.order(ByteOrder.BIG_ENDIAN).putLong(speaker.getMostSignificantBits()).putLong(speaker.getLeastSignificantBits());
        b.order(ByteOrder.LITTLE_ENDIAN).putLong(seq);
        b.put(opus);
        b.flip();
        return b;
    }
}
