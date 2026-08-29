import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal Docker image for Dokploy (ADR-007)
  output: "standalone",
  // Shared UI package is consumed as TypeScript source (see packages/ui/README.md).
  transpilePackages: ["@warden/ui"],
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
