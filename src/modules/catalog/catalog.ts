import { createHash, randomUUID } from "node:crypto";
import type { Sql, TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { array, attributes, definitions, id, image, integer, invalid, object, offerInput, pageInput, sku, text } from "./validation.ts";

type Definition = ReturnType<typeof offerInput> & { id: string; catalog_id: string; sku: string; retired: boolean };
type Revision = { id: string; catalog_id: string; slug: string; version: number; name: string; category_id: string;
  description: string; images: ReturnType<typeof image>[]; facts: ReturnType<typeof attributes>; variants: Definition[] };
// owner: Super Admin authority (exception proofs). company: company-wide product
// scope. financialCodes: may see cost/margin publication blocker codes.
type Authority = { owner: boolean; company: boolean; financialCodes: boolean; warehouseIds: string[] };

/**
 * Current catalog authority, rechecked under the grant-replacement actor lock.
 * Writes: owner (company) or ecommerce_admin (warehouse-scoped). Reads (`read`)
 * additionally admit warehouse staff with the same warehouse scope and finance
 * with an explicit finance.costs.read grant (company scope, matching cost reads).
 */
export async function authority(tx: TransactionSql, principal: Principal, read = false): Promise<Authority> {
  // Grant writers lock this same user first, so revocation and catalog mutations serialize.
  await tx`select id from app.auth_user where id=${principal.id} for update`;
  const [grant] = await tx`select g.roles, g.permissions from app.role_grant g join app.auth_user u on u.id=g.user_id
    join app.auth_session s on s.user_id=u.id join app.mfa_session m on m.session_id=s.id
    where u.id=${principal.id} and s.id=${principal.sessionId} and s.expires_at>clock_timestamp()
    and u.two_factor_enabled for share of g,s,m`;
  const roles: string[] = grant?.roles ?? [];
  const owner = roles.includes("owner");
  const costReader = read && roles.includes("finance") && (grant?.permissions ?? []).includes("finance.costs.read");
  const scoped = roles.includes("ecommerce_admin") || (read && roles.includes("warehouse"));
  if (!owner && !scoped && !costReader) throw new AccessError(403, "FORBIDDEN");
  const rows = await tx`select w.id from app.warehouse_membership m join app.warehouse w on w.id=m.warehouse_id
    where m.user_id=${principal.id} and w.active`;
  return { owner, company: owner || costReader, financialCodes: owner || costReader || roles.includes("ecommerce_admin"),
    warehouseIds: rows.map((v) => v.id) };
}
// Publication blockers that state no cost or margin fact.
const CATALOG_BLOCKERS = new Set(["MEDIA_REQUIRED", "DESCRIPTION_REQUIRED", "INVALID_OFFER_COUNT", "CATEGORY_REQUIRED", "INVALID_OFFER",
  "REQUIRED_FACT_MISSING", "FACT_TYPE_INVALID", "COMPLETE_STOCK_REQUIRED", "ACTIVE_WAREHOUSE_REQUIRED"]);
/** Readers without cost/margin authority see financial blockers as one generic code. */
export function visibleBlocker(access: Authority, code: string) {
  return access.financialCodes || CATALOG_BLOCKERS.has(code) ? code : "FINANCIAL_REVIEW_REQUIRED";
}
export function assertScope(revision: { variants: readonly { retired?: boolean; default_warehouse_id: string }[] }, access: Authority) {
  if (!access.company && revision.variants.some((v) => !v.retired && !access.warehouseIds.includes(v.default_warehouse_id))) throw new AccessError(404, "NOT_FOUND");
}

// Trusted server consumers use a specific revision, never a mutable current definition.
export async function readCatalogRevision(sql: Sql | TransactionSql, productId: string, version: number | null = null): Promise<Revision> {
  const [row] = await sql`select p.id,p.catalog_id,p.slug,r.revision,r.name,r.description,r.category_id,r.images,r.facts
    from app.product p join app.product_revision r on r.product_id=p.id and r.revision=coalesce(${version}::int,p.revision) where p.id=${productId}`;
  if (!row) throw new AccessError(404, "NOT_FOUND");
  const offers = await sql`select o.id,o.catalog_id,o.sku,v.label,v.attributes,v.image,v.kind,v.retired,
    v.weight_grams,v.length_mm,v.width_mm,v.height_mm,v.default_warehouse_id from app.offer_revision v
    join app.offer o on o.id=v.offer_id where v.product_id=${productId} and v.revision=${row.revision} order by o.id`;
  const contents = await sql`select offer_id,stock_item_id,name,quantity from app.offer_component
    where product_id=${productId} and revision=${row.revision} order by stock_item_id`;
  return { id: row.id, catalog_id: row.catalog_id, slug: row.slug, version: row.revision, name: row.name,
    description: row.description, category_id: row.category_id, images: row.images, facts: row.facts,
    variants: offers.map((v) => ({ id: v.id, catalog_id: v.catalog_id, sku: v.sku, label: v.label, attributes: v.attributes,
      image: v.image, retired: v.retired, offer_kind: v.kind, weight_grams: v.weight_grams,
      length_mm: v.length_mm, width_mm: v.width_mm, height_mm: v.height_mm, default_warehouse_id: v.default_warehouse_id,
      contents: contents.filter((c) => c.offer_id === v.id).map((c) => ({ stock_item_id: c.stock_item_id, name: c.name, quantity: c.quantity })) })) };
}
function project(revision: Revision) {
  return { id: revision.id, catalog_id: revision.catalog_id, slug: revision.slug, version: revision.version,
    name: revision.name, category_id: revision.category_id, description: revision.description, images: revision.images,
    facts: revision.facts, status: "draft", variants: revision.variants.filter((v) => !v.retired).sort((a, b) => a.id.localeCompare(b.id)).map((v) => ({
      id: v.id, catalog_id: v.catalog_id, sku: v.sku, label: v.label, attributes: v.attributes,
      price: 99000, currency: "IDR", availability: "unavailable", image: v.image ?? revision.images[0] ?? null,
      offer_kind: v.offer_kind, contents: v.contents, weight_grams: v.weight_grams, length_mm: v.length_mm,
      width_mm: v.width_mm, height_mm: v.height_mm, default_warehouse_id: v.default_warehouse_id })) };
}
async function mutate(request: Request, identity: LocalAuth, principal: Principal, action: string, input: unknown,
  write: (tx: TransactionSql, access: Authority) => Promise<{ id: string; response: unknown; reason: string }>) {
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[A-Za-z0-9_-]{16,200}$/.test(key)) throw new AccessError(400, "INVALID_IDEMPOTENCY_KEY");
  const hash = createHash("sha256").update(JSON.stringify({ action, input })).digest("hex");
  return identity.sql.begin(async (tx) => {
    const access = await authority(tx, principal);
    const [prior] = await tx`select request_hash,response from app.access_operation where actor_id=${principal.id} and action='catalog.mutate' and key=${key}`;
    if (prior) {
      if (prior.request_hash !== hash) throw new AccessError(409, "IDEMPOTENCY_CONFLICT");
      if (action.startsWith("catalog.product.")) {
        assertScope(await readCatalogRevision(tx, prior.response.id), access);
        assertScope(prior.response, access);
      }
      return prior.response;
    }
    const result = await write(tx, access);
    await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details)
      values (${principal.id},${action},${result.id},'allowed',${result.reason},${JSON.stringify({ version: (result.response as { version?: number }).version ?? null })}::jsonb)`;
    await tx`insert into app.access_operation (actor_id,action,key,request_hash,response)
      values (${principal.id},'catalog.mutate',${key},${hash},${JSON.stringify(result.response)}::jsonb)`;
    return result.response;
  });
}
export async function createCategory(request: Request, identity: LocalAuth, principal: Principal, value: unknown) {
  const data = object(value, ["name", "slug", "parent_id", "attribute_definitions"]);
  const input = { name: text(data.name, 200), slug: text(data.slug, 100), parent_id: data.parent_id === null ? null : id(data.parent_id),
    attribute_definitions: definitions(data.attribute_definitions) };
  if (input.slug !== data.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug)) throw invalid();
  return mutate(request, identity, principal, "catalog.category.create", input, async (tx) => {
    let depth = 1;
    if (input.parent_id) {
      const ancestors = await tx`with recursive parents as (select id,parent_id,depth,attribute_definitions from app.category where id=${input.parent_id}
        union all select c.id,c.parent_id,c.depth,c.attribute_definitions from app.category c join parents p on c.id=p.parent_id)
        select depth,attribute_definitions from parents`;
      if (!ancestors.length) throw new AccessError(404, "NOT_FOUND");
      depth = Math.max(...ancestors.map((v) => Number(v.depth))) + 1;
      if (depth > 3 || input.attribute_definitions.some((d) => ancestors.some((a) => a.attribute_definitions.some((v: { key: string }) => v.key === d.key)))) throw new AccessError(422, "INVALID_TAXONOMY");
    }
    const [row] = await tx`insert into app.category (name,slug,parent_id,depth,attribute_definitions)
      values (${input.name},${input.slug},${input.parent_id},${depth},${JSON.stringify(input.attribute_definitions)}::jsonb) returning id,name,slug,parent_id,depth,attribute_definitions`;
    return { id: row.id, response: row, reason: "Create catalog category" };
  });
}
export async function createStockItem(request: Request, identity: LocalAuth, principal: Principal, value: unknown) {
  const data = object(value, ["sku", "name"]); const input = { sku: sku(data.sku), name: text(data.name, 200) };
  return mutate(request, identity, principal, "catalog.stock_item.create", input, async (tx) => {
    const [row] = await tx`insert into app.stock_item (sku,name) values (${input.sku},${input.name}) returning id,sku,name`;
    return { id: row.id, response: row, reason: "Create physical SKU identity" };
  });
}
function newOffer(input: ReturnType<typeof offerInput>): Definition {
  return { ...input, sku: sku(input.sku), id: randomUUID(), catalog_id: `v_${randomUUID()}`, retired: false };
}
async function saveRevision(tx: TransactionSql, state: Revision, access: Authority, actorId: string, reason: string) {
  const active = state.variants.filter((v) => !v.retired);
  if (active.length < 1 || active.length > 100) throw new AccessError(422, "INVALID_OFFER_COUNT");
  if (!(await tx`select id from app.category where id=${state.category_id}`).length) throw new AccessError(404, "NOT_FOUND");
  const warehouseIds = [...new Set(active.map((v) => v.default_warehouse_id))];
  if (!access.owner && warehouseIds.some((v) => !access.warehouseIds.includes(v))) throw new AccessError(403, "FORBIDDEN");
  const warehouses = await tx`select id from app.warehouse where id in ${tx(warehouseIds)} and active for share`;
  if (warehouses.length !== warehouseIds.length) throw new AccessError(400, "INVALID_WAREHOUSE_SCOPE");
  const stockIds = [...new Set(state.variants.flatMap((v) => v.contents.map((c) => c.stock_item_id)))];
  const stocks = await tx`select id,name from app.stock_item where id in ${tx(stockIds)}`;
  if (stocks.length !== stockIds.length) throw new AccessError(404, "NOT_FOUND");
  if (state.variants.some((v) => v.contents.some((c) => stocks.find((s) => s.id === c.stock_item_id)?.name !== c.name))) throw new AccessError(422, "COMPONENT_NAME_MISMATCH");
  await tx`insert into app.product_revision (product_id,revision,name,description,category_id,images,facts,actor_id,reason)
    values (${state.id},${state.version},${state.name},${state.description},${state.category_id},${JSON.stringify(state.images)}::jsonb,${JSON.stringify(state.facts)}::jsonb,${actorId},${reason})`;
  for (const v of state.variants) {
    await tx`insert into app.offer (id,product_id,catalog_id,sku) values (${v.id},${state.id},${v.catalog_id},${v.sku}) on conflict (id) do nothing`;
    await tx`insert into app.offer_revision (product_id,revision,offer_id,label,attributes,image,kind,retired,weight_grams,length_mm,width_mm,height_mm,default_warehouse_id)
      values (${state.id},${state.version},${v.id},${v.label},${JSON.stringify(v.attributes)}::jsonb,${v.image ? JSON.stringify(v.image) : null}::jsonb,
        ${v.offer_kind},${v.retired},${v.weight_grams},${v.length_mm},${v.width_mm},${v.height_mm},${v.default_warehouse_id})`;
    for (const c of v.contents) await tx`insert into app.offer_component (product_id,revision,offer_id,stock_item_id,name,quantity)
      values (${state.id},${state.version},${v.id},${c.stock_item_id},${c.name},${c.quantity})`;
  }
  await tx`update app.product set revision=${state.version} where id=${state.id}`;
}
export async function createProduct(request: Request, identity: LocalAuth, principal: Principal, value: unknown) {
  const data = object(value, ["name", "description", "category_id", "images", "variants"]);
  const input = { name: text(data.name, 200), description: text(data.description, 10000, true), category_id: id(data.category_id),
    images: array(data.images, image, 0, 20), variants: array(data.variants, (v) => offerInput(v, true), 1) };
  return mutate(request, identity, principal, "catalog.product.create", input, async (tx, access) => {
    const productId = randomUUID(); const state: Revision = { ...input, id: productId, catalog_id: `p_${randomUUID()}`,
      slug: `p-${productId}`, version: 1, facts: [], variants: input.variants.map(newOffer) };
    await tx`insert into app.product (id,catalog_id,slug) values (${state.id},${state.catalog_id},${state.slug})`;
    await saveRevision(tx, state, access, principal.id, "Create inactive product draft");
    return { id: state.id, response: project(state), reason: "Create inactive product draft" };
  });
}
export async function patchProduct(request: Request, identity: LocalAuth, principal: Principal, productId: string, value: unknown) {
  const data = object(value, ["name", "description", "category_id", "facts", "images", "reason", "expected_version", "variant_changes"]);
  const input = { product_id: id(productId), expected_version: integer(data.expected_version, 1), reason: text(data.reason, 500),
    ...(data.name === undefined ? {} : { name: text(data.name, 200) }),
    ...(data.description === undefined ? {} : { description: text(data.description, 10000, true) }),
    ...(data.category_id === undefined ? {} : { category_id: id(data.category_id) }),
    ...(data.images === undefined ? {} : { images: array(data.images, image, 0, 20) }),
    ...(data.facts === undefined ? {} : { facts: attributes(data.facts) }),
    changes: data.variant_changes === undefined ? [] : array(data.variant_changes, (value) => {
      const row = object(value, ["operation", "variant_id", "create", "update"]);
      if (row.operation === "create" && row.variant_id === undefined && row.update === undefined) return { operation: "create", create: offerInput(row.create, true) } as const;
      if (row.operation === "update" && row.create === undefined) return { operation: "update", id: id(row.variant_id), update: offerInput(row.update, false) } as const;
      if (row.operation === "retire" && row.create === undefined && row.update === undefined) return { operation: "retire", id: id(row.variant_id) } as const;
      throw invalid();
    }, 1) };
  if (!["name", "description", "category_id", "facts", "images", "variant_changes"].some((k) => k in data)) throw invalid();
  const targets = input.changes.flatMap((v) => v.operation === "create" ? [] : [v.id]);
  if (new Set(targets).size !== targets.length) throw new AccessError(422, "DUPLICATE_VARIANT_TARGET");
  return mutate(request, identity, principal, "catalog.product.patch", input, async (tx, access) => {
    await tx`select id from app.product where id=${input.product_id} for update`;
    const before = await readCatalogRevision(tx, input.product_id); assertScope(before, access);
    if (before.version !== input.expected_version) throw new AccessError(409, "VERSION_CONFLICT");
    const { product_id: _id, expected_version: _version, reason, changes, ...fields } = input;
    const state: Revision = { ...before, ...fields, version: before.version + 1, variants: before.variants.filter((v) => !v.retired) };
    for (const change of changes) {
      if (change.operation === "create") { state.variants.push(newOffer(change.create)); continue; }
      const position = state.variants.findIndex((v) => v.id === change.id);
      if (position < 0) throw new AccessError(404, "NOT_FOUND");
      state.variants[position] = change.operation === "retire" ? { ...state.variants[position], retired: true }
        : { ...state.variants[position], ...change.update };
    }
    await saveRevision(tx, state, access, principal.id, reason);
    return { id: state.id, response: project(state), reason };
  });
}
export async function readCatalog(identity: LocalAuth, principal: Principal, url: URL, productId?: string) {
  if (productId && url.search) throw invalid();
  const page = productId ? null : pageInput(url);
  return identity.sql.begin(async (tx) => {
    // The physical-SKU dictionary stays with catalog editors; products/categories admit read roles.
    const access = await authority(tx, principal, Boolean(productId) || !url.pathname.endsWith("/stock-items"));
    if (productId) { const state = await readCatalogRevision(tx, id(productId)); assertScope(state, access); return project(state); }
    if (!page) throw invalid();
    const path = url.pathname;
    // S104: categories are immutable rows (DEC-011 renames create new ones), so only categories used by a
    // product's current draft or live publication, plus their ancestors, are listed; old rows stay readable by id.
    const rows = path.endsWith("/categories") ? await tx`with recursive used(id) as (
        select r.category_id from app.product p join app.product_revision r on r.product_id=p.id and r.revision=p.revision
        union select r.category_id from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
          join app.product_revision r on r.product_id=v.product_id and r.revision=v.product_revision
          where h.revision>0 and not exists (select 1 from app.publication_withdrawal w where w.publication_id=v.id)
        union select c.parent_id from app.category c join used u on u.id=c.id where c.parent_id is not null)
      select id,name,slug,parent_id,depth,attribute_definitions from app.category
      where id in (select id from used) and (${page.cursor}::uuid is null or id>${page.cursor}::uuid) order by id limit ${page.limit + 1}`
      : path.endsWith("/stock-items") ? await tx`select id,sku,name from app.stock_item
        where (${page.cursor}::uuid is null or id>${page.cursor}::uuid) order by id limit ${page.limit + 1}`
      : await tx`select p.id,p.catalog_id,p.slug,p.revision as version,r.name from app.product p
        join app.product_revision r on r.product_id=p.id and r.revision=p.revision
        where (${page.cursor}::uuid is null or p.id>${page.cursor}::uuid) and (${access.company} or not exists (
          select 1 from app.offer_revision v where v.product_id=p.id and v.revision=p.revision and not v.retired
          and not exists (select 1 from app.warehouse_membership m join app.warehouse w on w.id=m.warehouse_id
            where m.user_id=${principal.id} and w.active and w.id=v.default_warehouse_id))) order by p.id limit ${page.limit + 1}`;
    return { data: rows.slice(0, page.limit), pagination: { next_cursor: rows.length > page.limit ? rows[page.limit - 1].id : null } };
  });
}
