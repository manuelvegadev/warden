import { Toaster } from "@warden/ui/components/sonner";
import { BRAND } from "@warden/ui/lib/brand";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Google_Sans_Code } from "next/font/google";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Console / log viewer font (open-source release of Google Sans Mono).
const consoleFont = Google_Sans_Code({ variable: "--font-console", subsets: ["latin"], weight: ["400", "500"] });
// The game's own typeface, for the MOTD editor and the multiplayer-list preview only. Its metrics
// are the point, not just its look — see app/fonts/README.md.
const minecraftFont = localFont({
  variable: "--font-minecraft",
  display: "block", // a fallback face here would misreport every line width
  preload: false, // only the Properties tab renders it; every other route would pay for the link
  src: [
    { path: "./fonts/MinecraftDefault-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/MinecraftDefault-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/MinecraftDefault-Italic.woff2", weight: "400", style: "italic" },
    { path: "./fonts/MinecraftDefault-BoldItalic.woff2", weight: "700", style: "italic" },
  ],
});

export const metadata: Metadata = {
  title: "Beacon · Warden",
  description: "Minecraft server control panel",
  manifest: "/manifest.webmanifest",
  // iOS has no install prompt: with these, "Add to Home Screen" opens Beacon full screen.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Beacon" },
};

// Safari (15+, macOS and iOS) tints the browser chrome around the address bar with this; Chrome
// uses it for the address bar on Android and for an installed PWA's title bar, and ignores it in a
// desktop tab. The breakpoint is the one at which the sidebar hides (packages/ui use-mobile.ts), so
// the chrome matches whatever is actually behind it: the shell on desktop, the app surface on a
// phone. First match wins, so the wide rule comes first.
export const viewport: Viewport = {
  themeColor: [
    { media: "(min-width: 768px)", color: BRAND.shell },
    { media: "(max-width: 767px)", color: BRAND.theme },
  ],
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} ${consoleFont.variable} ${minecraftFont.variable}`}
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
        <Toaster />
        {/* Registers public/sw.js so browsers offer to install Beacon; a nicety, hence production only. */}
        {process.env.NODE_ENV === "production" && (
          <Script id="sw">{`navigator.serviceWorker?.register("/sw.js").catch(() => {});`}</Script>
        )}
      </body>
    </html>
  );
}
