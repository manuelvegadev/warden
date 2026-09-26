// Pure helpers for the file manager's audio player.

/**
 * The loudest sample in each of `bars` equal slices of a channel, from 0 to 1: the waveform the
 * player draws. Slices of a clip shorter than `bars` samples are single samples.
 */
export function peaks(samples: ArrayLike<number>, bars: number): number[] {
  if (samples.length === 0 || bars <= 0) return [];
  const per = samples.length / bars;
  const out: number[] = [];
  for (let b = 0; b < bars; b++) {
    const from = Math.floor(b * per);
    const to = Math.max(from + 1, Math.floor((b + 1) * per));
    let peak = 0;
    for (let i = from; i < to && i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    out.push(Math.min(peak, 1));
  }
  return out;
}

/** The bars scaled so the loudest fills the height: a quiet sound still shows its shape. */
export function normalize(bars: number[]): number[] {
  const top = Math.max(...bars, 0);
  return top > 0 ? bars.map((b) => b / top) : bars;
}

/** 0:07, 3:25, 1:02:03. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
