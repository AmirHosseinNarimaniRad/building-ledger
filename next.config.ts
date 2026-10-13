import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents is off: nearly every page is per-user and reads the database at request
  // time, so prerendering buys nothing and would force Suspense around every session read.
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
