import assert from "node:assert/strict";
import { parseEnv } from "node:util";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { assertLocalNextCommand, readLocalConfig } from "../src/config/local.ts";
import { appOrigin, assertProductionNextCommand, productionDatabase, readProductionConfig, readRuntimeConfig, runtimeTarget } from "../src/config/runtime.ts";
import { connectDatabase } from "../src/db/client.ts";
import { createLocalAuth, type LocalAuth } from "../src/modules/access/auth.ts";
import { handleAuth } from "../src/modules/access/handler.ts";
import { addressBucket, assertOrigin, clientIp, requestOrigin } from "../src/modules/access/http.ts";
import { autolarisClientFor } from "../src/modules/payments/autolaris.ts";
import { autolarisChannels } from "../src/modules/storefront/checkout-order.ts";
import { AccessError } from "../src/modules/access/policy.ts";
import { prefix, setCookie } from "../src/modules/checkout/access.ts";
import { submitOrder } from "../src/modules/checkout/orders.ts";
import { financeEnvironment } from "../src/modules/finance/ledger.ts";
import { seedCommerce } from "../src/modules/local/commerce.ts";
import { seedLocal } from "../src/modules/local/fixtures.ts";
import { provisionLocalAccounts } from "../src/modules/local/logins.ts";

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

// S82 production profile. Values are synthetic; the secret is generated per run and never printed.
const productionOrigin = "https://99ribu.com";
const production: Record<string, string> = {
  APP_ENV: "production", APP_ORIGIN: productionOrigin, BETTER_AUTH_URL: productionOrigin,
  BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
  PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled",
  EXTERNAL_DISPATCH: "disabled", DATABASE_HOST: "postgres-99ribu", DATABASE_APP_PASSWORD: "synthetic-sentinel-app-password",
  CLIENT_IP_HEADER: "x-real-ip",
};
async function asProduction<T>(change: Record<string, string | undefined>, run: () => T | Promise<T>) {
  const saved = process.env;
  process.env = { ...production, ...change } as NodeJS.ProcessEnv;
  for (const [name, value] of Object.entries(change)) if (value === undefined) delete process.env[name];
  try { return await run(); } finally { process.env = saved; }
}

test("production profile: exact https origin, container listener, one trusted origin and the proxy header", () => {
  const config = readProductionConfig(production);
  assert.equal(config.profile, "production");
  assert.equal(config.origin, productionOrigin);
  assert.equal(config.hostname, "0.0.0.0");
  assert.equal(config.port, 3000);
  assert.equal(readProductionConfig({ ...production, PORT: "8080" }).port, 8080);
  assert.deepEqual(config.trustedOrigins, [productionOrigin]);
  assert.equal(config.tailnetOrigin, null);
  assert.equal(config.clientIpHeader, "x-real-ip");
  assert.ok(!JSON.stringify(config).includes(production.BETTER_AUTH_SECRET), "the secret is never part of the config object");
  assert.ok(!JSON.stringify(config).includes("synthetic-sentinel"), "database passwords are never part of the config object");
  assert.equal(readRuntimeConfig(production).profile, "production");
  assert.equal(readRuntimeConfig(local).profile, "local", "the local profile is unchanged");
  assert.equal(readRuntimeConfig(local).origin, loopback);
  assert.equal(appOrigin(production), productionOrigin);
  assert.equal(runtimeTarget(production), "production");
  assert.equal(runtimeTarget(local), "local");
  assert.equal(readProductionConfig({ ...production, BETTER_AUTH_SECRET: randomBytes(32).toString("hex") }).origin, productionOrigin, "hex secrets of 32 bytes pass");
  assert.equal(readProductionConfig({ ...production, BETTER_AUTH_SECRET: randomBytes(48).toString("base64url") }).origin, productionOrigin);
  assert.equal(readProductionConfig({ ...production, BETTER_AUTH_TRUSTED_ORIGINS: productionOrigin }).origin, productionOrigin);
});

