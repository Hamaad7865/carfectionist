import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenNext bundles the standalone server. It normally sets this itself when it runs the
  // Next build — but we run the build ourselves (`next build --webpack`, see package.json:
  // Turbopack's bracketed chunk names are unloadable in the Worker), so we must declare it.
  output: "standalone",
};

export default nextConfig;

// Cloudflare Workers (OpenNext) — makes getCloudflareContext() work in `next dev`.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
void initOpenNextCloudflareForDev();
