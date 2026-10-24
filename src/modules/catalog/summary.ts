import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { offerCommissionIdr } from "../affiliates/rates.ts";
import { resolvePolicy } from "../settings/policies.ts";
import { homeSafe } from "../storefront/department-photos.ts";
import { authority, visibleBlocker } from "./catalog.ts";
import { id, integer, invalid } from "./validation.ts";

export const CATALOG_STATES = ["published", "withdrawn", "ready", "blocked"] as const;
type State = (typeof CATALOG_STATES)[number];

function summaryInput(url: URL) {
  const names = ["cursor", "limit", "q", "category_id", "state", "review"];
  if ([...url.searchParams.keys()].some((key) => !names.includes(key) || url.searchParams.getAll(key).length !== 1)) throw invalid();
  const raw = url.searchParams.get("limit") ?? "20";
  if (!/^\d{1,3}$/.test(raw)) throw invalid();
  const q = url.searchParams.get("q");
  if (q !== null && (!q.isWellFormed() || q.includes("\0") || !q.trim() || Array.from(q).length > 100)) throw invalid();
  const state = url.searchParams.get("state");
  if (state !== null && !CATALOG_STATES.includes(state as State)) throw invalid();
  const review = url.searchParams.get("review");
  if (review !== null && review !== "claim") throw invalid();
  return {
    limit: integer(Number(raw), 1, 100),
    cursor: url.searchParams.has("cursor") ? id(url.searchParams.get("cursor")) : null,
    // ILIKE pattern with the user's text matched literally.
    pattern: q === null ? null : `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
    categoryId: url.searchParams.has("category_id") ? id(url.searchParams.get("category_id")) : null,
    state: state as State | null,
    claimOnly: review === "claim",
  };
}

/** Commercial policy inputs of the financial publish guard, or the blocker code the guard would report. */
async function policyInputs(tx: TransactionSql, at: string) {
  try {
    const policy = await resolvePolicy(tx, "commercial", null, new Date(at));
    if (!("default_commission_bps" in policy.values)) throw new AccessError(503, "POLICY_INVALID");
    const values = policy.values as { default_commission_bps: number; minimum_contribution_idr?: number };
    return { commission: offerCommissionIdr(values.default_commission_bps), floor: values.minimum_contribution_idr ?? 0, code: null };
  } catch (error) {
    // Same handling as readPublicationState: 409/422 become blockers, anything else fails the read.
    if (error instanceof AccessError && [409, 422].includes(error.status)) return { commission: 0, floor: 0, code: error.code };
    throw error;
  }
}

/**
 * Read-only catalog list with publication summary. One SELECT statement reads
 * product, offer, stock, cost and publication rows from a single snapshot and
 * takes no product/inventory/cost row locks (only `authority` keeps its
 * existing session/grant locks). Blocker codes mirror the publish guard
 * (`publicationChecks` + `financialBlockers` in publication.ts) for: media,
 * description, active offer count, category, default-warehouse activity,
 * complete stock in the default warehouse (same formula as `offerAvailability`),
 * missing effective HPP / cost assumptions and the contribution floor under the
 * current commercial policy. Category fact validation (REQUIRED_FACT_MISSING,
 * FACT_TYPE_INVALID), offer re-validation (INVALID_OFFER) and
 * COST_CALCULATION_LIMIT are NOT evaluated here; the per-product publication
 * state endpoint and the publish command remain authoritative.
 */
export async function listProductSummaries(identity: LocalAuth, principal: Principal, url: URL) {
  const page = summaryInput(url);
  return identity.sql.begin(async (tx) => {
    const access = await authority(tx, principal, true);
    const [clock] = await tx`select clock_timestamp()::text as now`;
    const policy = await policyInputs(tx, clock.now);
    // S102 / DEC-013 "Perlu tinjauan klaim": the current draft's name carries a claim term
    // (hasClaimTerm's word list) or one of its photos is a screened claim photo, the same test
    // (homeSafe) that keeps such products off curated home surfaces. The rule lives in code, so the
    // filter resolves the matching product ids first and the summary query stays one statement.
    const claimIds = page.claimOnly
      ? (await tx<{ id: string; name: string; images: { url: string }[] }[]>`select p.id,r.name,r.images from app.product p
          join app.product_revision r on r.product_id=p.id and r.revision=p.revision`).filter((row) => !homeSafe(row)).map((row) => row.id)
      : null;
    // lazy: summaries are computed for every product in scope before the state
    // filter and LIMIT apply (hundreds of products); upgrade path is a
    // maintained readiness projection if the catalog grows to many thousands.
    const rows = await tx`
      with scoped as (
        select p.id, p.catalog_id, p.slug, p.revision as version, r.name, r.description, r.category_id, r.images
        from app.product p join app.product_revision r on r.product_id=p.id and r.revision=p.revision
        where (${page.cursor}::uuid is null or p.id>${page.cursor}::uuid)
          and (${page.pattern}::text is null or r.name ilike ${page.pattern} or p.catalog_id ilike ${page.pattern})
          and (${claimIds === null} or p.id = any(${claimIds ?? []}::uuid[]))
          and (${access.company} or not exists (
            select 1 from app.offer_revision v where v.product_id=p.id and v.revision=p.revision and not v.retired
            and not exists (select 1 from app.warehouse_membership m join app.warehouse w on w.id=m.warehouse_id
              where m.user_id=${principal.id} and w.active and w.id=v.default_warehouse_id)))
      ), categorized as (
        select s.*, c1.id as c1, c2.id as c2, c3.id as c3,
          case when c1.id is null then null else concat_ws(' › ', c3.name, c2.name, c1.name) end as category_path
        from scoped s left join app.category c1 on c1.id=s.category_id
        left join app.category c2 on c2.id=c1.parent_id left join app.category c3 on c3.id=c2.parent_id
        where ${page.categoryId}::uuid is null or ${page.categoryId}::uuid in (c1.id, c2.id, c3.id)
      ), offers as (
        select s.id as product_id, v.offer_id, v.kind, w.id as warehouse_id,
          (select coalesce(floor(min(coalesce(st.available,0)::numeric/c.quantity)),0)
            from app.offer_component c left join lateral (
              select sum((b.on_hand-b.reserved-b.quarantined)::bigint) as available
              from app.inventory_balance b left join app.inventory_lot l on l.id=b.lot_id
              where b.warehouse_id=w.id and b.stock_item_id=c.stock_item_id
                and (l.expires_on is null or l.expires_on>=(app.inventory_clock(w.id) at time zone w.timezone)::date)
            ) st on true where c.product_id=s.id and c.revision=s.version and c.offer_id=v.offer_id) as available,
          (select bool_or(cost.unit_cost is null) or count(*)=0 from app.offer_component c left join lateral (
              select k.unit_cost from app.component_cost_version k where k.stock_item_id=c.stock_item_id
                and k.effective_at<=${clock.now}::timestamptz order by k.effective_at desc,k.revision desc limit 1
            ) cost on true where c.product_id=s.id and c.revision=s.version and c.offer_id=v.offer_id) as hpp_missing,
          (select sum(cost.unit_cost::numeric*c.quantity) from app.offer_component c left join lateral (
              select k.unit_cost from app.component_cost_version k where k.stock_item_id=c.stock_item_id
                and k.effective_at<=${clock.now}::timestamptz order by k.effective_at desc,k.revision desc limit 1
            ) cost on true where c.product_id=s.id and c.revision=s.version and c.offer_id=v.offer_id) as hpp,
          a.packaging_idr, a.provider_fee_idr, a.subsidy_idr, a.returns_reserve_idr
        from categorized s join app.offer_revision v on v.product_id=s.id and v.revision=s.version and not v.retired
        left join app.warehouse w on w.id=v.default_warehouse_id and w.active
        left join lateral (select x.packaging_idr, x.provider_fee_idr, x.subsidy_idr, x.returns_reserve_idr
          from app.offer_cost_assumption_version x where x.offer_id=v.offer_id and x.effective_at<=${clock.now}::timestamptz
          order by x.effective_at desc, x.revision desc limit 1) a on true
      ), offer_codes as (
        select o.product_id, o.kind, o.available, o.warehouse_id, code
        from offers o cross join lateral unnest(array_remove(array[
          case when o.warehouse_id is null then 'ACTIVE_WAREHOUSE_REQUIRED'
               when o.available<1 then 'COMPLETE_STOCK_REQUIRED' end,
          case when ${policy.code}::text is null and o.hpp_missing then 'UNKNOWN_HPP' end,
          case when ${policy.code}::text is null and o.packaging_idr is null then 'UNKNOWN_PACKAGING_IDR' end,
          case when ${policy.code}::text is null and o.provider_fee_idr is null then 'UNKNOWN_PROVIDER_FEE_IDR' end,
          case when ${policy.code}::text is null and o.subsidy_idr is null then 'UNKNOWN_SUBSIDY_IDR' end,
          case when ${policy.code}::text is null and o.returns_reserve_idr is null then 'UNKNOWN_RETURNS_RESERVE_IDR' end,
          case when ${policy.code}::text is null and not o.hpp_missing and o.packaging_idr is not null and o.provider_fee_idr is not null
            and o.subsidy_idr is not null and o.returns_reserve_idr is not null
            and 99000 - o.hpp - o.packaging_idr - o.provider_fee_idr - o.subsidy_idr - o.returns_reserve_idr - ${policy.commission}::bigint
              < ${policy.floor}::bigint then 'BELOW_MARGIN_FLOOR' end
        ]::text[], null)) as code
      ), summary as (
        select s.id, s.catalog_id, s.slug, s.version, s.name, s.category_id, s.category_path,
          s.images->0->>'url' as image_url, s.images,
          coalesce((select array_agg(distinct o.kind order by o.kind) from offers o where o.product_id=s.id), '{}') as offer_kinds,
          (select count(*)::int from offers o where o.product_id=s.id) as offer_count,
          (select count(*)::int from offers o where o.product_id=s.id and o.warehouse_id is not null and o.available>=1) as stock_ready_offers,
          coalesce(h.revision, 0) as latest_publication_version,
          (select v.product_revision from app.publication_version v where v.product_id=s.id and v.revision=h.revision
            and not exists (select 1 from app.publication_withdrawal x where x.publication_id=v.id)) as published_revision,
          array(select distinct code from (
            select 'MEDIA_REQUIRED' as code where jsonb_array_length(s.images)=0
            union all select 'DESCRIPTION_REQUIRED' where s.description !~ '[^[:space:]]'
            union all select 'INVALID_OFFER_COUNT' where not exists (select 1 from offers o where o.product_id=s.id)
            union all select 'CATEGORY_REQUIRED' where s.c1 is null
            union all select ${policy.code}::text where ${policy.code}::text is not null and exists (select 1 from offers o where o.product_id=s.id)
            union all select oc.code from offer_codes oc where oc.product_id=s.id
          ) codes order by code) as blocker_codes
        from categorized s left join app.publication_head h on h.product_id=s.id
      )
      select *, case when published_revision is not null then 'published'
          when latest_publication_version>0 then 'withdrawn'
          when cardinality(blocker_codes)=0 then 'ready' else 'blocked' end as state
      from summary
      where ${page.state}::text is null or ${page.state}::text = case when published_revision is not null then 'published'
          when latest_publication_version>0 then 'withdrawn'
          when cardinality(blocker_codes)=0 then 'ready' else 'blocked' end
      order by id limit ${page.limit + 1}`;
    const data = rows.slice(0, page.limit).map((r) => ({
      id: r.id as string, catalog_id: r.catalog_id as string, slug: r.slug as string, version: Number(r.version), name: r.name as string,
      category_id: (r.category_id as string | null) ?? null, category_path: (r.category_path as string | null) ?? null,
      image_url: (r.image_url as string | null) ?? null, offer_kinds: r.offer_kinds as string[], offer_count: Number(r.offer_count),
      stock_ready_offers: Number(r.stock_ready_offers), price_idr: 99000, state: r.state as State,
      latest_publication_version: Number(r.latest_publication_version),
      published_revision: r.published_revision === null ? null : Number(r.published_revision),
      ready: (r.blocker_codes as string[]).length === 0,
      blocker_codes: [...new Set((r.blocker_codes as string[]).map((code) => visibleBlocker(access, code)))].sort(),
      claim_review: !homeSafe({ name: r.name as string, images: r.images as { url: string }[] }),
    }));
    return { data, pagination: { next_cursor: rows.length > page.limit ? data[page.limit - 1].id : null } };
  });
}
