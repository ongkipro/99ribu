import type { NextConfig } from "next";
import { realpathSync } from "node:fs";
import { assertLocalNextCommand } from "./src/config/local.ts";
import { assertProductionNextCommand, readRuntimeConfig } from "./src/config/runtime.ts";

// Also validate when Next is invoked directly, after its environment loading.
const config = readRuntimeConfig(process.env);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync("node_modules/next/dist/bin/next")) {
  const args = process.argv.slice(2);
  if (config.profile === "production") assertProductionNextCommand(args, config.port);
  else assertLocalNextCommand(args);
}

// lazy: next dev 16.4.1 strict route matching reports every /admin page as unmatched (it applies the
// (storefront)/@modal slot to the sibling admin tree) and serves 404; `next build`/`next start` validate the
// same tree strictly and pass. Loose matching for the dev server only; drop this when Next fixes dev matching.
const devServer = process.env.NODE_ENV === "development";

// Static CSP (no per-request nonce: anonymous catalog HTML is edge-cached for 60 s, so a nonce would be shared).
// Next's inline RSC bootstrap needs 'unsafe-inline' scripts without a nonce; the policy still blocks framing,
// plugins, base-tag hijack and cross-origin form posts. Cloudflare Web Analytics injects its beacon at the edge.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${devServer ? " 'unsafe-eval'" : ""} https://static.cloudflareinsights.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://cloudflareinsights.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(config.profile === "production" ? ["upgrade-insecure-requests"] : []),
].join("; ");
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
  ...(devServer ? { deprecated: { looseRouteMatching: true } } : {}),
  // Built-in image optimization for the content-addressed catalog photos only (resized webp; see
  // src/components/storefront/ui/media.tsx). Widths are the candidates the storefront's srcset uses.
  images: {
    localPatterns: [{ pathname: "/media/catalog/**", search: "" }],
    qualities: [60],
    imageSizes: [64, 96, 128, 256, 320, 384],
    deviceSizes: [640, 828, 1080, 1200, 1920],
  },
  // next dev refuses HMR/dev resources for an Origin other than localhost/127.0.0.1. Allow only the
  // opt-in tailnet IP. Server Actions need no entry: tailscale serve --tcp keeps Host equal to Origin.
  ...(config.tailnetOrigin ? { allowedDevOrigins: [new URL(config.tailnetOrigin).hostname] } : {}),
  // S82 audit: the S08 design prototypes under public/prototypes/ are local review material, never production
  // content. beforeFiles runs before public files are served, so the path resolves to the unmatched 404.
  ...(config.profile === "production" ? {
    rewrites: async () => ({ beforeFiles: [{ source: "/prototypes/:path*", destination: "/404" }], afterFiles: [], fallback: [] }),
  } : {}),
};

export default nextConfig;