const invalidProduction = [
  ["plain http origin", { APP_ORIGIN: "http://99ribu.com", BETTER_AUTH_URL: "http://99ribu.com" }],
  ["loopback origin", { APP_ORIGIN: "https://127.0.0.1", BETTER_AUTH_URL: "https://127.0.0.1" }],
  ["local loopback origin", { APP_ORIGIN: "http://127.0.0.1:3099", BETTER_AUTH_URL: "http://127.0.0.1:3099" }],
  ["localhost origin", { APP_ORIGIN: "https://localhost", BETTER_AUTH_URL: "https://localhost" }],
  ["tailnet IP origin", { APP_ORIGIN: "https://100.127.67.86", BETTER_AUTH_URL: "https://100.127.67.86" }],
  ["tailnet name origin", { APP_ORIGIN: "https://rich.tail915080.ts.net", BETTER_AUTH_URL: "https://rich.tail915080.ts.net" }],
  ["IPv6 origin", { APP_ORIGIN: "https://[::1]", BETTER_AUTH_URL: "https://[::1]" }],
  ["single-label host", { APP_ORIGIN: "https://intranet", BETTER_AUTH_URL: "https://intranet" }],
  ["origin with slash", { APP_ORIGIN: "https://99ribu.com/", BETTER_AUTH_URL: "https://99ribu.com/" }],
  ["origin with path", { APP_ORIGIN: "https://99ribu.com/admin", BETTER_AUTH_URL: "https://99ribu.com/admin" }],
  ["origin with credentials", { APP_ORIGIN: "https://user:synthetic-sentinel@99ribu.com", BETTER_AUTH_URL: "https://user:synthetic-sentinel@99ribu.com" }],
  ["origin with query", { APP_ORIGIN: "https://99ribu.com?x=1", BETTER_AUTH_URL: "https://99ribu.com?x=1" }],
  ["uppercase origin", { APP_ORIGIN: "HTTPS://99ribu.com", BETTER_AUTH_URL: "HTTPS://99ribu.com" }],
  ["missing origin", { APP_ORIGIN: undefined }],
  ["missing secret", { BETTER_AUTH_SECRET: undefined }],
  ["short secret", { BETTER_AUTH_SECRET: randomBytes(16).toString("base64") }],
  ["low-entropy secret", { BETTER_AUTH_SECRET: "a".repeat(64) }],
  ["non-encoded secret", { BETTER_AUTH_SECRET: "synthetic sentinel never log this secret value at all!" }],
  ["second secret source", { BETTER_AUTH_SECRETS: "synthetic-sentinel-never-log" }],
  ["legacy secret source", { AUTH_SECRET: "synthetic-sentinel-never-log" }],
  ["missing auth URL", { BETTER_AUTH_URL: undefined }],
  ["mismatched auth URL", { BETTER_AUTH_URL: "https://www.99ribu.com" }],
  ["extra trusted origin", { BETTER_AUTH_TRUSTED_ORIGINS: "https://99ribu.com,https://evil.invalid" }],
  ["other trusted origin", { BETTER_AUTH_TRUSTED_ORIGINS: "https://app.99ribu.com" }],
  ["tailnet switch", { LOCAL_TAILNET_ORIGIN: "http://100.127.67.86:3099" }],
  ...["PAYMENT", "SHIPPING", "ADS", "NOTIFICATION", "PAYOUT"].flatMap((name) => [
    [`simulated ${name.toLowerCase()} adapter`, { [`${name}_ADAPTER`]: "simulated" }],
    [`live ${name.toLowerCase()} adapter without its gate`, { [`${name}_ADAPTER`]: "live" }],
    [`missing ${name.toLowerCase()} adapter mode`, { [`${name}_ADAPTER`]: undefined }],
  ] as const),
  ["external dispatch", { EXTERNAL_DISPATCH: "enabled" }],
  ["payment provider credential", { AUTOLARIS_API_KEY: "synthetic-sentinel-never-log" }],
  ["shipping provider credential", { MENGANTAR_API_KEY: "synthetic-sentinel-never-log" }],
  ["database URL", { DATABASE_URL: "postgresql://u:synthetic-sentinel@db/99ribu_production" }],
  ["libpq override", { PGHOST: "synthetic-sentinel" }],
  ["missing database host", { DATABASE_HOST: undefined }],
  ["malformed database host", { DATABASE_HOST: "db;synthetic-sentinel" }],
  ["malformed database port", { DATABASE_PORT: "5432x" }],
  ["missing app password", { DATABASE_APP_PASSWORD: undefined }],
  ["short app password", { DATABASE_APP_PASSWORD: "short" }],
  ["client-supplied forwarding header", { CLIENT_IP_HEADER: "x-forwarded-for" }],
  ["missing proxy header choice", { CLIENT_IP_HEADER: undefined }],
  ["malformed listener port", { PORT: "70000" }],
] as const;

