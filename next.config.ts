import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  env: {
    CLERK_DISABLE_AUTO_PROXY: "true",
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

