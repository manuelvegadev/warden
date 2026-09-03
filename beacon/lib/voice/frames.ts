/**
 * The binary frames of the voice socket (ADR-019 §2 and §3). wardend relays the agent's frames to
 * the browser untouched, so this is the agent's layout: little-endian, the first byte is the kind.
 */

/** A player's microphone frame, kind 2. */
export const FRAME_VOICE = 2;

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
