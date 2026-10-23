import { readLocalConfig } from "./local.ts";

type Environment = Record<string, string | undefined>;

// Profile-neutral public-site settings for metadata, robots.txt and sitemap.xml.
// SITE_INDEXING is the single site-wide indexing switch (docs: README "Search indexing"):
// unset or "index" = public catalog routes are indexable (owner decision 2026-10-23, every profile,
// including the S82 production profile); "noindex" = every page noindex and robots.txt Disallow: /
// (use it on a rehearsal/staging host). Any other value throws instead of guessing.
// lazy: only the local profile reader exists today; S82 swaps in the production reader for the origin.
export function siteConfig(env: Environment = process.env) {
  const { origin } = readLocalConfig(env);
  const mode = env.SITE_INDEXING ?? "index";
  if (mode !== "index" && mode !== "noindex") throw new Error("SITE_INDEXING must be index or noindex.");
  return Object.freeze({ origin, indexing: mode === "index" });
}
export type SiteConfig = ReturnType<typeof siteConfig>;
