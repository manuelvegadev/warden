package io.github.manuelvega.warden.agent;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class SpeakFrameTest {
    private static final byte[] OPUS = {(byte) 0xF8, (byte) 0xFF, (byte) 0xFE, 1, 2, 3};

    /** Builds the frame the way wardend does: kind, session, then the browser's body. */
    private static ByteBuffer frame(String session, byte mode, byte flags, long seq, float distance, byte[] extra) {
        byte[] s = session.getBytes(StandardCharsets.US_ASCII);
        ByteBuffer b = ByteBuffer.allocate(1 + 1 + s.length + 1 + 1 + 8 + 4 + extra.length + OPUS.length)
                .order(ByteOrder.LITTLE_ENDIAN);
        b.put(SpeakFrame.KIND).put((byte) s.length).put(s).put(mode).put(flags).putLong(seq).putFloat(distance)
                .put(extra).put(OPUS);
        b.flip();
        b.position(1); // the client hands the handler the buffer just after the kind byte
        return b;
    }

    @Test
    void decodesStatic() {
        SpeakFrame f = SpeakFrame.decode(frame("a1b2c3d4", SpeakFrame.MODE_STATIC, (byte) 0, 7, 48f, new byte[0]));
        assertEquals("a1b2c3d4", f.session());
        assertEquals(SpeakFrame.MODE_STATIC, f.mode());
        assertFalse(f.whisper());
        assertEquals(7, f.seq());
        assertEquals(48f, f.distance());
        assertNull(f.world());
        assertNull(f.target());
        assertArrayEquals(OPUS, f.opus());
    }

    @Test
    void decodesLocational() {
        byte[] w = "world_nether".getBytes(StandardCharsets.UTF_8);
        ByteBuffer extra = ByteBuffer.allocate(1 + w.length + 24).order(ByteOrder.LITTLE_ENDIAN);
        extra.put((byte) w.length).put(w).putDouble(10.5).putDouble(64).putDouble(-3.25);
        SpeakFrame f = SpeakFrame.decode(frame("s", SpeakFrame.MODE_LOCATIONAL, (byte) 0, 1L << 40, 12.5f, extra.array()));
        assertEquals("world_nether", f.world());
        assertEquals(10.5, f.x());
        assertEquals(64, f.y());
        assertEquals(-3.25, f.z());
        assertEquals(1L << 40, f.seq());
        assertEquals(12.5f, f.distance());
        assertArrayEquals(OPUS, f.opus());
    }

    @Test
    void decodesEntityWithRfcByteOrderAndWhisper() {
        UUID target = UUID.fromString("161d9a23-1236-3ec4-b9d2-c3f94062b4fe");
        ByteBuffer extra = ByteBuffer.allocate(16); // big-endian: the bytes of the canonical text
        extra.putLong(target.getMostSignificantBits()).putLong(target.getLeastSignificantBits());
        SpeakFrame f = SpeakFrame.decode(frame("s", SpeakFrame.MODE_ENTITY, SpeakFrame.FLAG_WHISPER, 3, 2f, extra.array()));
        assertEquals(target, f.target());
        assertTrue(f.whisper());
        assertArrayEquals(OPUS, f.opus());
    }

    @Test
    void rejectsShortAndUnknownFrames() {
        for (int cut : new int[] {1, 3, 10, 14}) {
            ByteBuffer full = frame("ab", SpeakFrame.MODE_STATIC, (byte) 0, 1, 1f, new byte[0]);
            ByteBuffer b = ByteBuffer.wrap(full.array(), 0, cut).order(ByteOrder.LITTLE_ENDIAN);
            b.position(1);
            assertThrows(IllegalArgumentException.class, () -> SpeakFrame.decode(b), "cut at " + cut);
        }
        assertThrows(IllegalArgumentException.class,
                () -> SpeakFrame.decode(frame("s", (byte) 9, (byte) 0, 1, 1f, new byte[0])));
        // A locational frame missing its position.
        byte[] w = {1, 'w'};
        assertThrows(IllegalArgumentException.class,
                () -> SpeakFrame.decode(frame("s", SpeakFrame.MODE_LOCATIONAL, (byte) 0, 1, 1f, w)));
    }
}
