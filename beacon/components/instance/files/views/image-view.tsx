"use client";

import { Badge } from "@warden/ui/components/badge";
import { Button } from "@warden/ui/components/button";
import { badgeTone } from "@warden/ui/lib/badge-tone";
import { cn } from "@warden/ui/lib/utils";
import { ImageUp, PersonStanding } from "lucide-react";
import dynamic from "next/dynamic";
import { useState, type WheelEvent } from "react";
import { toast } from "sonner";
import { instances } from "@/lib/api";

// three.js is heavy: the 3D skin only loads when asked for.
const SkinViewer3D = dynamic(() => import("@/components/instance/skin-viewer").then((m) => m.SkinViewer3D), {
  ssr: false,
});

const ZOOMS = [1, 2, 4, 8, 16] as const;
type Zoom = "fit" | (typeof ZOOMS)[number];
/** At or under this size an image is pixel art (a texture, an icon, a skin): drawn with hard pixels. */
const PIXEL_ART = 256;

// A checkerboard behind the image, so transparent pixels read as transparent.
const checkerboard = {
  backgroundImage: "repeating-conic-gradient(var(--muted) 0% 25%, transparent 0% 50%)",
  backgroundSize: "16px 16px",
};

/**
 * An image as a texture editor would show it (ADR-020): on a checkerboard, fitted or at whole-number
 * zooms (ctrl + wheel steps through them), with its size in pixels; pixel art stays sharp. A
 * 64×64 PNG can become the server's icon, and a 64×64 or 64×32 one can be looked at as a skin.
 */
export function ImageView({
  id,
  path,
  src,
  name,
  canManage,
}: {
  id: string;
  path: string;
  src: string;
  name: string;
  canManage: boolean;
}) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [asSkin, setAsSkin] = useState(false);
  const png = /\.png$/i.test(name);
  const isIcon = path === "server-icon.png";
  const iconSized = size?.w === 64 && size?.h === 64;
  const skinSized = size?.w === 64 && (size?.h === 64 || size?.h === 32);
  const pixelated = size !== null && (zoom !== "fit" ? zoom > 1 : Math.max(size.w, size.h) <= PIXEL_ART);

  const step = (dir: 1 | -1) =>
    setZoom((z) => {
      const i = z === "fit" ? (dir > 0 ? -1 : 0) : ZOOMS.indexOf(z);
      const next = i + dir;
      return next < 0 ? "fit" : ZOOMS[Math.min(next, ZOOMS.length - 1)];
    });
  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    step(e.deltaY < 0 ? 1 : -1);
  };

  const useAsIcon = async () => {
    try {
      const blob = await (await fetch(src)).blob();
      await instances.setServerIcon(id, blob);
      toast.success("Server icon set — the server list shows it after a restart");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set the icon");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2 text-xs">
        <span className="text-muted-foreground tabular-nums">{size ? `${size.w} × ${size.h} px` : "…"}</span>
        {isIcon && size && (
          <Badge variant="outline" className={iconSized ? badgeTone.emerald : badgeTone.amber}>
            {iconSized ? "server icon, 64 × 64" : "a server icon must be 64 × 64"}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-1">
          {png && skinSized && !isIcon && (
            <Button
              size="sm"
              variant={asSkin ? "secondary" : "ghost"}
              className="h-7"
              onClick={() => setAsSkin((s) => !s)}
            >
              <PersonStanding /> Skin
            </Button>
          )}
          {png && iconSized && !isIcon && canManage && (
            <Button size="sm" variant="ghost" className="h-7" onClick={useAsIcon}>
              <ImageUp /> Use as server icon
            </Button>
          )}
          <fieldset className="flex rounded-md border p-0.5">
            <legend className="sr-only">Zoom</legend>
            {(["fit", ...ZOOMS] as Zoom[]).map((z) => (
              <Button
                key={z}
                size="sm"
                variant={z === zoom ? "secondary" : "ghost"}
                className="h-6 px-2 text-xs"
                aria-pressed={z === zoom}
                onClick={() => setZoom(z)}
              >
                {z === "fit" ? "Fit" : `${z}×`}
              </Button>
            ))}
          </fieldset>
        </div>
      </div>
      {asSkin ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <SkinViewer3D skinUrl={src} />
        </div>
      ) : (
        <div
          className={cn("flex min-h-0 flex-1 overflow-auto p-4", zoom === "fit" && "items-center justify-center")}
          onWheel={onWheel}
        >
          {/* biome-ignore lint/performance/noImgElement: a file served by the daemon, not a static asset */}
          <img
            src={src}
            alt={name}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className={cn(
              "m-auto shrink-0",
              zoom === "fit" && "max-h-full max-w-full",
              pixelated && "[image-rendering:pixelated]",
            )}
            style={{
              ...checkerboard,
              ...(zoom === "fit"
                ? // A tiny picture fitted is still drawn at least a few times its size.
                  size && Math.max(size.w, size.h) <= 64 && { width: size.w * 4, height: size.h * 4 }
                : size && { width: size.w * zoom, height: size.h * zoom }),
            }}
          />
        </div>
      )}
    </div>
  );
}
