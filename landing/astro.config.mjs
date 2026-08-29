import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Static site for GitHub Pages (docs/deploy.md §4). React is used only for the shared @warden/ui
// components and the two interactive islands (hero demo, install tabs); everything else ships as HTML.
export default defineConfig({
  site: "https://warden.manuelvega.dev",
  output: "static",
  integrations: [react()],
  // Keep fonts as separate files (unicode-range lets the browser skip what it does not need).
  vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0 } },
});
