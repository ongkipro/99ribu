import { createHash } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { assertCurrentOwner, consumeAccessProof } from "../access/grants.ts";
import { AccessError, type Principal } from "../access/policy.ts";

type Kind = "commercial" | "warehouse_calendar" | "payment";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// DEC-008/009 payment terms are their own company policy so changing them never
// invalidates catalog publications (which freeze the commercial version).
const purpose = (kind: Kind) => kind === "commercial" ? "company_policy.version" : kind === "payment" ? "payment_policy.version" : "warehouse_calendar.version";
const subject = (warehouseId: string | null, kind: Kind = "commercial") => warehouseId ?? (kind === "payment" ? "company-payment" : "company-commercial");
const invalid = () => new AccessError(400, "INVALID_INPUT");

function scope(kind: unknown, warehouseId: unknown): { kind: Kind; warehouseId: string | null } {
  if (kind !== "commercial" && kind !== "warehouse_calendar" && kind !== "payment") throw invalid();
  if (kind === "commercial" || kind === "payment") { if (warehouseId !== null) throw invalid(); return { kind, warehouseId: null }; }
  if (typeof warehouseId !== "string" || !uuid.test(warehouseId)) throw invalid();
  return { kind, warehouseId: warehouseId.toLowerCase() };
}
export type BankAccount = { bank_name: string; account_number: string; account_holder: string };
function bankAccounts(value: unknown): value is BankAccount[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 5 && value.every((a) => a && typeof a === "object" && !Array.isArray(a) &&
    Object.keys(a).every((key) => ["bank_name", "account_number", "account_holder"].includes(key)) &&
    typeof a.bank_name === "string" && a.bank_name.trim().length >= 2 && a.bank_name.length <= 60 &&
    typeof a.account_number === "string" && /^[0-9]{6,20}$/.test(a.account_number) &&
    typeof a.account_holder === "string" && a.account_holder.trim().length >= 2 && a.account_holder.length <= 100);
}
function valuesFor(kind: Kind, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const data = value as Record<string, unknown>;
  if (kind === "commercial") {
    if (Object.keys(data).some((key) => !["default_commission_bps", "minimum_payout_idr", "minimum_contribution_idr"].includes(key)) ||
      !Number.isSafeInteger(data.default_commission_bps) || Number(data.default_commission_bps) < 0 || Number(data.default_commission_bps) > 10000 ||
      !Number.isSafeInteger(data.minimum_payout_idr) || Number(data.minimum_payout_idr) < 1 ||
      ("minimum_contribution_idr" in data && (!Number.isSafeInteger(data.minimum_contribution_idr) || Number(data.minimum_contribution_idr)<0 || Number(data.minimum_contribution_idr)>99000))) throw invalid();
    return { default_commission_bps: Number(data.default_commission_bps), minimum_payout_idr: Number(data.minimum_payout_idr),
      ...(data.minimum_contribution_idr===undefined?{}:{minimum_contribution_idr:Number(data.minimum_contribution_idr)}) };
  }
  if (kind === "payment") {
    // DEC-009 buyer COD fee rate (basis points) and DEC-008 manual transfer accounts.
    if (Object.keys(data).some((key) => !["cod_fee_bps", "manual_bank_accounts"].includes(key)) ||
      !Number.isSafeInteger(data.cod_fee_bps) || Number(data.cod_fee_bps) < 0 || Number(data.cod_fee_bps) > 2000 ||
      ("manual_bank_accounts" in data && !(Array.isArray(data.manual_bank_accounts) && (data.manual_bank_accounts.length === 0 || bankAccounts(data.manual_bank_accounts))))) throw invalid();
    return { cod_fee_bps: Number(data.cod_fee_bps), manual_bank_accounts: ((data.manual_bank_accounts ?? []) as BankAccount[]).map((a) => ({ bank_name: a.bank_name.trim(), account_number: a.account_number, account_holder: a.account_holder.trim() })) };
  }
  if (Object.keys(data).some((key) => !["timezone", "year", "working_weekdays", "cutoff_local", "closed_dates", "source", "approval"].includes(key)) ||
    typeof data.timezone !== "string" || !data.timezone || data.timezone.length > 100 ||
    !Number.isSafeInteger(data.year) || Number(data.year) < 2020 || Number(data.year) > 2100 ||
    !Array.isArray(data.working_weekdays) || !data.working_weekdays.length || data.working_weekdays.length > 7 ||
    data.working_weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || new Set(data.working_weekdays).size !== data.working_weekdays.length ||
    typeof data.cutoff_local !== "string" || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(data.cutoff_local) ||
    !Array.isArray(data.closed_dates) || data.closed_dates.length > 366 || new Set(data.closed_dates).size !== data.closed_dates.length ||
    data.closed_dates.some((date) => typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !date.startsWith(`${data.year}-`) ||
      !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`)) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) ||
    data.source !== "TEST-ONLY" || data.approval !== "test_only") throw invalid();
  try { new Intl.DateTimeFormat("en", { timeZone: data.timezone }); } catch { throw invalid(); }
  return { timezone: data.timezone, year: Number(data.year), working_weekdays: [...data.working_weekdays].sort((a, b) => a - b),
    cutoff_local: data.cutoff_local, closed_dates: [...data.closed_dates].sort(), source: "TEST-ONLY", approval: "test_only" };
}
type Stored = { id: string; kind: Kind; warehouse_id: string | null; revision: number; effective_at: string;
  values: Record<string, unknown>; actor_id: string; reason: string; created_at: string };
function project(row: Stored) {
  let values: ReturnType<typeof valuesFor>;
  try { values = valuesFor(row.kind, row.values); } catch { throw new AccessError(503, "POLICY_INVALID"); }
  return { id: row.id, kind: row.kind, warehouse_id: row.warehouse_id, version: row.revision,
    effective_at: new Date(row.effective_at).toISOString(), values, actor_id: row.actor_id, reason: row.reason,
    created_at: new Date(row.created_at).toISOString() };
}

// Trusted server consumer: freeze this immutable version ID/values in the actual domain snapshot.
export async function resolvePolicy(sql: Sql | TransactionSql, kind: Kind, warehouseId: string | null, at: Date) {
  const selected = scope(kind, warehouseId);
  if (!Number.isFinite(at.getTime())) throw invalid();
  const [row] = await sql<Stored[]>`select v.*,h.kind,h.warehouse_id from app.policy_version v join app.policy_head h on h.id=v.head_id
    where h.kind=${selected.kind} and h.warehouse_id is not distinct from ${selected.warehouseId}::uuid
    and v.effective_at<=${at.toISOString()} order by v.effective_at desc,v.revision desc limit 1`;
  if (!row) throw new AccessError(409, "POLICY_UNCONFIGURED");
  return project(row);
}

export async function listPolicyVersions(url: URL, principal: Principal, identity: LocalAuth) {
  if (!principal.roles.includes("owner") || !principal.mfaAt) throw new AccessError(403, "FORBIDDEN");
  if ([...url.searchParams.keys()].some((key) => !["kind", "warehouse_id", "cursor", "limit"].includes(key) || url.searchParams.getAll(key).length !== 1)) throw invalid();
  const selected = scope(url.searchParams.get("kind"), url.searchParams.get("warehouse_id"));
  const rawLimit = url.searchParams.get("limit") ?? "20"; const rawCursor = url.searchParams.get("cursor");
  if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100 ||
    (rawCursor !== null && (!/^\d{1,10}$/.test(rawCursor) || Number(rawCursor) < 1 || Number(rawCursor) > 2147483647))) throw invalid();
  return identity.sql.begin("isolation level repeatable read read only", async (tx) => {
    if (selected.warehouseId && !(await tx`select id from app.warehouse where id=${selected.warehouseId}`).length) throw new AccessError(404, "NOT_FOUND");
    const [head] = await tx`select id,revision from app.policy_head where kind=${selected.kind} and warehouse_id is not distinct from ${selected.warehouseId}::uuid`;
    if (!head) return { data: [], pagination: { next_cursor: null }, latest_version: 0, current: null };
    const limit = Number(rawLimit);
    const rows = await tx<Stored[]>`select v.*,h.kind,h.warehouse_id from app.policy_version v join app.policy_head h on h.id=v.head_id
      where v.head_id=${head.id} and (${rawCursor}::int is null or v.revision<${rawCursor}::int) order by v.revision desc limit ${limit + 1}`;
    const [current] = await tx<Stored[]>`select v.*,h.kind,h.warehouse_id from app.policy_version v join app.policy_head h on h.id=v.head_id
      where v.head_id=${head.id} and v.effective_at<=clock_timestamp() order by v.effective_at desc,v.revision desc limit 1`;
    return { data: rows.slice(0, limit).map(project), pagination: { next_cursor: rows.length > limit ? String(rows[limit - 1].revision) : null },
      latest_version: head.revision, current: current ? project(current) : null };
  });
}

export async function appendPolicyVersion(request: Request, principal: Principal, identity: LocalAuth, body: Record<string, unknown>) {
  if (!principal.roles.includes("owner") || !principal.mfaAt) throw new AccessError(403, "FORBIDDEN");
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
  if (Object.keys(body).some((field) => !["kind", "warehouse_id", "effective_at", "values", "expected_version", "reason", "reauthentication_proof"].includes(field)) ||
    !Number.isSafeInteger(body.expected_version) || Number(body.expected_version) < 0 || typeof body.reason !== "string" ||
    !body.reason.trim() || !body.reason.isWellFormed() || body.reason.includes("\0") || Array.from(body.reason).length > 500 ||
    typeof body.reauthentication_proof !== "string" || !body.reauthentication_proof.length || body.reauthentication_proof.length > 100 ||
    (body.effective_at !== null && (typeof body.effective_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(body.effective_at) ||
      !Number.isFinite(Date.parse(body.effective_at)) || new Date(body.effective_at).toISOString() !== body.effective_at))) throw invalid();
  const selected = scope(body.kind, body.warehouse_id); const values = valuesFor(selected.kind, body.values);
  const reauthenticationProof = body.reauthentication_proof; const effectiveInput = body.effective_at;
  const intent = { kind: selected.kind, warehouse_id: selected.warehouseId, effective_at: effectiveInput,
    values, expected_version: Number(body.expected_version), reason: body.reason.trim() };
  const hash = createHash("sha256").update(JSON.stringify(intent)).digest("hex");
  const action = purpose(selected.kind);
  const operation = "platform_policy.append";
  return identity.sql.begin(async (tx) => {
    await tx`select id from app.auth_user where id=${principal.id} for update`;
    await assertCurrentOwner(tx, principal);
    const [previous] = await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action=${operation} and key=${key}`;
    if (previous) { if (previous.request_hash !== hash) throw new AccessError(409, "IDEMPOTENCY_CONFLICT"); return previous.response; }
    if (selected.warehouseId) {
      const [warehouse] = await tx`select timezone from app.warehouse where id=${selected.warehouseId} and active for share`;
      if (!warehouse) throw new AccessError(400, "INVALID_WAREHOUSE_SCOPE");
      if (!("timezone" in values) || warehouse.timezone !== values.timezone) throw invalid();
    }
    await tx`insert into app.policy_head (kind,warehouse_id) values (${selected.kind},${selected.warehouseId}) on conflict do nothing`;
    const [head] = await tx`select id,revision from app.policy_head where kind=${selected.kind} and warehouse_id is not distinct from ${selected.warehouseId}::uuid for update`;
    if (head.revision !== intent.expected_version) throw new AccessError(409, "VERSION_CONFLICT");
    const [last] = await tx`select effective_at from app.policy_version where head_id=${head.id} order by revision desc limit 1`;
    await consumeAccessProof(tx, principal, action, subject(selected.warehouseId, selected.kind), reauthenticationProof);
    const [clock] = await tx`select clock_timestamp() as now`;
    const now = new Date(clock.now); const effectiveAt = effectiveInput === null ? now.toISOString() : String(effectiveInput);
    if (Date.parse(effectiveAt) < now.getTime()) throw new AccessError(400, "RETROACTIVE_POLICY_FORBIDDEN");
    if (Date.parse(effectiveAt) > now.getTime() + 366 * 86400000) throw new AccessError(400, "POLICY_SCHEDULE_TOO_DISTANT");
    if (last && Date.parse(effectiveAt) < new Date(last.effective_at).getTime()) throw new AccessError(409, "SCHEDULE_CONFLICT");
    const [saved] = await tx`insert into app.policy_version (head_id,revision,effective_at,"values",actor_id,reason)
      values (${head.id},${head.revision + 1},${effectiveAt},${JSON.stringify(values)}::jsonb,${principal.id},${intent.reason}) returning *`;
    await tx`update app.policy_head set revision=revision+1 where id=${head.id}`;
    const response = project({ ...saved, kind: selected.kind, warehouse_id: selected.warehouseId } as Stored);
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},${action},${head.id},'allowed',${intent.reason},${JSON.stringify({ version_id: response.id, version: response.version, effective_at: response.effective_at })}::jsonb)`;
    await tx`insert into app.access_operation (actor_id,action,key,request_hash,response) values (${principal.id},${operation},${key},${hash},${JSON.stringify(response)}::jsonb)`;
    return response;
  });
}
