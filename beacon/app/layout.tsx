import type { Metadata } from "next";
import { Geist, Geist_Mono, Google_Sans_Code } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Console / log viewer font (open-source release of Google Sans Mono).
const consoleFont = Google_Sans_Code({ variable: "--font-console", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = { title: "Beacon · Warden", description: "Minecraft server control panel" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable} ${consoleFont.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
