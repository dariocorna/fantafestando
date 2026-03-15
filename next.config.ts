import type { NextConfig } from "next";

function resolveAllowedDevOrigins(): string[] {
  const defaults = ["localhost", "127.0.0.1", "*.localhost"];
  const extra = (process.env.NEXT_ALLOWED_DEV_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set([...defaults, ...extra]));
}

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: resolveAllowedDevOrigins(),
  experimental: {
    serverActions: {
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
