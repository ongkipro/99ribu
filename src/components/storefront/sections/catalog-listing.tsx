import Link from "next/link";
import { getLocalAuth } from "../../../modules/access/auth";
import { AccessError } from "../../../modules/access/policy";
import {
	catalogQuery,
	featuredDepartments,
	listCategories,
	listProducts,
	type CatalogQuery,
	type PublicCategory,
	publicCategory,
} from "../../../modules/storefront/catalog";
import { isListingParam } from "../../../modules/storefront/navigation";
import { Listing } from "./listing";
import type { Collection } from "./category-collections";
import { Shell } from "../shell";

type Raw = Record<string, string | string[] | undefined>;
// The public list pages by category id; follow its cursor so a category is never dropped.
// lazy: capped at 1,000 categories; a larger catalog needs a searchable category picker, not a <select>.
async function allCategories(identity: ReturnType<typeof getLocalAuth>) {
	const data: Awaited<ReturnType<typeof listCategories>>["data"] = [];
	let cursor: string | null = null;
	for (let page = 0; page < 10; page++) {
		const params = new URLSearchParams({ limit: "100" });
		if (cursor) params.set("cursor", cursor);
		const result = await listCategories(identity, params);
		data.push(...result.data);
		cursor = result.pagination.next_cursor;
		if (!cursor) break;
	}
	return { data };
}

const isPlain = (input: CatalogQuery) =>
	!input.q &&
	!input.cursor &&
	!input.offer_kind &&
	!input.availability &&
	input.sort === "relevance" &&
	!Object.keys(input.attributes).length;
// Category feed cards above the full grid (clean category URL only). Each card is a real listing
// view it links to: the category's newest, its mixed bundles when there are enough, otherwise the
// next department in catalog order. A card needs four products; with fewer the grid says it all.
async function collectionsFor(
	identity: ReturnType<typeof getLocalAuth>,
	category: PublicCategory,
	path: string,
): Promise<Collection[]> {
	const query = (params: Record<string, string>) =>
		catalogQuery(new URLSearchParams({ limit: "8", ...params }));
	const bundle = query({ category_id: category.id, offer_kind: "bundle" });
	const [newest, bundles, departments] = await Promise.all([
		listProducts(identity, query({ category_id: category.id, sort: "newest" })),
		listProducts(identity, bundle),
		featuredDepartments(identity, 100),
	]);
	if (newest.data.length < 4) return [];
	const cards: Collection[] = [
		{ title: "Baru masuk", href: `${path}?sort=newest`, products: newest.data },
	];
	if (bundles.data.length >= 4)
		cards.push({
			title: "Paket campuran",
			href: `${path}?offer_kind=bundle`,
			products: bundles.data,
			input: bundle,
		});
	else {
		const at = departments.findIndex((d) => d.id === category.id);
		const next = departments.filter((d) => d.id !== category.id)[
			Math.max(at, 0) % Math.max(departments.length - 1, 1)
		];
		const other = next
			? await listProducts(
					identity,
					query({ category_id: next.id, sort: "newest" }),
				)
			: null;
		if (next && other && other.data.length >= 4)
			cards.push({
				title: `Jelajahi ${next.name}`,
				href: `/kategori/${next.slug}`,
				products: other.data,
			});
	}
	return cards;
}

// Shared by /search and /category/<slug>. Parameters that are not listing state (utm_*, gclid,
// fbclid, ...) are ignored instead of failing (a malformed filter.* key still gets the recovery page); a category page pins its own category and keeps
// pagination and filter links on its own path.
export async function CatalogListing({
	raw: input,
	category: pinned = null,
}: {
	raw: Raw;
	category?: PublicCategory | null;
}) {
	const raw: Raw = Object.fromEntries(
		Object.entries(input).filter(
			([key]) => isListingParam(key) || key.startsWith("filter."),
		),
	);
	if (pinned) raw.category_id = pinned.id;
	const basePath = pinned ? `/kategori/${pinned.slug}` : "/cari",
		params = new URLSearchParams();
	for (const [key, value] of Object.entries(raw)) {
		if (Array.isArray(value)) for (const v of value) params.append(key, v);
		else if (value !== undefined) params.set(key, value);
	}
	const q = typeof raw.q === "string" ? raw.q : "";
	try {
		const attributes: Record<string, string[]> = {};
		for (const key of new Set(params.keys()))
			if (key.startsWith("filter.")) {
				if (
					!/^filter\.[a-z][a-z0-9_]{0,49}$/.test(key) ||
					params.has("attributes")
				)
					throw new AccessError(400, "INVALID_INPUT");
				attributes[key.slice(7)] = params.getAll(key);
				params.delete(key);
			}
		if (Object.keys(attributes).length)
			params.set("attributes", JSON.stringify(attributes));
		// Owner 2026-10-30: listing pages hold 30 cards, five full rows at six columns (the step island shows five rows at a time).
		if (!params.has("limit")) params.set("limit", "30");
		const input = catalogQuery(params),
			identity = getLocalAuth();
		const [result, categories] = await Promise.all([
			listProducts(identity, input),
			allCategories(identity),
		]);
		const category = input.category_id
			? await publicCategory(identity.sql, input.category_id)
			: null;
		const collections =
			pinned && isPlain(input)
				? await collectionsFor(identity, pinned, basePath)
				: [];
		const current = category ? [category] : [];
		const products = result.data;
		const next = result.pagination.next_cursor;
		const options = [
			...new Map(
				[...current, ...categories.data].map((c) => [c.id, c]),
			).values(),
		];
		return (
			<Shell
				q={input.q}
				active={input.category_id && !input.q ? "category" : "none"}
				department={category?.slug ?? (input.q ? null : "all")}
			>
				<Listing
					input={input}
					products={products}
					next={next}
					categories={
						options as {
							id: string;
							name: string;
							slug: string;
							parent_id: string | null;
						}[]
					}
					categoryName={current[0]?.name}
					collections={collections}
					facets={result.available_filters}
					pinned={pinned ? { id: pinned.id, path: basePath } : undefined}
				/>
			</Shell>
		);
	} catch (error) {
		if (!(error instanceof AccessError) || ![400, 404].includes(error.status))
			throw error;
		const safeQuery = [...q].slice(0, 200).join("");
		const issue =
			typeof raw.sort === "string" &&
			!["", "relevance", "newest"].includes(raw.sort)
				? "Urutan produk belum dikenal. Pilih Paling sesuai atau Publikasi terbaru."
				: error.status === 404
					? "Kategori yang dipilih belum tersedia."
					: "Ada parameter filter yang belum didukung atau nilainya tidak sesuai.";
		return (
			<Shell q={safeQuery} active="none">
				<main id="main" className="wrap empty-state">
					<h1>Filter belum bisa digunakan</h1>
					<p>{issue}</p>
					{safeQuery && <p>Pencarian: “{safeQuery}”</p>}
					<Link
						className="button"
						href={
							safeQuery ? `/cari?q=${encodeURIComponent(safeQuery)}` : basePath
						}
					>
						Hapus filter
					</Link>
				</main>
			</Shell>
		);
	}
}
