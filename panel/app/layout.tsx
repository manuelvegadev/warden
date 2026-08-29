import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "mc-server-gui", description: "Panel de servidores Minecraft" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">{children}</body>
    </html>
  );
}
