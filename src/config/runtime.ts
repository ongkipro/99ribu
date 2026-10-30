import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { readLocalConfig } from "./local.ts";

type Environment = Record<string, string | undefined>;

// The single trusted reverse proxy's client-address header (RELEASE.md OD-9, still open): x-real-ip for the
// Coolify proxy, cf-connecting-ip for Cloudflare with the origin locked to Cloudflare. That the chosen proxy
// overwrites (never forwards) a client-sent copy is unverified here and must be proven at S84/S88 before exposure.
const CLIENT_IP_HEADERS = ["x-real-ip", "cf-connecting-ip"] as const;
const PROVIDER_KEY = /^(?:NEXT_PUBLIC_)?(?:VIRGO|MENGANTAR|AUTOLARIS|META|FACEBOOK|GOOGLE_ADS|TIKTOK|SMTP|RESEND|SENDGRID|TWILIO)_/;

function productionOrigin(value: string | undefined) {
  let url: URL;
  try { url = new URL(value ?? ""); } catch { throw new Error("APP_ORIGIN must be an exact https:// origin."); }
  // origin === value refuses paths (including "/"), query, fragment, credentials and non-canonical spelling.
  if (url.protocol !== "https:" || url.origin !== value) throw new Error("APP_ORIGIN must be an exact https:// origin.");
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || /(?:^|\.)localhost$|\.ts\.net$|\.local$|\.internal$/.test(host)) {
    throw new Error("APP_ORIGIN must be a public DNS host, not loopback, an IP literal or a tailnet/internal name.");
  }
  return value;
}

// At least 32 random bytes, hex or base64/base64url encoded (e.g. `openssl rand -base64 48`). Never echoed.
function assertAuthSecret(value: string | undefined) {
  if (!value) throw new Error("BETTER_AUTH_SECRET is required in production.");
  const bytes = /^(?:[0-9a-f]{2})+$/i.test(value) ? value.length / 2
    : /^[A-Za-z0-9+/_-]+={0,2}$/.test(value) ? Buffer.from(value, "base64").length : 0;
  if (bytes < 32 || new Set(value).size < 12) {
    throw new Error("BETTER_AUTH_SECRET must encode at least 32 random bytes (openssl rand -base64 48).");
  }
}

function port(value: string | undefined, name: string, fallback: number) {
  if (value === undefined || value === "") return fallback;
  if (!/^[1-9]\d{0,4}$/.test(value) || Number(value) > 65535) throw new Error(`${name} must be a TCP port.`);
  return Number(value);
}

// Production database endpoint: TCP on the private Docker network, password (SCRAM) from env, fixed role and
// database names (99ribu_production_{app,owner}) so every identity check stays the same as local/test.
export function productionDatabase(env: Environment, access: "app" | "owner") {
  const host = env.DATABASE_HOST ?? "";
  if (!(isIP(host) || /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(host))) {
    throw new Error("DATABASE_HOST must be the private database host name or IP.");
  }
  const name = access === "owner" ? "DATABASE_OWNER_PASSWORD" : "DATABASE_APP_PASSWORD";
  // `<name>_FILE`: a secret file mounted into one service only (Coolify gives every application variable to
  // every Compose service, so the owner password reaches only `migrate` as a file; compose.production.yaml).
  const password = env[name] || (env[`${name}_FILE`] ? readFileSync(env[`${name}_FILE`] as string, "utf8").trim() : undefined);
  if (!password || password.length < 16) throw new Error(`${name} is required (at least 16 characters).`);
  return { host, port: port(env.DATABASE_PORT, "DATABASE_PORT", 5432), password, ssl: databaseTls(host, env.DATABASE_SSL) };
}

// Shared by the app and backup tools: require encrypts but does not authenticate postgres.js peers.
export function databaseTls(host: string, mode: string | undefined): false | "require" | "verify-full" {
  const ssl = mode ?? "disable";
  if (ssl !== "disable" && ssl !== "require" && ssl !== "verify-full") throw new Error("DATABASE_SSL must be disable, require or verify-full.");
  if (ssl !== "verify-full" && !privateNetworkHost(host)) {
    throw new Error("DATABASE_SSL must be verify-full unless DATABASE_HOST is on a private network.");
  }
  return ssl === "disable" ? false as const : ssl;
}

