import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertLocalNextCommand, readLocalConfig } from "../src/config/local.ts";
import { assertOrigin, requestOrigin } from "../src/modules/access/http.ts";
import { AccessError } from "../src/modules/access/policy.ts";

const local = parseEnv(readFileSync(new URL("../.env.example", import.meta.url), "utf8"));

test("the Next command boundary refuses default, remote and duplicate listener arguments", () => {
  for (const args of [[], ["start"], ["dev"], ["start", "--hostname", "0.0.0.0", "--port", "3099"], ["start", "--hostname", "127.0.0.1", "--port", "3099", "--port", "3000"]]) {
    assert.throws(() => assertLocalNextCommand(args), /fixed local listener/);
  }
  for (const mode of ["dev", "start"]) {
    assert.doesNotThrow(() => assertLocalNextCommand([mode, "--hostname", "127.0.0.1", "--port", "3099"]));
  }
});

test("local profile also supports a production-mode localhost build", () => {
  const config = readLocalConfig({ ...local, NODE_ENV: "production" });
  assert.equal(config.origin, "http://127.0.0.1:3099");
  assert.equal(config.hostname, "127.0.0.1");
});

const invalidProfiles = [
  ["missing environment", { APP_ENV: undefined }],
  ["live environment", { APP_ENV: "production" }],
  ["remote origin", { APP_ORIGIN: "https://99ribu.com" }],
  ["mixed localhost alias", { APP_ORIGIN: "http://localhost:3099" }],
  ["all-interface origin", { APP_ORIGIN: "http://0.0.0.0:3099" }],
  ["missing payment mode", { PAYMENT_ADAPTER: undefined }],
  ["live shipping", { SHIPPING_ADAPTER: "live" }],
  ["live advertising", { ADS_ADAPTER: "live" }],
  ["real notifications", { NOTIFICATION_ADAPTER: "smtp" }],
  ["real payout", { PAYOUT_ADAPTER: "live" }],
  ["external dispatch", { EXTERNAL_DISPATCH: "enabled" }],
  ["mismatched auth origin", { BETTER_AUTH_URL: "https://example.com" }],
  ["inherited auth material", { BETTER_AUTH_SECRET: "synthetic-sentinel-never-log" }],
  ["inherited auth allowlist", { BETTER_AUTH_TRUSTED_ORIGINS: "https://example.com" }],
  ["provider credentials", { VIRGO_API_KEY: "synthetic-sentinel-never-log" }],
  ["browser pixel", { NEXT_PUBLIC_META_PIXEL_ID: "synthetic-sentinel-never-log" }],
  ["remote database", { DATABASE_URL: "postgresql://127.0.0.1.evil.invalid:5499/99ribu_local" }],
  ["other local database", { DATABASE_URL: "postgresql://127.0.0.1:5499/other_project" }],
  ["default database port", { DATABASE_URL: "postgresql://127.0.0.1:5432/99ribu_local" }],
  ["database host override", { DATABASE_URL: "postgresql://127.0.0.1:5499/99ribu_local?host=example.com" }],
  ["malformed database URL", { DATABASE_URL: "synthetic-sentinel-never-log" }],
] as const;

for (const [label, change] of invalidProfiles) {
  test(`rejects ${label} without exposing configured values`, () => {
    assert.throws(() => readLocalConfig({ ...local, ...change }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("synthetic-sentinel"));
      return true;
    });
  });
}

test("database URL overrides are refused even for loopback databases", () => {
  for (const name of ["99ribu_local", "99ribu_test"]) {
    assert.throws(() => readLocalConfig({ ...local, DATABASE_URL: `postgresql://127.0.0.1:5499/${name}` }), /private local socket/);
  }
});

// Opt-in tailnet origin (LOCAL_TAILNET_ORIGIN): absent by default, strict when present.
const tailnet = "http://100.127.67.86:3099";

test("without LOCAL_TAILNET_ORIGIN the profile serves exactly the loopback origin", () => {
  for (const value of [undefined, ""]) {
    const config = readLocalConfig({ ...local, LOCAL_TAILNET_ORIGIN: value });
    assert.equal(config.tailnetOrigin, null);
    assert.deepEqual(config.trustedOrigins, ["http://127.0.0.1:3099"]);
  }
});

test("a Tailscale CGNAT IPv4 origin on the fixed port is accepted as the only second origin", () => {
  for (const value of [tailnet, "http://100.64.0.1:3099", "http://100.127.255.254:3099"]) {
    const config = readLocalConfig({ ...local, LOCAL_TAILNET_ORIGIN: value });
    assert.equal(config.tailnetOrigin, value);
    assert.deepEqual(config.trustedOrigins, ["http://127.0.0.1:3099", value]);
    assert.equal(config.hostname, "127.0.0.1", "the listener never moves off loopback");
  }
});

