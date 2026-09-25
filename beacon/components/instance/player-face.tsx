import { cn } from "@warden/ui/lib/utils";
import { User } from "lucide-react";
import { FallbackImage } from "@/components/fallback-image";
import { skins } from "@/lib/api";

/** Pixel-art head from the player's skin; falls back to an icon when Mojang has no skin for the name. */
export function PlayerFace({ name, className }: { name: string; className?: string }) {
  return <FallbackImage src={skins.face(name)} icon={User} className={className} rounded="rounded-sm" pixelated />;
}

/** How the panel names a player anywhere: the face, then the name. */
export function PlayerName({
  name,
  className,
  faceClassName = "size-4",
}: {
  name: string;
  className?: string;
  faceClassName?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 align-middle", className)}>
      <PlayerFace name={name} className={cn("shrink-0", faceClassName)} />
      <span className="truncate">{name}</span>
    </span>
  );
}
