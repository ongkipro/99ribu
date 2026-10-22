import { createHash, createHmac, randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { LocalAuth } from "./auth.ts";
import { AccessError, hasPermission, permissions, type Principal } from "./policy.ts";
import {financeAuthority} from '../finance/costs.ts';

const action = "staff_roles.replace";
const staffRoles = ["ecommerce_admin", "warehouse", "customer_service", "finance"];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const list = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 50 && value.every((v) => typeof v === "string") && new Set(value).size === value.length;

export async function assertCurrentOwner(tx: TransactionSql, principal: Principal, freshMfa = false) {
  const [owner] = await tx`select g.roles from app.role_grant g join app.auth_user u on u.id=g.user_id
    join app.auth_session s on s.user_id=u.id join app.mfa_session m on m.session_id=s.id
    where u.id=${principal.id} and s.id=${principal.sessionId} and s.expires_at>clock_timestamp() and u.two_factor_enabled
    and (not ${freshMfa} or m.verified_at>clock_timestamp()-interval '5 minutes') for share of g,s,m`;
  if (!owner?.roles.includes("owner")) throw new AccessError(403, "FORBIDDEN");
}

export async function consumeAccessProof(tx: TransactionSql, principal: Principal, purpose: string, subjectId: string, proof: string) {
  const [stored] = await tx`update app.access_proof set consumed_at=clock_timestamp() where digest=${digest(proof)}
    and session_id=${principal.sessionId} and action=${purpose} and subject_id=${subjectId} and expires_at>clock_timestamp()
    and consumed_at is null returning digest,expires_at>clock_timestamp() as fresh`;
  // RETURNING checks wall time after any row-lock wait; the caller rolls back stale consumption.
  if (!stored?.fresh) throw new AccessError(403, "REAUTHENTICATION_REQUIRED");
}

export async function issueAccessProof(request: Request, principal: Principal, identity: LocalAuth, body: Record<string, unknown>) {
  const financePurpose=body.action==='finance.reconcile'?'reconciliation':body.action==='finance.refund'?'refunds':null;
  if(!principal.mfaAt||(financePurpose?(!hasPermission(principal,`finance.${financePurpose}.read`)||!hasPermission(principal,`finance.${financePurpose}.write`)):!principal.roles.includes('owner')))throw new AccessError(403,'FORBIDDEN');
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
  if (Object.keys(body).some((key) => !["password", "action", "subject_id"].includes(key)) || typeof body.action !== "string" ||
    ![action, "company_policy.version", "payment_policy.version", "warehouse_calendar.version", "catalog_publication.exception", "finance.reconcile", "finance.refund", "affiliate_rate.version"].includes(body.action) ||
    !validId(body.subject_id) || typeof body.password !== "string" || body.password.length > 128) throw new AccessError(400, "INVALID_INPUT");
  if ((body.action === "company_policy.version" && body.subject_id !== "company-commercial") || (body.action === "payment_policy.version" && body.subject_id !== "company-payment") ||
    (["warehouse_calendar.version", "catalog_publication.exception", "finance.reconcile", "finance.refund", "affiliate_rate.version"].includes(body.action) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.subject_id))) throw new AccessError(400, "INVALID_INPUT");
  const proofAction = body.action;
  const subjectId = ["warehouse_calendar.version", "catalog_publication.exception", "finance.reconcile", "finance.refund", "affiliate_rate.version"].includes(proofAction) ? body.subject_id.toLowerCase() : body.subject_id;
  const now = Date.now();
  const [rate] = await identity.sql`insert into app.auth_rate_limit (id,key,count,last_request)
    values (${randomUUID()},${`access-proof:${principal.id}`},1,${now}) on conflict (key) do update set
    count=case when app.auth_rate_limit.last_request<${now - 60000} then 1 else app.auth_rate_limit.count+1 end,
    last_request=case when app.auth_rate_limit.last_request<${now - 60000} then ${now} else app.auth_rate_limit.last_request end returning count,last_request`;
  if (rate.count > 5) throw new AccessError(429, "RATE_LIMITED", Math.max(1, Math.ceil((Number(rate.last_request) + 60000 - now) / 1000)));
  if (now - principal.mfaAt.getTime() > 300000) throw new AccessError(403, "FRESH_MFA_REQUIRED");
  try { await identity.auth.api.verifyPassword({ headers: request.headers, body: { password: body.password } }); }
  catch { throw new AccessError(403, "REAUTHENTICATION_REQUIRED"); }
  // Purpose-separated keyed derivation makes a lost response recoverable without
  // persisting plaintext proof. The session/action/target/key remain bound.
  const proof = createHmac("sha256", (await identity.auth.$context).secret)
    .update(JSON.stringify(["99ribu-access-proof-v1", principal.sessionId, proofAction, subjectId, key])).digest("base64url");
  return identity.sql.begin(async (tx) => {
    const [currentUser]=await tx`select id,email_verified from app.auth_user where id=${principal.id} for update`;
    if(!currentUser?.email_verified)throw new AccessError(403,'FORBIDDEN');
    if(financePurpose){await financeAuthority(tx,principal,`finance.${financePurpose}.read`,true);await financeAuthority(tx,principal,`finance.${financePurpose}.write`,true);}
    else await assertCurrentOwner(tx, principal, true);
    // Preserve the established per-session issuance identity across reviewed purposes.
    const operationAction = `staff_roles.proof:${principal.sessionId}`;
    const requestHash = digest(JSON.stringify([proofAction, subjectId]));
    const [previous] = await tx`select request_hash from app.access_operation where actor_id=${principal.id} and action=${operationAction} and key=${key}`;
    if (previous && previous.request_hash !== requestHash) throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
    if (!previous) {
      const expiresAt = new Date(now + 300000).toISOString();
      await tx`insert into app.access_proof (digest,session_id,action,subject_id,expires_at)
        values (${digest(proof)},${principal.sessionId},${proofAction},${subjectId},${expiresAt})`;
      await tx`insert into app.access_operation (actor_id,action,key,request_hash,response)
        values (${principal.id},${operationAction},${key},${requestHash},'{}'::jsonb)`;
    }
    const [stored] = await tx`select expires_at,consumed_at from app.access_proof where digest=${digest(proof)}`;
    if (!stored || stored.consumed_at || new Date(stored.expires_at).getTime() <= now) throw new AccessError(409, "PROOF_NO_LONGER_VALID");
    return { proof, expires_at: new Date(stored.expires_at).toISOString() };
  });
}

