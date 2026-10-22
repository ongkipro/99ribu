import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Sql, TransactionSql } from "postgres";
import { readLocalConfig } from "../../config/local.ts";
import { CATALOG_MEDIA_LIMIT, catalogMediaName, saveCatalogMedia } from "../../storage/catalog-media.ts";
import type { LocalAuth } from "../access/auth.ts";
import { assertCurrentOwner } from "../access/grants.ts";
import { assertOrigin } from "../access/http.ts";
import { AccessError, getPrincipal, type Principal } from "../access/policy.ts";
import { createCategory, createProduct, createStockItem, patchProduct, readCatalogRevision } from "./catalog.ts";
import { publishProduct, readPublicationState, withdrawPublication } from "./publication.ts";
import { array, id, integer, object, sku, text } from "./validation.ts";

// DEC-005 production catalog content. A committed dataset directory holds catalog.json,
// manifest.json and photos/<sha256>.webp. It carries public catalog facts only: no stock,
// cost, supplier or warehouse identity. importCatalog loads it through the real catalog and
// publication services; it never writes stock, cost or order rows.
export const CATALOG_FORMAT = "99ribu.catalog/v1";
export const MANIFEST_FORMAT = "99ribu.catalog-manifest/v1";
const PRICE = 99000, JSON_LIMIT = 16 * 1024 * 1024, SHA = /^[0-9a-f]{64}$/, SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const IMPORT_ACTION = "catalog.import";

export class CatalogDatasetError extends Error {}
const refuse = (message: string): never => { throw new CatalogDatasetError(message); };
// Field validators throw AccessError(400); name the failing record instead.
function field<T>(where: string, parse: () => T): T {
  try { return parse(); } catch (error) { if (error instanceof CatalogDatasetError) throw error; return refuse(`Invalid catalog dataset: ${where}`); }
}

type Content = { stock_item: string; quantity: number };
type Offer = { sku: string; label: string; kind: "unit" | "multipack" | "bundle"; weight_grams: number; length_mm: number; width_mm: number; height_mm: number; contents: Content[] };
type Product = { key: string; name: string; description: string; category: string; photos: { sha256: string; alt: string }[]; offer: Offer };
export type CatalogDocument = { format: string; source: string; source_snapshot: string; price_idr: number;
  categories: { slug: string; name: string }[]; stock_items: { sku: string; name: string }[]; products: Product[] };
export type ManifestDocument = { format: string; catalog_sha256: string; photos: { sha256: string; bytes: number; width: number; height: number }[] };
export type CatalogDataset = { catalog: CatalogDocument; catalogSha256: string; photos: Map<string, { bytes: Buffer; width: number; height: number }> };

export function parseCatalog(value: unknown): CatalogDocument {
  const data = field("catalog root", () => object(value, ["format", "source", "source_snapshot", "price_idr", "categories", "stock_items", "products"]));
  if (data.format !== CATALOG_FORMAT) refuse("Unsupported catalog dataset format.");
  if (data.price_idr !== PRICE) refuse("Every catalog offer must be IDR 99,000.");
  const categories = field("categories", () => array(data.categories, (v) => {
    const row = object(v, ["slug", "name"]); const slug = text(row.slug, 100);
    if (slug !== row.slug || !SLUG.test(slug)) throw new Error();
    return { slug, name: text(row.name, 200) };
  }, 1, 100));
  const stockItems = field("stock_items", () => array(data.stock_items, (v) => {
    const row = object(v, ["sku", "name"]); return { sku: sku(row.sku), name: text(row.name, 200) };
  }, 1, 10000));
  const products = field("products", () => array(data.products, (v) => v, 1, 10000)).map((v, index) => field(`products[${index}]`, () => {
    const row = object(v, ["key", "name", "description", "category", "photos", "offer"]);
    const key = text(row.key, 40); if (key !== row.key || !/^[A-Za-z0-9-]+$/.test(key)) throw new Error();
    const photos = array(row.photos, (p) => {
      const photo = object(p, ["sha256", "alt"]); if (typeof photo.sha256 !== "string" || !SHA.test(photo.sha256)) throw new Error();
      return { sha256: photo.sha256, alt: text(photo.alt, 500) };
    }, 1, 20);
    const o = object(row.offer, ["sku", "label", "kind", "weight_grams", "length_mm", "width_mm", "height_mm", "contents"]);
    const contents = array(o.contents, (c) => {
      const item = object(c, ["stock_item", "quantity"]); return { stock_item: sku(item.stock_item), quantity: integer(item.quantity, 1, 1000) };
    }, 1, 20);
    const kind = o.kind;
    if ((kind === "unit" && (contents.length !== 1 || contents[0].quantity !== 1)) || (kind === "multipack" && (contents.length !== 1 || contents[0].quantity < 2)) ||
      (kind === "bundle" && contents.length < 2) || !["unit", "multipack", "bundle"].includes(kind as string)) throw new Error();
    if (new Set(contents.map((c) => c.stock_item)).size !== contents.length) throw new Error();
    return { key, name: text(row.name, 200), description: text(row.description, 10000), category: text(row.category, 100), photos,
      offer: { sku: sku(o.sku), label: text(o.label, 200), kind: kind as Offer["kind"], weight_grams: integer(o.weight_grams, 1, 1000000),
        length_mm: integer(o.length_mm, 1, 10000), width_mm: integer(o.width_mm, 1, 10000), height_mm: integer(o.height_mm, 1, 10000), contents } };
  }));
  const unique = (values: string[], what: string) => { if (new Set(values).size !== values.length) refuse(`Duplicate ${what} in catalog dataset.`); };
  unique(categories.map((c) => c.slug), "category slug"); unique(stockItems.map((s) => s.sku), "stock item SKU");
  unique(products.map((p) => p.key), "product key"); unique(products.map((p) => p.offer.sku), "offer SKU");
  const slugs = new Set(categories.map((c) => c.slug)), skus = new Set(stockItems.map((s) => s.sku));
  for (const product of products) {
    if (!slugs.has(product.category)) refuse(`Product ${product.key} references an unknown category.`);
    if (product.offer.contents.some((c) => !skus.has(c.stock_item))) refuse(`Product ${product.key} references an unknown stock item.`);
  }
  return { format: CATALOG_FORMAT, source: field("source", () => text(data.source, 100)), source_snapshot: field("source_snapshot", () => text(data.source_snapshot, 100)),
    price_idr: PRICE, categories, stock_items: stockItems, products };
}