for (const [label, change] of invalidProduction) {
  test(`production profile rejects ${label} without exposing configured values`, () => {
    const env: Record<string, string | undefined> = { ...production, ...change };
    assert.throws(() => readProductionConfig(env), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!error.message.includes("synthetic-sentinel"), "value echoed");
      assert.ok(!error.message.includes(production.BETTER_AUTH_SECRET), "secret echoed");
      for (const value of Object.values(change)) if (value && value.length > 12) assert.ok(!error.message.includes(value), "value echoed");
      return true;
    });
  });
}

test("the production Next command boundary allows only build and start on 0.0.0.0:<PORT>", () => {
  for (const args of [["build"], ["typegen"], ["start", "--hostname", "0.0.0.0", "--port", "3000"]]) {
    assert.doesNotThrow(() => assertProductionNextCommand(args, 3000));
  }
  for (const args of [[], ["dev"], ["dev", "--hostname", "0.0.0.0", "--port", "3000"], ["start"], ["start", "--hostname", "127.0.0.1", "--port", "3000"],
    ["start", "--hostname", "0.0.0.0", "--port", "3099"], ["start", "--hostname", "0.0.0.0", "--port", "3000", "--port", "3001"]]) {
    assert.throws(() => assertProductionNextCommand(args, 3000), /no dev server/);
  }
});

test("production database target: TCP endpoint, fixed roles, explicit pool and timeouts, no connection made", async () => asProduction({ DATABASE_OWNER_PASSWORD: "synthetic-sentinel-owner-password" }, async () => {
  for (const access of ["app", "owner"] as const) {
    const { sql } = connectDatabase("production", access);
    try {
      const options = sql.options as unknown as { host: string[]; port: number[]; path: string | false; database: string; user: string; max: number; ssl: unknown; connection: Record<string, unknown> };
      assert.deepEqual(options.host, ["postgres-99ribu"]);
      assert.deepEqual(options.port, [5432]);
      assert.ok(!options.path, "never the local socket");
      assert.equal(options.database, "99ribu_production");
      assert.equal(options.user, `99ribu_production_${access}`);
      assert.equal(options.max, 5);
      assert.equal(options.ssl, false);
      assert.deepEqual(options.connection, {
        application_name: `99ribu-production-${access}`, statement_timeout: 10000, lock_timeout: 5000, idle_in_transaction_session_timeout: 30000,
      });
    } finally { await sql.end(); }
  }
  assert.throws(() => connectDatabase("local"), /must match APP_ENV/, "a production process never reaches the local socket");
  assert.throws(() => connectDatabase("test", "owner"), /must match APP_ENV/);
}));

test("production database target refuses a missing owner password and the local profile refuses it entirely", async () => {
  await asProduction({}, () => assert.throws(() => connectDatabase("production", "owner"), /DATABASE_OWNER_PASSWORD is required/));
  const saved = process.env;
  process.env = { ...local } as NodeJS.ProcessEnv;
  try { assert.throws(() => connectDatabase("production"), /must match APP_ENV/); } finally { process.env = saved; }
});

