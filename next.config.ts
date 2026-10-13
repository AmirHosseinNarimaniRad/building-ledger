import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents is off: nearly every page is per-user and reads the database at request
  // time, so prerendering buys nothing and would force Suspense around every session read.
  experimental: {
    // Receipt photos: 10 MB files plus multipart overhead.
    serverActions: { bodySizeLimit: "11mb" },
  },
  logging: {
    // Resident links carry their token in the path; keep it out of the dev log.
    incomingRequests: { ignore: [/^\/r\//] },
  },
  async headers() {
    return [
      {
        source: "/r/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
        ],
      },
    ];
  },
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