test("malformed tailnet origins are refused without echoing the value", () => {
  for (const value of [
    "https://100.127.67.86:3099", "http://100.127.67.86", "http://100.127.67.86:3000", "http://100.127.67.86:3099/",
    "http://100.127.67.86:3099/path", "http://100.127.67.86:3099?x=1", "http://100.127.67.86:3099#x", "http://user:pw@100.127.67.86:3099",
    "http://rich.tail915080.ts.net:3099", "https://rich.tail915080.ts.net:8443", "http://*.ts.net:3099", "*", "http://0.0.0.0:3099",
    "http://127.0.0.1:3099", "http://10.0.0.1:3099", "http://100.63.255.255:3099", "http://100.128.0.1:3099", "http://101.64.0.1:3099",
    "http://100.064.1.1:3099", "http://100.127.67.256:3099", "http://100.127.67:3099", "http://[fd7a:115c:a1e0::1]:3099",
    "HTTP://100.127.67.86:3099", " http://100.127.67.86:3099", "http://100.127.67.86:3099 ", "http://100.127.67.86:3099,http://evil.invalid",
  ]) {
    assert.throws(() => readLocalConfig({ ...local, LOCAL_TAILNET_ORIGIN: value }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /LOCAL_TAILNET_ORIGIN must be/);
      assert.ok(!error.message.includes(value.trim()) || value.trim() === "*", `value echoed for ${value}`);
      return true;
    }, value);
  }
});

const loopback = "http://127.0.0.1:3099";
function browserRequest(host: string | null, origin: string | null, method = "POST", url = `${loopback}/api/v1/carts`) {
  const headers = new Headers();
  if (host !== null) headers.set("host", host);
  if (origin !== null) headers.set("origin", origin);
  return new Request(url, { method, headers });
}
function withTailnet<T>(value: string | undefined, run: () => T) {
  const saved = { ...process.env };
  Object.assign(process.env, local);
  if (value === undefined) delete process.env.LOCAL_TAILNET_ORIGIN; else process.env.LOCAL_TAILNET_ORIGIN = value;
  try { return run(); } finally { process.env = saved; }
}
const refused = (request: Request) => assert.throws(() => assertOrigin(request), (error: unknown) => error instanceof AccessError && error.status === 403 && error.code === "INVALID_ORIGIN");

test("default profile: loopback mutations pass and a tailnet Host/Origin is refused", () => withTailnet(undefined, () => {
  assert.equal(assertOrigin(browserRequest("127.0.0.1:3099", loopback)), loopback);
  assert.equal(assertOrigin(browserRequest(null, loopback)), loopback);
  assert.equal(assertOrigin(browserRequest("127.0.0.1:3099", loopback, "POST", "http://localhost:3099/api/v1/carts")), loopback, "NextURL normalization");
  refused(browserRequest("100.127.67.86:3099", tailnet));
  refused(browserRequest("127.0.0.1:3099", tailnet));
  refused(browserRequest("localhost:3099", "http://localhost:3099", "POST", "http://localhost:3099/api/v1/carts"));
  assert.equal(requestOrigin(browserRequest("100.127.67.86:3099", null, "GET")), null);
}));

test("opt-in tailnet: exactly the configured Host+Origin pair is accepted; every other origin is refused", () => withTailnet(tailnet, () => {
  // tailscale serve --tcp forwards bytes unchanged: Next sees Host 100.x:3099 while request.url is its own loopback listener.
  assert.equal(assertOrigin(browserRequest("100.127.67.86:3099", tailnet)), tailnet);
  assert.equal(assertOrigin(browserRequest("100.127.67.86:3099", tailnet, "POST", "http://localhost:3099/api/v1/carts")), tailnet);
  assert.equal(assertOrigin(browserRequest("100.127.67.86:3099", null, "GET")), tailnet);
  assert.equal(assertOrigin(browserRequest("127.0.0.1:3099", loopback)), loopback, "loopback is unchanged");
  for (const origin of ["http://100.127.67.87:3099", "https://100.127.67.86:3099", "http://100.127.67.86:3000", loopback, "http://localhost:3099", "null", ""]) {
    refused(browserRequest("100.127.67.86:3099", origin));
  }
  refused(browserRequest("127.0.0.1:3099", tailnet));
  for (const host of ["100.127.67.87:3099", "100.127.67.86", "100.127.67.86:3000", "rich.tail915080.ts.net:3099", "evil.invalid:3099", "localhost:3099"]) {
    refused(browserRequest(host, `http://${host}`));
    refused(browserRequest(host, tailnet));
  }
  refused(browserRequest(null, tailnet, "POST", `${tailnet}/api/v1/carts`));
  refused(browserRequest("100.127.67.86:3099", tailnet, "POST", `${tailnet}/api/v1/carts`));
  refused(browserRequest("100.127.67.86:3099", tailnet, "POST", "https://localhost:3099/api/v1/carts"));
}));

test("next dev allows dev resources only for the configured tailnet IP", async () => {
  const load = async (value: string | undefined) => {
    const saved = { ...process.env };
    Object.assign(process.env, local);
    if (value === undefined) delete process.env.LOCAL_TAILNET_ORIGIN; else process.env.LOCAL_TAILNET_ORIGIN = value;
    try { return (await import(`../next.config.ts?tailnet=${value ?? "unset"}`)).default; } finally { process.env = saved; }
  };
  assert.equal((await load(undefined)).allowedDevOrigins, undefined);
  assert.deepEqual((await load(tailnet)).allowedDevOrigins, ["100.127.67.86"]);
  assert.equal((await load(tailnet)).experimental, undefined, "Server Actions keep Next's own Origin==Host rule; no extra allowedOrigins");
});
