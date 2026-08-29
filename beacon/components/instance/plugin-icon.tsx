import { Puzzle } from "lucide-react";
import { FallbackImage } from "@/components/fallback-image";

/** Square plugin icon with a placeholder when the project has none (or it failed to fetch). */
export function PluginIcon({ src, className }: { src?: string; className?: string }) {
  return <FallbackImage src={src} icon={Puzzle} className={className} />;
}