// catalog.json alone (no photo verification): enough to know which offers are the live catalog.
export function readCatalogDocument(directory: string): CatalogDocument {
  let bytes: Buffer;
  try { const fd = openSync(join(directory, "catalog.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const stat = fstatSync(fd); if (!stat.isFile() || stat.size > JSON_LIMIT) refuse("catalog.json too large or not a file."); bytes = readFileSync(fd); } finally { closeSync(fd); } }
  catch (error) { if (error instanceof CatalogDatasetError) throw error; return refuse(`Catalog dataset file missing or not a regular file: ${join(directory, "catalog.json")}`); }
  try { return parseCatalog(JSON.parse(bytes.toString("utf8"))); } catch (error) { if (error instanceof CatalogDatasetError) throw error; return refuse("Malformed JSON: catalog.json"); }
}

// Reads the committed dataset and verifies every byte before any database write: catalog
// digest, exact photo set, per-photo size/hash/WebP dimensions. Photo files are opened without
// following symlinks.
export function readCatalogDataset(directory: string): CatalogDataset {
  const read = (path: string, limit: number) => {
    let fd: number;
    try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); } catch { return refuse(`Catalog dataset file missing or not a regular file: ${path}`); }
    try { const stat = fstatSync(fd); if (!stat.isFile() || stat.size > limit) refuse(`Catalog dataset file too large or not a file: ${path}`); return readFileSync(fd); }
    finally { closeSync(fd); }
  };
  const json = (bytes: Buffer, name: string) => { try { return JSON.parse(bytes.toString("utf8")) as unknown; } catch { return refuse(`Malformed JSON: ${name}`); } };
  const catalogBytes = read(join(directory, "catalog.json"), JSON_LIMIT);
  const catalog = parseCatalog(json(catalogBytes, "catalog.json"));
  const manifest = field("manifest", () => object(json(read(join(directory, "manifest.json"), JSON_LIMIT), "manifest.json"), ["format", "catalog_sha256", "photos"]));
  if (manifest.format !== MANIFEST_FORMAT) refuse("Unsupported catalog manifest format.");
  const catalogSha256 = createHash("sha256").update(catalogBytes).digest("hex");
  if (manifest.catalog_sha256 !== catalogSha256) refuse("catalog.json does not match the manifest digest.");
  const entries = field("manifest photos", () => array(manifest.photos, (v) => {
    const row = object(v, ["sha256", "bytes", "width", "height"]); if (typeof row.sha256 !== "string" || !SHA.test(row.sha256)) throw new Error();
    return { sha256: row.sha256, bytes: integer(row.bytes, 1, CATALOG_MEDIA_LIMIT), width: integer(row.width, 1, 20000), height: integer(row.height, 1, 20000) };
  }, 1, 20000));
  const referenced = new Set(catalog.products.flatMap((p) => p.photos.map((photo) => photo.sha256)));
  if (new Set(entries.map((e) => e.sha256)).size !== entries.length || entries.length !== referenced.size || entries.some((e) => !referenced.has(e.sha256))) {
    refuse("Manifest photo set must equal the photos referenced by catalog.json.");
  }
  const photos = new Map<string, { bytes: Buffer; width: number; height: number }>();
  for (const entry of entries) {
    const bytes = read(join(directory, "photos", `${entry.sha256}.webp`), CATALOG_MEDIA_LIMIT);
    let checked: ReturnType<typeof catalogMediaName>;
    try { checked = catalogMediaName(bytes); } catch { return refuse(`Photo ${entry.sha256} is not a clean WebP within the size limit.`); }
    if (checked.name !== `${entry.sha256}.webp` || bytes.length !== entry.bytes || checked.width !== entry.width || checked.height !== entry.height) {
      refuse(`Photo ${entry.sha256} does not match its manifest entry.`);
    }
    photos.set(entry.sha256, { bytes, width: entry.width, height: entry.height });
  }
  return { catalog, catalogSha256, photos };
}

export async function lockOwner(tx: TransactionSql, principal: Principal) {
  await tx`select id from app.auth_user where id=${principal.id} for update`; await assertCurrentOwner(tx, principal);
}

export type ImportSummary = {
  catalog_sha256: string; photos: { stored: number; existing: number };
  categories: { created: number; existing: number }; stock_items: { created: number; existing: number };
  products: { created: number; revised: number; unchanged: number; preserved: string[] };
  published_now: number; published: number; blocked: Record<string, number>; changed: boolean;
};

// Idempotent, resumable import. Natural keys (category slug, stock/offer SKU) are the
// checkpoint: each step commits through its domain service, and a rerun after any crash
// converges without duplicates. A differing dataset appends a new product revision through
// patchProduct (history stays immutable) only while the current revision was written by this
// importer; a revision authored by staff is preserved and reported. Publication uses the real
// guard only; products blocked by missing stock/cost/policy stay drafts and are reported.
export async function importCatalog(request: Request, identity: LocalAuth, dataset: CatalogDataset, options: { warehouseId: string; signal?: AbortSignal }): Promise<ImportSummary> {
  const { signal } = options; signal?.throwIfAborted();
  const config = readLocalConfig(process.env); assertOrigin(request);
  const warehouseId = field("warehouse id", () => id(options.warehouseId));
  const principal = await getPrincipal(request, identity); await identity.sql.begin((tx) => lockOwner(tx, principal));
  const { catalog, catalogSha256 } = dataset;
  const reserved = await identity.sql.reserve();
  try {
    const lockKey = "99ribu:catalog-import";
    const [lock] = await reserved`select pg_try_advisory_lock(hashtextextended(${lockKey},0)) as ok`;
    if (!lock.ok) refuse("Another catalog import is running; retry after it finishes.");
    try {
      // Preflight (read-only): immutable identities that already exist must match the dataset.
      const [warehouse] = await identity.sql`select active from app.warehouse where id=${warehouseId}`;
      if (!warehouse?.active) refuse("Target warehouse does not exist or is inactive.");
      const categoryRows = await identity.sql`select id,slug,name,parent_id,attribute_definitions from app.category where slug in ${identity.sql(catalog.categories.map((c) => c.slug))}`;
      for (const row of categoryRows) {
        const wanted = catalog.categories.find((c) => c.slug === row.slug);
        if (row.name !== wanted?.name || row.parent_id !== null || row.attribute_definitions.length) refuse(`Category ${row.slug} exists with different immutable content.`);
      }
      const stockRows = await identity.sql`select id,sku,name from app.stock_item where sku in ${identity.sql(catalog.stock_items.map((s) => s.sku))}`;
      for (const row of stockRows) if (row.name !== catalog.stock_items.find((s) => s.sku === row.sku)?.name) refuse(`Stock item ${row.sku} exists with a different immutable name.`);

      const summary: ImportSummary = { catalog_sha256: catalogSha256, photos: { stored: 0, existing: 0 }, categories: { created: 0, existing: categoryRows.length },
        stock_items: { created: 0, existing: stockRows.length }, products: { created: 0, revised: 0, unchanged: 0, preserved: [] }, published_now: 0, published: 0, blocked: {}, changed: false };
      for (const [, photo] of [...dataset.photos].sort(([a], [b]) => a.localeCompare(b))) {
        signal?.throwIfAborted(); const saved = await saveCatalogMedia(photo.bytes);
        if (saved.created) summary.photos.stored++; else summary.photos.existing++;
      }
      // One audit row per writing run; its actor marks revisions this importer owns. Written
      // before the first catalog write so a crash cannot leave unowned import revisions.
      const begin = async () => {
        if (summary.changed) return; summary.changed = true;
        await identity.sql.begin(async (tx) => { await lockOwner(tx, principal);
          await tx`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details) values (${principal.id},${IMPORT_ACTION},${`catalog:${catalog.source}`},'allowed',
            'Import committed catalog dataset through real catalog/publication services',${JSON.stringify({ catalog_sha256: catalogSha256, source_snapshot: catalog.source_snapshot })}::jsonb)`; });
      };
      const command = (step: string) => {
        const next = new Request(`${config.origin}/api/v1/admin/catalog-import`, { method: "POST", headers: request.headers });
        next.headers.set("idempotency-key", createHash("sha256").update(`catalog-import:${catalogSha256}:${step}`).digest("hex")); return next;
      };
      const categories = new Map<string, string>(categoryRows.map((r) => [r.slug as string, r.id as string]));
      for (const category of catalog.categories) {
        signal?.throwIfAborted(); if (categories.has(category.slug)) continue; await begin();
        const row = await createCategory(command(`category:${category.slug}`), identity, principal, { name: category.name, slug: category.slug, parent_id: null, attribute_definitions: [] });
        categories.set(category.slug, row.id); summary.categories.created++;
      }
      const stocks = new Map<string, { id: string; name: string }>(stockRows.map((r) => [r.sku as string, { id: r.id as string, name: r.name as string }]));
      for (const item of catalog.stock_items) {
        signal?.throwIfAborted(); if (stocks.has(item.sku)) continue; await begin();
        const row = await createStockItem(command(`stock:${item.sku}`), identity, principal, { sku: item.sku, name: item.name });
        stocks.set(item.sku, { id: row.id, name: row.name }); summary.stock_items.created++;
      }
      for (const product of catalog.products) {
        signal?.throwIfAborted();
        const images = product.photos.map((photo) => { const meta = dataset.photos.get(photo.sha256) as { width: number; height: number };
          return { url: `${config.origin}/media/catalog/${photo.sha256}.webp`, alt: photo.alt, width: meta.width, height: meta.height }; });
        const variant = { label: product.offer.label, attributes: [], offer_kind: product.offer.kind, weight_grams: product.offer.weight_grams, length_mm: product.offer.length_mm,
          width_mm: product.offer.width_mm, height_mm: product.offer.height_mm, default_warehouse_id: warehouseId,
          contents: product.offer.contents.map((c) => { const stock = stocks.get(c.stock_item) as { id: string; name: string }; return { stock_item_id: stock.id, name: stock.name, quantity: c.quantity }; })
            .sort((a, b) => a.stock_item_id.localeCompare(b.stock_item_id)) };
        const fields = { name: product.name, description: product.description, category_id: categories.get(product.category) as string, images };
        let [stored] = await identity.sql`select id,product_id from app.offer where sku=${product.offer.sku}`;
        const fresh = !stored;
        if (!stored) {
          await begin();
          const created = await createProduct(command(`product:${product.offer.sku}`), identity, principal, { ...fields, variants: [{ sku: product.offer.sku, ...variant }] });
          stored = { id: created.variants[0].id, product_id: created.id }; summary.products.created++;
        }
        const draft = await readCatalogRevision(identity.sql, stored.product_id);
        const active = draft.variants.filter((v) => !v.retired), current = active.find((v) => v.id === stored.id);
        const owned = (await identity.sql`select 1 from app.product_revision r where r.product_id=${draft.id} and r.revision=${draft.version}
          and exists (select 1 from app.audit_event a where a.action=${IMPORT_ACTION} and a.actor_id=r.actor_id)`).length > 0;
        const matches = active.length === 1 && current !== undefined && draft.name === fields.name && draft.description === fields.description && draft.category_id === fields.category_id &&
          isDeepStrictEqual(draft.images, images) && isDeepStrictEqual(draft.facts, []) &&
          isDeepStrictEqual({ label: current.label, attributes: current.attributes, offer_kind: current.offer_kind, weight_grams: current.weight_grams, length_mm: current.length_mm,
            width_mm: current.width_mm, height_mm: current.height_mm, default_warehouse_id: current.default_warehouse_id, contents: current.contents, image: current.image }, { ...variant, image: null });
        let version = draft.version;
        if (!owned || (!matches && (active.length !== 1 || current === undefined))) { summary.products.preserved.push(product.key); continue; }
        if (!matches) {
          await begin();
          const revised = await patchProduct(command(`revise:${product.offer.sku}:${draft.version}`), identity, principal, draft.id, { ...fields, expected_version: draft.version,
            reason: `Catalog dataset import ${catalogSha256.slice(0, 12)}`, variant_changes: [{ operation: "update", variant_id: stored.id, update: variant }] });
          version = revised.version; summary.products.revised++;
        } else if (!fresh) summary.products.unchanged++;
        let state = await readPublicationState(identity, principal, draft.id);
        if (state.ready && state.draft_version === version && state.current?.product_revision !== version) {
          await begin();
          await publishProduct(command(`publish:${product.offer.sku}:${version}:${state.latest_version}`), identity, principal, draft.id,
            { expected_version: version, expected_publication_version: state.latest_version, reason: "Guarded catalog dataset publication; no exception" });
          state = await readPublicationState(identity, principal, draft.id); summary.published_now++;
        }
        if (state.current?.product_revision === version) summary.published++;
        else for (const code of new Set(state.blockers.map((b) => b.code))) summary.blocked[code] = (summary.blocked[code] ?? 0) + 1;
      }
      return summary;
    } finally { await reserved`select pg_advisory_unlock(hashtextextended(${lockKey},0))`; }
  } finally { reserved.release(); }
}

// Publications that are current (head, not withdrawn) for products outside the committed
// catalog: no active offer of the current draft or publication carries a dataset offer SKU.
// `since` + `syntheticOnly` narrow it to one test run's publications by synthetic or removed
// principals, so an operator's own publications are never swept by a test run.
export type WithdrawalCandidate = { product_id: string; version: number; group: string };
export async function withdrawalCandidates(sql: Sql | TransactionSql, keepOfferSkus: readonly string[], options: { since?: string; syntheticOnly?: boolean } = {}) {
  return sql<WithdrawalCandidate[]>`select v.product_id, v.revision as version,
      case when min(o.sku) like 'BL\\_%' then 'BL (S69 snapshot fixture)' when min(o.sku) like 'SF\\_COMMERCE-DEMO\\_%' then 'SF_COMMERCE-DEMO (demo merchandising)'
        when min(o.sku) like 'SF\\_%' then 'SF (storefront fixtures)' when min(o.sku) like 'FX\\_%' then 'FX (commerce fixtures)' else 'other (test-created)' end as "group"
    from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
    join app.offer o on o.product_id=v.product_id
    where not exists (select 1 from app.publication_withdrawal w where w.publication_id=v.id)
      and (${options.since ?? null}::timestamptz is null or v.created_at>=${options.since ?? null}::timestamptz)
      and (not ${options.syntheticOnly ?? false} or not exists (select 1 from app.auth_user u where u.id::text=v.actor_id and u.email not like '%@example.invalid'))
    group by v.product_id, v.revision
    having not bool_or(o.sku in ${sql(keepOfferSkus.length ? [...keepOfferSkus] : [""])})
    order by v.product_id`;
}
export function summarizeCandidates(candidates: readonly WithdrawalCandidate[]) {
  const by_group: Record<string, number> = {};
  for (const c of candidates) by_group[c.group] = (by_group[c.group] ?? 0) + 1;
  return { candidates: candidates.length, by_group };
}
// Applies withdrawals one product at a time through the real publication service (own
// transaction, audit and idempotency each). A product republished meanwhile is skipped.
export async function withdrawCandidates(request: Request, identity: LocalAuth, candidates: readonly WithdrawalCandidate[], reason: string, signal?: AbortSignal) {
  assertOrigin(request); const config = readLocalConfig(process.env);
  const principal = await getPrincipal(request, identity); await identity.sql.begin((tx) => lockOwner(tx, principal));
  let withdrawn = 0; const skipped: Record<string, number> = {};
  for (const candidate of candidates) {
    signal?.throwIfAborted();
    const next = new Request(`${config.origin}/api/v1/admin/products/${candidate.product_id}/publications`, { method: "POST", headers: request.headers });
    next.headers.set("idempotency-key", createHash("sha256").update(`catalog-withdraw:${candidate.product_id}:${candidate.version}`).digest("hex"));
    try { await withdrawPublication(next, identity, principal, candidate.product_id, { expected_publication_version: candidate.version, reason }); withdrawn++; }
    catch (error) { if (!(error instanceof AccessError) || error.status !== 409) throw error; skipped[error.code] = (skipped[error.code] ?? 0) + 1; }
  }
  return { withdrawn, skipped };
}
