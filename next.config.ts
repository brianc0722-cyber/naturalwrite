import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mammoth and unpdf are CommonJS-ish native-ish parsers. Bundling them into
  // the server build can break their internal dynamic requires, so let Node
  // resolve them at runtime instead.
  serverExternalPackages: ["mammoth", "unpdf"],

  async headers() {
    return [
      {
        // The service worker must never be served from the HTTP cache, or
        // browsers can pin an old worker for up to 24h and users stop
        // receiving updates. Revalidate on every request.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
