// Shapes of the admin catalog APIs (src/modules/catalog, finance, inventory)
// and their Indonesian presentation labels. Read-only; servers enforce access.

import { type ApiFailure, getJson } from "./admin-errors";

export type CatalogImage = {
	url: string;
	alt: string;
	width: number;
	height: number;
};
export type CatalogAttribute = { key: string; label: string; values: string[] };
export type OfferKind = "unit" | "multipack" | "bundle";
export type CatalogVariant = {
	id: string;
	catalog_id: string;
	sku: string;
	label: string;
	attributes: CatalogAttribute[];
	price: number;
	image: CatalogImage | null;
	offer_kind: OfferKind;
	contents: { stock_item_id: string; name: string; quantity: number }[];
	weight_grams: number;
	length_mm: number;
	width_mm: number;
	height_mm: number;
	default_warehouse_id: string;
};
export type CatalogProduct = {
	id: string;
	catalog_id: string;
	slug: string;
	version: number;
	name: string;
	category_id: string | null;
	description: string;
	images: CatalogImage[];
	facts: CatalogAttribute[];
	variants: CatalogVariant[];
};
/** Row of GET /api/v1/admin/products (summary computed server-side). */
export type ProductSummary = {
	id: string;
	catalog_id: string;
	slug: string;
	version: number;
	name: string;
	category_id: string | null;
	category_path: string | null;
	image_url: string | null;
	offer_kinds: OfferKind[];
	offer_count: number;
	stock_ready_offers: number;
	price_idr: number;
	state: CatalogStatus;
	latest_publication_version: number;
	published_revision: number | null;
	ready: boolean;
	blocker_codes: string[];
};
export type Category = {
	id: string;
	name: string;
	slug: string;
	parent_id: string | null;
	depth: number;
	/** Fact rules; a product inherits its category's and every ancestor's. */
	attribute_definitions?: { key: string; label: string }[];
};
export type Blocker = {
	code: string;
	offer_id: string | null;
	fact_key?: string;
};
export type PublicationState = {
	latest_version: number;
	current: {
		id: string;
		version: number;
		product_revision: number;
		exception_applied: boolean;
		created_at: string;
	} | null;
	current_review_state: "approved" | "requires_review" | null;
	draft_version: number;
	ready: boolean;
	blockers: Blocker[];
	blocker_count: number;
	blockers_truncated: boolean;
};
export type Page<T> = { data: T[]; pagination: { next_cursor: string | null } };

export const PRICE_IDR = 99000;

/**
 * What the console may show for the catalog. Mirrors the server checks in
 * catalog authority() (read/edit), handleInventory (stock) and handleFinance
 * (costs); hiding is a convenience, every API refuses on its own.
 */
export function catalogAccess(
	roles: readonly string[],
	permissions: readonly string[],
) {
	const owner = roles.includes("owner");
	const edit = owner || roles.includes("ecommerce_admin");
	const stock = edit || roles.includes("warehouse");
	const costs =
		owner ||
		(roles.includes("finance") && permissions.includes("finance.costs.read"));
	// Owner and cost readers see every product; other readers only products
	// whose active offers sit in their warehouses (server authority().company).
	return { read: stock || costs, edit, stock, costs, company: costs };
}

export const idr = new Intl.NumberFormat("id-ID", {
	style: "currency",
	currency: "IDR",
	maximumFractionDigits: 0,
});

export const OFFER_KIND_LABELS: Record<OfferKind, string> = {
	unit: "Satuan",
	multipack: "Multipak",
	bundle: "Bundel",
};

export const BLOCKER_LABELS: Record<string, string> = {
	COMPLETE_STOCK_REQUIRED: "Stok lengkap belum tersedia di gudang",
	ACTIVE_WAREHOUSE_REQUIRED: "Gudang aktif belum ditetapkan",
	UNKNOWN_HPP: "HPP komponen belum diisi",
	UNKNOWN_PACKAGING_IDR: "Biaya kemasan belum diisi",
	UNKNOWN_PROVIDER_FEE_IDR: "Biaya penyedia pembayaran belum diisi",
	UNKNOWN_SUBSIDY_IDR: "Subsidi ongkir belum diisi",
	UNKNOWN_RETURNS_RESERVE_IDR: "Cadangan retur belum diisi",
	BELOW_MARGIN_FLOOR: "Kontribusi di bawah batas minimum",
	MEDIA_REQUIRED: "Foto produk belum ada",
	DESCRIPTION_REQUIRED: "Deskripsi belum diisi",
	INVALID_OFFER_COUNT: "Belum ada varian aktif",
	CATEGORY_REQUIRED: "Kategori belum dipilih",
	INVALID_OFFER: "Data varian belum valid",
	REQUIRED_FACT_MISSING: "Atribut wajib belum diisi",
	FACT_TYPE_INVALID: "Nilai atribut tidak sesuai jenisnya",
	POLICY_INVALID: "Kebijakan margin belum berlaku",
	COST_CALCULATION_LIMIT: "Perhitungan biaya melebihi batas",
	FINANCIAL_REVIEW_REQUIRED: "Perlu tinjauan keuangan",
};

export const blockerLabel = (code: string) => BLOCKER_LABELS[code] ?? code;

export type CatalogStatus = "published" | "withdrawn" | "ready" | "blocked";
export const STATUS_LABELS: Record<CatalogStatus, string> = {
	published: "Terbit",
	withdrawn: "Ditarik dari toko",
	ready: "Draf siap terbit",
	blocked: "Diblokir",
};
export const STATUS_BADGE: Record<
	CatalogStatus,
	"success" | "secondary" | "warning" | "outline"
> = {
	published: "success",
	withdrawn: "outline",
	ready: "secondary",
	blocked: "warning",
};

/** Same derivation as the list API's `state`. */
export function catalogStatus(state: PublicationState): CatalogStatus {
	if (state.current) return "published";
	if (state.latest_version > 0) return "withdrawn";
	return state.ready ? "ready" : "blocked";
}

export function categoryPath(id: string | null, categories: Category[]) {
	if (!id) return null;
	const byId = new Map(categories.map((c) => [c.id, c]));
	const names: string[] = [];
	for (
		let c = byId.get(id);
		c && names.length < 3;
		c = c.parent_id ? byId.get(c.parent_id) : undefined
	)
		names.unshift(c.name);
	return names.length ? names.join(" › ") : null;
}

/** Runs `task` over `items` with at most `limit` in flight. */
export async function mapLimit<T>(
	items: T[],
	limit: number,
	task: (item: T) => Promise<void>,
) {
	let next = 0;
	const worker = async () => {
		while (next < items.length) await task(items[next++]);
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
}

/** Follows cursor pages to the end (bounded) for reference lists. */
export async function readAll<T>(
	path: string,
	maxPages = 20,
): Promise<
	| { ok: true; data: T[]; complete: boolean }
	| { ok: false; failure: ApiFailure }
> {
	const rows: T[] = [];
	let cursor: string | null = null;
	for (let i = 0; i < maxPages; i++) {
		const sep = path.includes("?") ? "&" : "?";
		const res:
			| { ok: true; data: Page<T> }
			| { ok: false; failure: ApiFailure } = await getJson<Page<T>>(
			`${path}${sep}limit=100${cursor ? `&cursor=${cursor}` : ""}`,
		);
		if (!res.ok) return res;
		rows.push(...res.data.data);
		cursor = res.data.pagination.next_cursor;
		if (!cursor) return { ok: true, data: rows, complete: true };
	}
	return { ok: true, data: rows, complete: false };
}
