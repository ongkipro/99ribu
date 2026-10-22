import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hashPassword } from "better-auth/crypto";
import { connectDatabase } from "../../db/client.ts";
import { readLocalConfig } from "../../config/local.ts";
import { roles, type Role } from "../access/policy.ts";

type Target = "local" | "test";
type Fixture = {
  environment: string; synthetic: boolean; real_external_effects: boolean; clock: string;
  users: { id: string; email: string; roles: Role[]; warehouse_ids?: string[] }[];
  warehouses: { id: string; name: string; timezone: string }[];
};
function namespaceGuard(namespace: string) {
  readLocalConfig(process.env);
  if (!/^[a-z][a-z0-9-]{0,23}$/.test(namespace)) throw new Error("Invalid local fixture namespace.");
}
function fixture() {
  const data = JSON.parse(readFileSync(new URL("../../../docs/spec/fixtures/localhost-commerce.json", import.meta.url), "utf8")) as Fixture;
  const id = (value: string) => typeof value === "string" && /^fixture-[a-z0-9-]{1,32}$/.test(value);
  if (data.environment !== "local" || data.synthetic !== true || data.real_external_effects !== false ||
      !Number.isFinite(Date.parse(data.clock)) || !Array.isArray(data.users) || !Array.isArray(data.warehouses) ||
      !data.users.length || !data.warehouses.length || new Set(data.users.map((u) => u.id)).size !== data.users.length ||
      new Set(data.warehouses.map((w) => w.id)).size !== data.warehouses.length ||
      data.warehouses.some((w) => !id(w.id) || typeof w.name !== "string" || !w.name.trim() || w.timezone !== "Asia/Jakarta") ||
      data.users.some((u) => !id(u.id) || !/^[a-z0-9-]+@example\.test$/.test(u.email) ||
        !Array.isArray(u.roles) || !u.roles.length || u.roles.some((r) => !roles.includes(r)) || new Set(u.roles).size !== u.roles.length ||
        (u.warehouse_ids !== undefined && (!Array.isArray(u.warehouse_ids) || new Set(u.warehouse_ids).size !== u.warehouse_ids.length || u.warehouse_ids.some((scope) => !data.warehouses.some((w) => w.id === scope)))))) {
    throw new Error("Invalid synthetic identity/warehouse fixture.");
  }
  return data;
}

