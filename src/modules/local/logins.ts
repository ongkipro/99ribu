import { symmetricDecrypt } from "better-auth/crypto";
import { readLocalConfig } from "../../config/local.ts";
import { createLocalAuth, isSyntheticEmail, type LocalAuth } from "../access/auth.ts";
import type { Permission, Role } from "../access/policy.ts";
import { BrowserSession, enroll, totp } from "./synthetic-session.ts";

// Stable local sign-in accounts, separate from the namespaced fixture principals
// (docs/spec/fixtures/localhost-commerce.json keeps its `<namespace>.<x>@example.test` contract).
// `.test` is a reserved synthetic TLD, accepted by isSyntheticEmail and the auth handler.
// Dummy credentials: local profile only, printed only by the explicit `fixture -- login local` command.
const finance: Permission[] = ["finance.summary.read", "finance.costs.read", "finance.costs.write", "finance.reconciliation.read", "finance.reconciliation.write", "finance.refunds.read", "finance.refunds.write"];
const labels: Permission[] = ["shipping.labels.read", "shipping.labels.generate", "shipping.labels.print"];
const exportsAll: Permission[] = ["exports.read", "exports.download"];
// One shared dummy password for every local account (owner decision 2026-10-24); 12 characters to meet
// the auth policy minimum (minPasswordLength 12). Local profile only.
export const LOCAL_DUMMY_PASSWORD = "99ribu123456";
export const LOCAL_ACCOUNTS: readonly { email: string; name: string; role: Role; password: string; permissions: Permission[]; landing: string }[] = [
  { email: "owner@99ribu.test", name: "Super Admin", role: "owner", password: LOCAL_DUMMY_PASSWORD, permissions: [], landing: "/admin" },
  { email: "ecommerce@99ribu.test", name: "Admin E-Commerce", role: "ecommerce_admin", password: LOCAL_DUMMY_PASSWORD, permissions: ["orders.history.read", ...labels, ...exportsAll], landing: "/admin" },
  { email: "gudang@99ribu.test", name: "Staf Gudang", role: "warehouse", password: LOCAL_DUMMY_PASSWORD, permissions: [...labels, ...exportsAll], landing: "/admin" },
  { email: "cs@99ribu.test", name: "Layanan Pelanggan", role: "customer_service", password: LOCAL_DUMMY_PASSWORD, permissions: ["orders.history.read"], landing: "/admin" },
  { email: "keuangan@99ribu.test", name: "Keuangan", role: "finance", password: LOCAL_DUMMY_PASSWORD, permissions: [...finance, "orders.history.read", ...exportsAll], landing: "/admin" },
  { email: "pembeli@99ribu.test", name: "Pembeli Satu", role: "buyer", password: LOCAL_DUMMY_PASSWORD, permissions: [], landing: "/akun" },
  { email: "pembeli2@99ribu.test", name: "Pembeli Dua", role: "buyer", password: LOCAL_DUMMY_PASSWORD, permissions: [], landing: "/akun" },
  { email: "afiliasi@99ribu.test", name: "Mitra Afiliasi", role: "affiliate", password: LOCAL_DUMMY_PASSWORD, permissions: [], landing: "/akun" },
];
const STAFF = new Set<Role>(["owner", "ecommerce_admin", "warehouse", "customer_service", "finance"]);
// Membership-scoped staff (S91 manual queue, pickup profile) share the catalog origin warehouses. S109: cs@ too,
// since order history/search and return review only show orders whose every parcel is in the reader's warehouses.
const SCOPED = new Set<Role>(["ecommerce_admin", "warehouse", "customer_service"]);
// Namespaces created per test run end in an 8-hex run id; fixed names (demo, berlapak, ...) are reused by
// seed/berlapak reruns, which require the full principal mapping, so they are never pruned.
const DISPOSABLE_NAMESPACE = /-[0-9a-f]{8}(?:-[0-9a-f])?$/;
const RETIRED_NAMESPACES = ["signin-check"]; // earlier sign-in check namespace; superseded by LOCAL_ACCOUNTS

function localOnly(target: string) {
  readLocalConfig(process.env); // APP_ENV=local, loopback origin, simulated adapters, no auth/DB overrides.
  if (target !== "local") throw new Error("Local accounts are local-only; the test database and every other target are refused.", { cause: "visible" });
}

