import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Tailwind class for the console/code font (see docs/design.md). */
export const mono = "font-[family-name:var(--font-console)]";
