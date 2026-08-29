"use client";

import { useEffect, useRef } from "react";
import { SkinViewer, WalkingAnimation } from "skinview3d";

/** Rotating 3D model of the player's skin (skinview3d). One renderer; skin swaps reload the texture. */
export function SkinViewer3D({ skinUrl }: { skinUrl: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const viewer = useRef<SkinViewer | null>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const v = new SkinViewer({ canvas: canvas.current, width: 200, height: 260 });
    v.autoRotate = true;
    v.autoRotateSpeed = 0.6;
    v.animation = new WalkingAnimation();
    v.animation.speed = 0.6;
    v.zoom = 0.9;
    viewer.current = v;
    return () => {
      v.dispose();
      viewer.current = null;
    };
  }, []);
  useEffect(() => {
    viewer.current?.loadSkin(skinUrl).catch(() => {});
  }, [skinUrl]);
  return <canvas ref={canvas} className="mx-auto" />;
}
