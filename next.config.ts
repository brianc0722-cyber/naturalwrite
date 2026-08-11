import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // mammoth and unpdf are CommonJS-ish native-ish parsers. Bundling them into
  // the server build can break their internal dynamic requires, so let Node
  // resolve them at runtime instead.
  serverExternalPackages: ["mammoth", "unpdf"],
};

export default nextConfig;
