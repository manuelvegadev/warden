import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Tailwind-aware class joiner used by every shadcn component. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
