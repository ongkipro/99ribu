import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";
import { checkStandIn } from "../scripts/local-providers.ts";

// S167: the check against an in-test server shaped like the AdsBookCMS stand-in (no real stand-in needed here; S169 runs it).
type Route = (path: string) => { status: number; body: string } | undefined;
async function serve(route: Route) {
  const server = createServer((request, response) => {
    const r = route(new URL(request.url ?? "/", "http://x").pathname) ?? { status: 404, body: '{"error":"not found"}' };
    response.writeHead(r.status, { "content-type": "application/json" }); response.end(r.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { origin: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
const good: Route = (path) => ({
  "/": { status: 200, body: '{"name":"AdsBookCMS dev providers"}' },
  "/api/public/local/address/search": { status: 200, body: '{"success":true,"data":[{"_id":"dev-area-1","DISTRICT_NAME":"Tebet"}]}' },
  "/api/public/local/order/estimate": { status: 200, body: '{"success":true,"data":{"JNE":{"price":12000},"SiCepat":{"price":10500}}}' },
  "/api/h2h/list_payment": { status: 200, body: '{"rc":"00","ket":"SUCCESS","data":[{"channel_code":"VABCA"}]}' },
} as Record<string, { status: number; body: string }>)[path];

test("check passes on the stand-in shapes and reports create_payment as a gap until S171", async () => {
  const s = await serve(good);
  try {
    const results = await checkStandIn(s.origin);
    assert.ok(results.every((r) => r.ok), JSON.stringify(results));
    assert.match(results.at(-1)?.note ?? "", /^GAP: not served \(HTTP 404\); S171 pending$/);
  } finally { await s.close(); }
});

test("check fails on a missing estimate key, a non-JSON answer and a 5xx", async () => {
  for (const [path, reply] of [
    ["/api/public/local/order/estimate", { status: 200, body: '{"success":true,"data":{}}' }],
    ["/api/public/local/address/search", { status: 200, body: "not json" }],
    ["/api/h2h/list_payment", { status: 503, body: "{}" }],
  ] as const) {
    const s = await serve((p) => (p === path ? reply : good(p)));
    try {
      const failed = (await checkStandIn(s.origin)).filter((r) => !r.ok);
      assert.equal(failed.length, 1, path);
    } finally { await s.close(); }
  }
});

test("check fails when nothing listens, and the command refuses a missing or non-loopback origin", async () => {
  const s = await serve(good); const origin = s.origin; await s.close();
  assert.ok((await checkStandIn(origin)).filter((r) => !r.ok).length >= 4, "down stand-in fails every required step");
  const run = (value: string | undefined) => spawnSync(process.execPath, ["--env-file=.env.example", "scripts/local-providers.ts", "check"],
    { encoding: "utf8", env: { ...process.env, LOCAL_PROVIDER_ORIGIN: value ?? "" } });
  const unset = run(undefined);
  assert.equal(unset.status, 1);
  assert.match(unset.stderr, /DEV_PROVIDERS_PORT=8788 npm run dev:providers/);
  const remote = run("http://localhost:8788");
  assert.notEqual(remote.status, 0);
  assert.match(remote.stderr, /LOCAL_PROVIDER_ORIGIN must be/);
  const down = run(origin);
  assert.equal(down.status, 1);
  assert.match(down.stderr, /Start it with: cd ~\/Projects\/adsbookcms/);
});
