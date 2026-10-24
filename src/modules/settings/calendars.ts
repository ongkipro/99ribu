import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { assertCurrentOwner, consumeAccessProof } from "../access/grants.ts";
import { assertOrigin, privateJson, problem, readBody } from "../access/http.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { valuesFor } from "./policies.ts";

// S101: warehouse calendar coverage for the owner and the audited bulk "apply the default calendar
// to origin warehouses" action. Each written version is the same immutable policy_version row
// (and audit row) a single POST /admin/policy-versions would write; one proof covers the batch.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new AccessError(400, "INVALID_INPUT");
export const DEFAULT_APPLY_PURPOSE = "warehouse_calendar.default_apply";
export const DEFAULT_APPLY_SUBJECT = "origin-warehouses";
// lazy: one page of up to 500 active warehouses; add keyset paging if the network grows past it.
const LIMIT = 500;

type CoverageRow = {
  id: string; name: string; city: string; timezone: string; local_year: number; live_products: number;
  latest_version: number | null; scheduled: boolean; version_id: string | null; version: number | null;
  effective_at: string | null; values: unknown;
};

// Origin warehouse: active, and the default warehouse of a live (published, not withdrawn,
// not retired) offer or holding stock of one of its components, so checkout can route a parcel there.
function coverage(sql: Sql | TransactionSql, ids: string[] | null) {
  return sql<CoverageRow[]>`
    with live as (
      select pv.product_id,pv.product_revision from app.publication_head ph
      join app.publication_version pv on pv.product_id=ph.product_id and pv.revision=ph.revision
      where not exists (select 1 from app.publication_withdrawal x where x.publication_id=pv.id))
    select w.id,w.name,w.city,w.timezone,extract(year from clock_timestamp() at time zone w.timezone)::int local_year,
      (select count(distinct x.product_id)::int from (
        select l.product_id from live l join app.offer_revision v on v.product_id=l.product_id and v.revision=l.product_revision and not v.retired
          where v.default_warehouse_id=w.id
        union all
        select l.product_id from live l join app.offer_revision v on v.product_id=l.product_id and v.revision=l.product_revision and not v.retired
          join app.offer_component c on c.product_id=v.product_id and c.revision=v.revision and c.offer_id=v.offer_id
          join app.inventory_balance b on b.stock_item_id=c.stock_item_id and b.warehouse_id=w.id) x) live_products,
      h.revision latest_version,
      coalesce((select max(v.effective_at) from app.policy_version v where v.head_id=h.id)>clock_timestamp(),false) scheduled,
      cur.id version_id,cur.revision version,cur.effective_at,cur."values"
    from app.warehouse w
    left join app.policy_head h on h.kind='warehouse_calendar' and h.warehouse_id=w.id
    left join lateral (select v.id,v.revision,v.effective_at,v."values" from app.policy_version v where v.head_id=h.id and v.effective_at<=clock_timestamp()
      order by v.effective_at desc,v.revision desc limit 1) cur on true
    where w.active and (${ids}::uuid[] is null or w.id=any(${ids}::uuid[]))
    order by live_products desc, w.name, w.id limit ${LIMIT + 1}`;
}

function project(row: CoverageRow) {
  let values: ReturnType<typeof valuesFor> | null = null;
  try { if (row.values) values = valuesFor("warehouse_calendar", row.values); } catch { values = null; }
  const year = values && "year" in values ? values.year : null;
  const state = !row.version_id || !values ? "missing" : year === row.local_year ? "current" : "outdated";
  return {
    warehouse_id: row.id, warehouse_name: row.name, city: row.city, timezone: row.timezone, local_year: row.local_year,
    live_products: row.live_products, origin: row.live_products > 0, state, scheduled: row.scheduled, latest_version: row.latest_version ?? 0,
    current: row.version_id && values ? { version_id: row.version_id, version: row.version, effective_at: new Date(String(row.effective_at)).toISOString(), values } : null,
  };
}

export async function listWarehouseCalendars(url: URL, principal: Principal, identity: LocalAuth) {
  if (!principal.roles.includes("owner") || !principal.mfaAt) throw new AccessError(403, "FORBIDDEN");
  if (url.search) throw invalid();
  return identity.sql.begin("isolation level repeatable read read only", async (tx) => {
    const rows = await coverage(tx, null);
    const data = rows.slice(0, LIMIT).map(project).sort((a, b) => Number(b.origin) - Number(a.origin) || a.warehouse_name.localeCompare(b.warehouse_name, "id"));
    return { data, truncated: rows.length > LIMIT };
  });
}