// RFC 4648 base32 without padding, matching Better Auth's otpauth URI encoding of the stored secret.
function base32(value: string) {
  let bits = ""; let out = "";
  for (const byte of Buffer.from(value, "utf8")) bits += byte.toString(2).padStart(8, "0");
  for (let i = 0; i < bits.length; i += 5) out += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[Number.parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
export async function storedTotpUri(identity: LocalAuth, userId: string, email: string) {
  const [row] = await identity.sql`select t.secret from app.auth_two_factor t join app.auth_user u on u.id=t.user_id where t.user_id=${userId} and t.verified and u.two_factor_enabled`;
  if (!row) return null;
  const secret = await symmetricDecrypt({ key: (await identity.auth.$context).secretConfig, data: row.secret });
  return `otpauth://totp/99ribu:${encodeURIComponent(email)}?${new URLSearchParams({ secret: base32(secret), issuer: "99ribu", digits: "6", period: "30" })}`;
}

// gudang@, ecommerce@ and cs@ work where the catalog stock lives: every active S90 origin warehouse; before the catalog
// is imported, the `demo` namespace's Malang warehouse (else the oldest active Malang one).
async function localWarehouses(identity: LocalAuth) {
  const origins = await identity.sql<{ id: string; name: string }[]>`select id,name from app.warehouse where active and origin_key is not null order by name`;
  if (origins.length) return origins;
  const [row] = await identity.sql<{ id: string; name: string }[]>`select w.id,w.name from app.warehouse w left join app.local_fixture_warehouse f on f.warehouse_id=w.id
    where w.active and w.city='Malang' order by (f.namespace='demo' and f.fixture_id='fixture-malang') is true desc, w.id limit 1`;
  if (!row) throw new Error("No active local Malang warehouse; run `npm run fixture -- seed local demo` first.", { cause: "visible" });
  return [row];
}

// Idempotent desired state for every LOCAL_ACCOUNTS entry: user (verified), credential password, role grant,
// warehouse scope, and TOTP for staff enrolled through the real auth handler. Existing TOTP is kept and re-printed.
export async function provisionLocalAccounts(target: string) {
  localOnly(target);
  const identity = createLocalAuth("local");
  try {
    const context = await identity.auth.$context;
    const warehouses = await localWarehouses(identity);
    const scope = warehouses.map((w) => w.id);
    const accounts = [];
    for (const account of LOCAL_ACCOUNTS) {
      if (!isSyntheticEmail(account.email)) throw new Error("Local account email must be synthetic.");
      const hash = await context.password.hash(account.password);
      const found = await context.internalAdapter.findUserByEmail(account.email, { includeAccounts: true });
      const user = found?.user ?? await context.internalAdapter.createUser({ email: account.email, name: account.name, emailVerified: true }, { method: "admin" });
      if (found && (!found.user.emailVerified || found.user.name !== account.name)) await context.internalAdapter.updateUser(user.id, { emailVerified: true, name: account.name });
      if (found?.accounts.some((item) => item.providerId === "credential")) await context.internalAdapter.updatePassword(user.id, hash);
      else await context.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: hash });
      await identity.sql.begin(async (tx) => {
        await tx`insert into app.role_grant (user_id,roles,permissions) values (${user.id},${[account.role]},${account.permissions})
          on conflict (user_id) do update set roles=excluded.roles,permissions=excluded.permissions,revision=app.role_grant.revision+1
          where (app.role_grant.roles,app.role_grant.permissions) is distinct from (excluded.roles,excluded.permissions)`;
        if (!SCOPED.has(account.role)) await tx`delete from app.warehouse_membership where user_id=${user.id}`;
        else await tx`delete from app.warehouse_membership where user_id=${user.id} and not (warehouse_id = any(${scope}::uuid[]))`;
        if (SCOPED.has(account.role)) for (const id of scope) await tx`insert into app.warehouse_membership (user_id,warehouse_id) values (${user.id},${id}) on conflict do nothing`;
      });
      const mfa = STAFF.has(account.role);
      let uri = mfa ? await storedTotpUri(identity, user.id, account.email) : null;
      let backupCodes: string[] | null = null;
      if (mfa && !uri) {
        // Same browser flow a person uses: password sign-in, enable, verify the first TOTP code, sign out.
        const browser = new BrowserSession(identity);
        if ((await browser.auth("/sign-in/email", { email: account.email, password: account.password })).status !== 200) {
          throw new Error("Sign-in for MFA enrollment was refused (per-account rate limit?); retry in a minute.", { cause: "visible" });
        }
        const setup = await enroll(browser, account.password);
        await browser.auth("/sign-out", {});
        uri = setup.totpURI; backupCodes = setup.backupCodes;
      }
      accounts.push({ role: account.name, email: account.email, password: account.password, mfa, landing: account.landing,
        ...(SCOPED.has(account.role) ? { warehouses: warehouses.length === 1 ? warehouses[0].name : `${warehouses.length} gudang asal katalog` } : {}),
        ...(uri ? { totp_uri: uri, totp_secret: new URL(uri).searchParams.get("secret"), current_code: totp(uri) } : {}),
        ...(backupCodes ? { backup_codes: backupCodes } : {}) });
    }
    await identity.sql`insert into app.audit_event (actor_id,action,subject_id,outcome,reason) values ('local-accounts','local_accounts.provision','local','allowed','Local dummy sign-in accounts refreshed')`;
    return { profile: "local", sign_in: `${readLocalConfig(process.env).origin}/masuk`, accounts };
  } finally { await identity.sql.end(); }
}