export async function replaceStaffGrant(request: Request, principal: Principal, identity: LocalAuth, body: Record<string, unknown>) {
  if (!principal.roles.includes("owner")) throw new AccessError(403, "FORBIDDEN");
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
  if (Object.keys(body).some((field) => !["user_id", "roles", "warehouse_ids", "permissions", "expected_version", "reason", "reauthentication_proof"].includes(field)) ||
    !validId(body.user_id) || !list(body.roles) || body.roles.some((role) => !staffRoles.includes(role)) ||
    !list(body.warehouse_ids) || body.warehouse_ids.some((id) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) ||
    !list(body.permissions) || body.permissions.some((permission) => !permissions.includes(permission as typeof permissions[number])) ||
    !Number.isSafeInteger(body.expected_version) || Number(body.expected_version) < 0 ||
    typeof body.reason !== "string" || !body.reason.trim() || body.reason.length > 500 ||
    typeof body.reauthentication_proof !== "string" || !body.reauthentication_proof.length || body.reauthentication_proof.length > 100) throw new AccessError(400, "INVALID_INPUT");
  if (body.user_id === principal.id || (body.roles.includes("warehouse") && !body.warehouse_ids.length) ||
    (body.permissions.some((permission) => permission.startsWith("finance.")) && !body.roles.includes("finance"))) throw new AccessError(403, "FORBIDDEN");
  const change = { user_id: body.user_id, roles: [...body.roles].sort(), warehouse_ids: [...body.warehouse_ids].sort(),
    permissions: [...body.permissions].sort(), expected_version: Number(body.expected_version), reason: body.reason.trim() };
  const requestHash = digest(JSON.stringify(change));
  const reauthenticationProof = body.reauthentication_proof;
  return identity.sql.begin(async (tx) => {
    // Lock actor/subject in stable order. Every grant writer uses this boundary;
    // concurrent replacement/revocation cannot authorize from a stale grant.
    const users = await tx`select id from app.auth_user where id in (${principal.id},${change.user_id}) order by id for update`;
    if (users.length !== 2) throw new AccessError(404, "NOT_FOUND");
    await assertCurrentOwner(tx, principal);
    const [previous] = await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action=${action} and key=${key}`;
    if (previous) {
      if (previous.request_hash !== requestHash) throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
      return previous.response;
    }
    const [current] = await tx`select id,roles,revision from app.role_grant where user_id=${change.user_id}`;
    if (current?.roles.includes("owner")) throw new AccessError(403, "FORBIDDEN");
    if ((current?.revision ?? 0) !== change.expected_version) throw new AccessError(409, "VERSION_CONFLICT");
    if (change.warehouse_ids.length) {
      const active = await tx`select id from app.warehouse where id in ${tx(change.warehouse_ids)} and active for share`;
      if (active.length !== change.warehouse_ids.length) throw new AccessError(400, "INVALID_WAREHOUSE_SCOPE");
    }
    await consumeAccessProof(tx, principal, action, change.user_id, reauthenticationProof);
    const retained = (current?.roles ?? ["buyer"]).filter((role: string) => ["buyer", "affiliate"].includes(role));
    const nextRoles = [...new Set([...retained, ...change.roles])].sort();
    const [saved] = await tx`insert into app.role_grant (user_id,roles,permissions) values (${change.user_id},${nextRoles},${change.permissions})
      on conflict (user_id) do update set roles=excluded.roles, permissions=excluded.permissions,revision=app.role_grant.revision+1 returning id,revision`;
    await tx`delete from app.warehouse_membership where user_id=${change.user_id}`;
    for (const warehouseId of change.warehouse_ids) await tx`insert into app.warehouse_membership (user_id,warehouse_id) values (${change.user_id},${warehouseId})`;
    // Privilege changes invalidate every existing subject session, including MFA.
    await tx`delete from app.auth_session where user_id=${change.user_id}`;
    const response = { id: saved.id, user_id: change.user_id, roles: nextRoles, warehouse_ids: change.warehouse_ids, permissions: change.permissions, version: saved.revision };
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},${action},${change.user_id},'allowed',${change.reason},${JSON.stringify(response)}::jsonb)`;
    await tx`insert into app.access_operation (actor_id,action,key,request_hash,response)
      values (${principal.id},${action},${key},${requestHash},${JSON.stringify(response)}::jsonb)`;
    return response;
  });
}