// Private: loopback, RFC 1918 / IPv6 ULA literals, and Docker-network names (single label, or .internal/.local).
// Any other DNS name or IP literal may be public, so it needs TLS.
function privateNetworkHost(host: string) {
  const version = isIP(host);
  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (version === 6) return host === "::1" || /^f[cd][0-9a-f]{0,2}:/i.test(host);
  return !host.includes(".") || /\.(?:internal|local)$/i.test(host);
}

// Production profile (S82). Refuses anything the local profile would accept as a convenience: plain http,
// loopback/tailnet origins, simulated or live adapters, extra trusted origins and local-only switches.
export function readProductionConfig(env: Environment) {
  if (env.APP_ENV !== "production") throw new Error("APP_ENV must be production.");
  const origin = productionOrigin(env.APP_ORIGIN);
  if (env.BETTER_AUTH_URL !== origin) throw new Error("BETTER_AUTH_URL must equal APP_ORIGIN.");
  if (env.BETTER_AUTH_TRUSTED_ORIGINS !== undefined && env.BETTER_AUTH_TRUSTED_ORIGINS !== origin) {
    throw new Error("Trusted origins are exactly APP_ORIGIN in production.");
  }
  if (env.BETTER_AUTH_SECRETS || env.AUTH_SECRET) throw new Error("Use BETTER_AUTH_SECRET only.");
  assertAuthSecret(env.BETTER_AUTH_SECRET);
  if (env.LOCAL_TAILNET_ORIGIN) throw new Error("LOCAL_TAILNET_ORIGIN is local-only.");
  for (const name of ["PAYMENT", "SHIPPING", "ADS", "NOTIFICATION", "PAYOUT"]) {
    // No live adapter has passed its provider gate; simulated adapters would create fake effects.
    if (env[`${name}_ADAPTER`] !== "disabled") throw new Error(`${name}_ADAPTER must be disabled until its provider gate passes.`);
  }
  if (env.EXTERNAL_DISPATCH !== "disabled") throw new Error("EXTERNAL_DISPATCH must be disabled.");
  for (const [name, value] of Object.entries(env)) {
    if (value && PROVIDER_KEY.test(name)) throw new Error("Provider configuration is gated in production.");
  }
  if (env.DATABASE_URL || env.PGHOST || env.PGPORT || env.PGDATABASE || env.PGUSER || env.PGPASSWORD) {
    throw new Error("Use DATABASE_HOST/DATABASE_PORT and the role passwords; URL and PG* overrides are refused.");
  }
  productionDatabase(env, "app");
  const clientIpHeader = CLIENT_IP_HEADERS.find((header) => header === env.CLIENT_IP_HEADER);
  if (!clientIpHeader) throw new Error(`CLIENT_IP_HEADER must be one of ${CLIENT_IP_HEADERS.join(", ")}.`);
  return Object.freeze({
    profile: "production" as const, origin, hostname: "0.0.0.0", port: port(env.PORT, "PORT", 3000),
    tailnetOrigin: null, trustedOrigins: Object.freeze([origin]), clientIpHeader,
  });
}

// The one profile switch. Every serving path (web, worker, health, migrations) reads this; simulators and
// local commands keep calling readLocalConfig, which refuses APP_ENV=production.
export function readRuntimeConfig(env: Environment = process.env) {
  if (env.APP_ENV === "production") return readProductionConfig(env);
  return Object.freeze({ profile: "local" as const, ...readLocalConfig(env), clientIpHeader: null });
}
export type RuntimeConfig = ReturnType<typeof readRuntimeConfig>;

// Profile-neutral accessors for modules that only need the origin or the web process's database target.
export const appOrigin = (env: Environment = process.env) => readRuntimeConfig(env).origin;
export const runtimeTarget = (env: Environment = process.env) => readRuntimeConfig(env).profile === "production" ? "production" as const : "local" as const;

export function assertProductionNextCommand(args: readonly string[], listenerPort: number) {
  if (args.length === 1 && ["build", "typegen"].includes(args[0])) return;
  const expected = ["start", "--hostname", "0.0.0.0", "--port", String(listenerPort)];
  if (args.length !== expected.length || args.some((argument, index) => argument !== expected[index])) {
    throw new Error("Production runs only next build or next start on 0.0.0.0:<PORT> (no dev server).");
  }
}