// Current TOTP code per local staff account; nothing is written.
export async function localAccountCodes(target: string) {
  localOnly(target);
  const identity = createLocalAuth("local");
  try {
    const codes = [];
    for (const account of LOCAL_ACCOUNTS.filter((item) => STAFF.has(item.role))) {
      const [user] = await identity.sql`select id from app.auth_user where email=${account.email}`;
      const uri = user ? await storedTotpUri(identity, user.id, account.email) : null;
      if (uri) codes.push({ email: account.email, code: totp(uri) });
    }
    return { valid_for_seconds: 30 - (Math.floor(Date.now() / 1000) % 30), codes };
  } finally { await identity.sql.end(); }
}

// Removes leftover synthetic accounts (`@example.invalid` / `@example.test`) from the LOCAL database:
// unmapped test users (access-*, browser-*, orphan seed operators, ...) and principals of disposable per-run
// fixture namespaces. A user is kept when any app table still references it (orders, carts, audit, operations,
// support, profiles, ...), when it belongs to a fixed fixture namespace, or when it is younger than 15 minutes
// (a test may be using it). FK RESTRICT is the backstop: a refused delete is skipped, never cascaded past.
export async function pruneLocalAccounts(target: string, apply: boolean) {
  localOnly(target);
  const identity = createLocalAuth("local");
  const { sql } = identity;
  try {
    const users = await sql`select u.id,u.email,p.namespace,u.created_at>clock_timestamp()-interval '15 minutes' recent
      from app.auth_user u left join app.local_fixture_principal p on p.user_id=u.id
      where u.email ~ '@example\\.(invalid|test)$' order by u.created_at,u.id`;
    const tidy = new Set(LOCAL_ACCOUNTS.map((account) => account.email));
    const kept: Record<string, number> = {};
    const keep = (reason: string) => { kept[reason] = (kept[reason] ?? 0) + 1; };
    let candidates = users.filter((user) => {
      if (tidy.has(user.email)) return false;
      if (user.recent) { keep("created in the last 15 minutes"); return false; }
      if (user.namespace && !DISPOSABLE_NAMESPACE.test(user.namespace) && !RETIRED_NAMESPACES.includes(user.namespace)) { keep(`fixed fixture namespace ${user.namespace}`); return false; }
      return true;
    });
    // Every app column that can hold a user id, except identity rows that belong to the user itself.
    const identityOnly = ["auth_account", "auth_session", "auth_two_factor", "auth_verification", "role_grant", "warehouse_membership", "local_fixture_principal", "access_operation"];
    const columns = await sql`select table_name,column_name,data_type from information_schema.columns where table_schema='app'
      and (column_name in ('user_id','actor_id','affiliate_id','subject_id') or column_name like '%\\_user\\_id')
      and data_type in ('text','uuid','character varying') and table_name <> all(${identityOnly})`;
    const referenced = new Set<string>();
    const ids = candidates.map((user) => user.id as string);
    const uuidIds = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
    for (const column of columns) {
      const values = column.data_type === "uuid" ? uuidIds : ids;
      if (!values.length) continue;
      const rows = await sql`select distinct ${sql(column.column_name)}::text id from ${sql(`app.${column.table_name}`)}
        where ${sql(column.column_name)} = any(${values}::${sql.unsafe(column.data_type === "uuid" ? "uuid[]" : "text[]")})`;
      for (const row of rows) referenced.add(row.id);
    }
    candidates = candidates.filter((user) => { if (referenced.has(user.id)) { keep("referenced by business history or account data"); return false; } return true; });
    const group = (user: { email?: string; namespace?: string | null }) => user.namespace
      ? `fixture namespace ${user.namespace.replace(DISPOSABLE_NAMESPACE, "-*")}` : `${String(user.email).replace(/^([a-z]+)[-.].*(@.*)$/, "$1-*$2")}`;
    const deletable: Record<string, number> = {};
    for (const user of candidates) deletable[group(user)] = (deletable[group(user)] ?? 0) + 1;
    let deleted = 0; let skipped = 0;
    if (apply) {
      for (const user of candidates) {
        try {
          await sql.begin(async (tx) => {
            await tx`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${user.email})`;
            await tx`delete from app.local_delivery where recipient=${user.email}`;
            await tx`delete from app.auth_verification where value=${user.id}`;
            await tx`delete from app.access_operation where actor_id=${user.id}`;
            await tx`delete from app.auth_rate_limit where key=${`access-proof:${user.id}`}`;
            await tx`delete from app.local_fixture_principal where user_id=${user.id}`;
            await tx`delete from app.auth_user where id=${user.id}`;
          });
          deleted++;
        } catch (error) {
          if ((error as { code?: string }).code !== "23503") throw error; // FK RESTRICT: still referenced, keep it.
          skipped++;
        }
      }
      await sql`insert into app.audit_event (actor_id,action,subject_id,outcome,reason) values ('local-accounts','local_accounts.prune','local','allowed',${`Pruned ${deleted} synthetic local accounts; ${skipped} skipped by FK`})`;
    }
    return { profile: "local", applied: apply, scanned: users.length, deletable: candidates.length, deletable_by_group: deletable, kept, ...(apply ? { deleted, skipped_fk: skipped } : { next: "Re-run with --apply to delete the deletable accounts." }) };
  } finally { await sql.end(); }
}
