import type { Sql } from "postgres";

// S102 admin product detail: the Google product category the local feed emits for a draft (offer
// SKU override, else the department default), read-only. Same mapping as feed.ts catalogFeed.
// lazy: read from the committed dataset (loaded on first use, kept per process) instead of a stored
// column; S106 persists the category per product and replaces this module.
type Dataset = {
	categories: { slug: string; google_product_category?: number }[];
	products: { google_product_category?: number; offer: { sku: string } }[];
};
let maps: Promise<{ bySlug: Map<string, string>; bySku: Map<string, string> }> | null = null;
const load = () =>
	import("../../../data/catalog/berlapak/catalog.json", { with: { type: "json" } }).then(({ default: raw }) => {
		const dataset = raw as Dataset;
		return {
			bySlug: new Map(dataset.categories.flatMap((c) => (c.google_product_category ? [[c.slug, String(c.google_product_category)] as const] : []))),
			bySku: new Map(dataset.products.flatMap((p) => (p.google_product_category ? [[p.offer.sku, String(p.google_product_category)] as const] : []))),
		};
	});

export async function draftGoogleCategory(sql: Sql, categoryId: string | null, offerIds: readonly string[]) {
	if (!categoryId) return null;
	maps ??= load();
	const { bySlug, bySku } = await maps;
	const [root] = await sql`with recursive up as (select id,slug,parent_id from app.category where id=${categoryId}
		union select c.id,c.slug,c.parent_id from app.category c join up on c.id=up.parent_id) select slug from up where parent_id is null`;
	const skus = offerIds.length ? (await sql`select sku from app.offer where id in ${sql(offerIds)} order by sku`).map((o) => o.sku as string) : [];
	return skus.map((sku) => bySku.get(sku)).find(Boolean) ?? (root ? bySlug.get(root.slug as string) : undefined) ?? null;
}
