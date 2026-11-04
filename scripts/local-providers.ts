import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readLocalConfig } from "../src/config/local.ts";

// DEC-028 / S167: the provider stand-in is AdsBookCMS's scripts/dev-providers.ts, run as its own process and never
// copied here. `check` proves the configured loopback origin answers the shapes 99ribu relies on.
export const START_COMMAND = "cd ~/Projects/adsbookcms && DEV_PROVIDERS_PORT=8788 npm run dev:providers";
const TIMEOUT_MS = 5000;

type Result = { name: string; ok: boolean; note: string };
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

// Only the validated loopback origin is ever requested; bodies are never printed (no key exists, keep the habit).
export async function checkStandIn(origin: string, fetchImpl: typeof fetch = fetch): Promise<Result[]> {
  const get = async (path: string, init: RequestInit = {}) => {
    const response = await fetchImpl(`${origin}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    try { return await response.json() as unknown; } catch { throw new Error("non-JSON answer"); }
  };
  const step = async (name: string, run: () => Promise<string>): Promise<Result> => {
    try { return { name, ok: true, note: await run() }; } catch (error) { return { name, ok: false, note: error instanceof Error ? error.message : "failed" }; }
  };
  const results = [
    await step("index", async () => { if (!isObject(await get("/"))) throw new Error("index is not an object"); return "answers"; }),
    await step("mengantar address/search", async () => {
      const body = await get("/api/public/local/address/search?keyword=jakarta");
      const rows = isObject(body) && Array.isArray(body.data) ? body.data : null;
      if (!rows?.length || !rows.every((row) => isObject(row) && typeof row._id === "string" && typeof row.DISTRICT_NAME === "string")) throw new Error("no rows with _id and DISTRICT_NAME");
      return `${rows.length} rows`;
    }),
    await step("mengantar order/estimate", async () => {
      const query = new URLSearchParams({ origin_id: "0".repeat(24), destination_id: "f".repeat(24), courier: "all", weight: "1.000" });
      const body = await get(`/api/public/local/order/estimate?${query}`);
      if (!isObject(body) || body.success !== true || !isObject(body.data)) throw new Error("not {success:true,data:{<courier>:...}}");
      const keys = Object.keys(body.data);
      if (!keys.length || !keys.every((key) => isObject((body.data as Record<string, unknown>)[key]) && typeof ((body.data as Record<string, Record<string, unknown>>)[key].price) === "number")) throw new Error("courier rows without a numeric price");
      return `couriers ${keys.join(",")}`;
    }),
    await step("autolaris list_payment", async () => {
      const body = await get("/api/h2h/list_payment", { headers: { authorization: "Bearer local", accept: "application/json" } });
      if (!isObject(body) || typeof body.rc !== "string" || !Array.isArray(body.data)) throw new Error("not an rc envelope with a data array");
      return `rc ${body.rc}, ${body.data.length} channels`;
    }),
  ];
  // create_payment is what 99ribu calls; the stand-in serves only /submit until S171 lands (owner gate). Reported, not hidden.
  const create = await step("autolaris create_payment", async () => {
    const response = await fetchImpl(`${origin}/api/h2h/create_payment`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: "Bearer local", "content-type": "application/json" }, body: JSON.stringify({ reff_id: `99RCHECK${Date.now()}`, channel_code: "VABCA", customer_id: "CHECK", customer_name: "Check", customer_phone: "081200000000", customer_email: "", expired: "20991231235959", amount: "10000", callback_url: "" }) });
    let body: unknown = null; try { body = await response.json(); } catch { /* reported below */ }
    if (!response.ok || !isObject(body) || !isObject(body.data) || typeof body.data.trx_id !== "string") throw new Error(`not served (HTTP ${response.status}); S171 pending`);
    return `trx_id ${String(body.data.trx_id).slice(0, 12)}`;
  });
  return [...results, { ...create, name: `${create.name} (gap until S171, not required)`, ok: true, note: create.ok ? create.note : `GAP: ${create.note}` }];
}

function standInHead() {
  try { return execFileSync("git", ["-C", join(homedir(), "Projects/adsbookcms"), "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

if (import.meta.main) {
  const [command, ...extra] = process.argv.slice(2);
  if (command !== "check" || extra.length) throw new Error("Use local-providers.ts check.");
  const origin = readLocalConfig(process.env).providerOrigin;
  if (!origin) {
    console.error(`LOCAL_PROVIDER_ORIGIN is not set. Start the stand-in (${START_COMMAND}) and run with LOCAL_PROVIDER_ORIGIN=http://127.0.0.1:8788.`);
    process.exit(1);
  }
  const results = await checkStandIn(origin);
  const head = standInHead();
  console.log(`stand-in ${origin}${head ? ` (adsbookcms HEAD ${head})` : ""}`);
  for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}: ${r.note}`);
  if (results.some((r) => !r.ok)) {
    console.error(`Stand-in check failed. Start it with: ${START_COMMAND}`);
    process.exit(1);
  }
}