test("production origin and client IP: exact Host only, and only the configured proxy header counts", () => asProduction({}, () => {
  const request = (headers: Record<string, string>, url = "http://0.0.0.0:3000/api/v1/carts") => new Request(url, { method: "POST", headers });
  assert.equal(assertOrigin(request({ host: "99ribu.com", origin: productionOrigin })), productionOrigin);
  assert.equal(requestOrigin(new Request("http://localhost:3000/", { headers: { host: "99ribu.com" } })), productionOrigin, "request.url behind the proxy is ignored");
  for (const [host, origin] of [["www.99ribu.com", "https://www.99ribu.com"], ["evil.invalid", productionOrigin], ["99ribu.com", "http://99ribu.com"],
    ["99ribu.com", "https://evil.invalid"], ["127.0.0.1:3099", loopback], ["99ribu.com:443", productionOrigin]]) {
    refused(request({ host, origin }));
  }
  assert.equal(requestOrigin(new Request(`${productionOrigin}/`)), null, "a request without Host is refused");
  assert.equal(clientIp(request({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
  assert.equal(clientIp(request({ "x-real-ip": "2001:db8::7" })), "2001:db8::7");
  const forged: Record<string, string>[] = [{}, { "x-forwarded-for": "203.0.113.7" }, { "cf-connecting-ip": "203.0.113.7" }, { "x-real-ip": "203.0.113.7, 198.51.100.1" }, { "x-real-ip": "unknown" }];
  for (const headers of forged) {
    assert.throws(() => clientIp(request(headers)), (error: unknown) => error instanceof AccessError && error.status === 503 && error.code === "CLIENT_IP_UNAVAILABLE");
  }
}));

test("client budget keys: IPv4 as is, IPv6 by its /64, IPv4-mapped IPv6 as IPv4", () => {
  assert.equal(addressBucket("203.0.113.7"), "203.0.113.7");
  for (const [ip, bucket] of [["2001:db8:1:2::a", "2001:db8:1:2::/64"], ["2001:0DB8:0001:0002:ffff:0:0:b", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"], ["::1", "0:0:0:0::/64"], ["fe80::1:2:3:4", "fe80:0:0:0::/64"], ["::ffff:198.51.100.9", "198.51.100.9"],
    ["2001:db8:1:2:3:4:192.0.2.1", "2001:db8:1:2::/64"]]) {
    assert.equal(addressBucket(ip), bucket, ip);
  }
  assert.equal(addressBucket("2001:db8:1:2::a"), addressBucket("2001:db8:1:2:aaaa:bbbb:cccc:dddd"), "one /64 shares a bucket");
  assert.notEqual(addressBucket("2001:db8:1:2::a"), addressBucket("2001:db8:1:3::a"));
});

test("production database TLS: plaintext only on a private network, an external database requires TLS", () => {
  const database = (change: Record<string, string>) => productionDatabase({ ...production, ...change }, "app");
  for (const host of ["postgres-99ribu", "db.internal", "pg.local", "10.0.0.5", "172.20.1.1", "192.168.1.10", "127.0.0.1", "fd00::5", "::1"]) {
    assert.equal(database({ DATABASE_HOST: host }).ssl, false, host);
  }
  for (const host of ["203.0.113.5", "172.32.0.1", "8.8.8.8", "db.example.com", "2001:db8::5"]) {
    assert.throws(() => database({ DATABASE_HOST: host }), /DATABASE_SSL must be require or verify-full/, host);
    assert.equal(database({ DATABASE_HOST: host, DATABASE_SSL: "require" }).ssl, "require");
    assert.equal(database({ DATABASE_HOST: host, DATABASE_SSL: "verify-full" }).ssl, "verify-full");
  }
  for (const mode of ["prefer", "allow", "true", "VERIFY-FULL"]) assert.throws(() => database({ DATABASE_SSL: mode }), /DATABASE_SSL must be disable, require or verify-full/);
  assert.throws(() => readProductionConfig({ ...production, DATABASE_HOST: "203.0.113.5" }), /DATABASE_SSL/);
});

test("checkout payment channels: the simulated AutoLaris list only for local/test, none on the production database", async () => {
  const on = (name: string) => ({ sql: (() => Promise.resolve([{ name }])) as never });
  assert.ok((await autolarisChannels(on("99ribu_local"))).length > 0, "local keeps the simulated channel list");
  assert.deepEqual(await autolarisChannels(on("99ribu_production")), []);
  assert.throws(() => autolarisClientFor("production", on("99ribu_production").sql), (error: unknown) => error instanceof AccessError && error.code === "AUTOLARIS_LIVE_GATED");
});

test("the local profile keeps one loopback client identity regardless of forwarding headers", () => withTailnet(undefined, () => {
  assert.equal(clientIp(new Request(`${loopback}/`, { headers: { "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" } })), "127.0.0.1");
}));

test("production auth: env secret, Secure __Secure- cookies, client-IP header, and app cookies share the prefix", async () => asProduction({}, async () => {
  const identity = createLocalAuth("production");
  try {
    const context = await identity.auth.$context;
    assert.equal(context.secret, production.BETTER_AUTH_SECRET);
    assert.equal(context.options.advanced?.useSecureCookies, true);
    assert.equal(context.authCookies.sessionToken.name, "__Secure-99ribu-production.session_token");
    assert.equal(context.authCookies.sessionToken.attributes.secure, true);
    assert.deepEqual(context.options.advanced?.ipAddress?.ipAddressHeaders, ["x-99ribu-client-ip"]);
    assert.deepEqual([...new Set(context.trustedOrigins)], [productionOrigin], "Better Auth adds baseURL; no other origin");
    assert.equal(await prefix(identity), "__Secure-99ribu-production");
    const response = new Response(null);
    setCookie(response, `${await prefix(identity)}.cart_access`, "value");
    assert.match(response.headers.get("set-cookie") ?? "", /^__Secure-99ribu-production\.cart_access=value; Path=\/; HttpOnly; Secure; SameSite=Lax;/);
  } finally { await identity.sql.end(); }
}));

test("production auth boundary: delivery flows stay closed and a request without the proxy's client IP is refused", async () => asProduction({}, async () => {
  const identity = {} as LocalAuth; // every asserted refusal happens before identity or the database is touched
  const post = (path: string, headers: Record<string, string> = {}) => new Request(`http://0.0.0.0:3000${path}`, {
    method: "POST", headers: { host: "99ribu.com", origin: productionOrigin, "content-type": "application/json", ...headers }, body: "{}",
  });
  for (const path of ["/api/auth/sign-up/email", "/api/auth/request-password-reset", "/api/auth/send-verification-email"]) {
    const response = await handleAuth(post(path, { "x-real-ip": "203.0.113.7" }), identity);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: "NOTIFICATION_DISABLED" });
  }
  const missing = await handleAuth(post("/api/auth/sign-in/email", { "x-forwarded-for": "203.0.113.7" }), identity);
  assert.equal(missing.status, 503);
  assert.equal((await missing.json()).code, "CLIENT_IP_UNAVAILABLE");
  const foreign = await handleAuth(post("/api/auth/sign-in/email", { host: "evil.invalid", "x-real-ip": "203.0.113.7" }), identity);
  assert.equal(foreign.status, 403);
}));

test("production keeps checkout and money paths closed and refuses local fixture commands", async () => asProduction({}, async () => {
  await assert.rejects(submitOrder({} as never, new Request(`${productionOrigin}/api/v1/orders`), {} as LocalAuth, { kind: "guest", id: "x" }, {}),
    (error: unknown) => error instanceof AccessError && error.status === 503 && error.code === "CHECKOUT_CLOSED");
  const productionTx = (() => Promise.resolve([{ name: "99ribu_production" }])) as never;
  await assert.rejects(financeEnvironment(productionTx), (error: unknown) => error instanceof AccessError && error.code === "PRODUCTION_MONEY_PATH_GATED");
  // The in-process /api/v1/admin/local-fixture-command flows and the fixture/login commands run through these entry points.
  await assert.rejects(seedCommerce(new Request(`${productionOrigin}/api/v1/admin/local-fixture-command`), {} as LocalAuth, "local", "prod-refusal"), /APP_ENV must be local/);
  await assert.rejects(seedLocal("local", "prod-refusal"), /APP_ENV must be local/);
  await assert.rejects(provisionLocalAccounts("local"), /APP_ENV must be local/);
}));

test("production Next config hides public/prototypes; the local config does not rewrite", async () => {
  const productionConfig = await asProduction({}, async () => (await import(`../next.config.ts?profile=${"production"}`)).default);
  assert.deepEqual(await productionConfig.rewrites(), { beforeFiles: [{ source: "/prototypes/:path*", destination: "/404" }], afterFiles: [], fallback: [] });
  assert.equal(productionConfig.allowedDevOrigins, undefined);
  const saved = process.env;
  process.env = { ...local } as NodeJS.ProcessEnv;
  try { assert.equal((await import(`../next.config.ts?profile=${"local"}`)).default.rewrites, undefined); } finally { process.env = saved; }
});