export async function applyDefaultCalendar(request: Request, principal: Principal, identity: LocalAuth, body: Record<string, unknown>) {
  if (!principal.roles.includes("owner") || !principal.mfaAt) throw new AccessError(403, "FORBIDDEN");
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
  if (Object.keys(body).some((field) => !["warehouse_ids", "values", "reason", "reauthentication_proof"].includes(field)) ||
    !Array.isArray(body.warehouse_ids) || !body.warehouse_ids.length || body.warehouse_ids.length > 100 ||
    body.warehouse_ids.some((id) => typeof id !== "string" || !uuid.test(id)) ||
    typeof body.reason !== "string" || !body.reason.trim() || !body.reason.isWellFormed() || body.reason.includes("\0") || Array.from(body.reason).length > 500 ||
    typeof body.reauthentication_proof !== "string" || !body.reauthentication_proof.length || body.reauthentication_proof.length > 100 ||
    !body.values || typeof body.values !== "object" || Array.isArray(body.values)) throw invalid();
  const ids = [...new Set((body.warehouse_ids as string[]).map((id) => id.toLowerCase()))].sort();
  if (ids.length !== body.warehouse_ids.length) throw invalid();
  const input = body.values as Record<string, unknown>;
  if (Object.keys(input).some((field) => !["working_weekdays", "cutoff_local", "closed_dates"].includes(field))) throw invalid();
  const reason = body.reason.trim(), proof = body.reauthentication_proof;
  const intent = { warehouse_ids: ids, values: { working_weekdays: input.working_weekdays, cutoff_local: input.cutoff_local, closed_dates: input.closed_dates }, reason };
  const hash = createHash("sha256").update(JSON.stringify(intent)).digest("hex");
  return identity.sql.begin(async (tx) => {
    await tx`select id from app.auth_user where id=${principal.id} for update`;
    await assertCurrentOwner(tx, principal);
    const [previous] = await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action=${DEFAULT_APPLY_PURPOSE} and key=${key}`;
    if (previous) { if (previous.request_hash !== hash) throw new AccessError(409, "IDEMPOTENCY_CONFLICT"); return previous.response; }
    const locked = await tx`select id from app.warehouse where id in ${tx(ids)} and active order by id for share`;
    if (locked.length !== ids.length) throw new AccessError(400, "INVALID_WAREHOUSE_SCOPE");
    for (const id of ids) await tx`insert into app.policy_head (kind,warehouse_id) values ('warehouse_calendar',${id}) on conflict do nothing`;
    const heads = await tx`select id,warehouse_id,revision from app.policy_head where kind='warehouse_calendar' and warehouse_id in ${tx(ids)} order by id for update`;
    const rows = (await coverage(tx, ids)).map((row) => ({ row, view: project(row) }));
    if (rows.some(({ view }) => !view.origin)) throw new AccessError(400, "INVALID_WAREHOUSE_SCOPE");
    if (rows.some(({ view }) => view.scheduled)) throw new AccessError(409, "SCHEDULE_CONFLICT");
    if (rows.some(({ view }) => view.state === "current")) throw new AccessError(409, "CALENDAR_ALREADY_CURRENT");
    // Validate every warehouse's version before consuming the proof (closed dates must fall in its local year).
    const planned = rows.map(({ row }) => {
      const head = heads.find((h) => h.warehouse_id === row.id);
      if (!head) throw new AccessError(409, "VERSION_CONFLICT");
      return { row, head, values: valuesFor("warehouse_calendar", { timezone: row.timezone, year: row.local_year, ...intent.values, source: "TEST-ONLY", approval: "test_only" }) };
    });
    await consumeAccessProof(tx, principal, DEFAULT_APPLY_PURPOSE, DEFAULT_APPLY_SUBJECT, proof);
    const applied = [];
    for (const { row, head, values } of planned) {
      const [saved] = await tx`insert into app.policy_version (head_id,revision,effective_at,"values",actor_id,reason)
        values (${head.id},${head.revision + 1},clock_timestamp(),${JSON.stringify(values)}::jsonb,${principal.id},${reason}) returning id,revision,effective_at`;
      await tx`update app.policy_head set revision=revision+1 where id=${head.id}`;
      const effectiveAt = new Date(saved.effective_at).toISOString();
      await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
        values (${principal.id},'warehouse_calendar.version',${head.id},'allowed',${reason},${JSON.stringify({ version_id: saved.id, version: saved.revision, effective_at: effectiveAt, default_application: true })}::jsonb)`;
      applied.push({ warehouse_id: row.id, warehouse_name: row.name, version_id: String(saved.id), version: Number(saved.revision), year: row.local_year, effective_at: effectiveAt });
    }
    const response = { applied };
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},${DEFAULT_APPLY_PURPOSE},${DEFAULT_APPLY_SUBJECT},'allowed',${reason},${JSON.stringify({ warehouses: applied.length, version_ids: applied.map((a) => a.version_id) })}::jsonb)`;
    await tx`insert into app.access_operation (actor_id,action,key,request_hash,response) values (${principal.id},${DEFAULT_APPLY_PURPOSE},${key},${hash},${JSON.stringify(response)}::jsonb)`;
    return response;
  });
}

export async function handleWarehouseCalendars(request: Request, identity: LocalAuth) {
  try {
    assertOrigin(request);
    const url = new URL(request.url);
    if (["authorization", "x-cart-token", "x-order-token"].some((header) => request.headers.has(header))) throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
    const principal = await getPrincipal(request, identity);
    if (!principal.roles.includes("owner")) throw new AccessError(403, "FORBIDDEN");
    if (request.method === "GET" && url.pathname === "/api/v1/admin/warehouse-calendars") return privateJson(await listWarehouseCalendars(url, principal, identity));
    if (request.method === "POST" && url.pathname === "/api/v1/admin/warehouse-calendars/default-applications") {
      if (url.search) throw invalid();
      const body = await readBody(request);
      try { return privateJson(await applyDefaultCalendar(request, principal, identity, body), 201); }
      catch (error) {
        if (error instanceof AccessError) await identity.sql`insert into app.audit_event (actor_id,action,outcome,reason)
          values (${principal.id},${DEFAULT_APPLY_PURPOSE},'denied',${error.code})`;
        throw error;
      }
    }
    throw new AccessError(404, "NOT_FOUND");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["23505", "40001", "40P01"].includes(String(error.code))) return problem(new AccessError(409, "VERSION_CONFLICT"));
    return problem(error);
  }
}
