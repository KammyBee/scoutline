import type { NextConfig } from "next";

// Extra hostnames allowed to load the dev server, so it can be opened from a phone over Tailscale.
// Covers Tailscale IPs (100.x.y.z) and MagicDNS names (pc.tailnet.ts.net). Add any other name,
// such as a short MagicDNS name, to DEV_ORIGINS in .env.local (comma separated).
const devOrigins = [
  "100.*.*.*",
  "*.*.ts.net",
  ...(process.env.DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: devOrigins,
  // PGlite ships its own WebAssembly files; load it from node_modules instead of bundling it.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
