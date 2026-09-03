package io.github.manuelvega.warden.agent;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;

import java.nio.ByteBuffer;
import java.util.HexFormat;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class VoiceFrameTest {
    @Test
    void layoutMatchesTheContract() {
        UUID id = UUID.fromString("069a79f4-44e9-4726-a5be-fca90e38aaf5");
        byte[] opus = {(byte) 0xF8, (byte) 0xFF, (byte) 0xFE, 0x01, 0x02};
        ByteBuffer b = VoiceFrame.encode(true, false, id, 0x0102030405060708L, opus);
        byte[] out = new byte[b.remaining()];
        b.get(out);

        assertEquals(VoiceFrame.HEADER + opus.length, out.length);
        assertEquals(2, out[0]);
        assertEquals(VoiceFrame.FLAG_WHISPER, out[1]);
        byte[] uuid = new byte[16];
        System.arraycopy(out, 2, uuid, 0, 16);
        assertEquals(id.toString().replace("-", ""), HexFormat.of().formatHex(uuid));
        byte[] seq = new byte[8];
        System.arraycopy(out, 18, seq, 0, 8);
        assertArrayEquals(new byte[] {0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01}, seq);
        byte[] tail = new byte[opus.length];
        System.arraycopy(out, VoiceFrame.HEADER, tail, 0, opus.length);
        assertArrayEquals(opus, tail);
    }

    @Test
    void flagsCombine() {
        ByteBuffer b = VoiceFrame.encode(true, true, UUID.randomUUID(), 0, new byte[0]);
        assertEquals(VoiceFrame.FLAG_WHISPER | VoiceFrame.FLAG_GROUP, b.get(1));
        assertEquals(0, VoiceFrame.encode(false, false, UUID.randomUUID(), 0, new byte[0]).get(1));
    }
}
