import { User } from "lucide-react";
import { FallbackImage } from "@/components/fallback-image";
import { skins } from "@/lib/api";

/** Pixel-art head from the player's skin; falls back to an icon when Mojang has no skin for the name. */
export function PlayerFace({ name, className }: { name: string; className?: string }) {
  return <FallbackImage src={skins.face(name)} icon={User} className={className} rounded="rounded-sm" pixelated />;
}
