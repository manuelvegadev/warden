import { Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Square plugin icon with a placeholder when the project has none (or it failed to fetch). */
export function PluginIcon({ src, className }: { src?: string; className?: string }) {
  if (!src) {
    return (
      <div className={cn("flex aspect-square shrink-0 items-center justify-center rounded-md bg-muted", className)}>
        <Puzzle className="size-1/2 text-muted-foreground" aria-hidden />
      </div>
    );
  }
  // biome-ignore lint/performance/noImgElement: icons come from arbitrary CDNs and the BFF; next/image needs a host allowlist
  return <img src={src} alt="" className={cn("aspect-square shrink-0 rounded-md bg-muted object-cover", className)} />;
}
