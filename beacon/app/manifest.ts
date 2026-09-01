import { BRAND } from "@warden/ui/lib/brand";
import type { MetadataRoute } from "next";

/** Web app manifest (served at /manifest.webmanifest): Beacon installs as a PWA (docs/design.md → Brand). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Beacon · Warden",
    short_name: "Beacon",
    start_url: "/",
    display: "standalone",
    // An installed Beacon is overwhelmingly a phone, where the shell is hidden, so both the splash
    // screen and the launch chrome use the app surface rather than the shell grey.
    background_color: BRAND.theme,
    theme_color: BRAND.theme,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
