import type { NextConfig } from "next";
import { realpathSync } from "node:fs";
import { assertLocalNextCommand, readLocalConfig } from "./src/config/local.ts";

// Also validate when Next is invoked directly, after its environment loading.
const { tailnetOrigin } = readLocalConfig(process.env);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync("node_modules/next/dist/bin/next")) {
  assertLocalNextCommand(process.argv.slice(2));
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Built-in image optimization for the content-addressed catalog photos only (resized webp; see
  // src/components/storefront/media.ts). Widths are the candidates the storefront's srcset uses.
  images: {
    localPatterns: [{ pathname: "/media/catalog/**", search: "" }],
    qualities: [60],
    imageSizes: [64, 96, 128, 256, 320, 384],
    deviceSizes: [640, 828, 1080, 1200, 1920],
  },
  // next dev refuses HMR/dev resources for an Origin other than localhost/127.0.0.1. Allow only the
  // opt-in tailnet IP. Server Actions need no entry: tailscale serve --tcp keeps Host equal to Origin.
  ...(tailnetOrigin ? { allowedDevOrigins: [new URL(tailnetOrigin).hostname] } : {}),
};

export default nextConfig;
