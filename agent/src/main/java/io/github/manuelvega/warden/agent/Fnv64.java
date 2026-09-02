package io.github.manuelvega.warden.agent;

/** 64-bit FNV-1a, the content hash wardend and Beacon use to tell whether a chunk changed. */
public final class Fnv64 {
    private static final long OFFSET = 0xcbf29ce484222325L;
    private static final long PRIME = 0x100000001b3L;

    private Fnv64() {}

    public static long hash(byte[] data, int offset, int length) {
        long h = OFFSET;
        for (int i = offset; i < offset + length; i++) {
            h ^= (data[i] & 0xff);
            h *= PRIME;
        }
        return h;
    }
}
