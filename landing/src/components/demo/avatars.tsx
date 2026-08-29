/* Static stand-ins for Beacon's PlayerFace / PluginIcon: the real panel fetches skins through wardend
   (Mojang) and icons from Hangar / Modrinth; the landing ships a few downloaded copies in public/img. */

import { cn } from "@warden/ui/lib/utils";

/** Pixel-art head from the player's skin (64×64 PNG in public/img/players). */
export function PlayerFace({ name, className }: { name: string; className?: string }) {
  return (
    <img
      src={`/img/players/${name}.png`}
      alt=""
      width={64}
      height={64}
      className={cn("size-5 shrink-0 rounded-sm [image-rendering:pixelated]", className)}
    />
  );
}

/** Square plugin icon (public/img/plugins/<name>.webp). */
export function PluginIcon({ name, className }: { name: string; className?: string }) {
  return (
    <img
      src={`/img/plugins/${name.toLowerCase()}.webp`}
      alt=""
      width={96}
      height={96}
      className={cn("size-6 shrink-0 rounded-md", className)}
    />
  );
}
