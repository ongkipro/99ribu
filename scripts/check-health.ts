import assert from "node:assert/strict";
import { readRuntimeConfig } from "../src/config/runtime.ts";

const [expected, ...extra] = process.argv.slice(2);
if (!["ready", "unavailable"].includes(expected) || extra.length) throw new Error("Use check-health.ts ready|unavailable.");
const config = readRuntimeConfig(process.env);
// Production probes its own listener inside the container; the public origin is the proxy's, not this process's.
const base = config.profile === "production" ? `http://127.0.0.1:${config.port}` : config.origin;
const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
assert.equal(response.status, expected === "ready" ? 200 : 503);
assert.equal(response.headers.get("cache-control"), "no-store");
assert.deepEqual(await response.json(), { service: "99ribu", status: expected });
console.log(`readiness=${expected} status=${response.status}`);
