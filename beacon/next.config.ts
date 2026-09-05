import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal Docker image for Dokploy (ADR-007)
  output: "standalone",
  // Shared UI package is consumed as TypeScript source (see packages/ui/README.md).
  transpilePackages: ["@warden/ui"],
  outputFileTracingRoot: path.join(__dirname, ".."),
  // `next dev` only serves its assets to localhost. The origins Better Auth trusts for sign-in
  // (BETTER_AUTH_TRUSTED_ORIGINS=http://192.168.1.20:3000) are the ones a phone on the LAN uses.
  allowedDevOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((origin) => new URL(origin).hostname),
};

export default nextConfig;
