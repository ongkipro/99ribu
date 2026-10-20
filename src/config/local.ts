import { lstatSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

type Environment = Record<string, string | undefined>;

export function privateDirectory(name: "postgres" | "pgsocket" | "artifacts" | "auth") {
  const parent = resolve(".local");
  const path = resolve(parent, name);
  for (const directory of [parent, path]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(directory);
    // The official image sets its socket directory to 3775 on every restart.
    // The .local parent and the socket itself remain 0700; other host users cannot traverse it.
    const socketDirectory = name === "pgsocket" && directory === path && (stat.mode & 0o7777) === 0o3775;
    if (!stat.isDirectory() || stat.isSymbolicLink() || ((stat.mode & 0o7777) !== 0o700 && !socketDirectory) || stat.uid !== process.getuid?.()) {
      throw new Error("Local storage must be an owner-only directory, without symlinks.");
    }
  }
  return path;
}

export function assertLocalNextCommand(args: readonly string[]) {
  if (args.length === 1 && ["build", "typegen"].includes(args[0])) return;
  const expected = [args[0], "--hostname", "127.0.0.1", "--port", "3099"];
  if (
    !["dev", "start"].includes(args[0]) || args.length !== expected.length ||
    args.some((argument, index) => argument !== expected[index])
  ) {
    throw new Error("Use npm run dev, npm run build or npm start with the fixed local listener.");
  }
}

// This profile is deliberately local-only. Live activation requires its own gate.
export function readLocalConfig(env: Environment) {
  if (env.APP_ENV !== "local") throw new Error("APP_ENV must be local.");
  if (env.APP_ORIGIN !== "http://127.0.0.1:3099") {
    throw new Error("APP_ORIGIN must use the canonical loopback origin.");
  }
  for (const name of ["PAYMENT", "SHIPPING", "ADS", "NOTIFICATION", "PAYOUT"]) {
    if (env[`${name}_ADAPTER`] !== "simulated") {
      throw new Error(`${name}_ADAPTER must be simulated.`);
    }
  }
  if (env.EXTERNAL_DISPATCH !== "disabled") {
    throw new Error("EXTERNAL_DISPATCH must be disabled.");
  }
  // Do not echo names/values from a provider credential or destination into logs.
  const providerKey = /^(?:NEXT_PUBLIC_)?(?:VIRGO|MENGANTAR|META|FACEBOOK|GOOGLE_ADS|TIKTOK|SMTP|RESEND|SENDGRID|TWILIO)_/;
  for (const [name, value] of Object.entries(env)) {
    if (value && providerKey.test(name)) {
      throw new Error("Provider configuration is forbidden in the local profile.");
    }
  }
  if (env.BETTER_AUTH_URL && env.BETTER_AUTH_URL !== env.APP_ORIGIN) {
    throw new Error("Auth origin must match APP_ORIGIN.");
  }
  if (env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRETS || env.AUTH_SECRET || env.BETTER_AUTH_TRUSTED_ORIGINS) {
    throw new Error("Auth overrides are forbidden; use the private local identity profile.");
  }
  if (env.DATABASE_URL || env.PGHOST || env.PGPORT || env.PGDATABASE || env.PGUSER || env.PGPASSWORD) {
    throw new Error("Database overrides are forbidden; use the private local socket profile.");
  }
  return Object.freeze({ origin: env.APP_ORIGIN, hostname: "127.0.0.1", port: 3099 });
}
