/** Tailwind class for the console/code font (see docs/design.md). */
export const mono = "font-console";

/** Locale date, e.g. "Aug 29, 2026". Client-side only (locale differs from the server). */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
/** Locale date + time. Client-side only. */
export const formatDateTime = (iso: string) => new Date(iso).toLocaleString();
/** The time alone when it was today, else a short date with it: "6:25 PM", "Sep 24, 6:25 PM". Client-side only. */
export const formatWhen = (when: string | number) => {
  const d = new Date(when);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date().toDateString()) return time;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
};

/** 3725 → "1h 2m"; under an hour → "5m" (or "5m 12s" with `withSeconds`, for live clocks). */
export const formatDuration = (seconds: number, withSeconds = false) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return withSeconds ? `${m}m ${Math.floor(seconds % 60)}s` : `${m}m`;
};
