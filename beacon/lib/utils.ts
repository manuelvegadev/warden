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
