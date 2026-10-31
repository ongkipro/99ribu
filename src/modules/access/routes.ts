import type { LocalAuth } from "./auth.ts";
import { AccessError, getPrincipal, projectMe, projectWarehouse } from "./policy.ts";
import { assertOrigin, privateJson, problem, readBody } from "./http.ts";
import { issueAccessProof, replaceStaffGrant } from "./grants.ts";
import { appendPolicyVersion, listPolicyVersions } from "../settings/policies.ts";

type WarehouseRow = Parameters<typeof projectWarehouse>[0];
export async function handleAccess(request: Request, identity: LocalAuth) {
  try {
    assertOrigin(request);
    const url = new URL(request.url);
    if (["authorization", "x-cart-token", "x-order-token"].some((header) => request.headers.has(header))) throw new AccessError(401, "UNSUPPORTED_AUTH_TRANSPORT");
    if (request.method === "POST" && url.search) throw new AccessError(400, "INVALID_INPUT");
    const principal = await getPrincipal(request, identity);
    if (url.pathname === "/api/v1/admin/policy-versions") {
      if (request.method === "GET") {
        if (!principal.roles.some((role) => role === "owner" || role === "finance")) throw new AccessError(403, "FORBIDDEN");
        return privateJson(await listPolicyVersions(url, principal, identity));
      }
      if (request.method === "POST") {
        if (!principal.roles.includes("owner")) throw new AccessError(403, "FORBIDDEN");
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
      if ([...url.searchParams.keys()].some((key) => !["cursor", "limit", "q", "profile"].includes(key) || url.searchParams.getAll(key).length !== 1)) throw new AccessError(400, "INVALID_INPUT");
      const rawLimit = url.searchParams.get("limit") ?? "20";
      const cursor = url.searchParams.get("cursor");
      // Search over name, kecamatan, city and province; `profile` narrows to complete or incomplete pickup profiles.
      const q = url.searchParams.get("q")?.trim() ?? null, profile = url.searchParams.get("profile");
      if (!/^\d{1,3}$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > 100 ||
        (cursor !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)) ||
        (q !== null && (q.length < 1 || q.length > 100)) || (profile !== null && profile !== "complete" && profile !== "incomplete")) throw new AccessError(400, "INVALID_INPUT");
      const limit = Number(rawLimit), pattern = q === null ? null : `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const rows = await identity.sql<WarehouseRow[]>`
        select * from (select w.id,w.admin_no,w.name,w.city,w.province,w.district,w.timezone,w.active,w.provider_area_id is not null as shipping_area,
          coalesce(p.street_address is not null and p.pic_name is not null and p.pic_phone is not null,false) as pickup_ready
        from app.warehouse w left join lateral (select x.street_address,x.pic_name,x.pic_phone from app.warehouse_pickup_profile x
          where x.warehouse_id=w.id order by x.revision desc limit 1) p on true
        where w.active
        and (${principal.roles.includes("owner")} or exists (select 1 from app.warehouse_membership m where m.user_id=${principal.id} and m.warehouse_id=w.id))
        and (${pattern}::text is null or concat_ws(' ',w.name,w.district,w.city,w.province) ilike ${pattern})
        and (${cursor}::uuid is null or w.id>${cursor}::uuid)) r
        where ${profile}::text is null or r.pickup_ready=(${profile}='complete') order by r.id limit ${limit + 1}`;
      return privateJson({ data: rows.slice(0, limit).map(projectWarehouse), pagination: { next_cursor: rows.length > limit ? rows[limit - 1].id : null } });
    }
    const warehouse = /^\/api\/v1\/admin\/warehouses\/([^/]+)$/.exec(url.pathname);
    if (request.method === "GET" && warehouse) {
      // S134: one warehouse with the list's roles and scope; outside the scope (or inactive) it is a 404, never a 403, so ids do not probe.
      if (!principal.roles.some((role) => ["owner", "ecommerce_admin", "warehouse"].includes(role))) throw new AccessError(403, "FORBIDDEN");
      if (url.search || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(warehouse[1])) throw new AccessError(400, "INVALID_INPUT");
      const [row] = await identity.sql<WarehouseRow[]>`
        select w.id,w.admin_no,w.name,w.city,w.province,w.district,w.timezone,w.active,w.provider_area_id is not null as shipping_area,
          coalesce((select x.street_address is not null and x.pic_name is not null and x.pic_phone is not null from app.warehouse_pickup_profile x
            where x.warehouse_id=w.id order by x.revision desc limit 1),false) as pickup_ready
        from app.warehouse w where w.active and w.id=${warehouse[1].toLowerCase()}::uuid
        and (${principal.roles.includes("owner")} or exists (select 1 from app.warehouse_membership m where m.user_id=${principal.id} and m.warehouse_id=w.id))`;
      if (!row) throw new AccessError(404, "NOT_FOUND");
      return privateJson(projectWarehouse(row));
    }
    throw new AccessError(404, "NOT_FOUND");
  } catch (error) { return problem(error); }
}
