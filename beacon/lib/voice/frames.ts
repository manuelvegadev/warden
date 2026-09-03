/**
 * The binary frames of the voice socket (ADR-019 §2 and §3). wardend relays the agent's frames to
 * the browser untouched, so this is the agent's layout: little-endian, the first byte is the kind.
 */

/** Opus as Simple Voice Chat carries it: mono, 48 kHz, one 20 ms packet per frame. */
export const OPUS_RATE = 48_000;
export const PACKET_US = 20_000;

/** A player's microphone frame, kind 2. */
export const FRAME_VOICE = 2;
/** The admin's voice towards the server, kind 3; the browser sends the body behind a bare kind byte. */
export const FRAME_SPEAK = 3;

/** Where a speak frame plays: everyone, a point in a world, or attached to a player. */
export const SPEAK_STATIC = 0;
export const SPEAK_LOCATIONAL = 1;
export const SPEAK_ENTITY = 2;
export type SpeakMode = typeof SPEAK_STATIC | typeof SPEAK_LOCATIONAL | typeof SPEAK_ENTITY;

const FLAG_WHISPER = 1;
const FLAG_GROUP = 2;

/** `u8 kind=2 · u8 flags · 16 bytes UUID · u64 seq · opus` — the header before the Opus payload. */
const VOICE_HEADER = 1 + 1 + 16 + 8;

export interface VoiceFrame {
  /** The player was whispering: the game plays it within the whisper distance only. */
  whisper: boolean;
  /** The player was in a group: the game plays it to the group regardless of distance. */
  group: boolean;
  /** The speaking player's UUID, canonical lower-case hex with dashes (matches `PlayerPos.uuid`). */
  speaker: string;
  /** The player's packet sequence number; gaps are lost packets. */
  seq: number;
  /** One Opus packet: mono, 48 kHz, 20 ms. */
  opus: Uint8Array;
}

/** Parses a kind-2 frame; throws on any other kind or a short buffer. */
export function parseVoiceFrame(buf: ArrayBuffer): VoiceFrame {
  const bytes = new Uint8Array(buf);
  if (bytes.length < VOICE_HEADER) throw new Error(`voice frame too short (${bytes.length} bytes)`);
  if (bytes[0] !== FRAME_VOICE) throw new Error(`not a voice frame (kind ${bytes[0]})`);
  const flags = bytes[1];
  const view = new DataView(buf);
  const seq = Number(view.getBigUint64(18, true));
  return {
    whisper: (flags & FLAG_WHISPER) !== 0,
    group: (flags & FLAG_GROUP) !== 0,
    speaker: uuidString(bytes.subarray(2, 18)),
    seq,
    opus: bytes.subarray(VOICE_HEADER),
  };
}

const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** The canonical text form of a 16-byte UUID in RFC 4122 byte order. */
export function uuidString(b: Uint8Array): string {
  if (b.length !== 16) throw new Error(`uuid needs 16 bytes, got ${b.length}`);
  let s = "";
  for (let i = 0; i < 16; i++) {
    if (i === 4 || i === 6 || i === 8 || i === 10) s += "-";
    s += HEX[b[i]];
  }
  return s;
}

export interface SpeakBody {
  mode: SpeakMode;
  /** Entity channels whisper: only the player they are attached to (and anyone hugging them) hears. */
  whisper: boolean;
  seq: number;
  /** Blocks until the voice falls silent; ignored for static. */
  distance: number;
  /** Locational: the world and the point. */
  world?: string;
  x?: number;
  y?: number;
  z?: number;
  /** Entity: the player's UUID. */
  uuid?: string;
  opus: Uint8Array;
}

const TEXT = new TextEncoder();

/**
 * `u8 3 · u8 mode · u8 flags (1 whisper) · u64 seq · f32 distance · mode-specific · opus`, little-endian;
 * locational adds `u8 worldLen · world · f64 x · f64 y · f64 z`, entity adds the 16-byte UUID.
 */
export function encodeSpeakBody(b: SpeakBody): ArrayBuffer {
  const world = b.mode === SPEAK_LOCATIONAL ? TEXT.encode(b.world ?? "") : null;
  if (world && world.length > 255) throw new Error("world name too long");
  const extra = world ? 1 + world.length + 24 : b.mode === SPEAK_ENTITY ? 16 : 0;
  const bytes = new Uint8Array(1 + 1 + 1 + 8 + 4 + extra + b.opus.length);
  const view = new DataView(bytes.buffer);
  bytes[0] = FRAME_SPEAK;
  bytes[1] = b.mode;
  bytes[2] = b.whisper ? FLAG_WHISPER : 0;
  view.setBigUint64(3, BigInt(b.seq), true);
  view.setFloat32(11, b.distance, true);
  let p = 15;
  if (world) {
    bytes[p++] = world.length;
    bytes.set(world, p);
    p += world.length;
    view.setFloat64(p, b.x ?? 0, true);
    view.setFloat64(p + 8, b.y ?? 0, true);
    view.setFloat64(p + 16, b.z ?? 0, true);
    p += 24;
  } else if (b.mode === SPEAK_ENTITY) {
    bytes.set(uuidBytes(b.uuid ?? ""), p);
    p += 16;
  }
  bytes.set(b.opus, p);
  return bytes.buffer;
}

/** The 16 bytes of a canonical UUID string, RFC 4122 order. */
export function uuidBytes(s: string): Uint8Array {
  const hex = s.replace(/-/g, "");
  if (hex.length !== 32) throw new Error(`not a uuid: ${s}`);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
