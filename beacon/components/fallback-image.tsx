"use client";

import { cn } from "@warden/ui/lib/utils";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

/** Square image with an icon placeholder when there is no source or it fails to load. */
export function FallbackImage({
  src,
  icon: Icon,
  className,
  rounded = "rounded-md",
  pixelated,
}: {
  src?: string;
  icon: LucideIcon;
  className?: string;
  rounded?: string;
  pixelated?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className={cn("flex shrink-0 items-center justify-center bg-muted", rounded, className)}>
        <Icon className="size-1/2 text-muted-foreground" aria-hidden />
      </div>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: arbitrary hosts / BFF images; next/image needs an allowlist
    <img
      src={src}
      alt=""
      onError={() => setFailed(true)}
      className={cn("shrink-0 bg-muted object-cover", rounded, className)}
      style={pixelated ? { imageRendering: "pixelated" } : undefined}
    />
  );
}
