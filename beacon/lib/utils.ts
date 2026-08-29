import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Tailwind class for the console/code font (see docs/design.md). */
export const mono = "font-[family-name:var(--font-console)]";

/** Tinted outline-badge palettes (border/background/text) shared by status-like badges. */
export const badgeTone = {
  blue: "border-blue-500/30 bg-blue-500/15 text-blue-500",
  emerald: "border-emerald-500/30 bg-emerald-500/15 text-emerald-500",
  amber: "border-amber-500/30 bg-amber-500/15 text-amber-500",
  muted: "bg-muted text-muted-foreground",
} as const;

/** Locale date, e.g. "Aug 29, 2026". Client-side only (locale differs from the server). */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
/** Locale date + time. Client-side only. */
export const formatDateTime = (iso: string) => new Date(iso).toLocaleString();

/** 3725 → "1h 2m"; under an hour → "5m". */
export const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};
