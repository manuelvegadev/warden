import { BRAND } from "@warden/ui/lib/brand";
import type { MetadataRoute } from "next";

/** Web app manifest (served at /manifest.webmanifest): Beacon installs as a PWA (docs/design.md → Brand). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Beacon · Warden",
    short_name: "Beacon",
    start_url: "/",
    display: "standalone",
    background_color: BRAND.theme,
    theme_color: BRAND.theme,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
