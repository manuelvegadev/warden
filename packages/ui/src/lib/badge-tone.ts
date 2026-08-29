/** Tinted outline-badge palettes (border / background / text), shared by status-like badges. */
export const badgeTone = {
  blue: "border-blue-500/30 bg-blue-500/15 text-blue-500",
  emerald: "border-emerald-500/30 bg-emerald-500/15 text-emerald-500",
  amber: "border-amber-500/30 bg-amber-500/15 text-amber-500",
  violet: "border-violet-500/30 bg-violet-500/15 text-violet-400",
  lime: "border-lime-500/30 bg-lime-500/15 text-lime-500",
  sky: "border-sky-500/30 bg-sky-500/15 text-sky-500",
  red: "border-red-500/30 bg-red-500/15 text-red-500",
  muted: "bg-muted text-muted-foreground",
} as const;

export type BadgeTone = keyof typeof badgeTone;
