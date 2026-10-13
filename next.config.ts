import type { NextConfig } from "next";

// In development, let a phone on the same network load the app through APP_URL's host
// (e.g. http://192.168.1.107:3000). Next blocks dev assets for unlisted hosts otherwise.
const appHost = (() => {
  try {
    return new URL(process.env.APP_URL ?? "").hostname;
  } catch {
    return undefined;
  }
})();

const nextConfig: NextConfig = {
  // A self-contained server for the Docker image (see Dockerfile).
  output: "standalone",
  allowedDevOrigins: appHost && appHost !== "localhost" ? [appHost] : [],
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
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
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
