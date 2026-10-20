import assert from "node:assert/strict";
import { readLocalConfig } from "../src/config/local.ts";

const [expected, ...extra] = process.argv.slice(2);
if (!["ready", "unavailable"].includes(expected) || extra.length) throw new Error("Use check-health.ts ready|unavailable.");
const { origin } = readLocalConfig(process.env);
const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(5000) });
assert.equal(response.status, expected === "ready" ? 200 : 503);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.deepEqual(await response.json(), { service: "99ribu", status: expected });
console.log(`readiness=${expected} status=${response.status}`);
