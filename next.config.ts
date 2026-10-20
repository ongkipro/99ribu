import type { NextConfig } from "next";
import { realpathSync } from "node:fs";
import { assertLocalNextCommand, readLocalConfig } from "./src/config/local.ts";

// Also validate when Next is invoked directly, after its environment loading.
readLocalConfig(process.env);
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync("node_modules/next/dist/bin/next")) {
  assertLocalNextCommand(process.argv.slice(2));
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
};

export default nextConfig;
