/** Tailwind class for the console/code font (see docs/design.md). */
export const mono = "font-console";

/** Locale date, e.g. "Aug 29, 2026". Client-side only (locale differs from the server). */
export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
/** Locale date + time. Client-side only. */
export const formatDateTime = (iso: string) => new Date(iso).toLocaleString();

/** 3725 → "1h 2m"; under an hour → "5m" (or "5m 12s" with `withSeconds`, for live clocks). */
export const formatDuration = (seconds: number, withSeconds = false) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  return withSeconds ? `${m}m ${Math.floor(seconds % 60)}s` : `${m}m`;
};
