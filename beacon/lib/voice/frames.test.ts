import assert from "node:assert/strict";
import { test } from "node:test";
import { FRAME_VOICE, parseVoiceFrame, uuidString } from "./frames.ts";

const UUID = "069a79f4-44e9-4726-a5be-fca90e38aaf5";

function uuidBytes(s: string): number[] {
  return (s.replace(/-/g, "").match(/../g) ?? []).map((h) => Number.parseInt(h, 16));
}

function frame(kind: number, flags: number, seq: bigint, opus: number[]): ArrayBuffer {
  const bytes = new Uint8Array(1 + 1 + 16 + 8 + opus.length);
  bytes[0] = kind;
  bytes[1] = flags;
  bytes.set(uuidBytes(UUID), 2);
  new DataView(bytes.buffer).setBigUint64(18, seq, true);
  bytes.set(opus, 26);
  return bytes.buffer;
}

test("parses the header and hands back the opus payload", () => {
  const f = parseVoiceFrame(frame(FRAME_VOICE, 0, 1234n, [0xf8, 0xff, 0xfe]));
  assert.equal(f.speaker, UUID);
  assert.equal(f.seq, 1234);
  assert.equal(f.whisper, false);
  assert.equal(f.group, false);
  assert.deepEqual(Array.from(f.opus), [0xf8, 0xff, 0xfe]);
});

test("reads the whisper and group flags", () => {
  assert.equal(parseVoiceFrame(frame(FRAME_VOICE, 1, 0n, [1])).whisper, true);
  assert.equal(parseVoiceFrame(frame(FRAME_VOICE, 2, 0n, [1])).group, true);
  const both = parseVoiceFrame(frame(FRAME_VOICE, 3, 0n, [1]));
  assert.equal(both.whisper && both.group, true);
});

test("the sequence number is little-endian and survives past 32 bits", () => {
  assert.equal(parseVoiceFrame(frame(FRAME_VOICE, 0, 0x1_0000_0001n, [1])).seq, 0x1_0000_0001);
});

test("rejects other kinds and short buffers", () => {
  assert.throws(() => parseVoiceFrame(frame(1, 0, 0n, [1])), /not a voice frame/);
  assert.throws(() => parseVoiceFrame(new Uint8Array(10).buffer), /too short/);
});

test("uuidString renders RFC 4122 byte order", () => {
  assert.equal(uuidString(new Uint8Array(uuidBytes(UUID))), UUID);
  assert.throws(() => uuidString(new Uint8Array(3)));
});
