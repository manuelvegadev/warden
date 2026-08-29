import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Imagen Docker mínima para Dokploy (ADR-007)
  output: "standalone",
};

export default nextConfig;
