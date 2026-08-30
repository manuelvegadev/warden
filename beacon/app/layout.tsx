import { Toaster } from "@warden/ui/components/sonner";
import { BRAND } from "@warden/ui/lib/brand";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Google_Sans_Code } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Console / log viewer font (open-source release of Google Sans Mono).
const consoleFont = Google_Sans_Code({ variable: "--font-console", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Beacon · Warden",
  description: "Minecraft server control panel",
  manifest: "/manifest.webmanifest",
  // iOS has no install prompt: with these, "Add to Home Screen" opens Beacon full screen.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Beacon" },
};

export const viewport: Viewport = { themeColor: BRAND.theme, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} ${consoleFont.variable}`}>
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
