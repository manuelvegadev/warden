import assert from "node:assert/strict";
import { test } from "node:test";
import {
  encodeSpeakBody,
  FRAME_SPEAK,
  FRAME_VOICE,
  parseVoiceFrame,
  SPEAK_ENTITY,
  SPEAK_LOCATIONAL,
  SPEAK_STATIC,
  type SpeakBody,
  uuidBytes,
  uuidString,
} from "./frames.ts";

const UUID = "069a79f4-44e9-4726-a5be-fca90e38aaf5";

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
  assert.equal(uuidString(uuidBytes(UUID)), UUID);
  assert.throws(() => uuidString(new Uint8Array(3)));
});

/** A reader for the speak body, the mirror of the encoder and of what the agent parses. */
function decodeSpeakBody(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  const out: Record<string, unknown> = {
    kind: bytes[0],
    mode: bytes[1],
    whisper: (bytes[2] & 1) !== 0,
    seq: Number(view.getBigUint64(3, true)),
    distance: view.getFloat32(11, true),
  };
  let p = 15;
  if (out.mode === SPEAK_LOCATIONAL) {
    const n = bytes[p++];
    out.world = new TextDecoder().decode(bytes.subarray(p, p + n));
    p += n;
    out.x = view.getFloat64(p, true);
    out.y = view.getFloat64(p + 8, true);
    out.z = view.getFloat64(p + 16, true);
    p += 24;
  } else if (out.mode === SPEAK_ENTITY) {
    out.uuid = uuidString(bytes.subarray(p, p + 16));
    p += 16;
  }
  out.opus = Array.from(bytes.subarray(p));
  return out;
}

test("encodes a static body", () => {
  const d = decodeSpeakBody(
    encodeSpeakBody({ mode: SPEAK_STATIC, whisper: false, seq: 7, distance: 0, opus: new Uint8Array([1, 2]) }),
  );
  assert.equal(d.kind, FRAME_SPEAK);
  assert.equal(d.mode, SPEAK_STATIC);
  assert.equal(d.seq, 7);
  assert.deepEqual(d.opus, [1, 2]);
});

test("encodes a locational body with the world and the point", () => {
  const body: SpeakBody = {
    mode: SPEAK_LOCATIONAL,
    whisper: false,
    seq: 0x1_0000_0002,
    distance: 32,
    world: "world_nether",
    x: 77.5,
    y: -63.25,
    z: 6.125,
    opus: new Uint8Array([9]),
  };
  const d = decodeSpeakBody(encodeSpeakBody(body));
  assert.equal(d.world, "world_nether");
  assert.equal(d.x, 77.5);
  assert.equal(d.y, -63.25);
  assert.equal(d.z, 6.125);
  assert.equal(d.distance, 32);
  assert.equal(d.seq, 0x1_0000_0002);
  assert.deepEqual(d.opus, [9]);
});

test("encodes an entity body with the whisper flag and the uuid", () => {
  const d = decodeSpeakBody(
    encodeSpeakBody({
      mode: SPEAK_ENTITY,
      whisper: true,
      seq: 1,
      distance: 2,
      uuid: UUID,
      opus: new Uint8Array([3, 4, 5]),
    }),
  );
  assert.equal(d.whisper, true);
  assert.equal(d.uuid, UUID);
  assert.deepEqual(d.opus, [3, 4, 5]);
  assert.equal(uuidString(uuidBytes(UUID)), UUID);
  assert.throws(() => uuidBytes("nope"));
});
