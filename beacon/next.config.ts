import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal Docker image for Dokploy (ADR-007)
  output: "standalone",
};

export default nextConfig;
