import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Overridable so a verification build can run without clobbering a live dev server's output.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;
