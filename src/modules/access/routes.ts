import type { LocalAuth } from "./auth.ts";
import { AccessError, getPrincipal, projectMe, projectWarehouse } from "./policy.ts";
import { assertOrigin, privateJson, problem, readBody } from "./http.ts";
import { issueAccessProof, replaceStaffGrant } from "./grants.ts";
import { appendPolicyVersion, listPolicyVersions } from "../settings/policies.ts";

export async function handleAccess(request: Request, identity: LocalAuth) {
  try {
    assertOrigin(request);
    const url = new URL(request.url);
    if (["authorization", "x-cart-token", "x-order-token"].some((header) => request.headers.has(header))) throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
    if (request.method === "POST" && url.search) throw new AccessError(400, "INVALID_INPUT");
    const principal = await getPrincipal(request, identity);
    if (url.pathname === "/api/v1/admin/policy-versions") {
      if (!principal.roles.includes("owner")) throw new AccessError(403, "FORBIDDEN");
      if (request.method === "GET") return privateJson(await listPolicyVersions(url, principal, identity));
      if (request.method === "POST") {
        const body = await readBody(request);
        try { return privateJson(await appendPolicyVersion(request, principal, identity, body), 201); }
        catch (error) {
          if (error instanceof AccessError) await identity.sql`insert into app.audit_event (actor_id,action,outcome,reason)
            values (${principal.id},'platform_policy.append','denied',${error.code})`;
          throw error;
        }
      }
    }
    if (request.method === "POST" && url.pathname === "/api/v1/me/reauthentication-proofs") {
      return privateJson(await issueAccessProof(request, principal, identity, await readBody(request)), 201);
    }
    if (request.method === "POST" && url.pathname === "/api/v1/admin/role-grants") {
      // Untrusted non-owner requests must not create permanent audit rows.
      if (!principal.roles.includes("owner")) throw new AccessError(403, "FORBIDDEN");
      const body = await readBody(request);
      try { return privateJson(await replaceStaffGrant(request, principal, identity, body), 201); }
      catch (error) {
        if (error instanceof AccessError) await identity.sql`insert into app.audit_event (actor_id,action,outcome,reason)
          values (${principal.id},'staff_roles.replace','denied',${error.code})`;
        throw error;
      }
    }
    if (request.method === "GET" && url.pathname === "/api/v1/me") {
      if (url.search) throw new AccessError(400, "INVALID_INPUT");
      return privateJson(projectMe(principal));
    }
    if (request.method === "GET" && url.pathname === "/api/v1/admin/warehouses") {
      if (!principal.roles.some((role) => ["owner", "ecommerce_admin", "warehouse"].includes(role))) throw new AccessError(403, "FORBIDDEN");
      if ([...url.searchParams.keys()].some((key) => !["cursor", "limit"].includes(key) || url.searchParams.getAll(key).length !== 1)) throw new AccessError(400, "INVALID_INPUT");
      const rawLimit = url.searchParams.get("limit") ?? "20";
      const cursor = url.searchParams.get("cursor");
      if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100 ||
        (cursor !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor))) throw new AccessError(400, "INVALID_INPUT");
      const limit = Number(rawLimit);
      const rows = await identity.sql<{ id: string; name: string; city: string; timezone: string; active: boolean }[]>`
        select w.id,w.name,w.city,w.timezone,w.active from app.warehouse w where w.active
        and (${principal.roles.includes("owner")} or exists (select 1 from app.warehouse_membership m where m.user_id=${principal.id} and m.warehouse_id=w.id))
        and (${cursor}::uuid is null or w.id>${cursor}::uuid) order by w.id limit ${limit + 1}`;
      return privateJson({ data: rows.slice(0, limit).map(projectWarehouse), pagination: { next_cursor: rows.length > limit ? rows[limit - 1].id : null } });
    }
    throw new AccessError(404, "NOT_FOUND");
  } catch (error) { return problem(error); }
}