export async function seedLocal(target: Target, namespace: string) {
  namespaceGuard(namespace);
  const data = fixture();
  const { sql } = connectDatabase(target);
  try {
    return await sql.begin(async (tx) => {
      const inserted = await tx`insert into app.local_fixture_namespace (name,clock) values (${namespace},${new Date(data.clock).toISOString()}) on conflict (name) do nothing returning name`;
      const [state] = await tx`select clock,revision from app.local_fixture_namespace where name=${namespace} for update`;
      if (inserted.length) {
        const warehouseIds = new Map<string, string>();
        for (const item of data.warehouses) {
          // DEC-006 kecamatan-level origin; the fixture kecamatan differs from every destination
          // fixture kecamatan, so fixture quotes keep their same-city/inter-province bands.
          const place = ({ "fixture-malang": { province: "Jawa Timur", city: "Malang", district: "Kecamatan Gudang Contoh A" },
            "fixture-pontianak": { province: "Kalimantan Barat", city: "Pontianak", district: "Kecamatan Gudang Contoh B" } } as Record<string, { province: string; city: string; district: string }>)[item.id];
          if (!place) throw new Error("Warehouse fixture city requires explicit mapping.");
          const warehouseId = randomUUID(); warehouseIds.set(item.id, warehouseId);
          await tx`insert into app.warehouse (id,name,province,city,district,timezone) values (${warehouseId},${`${item.name} [${namespace}]`},${place.province},${place.city},${place.district},${item.timezone})`;
          await tx`insert into app.local_fixture_warehouse (namespace,fixture_id,warehouse_id) values (${namespace},${item.id},${warehouseId})`;
        }
        for (const item of data.users) {
          const userId = randomUUID();
          const passwordHash = await hashPassword(randomBytes(32).toString("base64url"));
          await tx`insert into app.auth_user (id,name,email,email_verified) values (${userId},${`SYNTHETIC ${item.id} [${namespace}]`},${`${namespace}.${item.email}`},true)`;
          await tx`insert into app.auth_account (id,account_id,provider_id,user_id,password) values (${randomUUID()},${userId},'credential',${userId},${passwordHash})`;
          await tx`insert into app.role_grant (user_id,roles) values (${userId},${item.roles})`;
          for (const scope of item.warehouse_ids ?? []) await tx`insert into app.warehouse_membership (user_id,warehouse_id) values (${userId},${warehouseIds.get(scope) as string})`;
          await tx`insert into app.local_fixture_principal (namespace,fixture_id,user_id) values (${namespace},${item.id},${userId})`;
        }
        await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason) values (${`local-seed:${namespace}`},'local_fixture.create',${namespace},'allowed','Synthetic local fixture bootstrap')`;
      }
      const users = await tx`select p.fixture_id,p.user_id,u.email from app.local_fixture_principal p join app.auth_user u on u.id=p.user_id where p.namespace=${namespace}`;
      const warehouses = await tx`select fixture_id,warehouse_id from app.local_fixture_warehouse where namespace=${namespace}`;
      if (users.length !== data.users.length || warehouses.length !== data.warehouses.length ||
          users.some((u) => !data.users.some((source) => source.id === u.fixture_id && `${namespace}.${source.email}` === u.email)) ||
          warehouses.some((w) => !data.warehouses.some((source) => source.id === w.fixture_id))) throw new Error("Fixture identity mapping changed; choose a new namespace.");
      return { namespace, created: inserted.length === 1, clock: new Date(state.clock).toISOString(), version: state.revision as number,
        principals: Object.fromEntries(users.map((u) => [u.fixture_id as string, u.user_id as string])),
        warehouses: Object.fromEntries(warehouses.map((w) => [w.fixture_id as string, w.warehouse_id as string])) };
    });
  } finally { await sql.end(); }
}

export async function readFixtureClock(target: Target, namespace: string) {
  namespaceGuard(namespace); const { sql } = connectDatabase(target);
  try {
    const [row] = await sql`select clock,revision from app.local_fixture_namespace where name=${namespace}`;
    if (!row) throw new Error("Unknown local fixture namespace.");
    return { now: new Date(row.clock).toISOString(), version: row.revision as number };
  } finally { await sql.end(); }
}

export async function advanceFixtureClock(target: Target, namespace: string, seconds: number, expectedVersion: number) {
  namespaceGuard(namespace);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 31622400 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error("Invalid fixture clock advance.");
  const { sql } = connectDatabase(target);
  try {
    const [row] = await sql`update app.local_fixture_namespace set clock=clock+${seconds}*interval '1 second',revision=revision+1 where name=${namespace} and revision=${expectedVersion} returning clock,revision`;
    if (!row) throw new Error("Fixture clock version conflict or unknown namespace.");
    return { now: new Date(row.clock).toISOString(), version: row.revision as number };
  } finally { await sql.end(); }
}

// Trusted host-side harness only. Never expose private message URLs in CLI output or HTTP.
export async function readFixtureInbox(target: Target, namespace: string, principalId: string) {
  namespaceGuard(namespace); const { sql } = connectDatabase(target);
  try {
    const [principal] = await sql`select u.email from app.local_fixture_principal p join app.auth_user u on u.id=p.user_id where p.namespace=${namespace} and p.user_id=${principalId}`;
    if (!principal?.email.endsWith("@example.test")) throw new Error("Fixture inbox scope denied.");
    const rows = await sql`select id,kind,url,expires_at from app.local_delivery where recipient=${principal.email} and delivered_at is not null and expires_at>now() order by created_at,id`;
    const { trustedOrigins } = readLocalConfig(process.env);
    if (rows.some((row) => !trustedOrigins.includes(new URL(row.url).origin))) throw new Error("Invalid local inbox destination.");
    return rows.map((row) => ({ id: row.id as string, kind: row.kind as string, url: row.url as string, expiresAt: new Date(row.expires_at).toISOString() }));
  } finally { await sql.end(); }
}
