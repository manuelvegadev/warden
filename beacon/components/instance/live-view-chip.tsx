import { cn } from "@warden/ui/lib/utils";
import type { ComponentProps } from "react";

/**
 * The surface of every control over the live view's scene: the page background showing through,
 * blurred. On the outline buttons the dark theme's own tint wins; the chip states it so both match.
 */
export const OVERLAY = "bg-background/80 backdrop-blur dark:bg-input/30";

/**
 * A read-only label over the live view's scene, in the shape of the outline buttons beside it
 * (the players, "Join voice", the gear), so the overlay reads as one set of controls.
 */
export function Chip({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-sm font-medium whitespace-nowrap dark:border-input [&_svg]:size-4 [&_svg]:shrink-0",
        OVERLAY,
        className,
      )}
      {...props}
    />
  );
}
