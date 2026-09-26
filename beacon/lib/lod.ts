/** Pure helpers for the Distant view section (ADR-025). */
import type { LodInfo, LodKey, LodPregen, LodPregenStatus, LodProvider } from "@/lib/api";

const count = new Intl.NumberFormat("en-US");

/** One line for a pre-generation: progress, LODs, speed and time left — or what state it is in. */
export function pregenSummary(s: LodPregenStatus): string {
  if (s.state === "resumed") return "Resumed after a restart";
  if (s.state === "unknown") return "Status not recognised";
  if (s.state === "done") return "Finished";
  if (s.state === "stopped") return "Stopped";
  if (s.target === 0) return "Starting…";
  const parts = [`${Number(s.progress.toFixed(1))}%`, `${count.format(s.done)} / ${count.format(s.target)}`];
  if (s.cps > 0) parts.push(`${Math.round(s.cps)} CPS`);
  if (s.remaining) parts.push(`${s.remaining} left`);
  return parts.join(" · ");
}

/** A radius in chunks, in blocks. */
export const radiusBlocks = (chunks: number) => chunks * 16;

/** The recorded pre-generation of a world, if any. */
export const pregenFor = (info: LodInfo, world: string): LodPregen | undefined =>
  (info.pregens ?? []).find((p) => p.world === world);

/** Bytes on disk across a provider's store paths. */
export const diskTotal = (p: LodProvider) => p.disk.reduce((n, d) => n + d.bytes, 0);

/** Bytes on disk across every installed provider's stores: what one backup would carry. */
export const lodDiskTotal = (info: LodInfo) =>
  info.providers.filter((p) => p.installed).reduce((n, p) => n + diskTotal(p), 0);

/** A form value checked against its key: the value to send, or why it cannot be. */
export function parseSetting(
  key: LodKey,
  input: string | boolean,
): { value?: number | boolean | string; error?: string } {
  if (key.type === "bool") return typeof input === "boolean" ? { value: input } : { error: "Choose on or off" };
  const text = String(input).trim();
  if (key.type === "enum") {
    return key.options?.includes(text) ? { value: text } : { error: `One of ${key.options?.join(", ")}` };
  }
  if (!/^-?\d+$/.test(text)) return { error: "A whole number" };
  const n = Number(text);
  if ((key.min !== undefined && n < key.min) || (key.max !== undefined && n > key.max)) {
    return { error: `Between ${key.min} and ${key.max}` };
  }
  return { value: n };
}
