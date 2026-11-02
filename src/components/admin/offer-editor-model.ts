import type { CatalogProduct, CatalogVariant } from "./catalog-model";

// S151 (spec 17 W4-3, DEC-025): pure rules of the offer editor on the product detail page. Limits mirror
// src/modules/catalog/validation.ts offerInput(); the server stays the authority and every refusal is mapped.

export const PRICE_MIN_IDR = 1;
export const PRICE_MAX_IDR = 99000;
export const LABEL_MAX = 200;
export const WEIGHT_MAX_GRAMS = 1_000_000;
export const DIMENSION_MAX_MM = 10_000;
export const REASON_MAX = 500;
export const OFFER_MAX = 100;
export const QUANTITY_MAX = 1_000_000;
export const SKU_PATTERN = /^[A-Z0-9_-]{1,100}$/;

/** What a new offer fixes at creation; the editor only edits label, price and weight afterwards. */
export type FreshOffer = {
	sku: string;
	length_mm: number;
	width_mm: number;
	height_mm: number;
	default_warehouse_id: string;
	stock_item_id: string;
	stock_name: string;
	quantity: number;
};

/** One editable line, kept as text so a half-typed number is refused instead of coerced. */
export type OfferRow = {
	/** The offer id for a saved offer, "new-N" for one added in this session. */
	key: string;
	id: string | null;
	label: string;
	price: string;
	weight: string;
	fresh: FreshOffer | null;
};

export type OfferField = "label" | "price" | "weight" | "count" | "reason";
export type OfferIssue = { key: string; field: OfferField; message: string };

export type VariantChange =
	| { operation: "create"; create: Record<string, unknown> }
	| { operation: "update"; variant_id: string; update: Record<string, unknown> }
	| { operation: "retire"; variant_id: string };

export const rowsFrom = (variants: readonly CatalogVariant[]): OfferRow[] =>
	variants.map((v) => ({
		key: v.id,
		id: v.id,
		label: v.label,
		price: String(v.price),
		weight: String(v.weight_grams),
		fresh: null,
	}));

/** Whole rupiah 1..99.000 written as digits only; null otherwise. */
export function parsePrice(raw: string): number | null {
	const text = raw.trim();
	if (!/^\d{1,5}$/.test(text)) return null;
	const n = Number(text);
	return n >= PRICE_MIN_IDR && n <= PRICE_MAX_IDR ? n : null;
}
export function parseWeight(raw: string): number | null {
	const text = raw.trim();
	if (!/^\d{1,7}$/.test(text)) return null;
	const n = Number(text);
	return n >= 1 && n <= WEIGHT_MAX_GRAMS ? n : null;
}
const labelOk = (raw: string) => raw.trim() !== "" && Array.from(raw.trim()).length <= LABEL_MAX;

const nameOf = (row: OfferRow) => row.label.trim() || (row.fresh ? "Penawaran baru" : "Penawaran tanpa nama");

/** Field-level refusals for the edited table, in table order; empty means the rows may be sent. */
export function validateRows(rows: readonly OfferRow[]): OfferIssue[] {
	const issues: OfferIssue[] = [];
	if (rows.length < 1 || rows.length > OFFER_MAX)
		issues.push({
			key: "",
			field: "count",
			message: `Produk harus punya 1 sampai ${OFFER_MAX} penawaran aktif. Sekarang ${rows.length}.`,
		});
	for (const row of rows) {
		const name = nameOf(row);
		if (!labelOk(row.label))
			issues.push({
				key: row.key,
				field: "label",
				message: row.label.trim()
					? `Nama ${name} maksimal ${LABEL_MAX} karakter.`
					: `${name}: nama penawaran wajib diisi.`,
			});
		if (parsePrice(row.price) === null)
			issues.push({
				key: row.key,
				field: "price",
				message: `Harga ${name} harus angka bulat Rp${PRICE_MIN_IDR} sampai Rp99.000.`,
			});
		if (parseWeight(row.weight) === null)
			issues.push({
				key: row.key,
				field: "weight",
				message: `Berat ${name} harus bilangan bulat gram, 1 sampai ${WEIGHT_MAX_GRAMS.toLocaleString("id-ID")}.`,
			});
	}
	return issues;
}

/** Validates the create-offer form before it becomes a row; first refusal wins. */
export function validateFresh(input: {
	sku: string;
	label: string;
	price: string;
	weight: string;
	length: string;
	width: string;
	height: string;
	warehouseId: string;
	stockItemId: string;
	quantity: string;
}): { field: keyof typeof input; message: string } | null {
	if (!SKU_PATTERN.test(input.sku.trim()))
		return { field: "sku", message: "SKU hanya huruf besar, angka, garis bawah dan tanda hubung (maksimal 100 karakter)." };
	if (!labelOk(input.label)) return { field: "label", message: `Nama penawaran wajib diisi, maksimal ${LABEL_MAX} karakter.` };
	if (parsePrice(input.price) === null) return { field: "price", message: "Harga harus angka bulat Rp1 sampai Rp99.000." };
	if (parseWeight(input.weight) === null) return { field: "weight", message: "Berat harus bilangan bulat gram, minimal 1." };
	for (const field of ["length", "width", "height"] as const)
		if (!/^\d{1,5}$/.test(input[field].trim()) || Number(input[field]) < 1 || Number(input[field]) > DIMENSION_MAX_MM)
			return { field, message: `Ukuran harus bilangan bulat milimeter, 1 sampai ${DIMENSION_MAX_MM.toLocaleString("id-ID")}.` };
	if (!input.warehouseId) return { field: "warehouseId", message: "Pilih gudang asal." };
	if (!input.stockItemId) return { field: "stockItemId", message: "Pilih barang stok untuk isi penawaran." };
	if (!/^\d{1,7}$/.test(input.quantity.trim()) || Number(input.quantity) < 1 || Number(input.quantity) > QUANTITY_MAX)
		return { field: "quantity", message: "Jumlah isi harus bilangan bulat minimal 1." };
	return null;
}

/**
 * The PATCH `variant_changes` for the edited table. An update body is the whole offer (the API replaces it
 * and refuses unknown keys), sent only for offers whose label, price or weight really changed. The wire
 * `image` falls back to the product cover, so it is sent only when it is not that cover (same rule as the
 * content dialog). New offers need the fields the API requires at creation; kind follows the quantity.
 */
export function diffOffers(
	variants: readonly CatalogVariant[],
	rows: readonly OfferRow[],
	retiredIds: readonly string[],
	coverUrl: string | null,
): VariantChange[] {
	const changes: VariantChange[] = [];
	const byId = new Map(variants.map((v) => [v.id, v]));
	for (const row of rows) {
		const price = parsePrice(row.price);
		const weight = parseWeight(row.weight);
		if (price === null || weight === null) continue;
		const label = row.label.trim();
		if (row.fresh) {
			const f = row.fresh;
			changes.push({
				operation: "create",
				create: {
					sku: f.sku,
					label,
					attributes: [],
					price,
					weight_grams: weight,
					length_mm: f.length_mm,
					width_mm: f.width_mm,
					height_mm: f.height_mm,
					default_warehouse_id: f.default_warehouse_id,
					offer_kind: f.quantity === 1 ? "unit" : "multipack",
					contents: [{ stock_item_id: f.stock_item_id, name: f.stock_name, quantity: f.quantity }],
				},
			});
			continue;
		}
		const v = row.id ? byId.get(row.id) : undefined;
		if (!v || (v.label === label && v.price === price && v.weight_grams === weight)) continue;
		changes.push({
			operation: "update",
			variant_id: v.id,
			update: {
				label,
				attributes: v.attributes,
				price,
				weight_grams: weight,
				length_mm: v.length_mm,
				width_mm: v.width_mm,
				height_mm: v.height_mm,
				default_warehouse_id: v.default_warehouse_id,
				offer_kind: v.offer_kind,
				contents: v.contents,
				...(v.image && v.image.url !== coverUrl ? { image: v.image } : {}),
			},
		});
	}
	for (const id of retiredIds) if (byId.has(id)) changes.push({ operation: "retire", variant_id: id });
	return changes;
}

export type PatchInput = {
	product: Pick<CatalogProduct, "version" | "variants" | "images" | "category_id">;
	rows: readonly OfferRow[];
	retiredIds: readonly string[];
	categoryId: string | null;
	reason: string;
};

/** The request body, or null when nothing changed (then no request is sent). */
export function buildPatch(input: PatchInput): Record<string, unknown> | null {
	const { product, rows, retiredIds, categoryId, reason } = input;
	const changes = diffOffers(product.variants, rows, retiredIds, product.images[0]?.url ?? null);
	const category = categoryId && categoryId !== product.category_id ? { category_id: categoryId } : {};
	if (!changes.length && !Object.keys(category).length) return null;
	return {
		expected_version: product.version,
		reason: reason.trim(),
		...category,
		...(changes.length ? { variant_changes: changes } : {}),
	};
}

export function describeChanges(changes: readonly VariantChange[], categoryChanged: boolean): string {
	const count = (op: VariantChange["operation"]) => changes.filter((c) => c.operation === op).length;
	const parts = [
		[count("update"), "penawaran diubah"],
		[count("create"), "penawaran baru"],
		[count("retire"), "penawaran dihentikan"],
		[categoryChanged ? 1 : 0, "kategori diganti"],
	] as const;
	return parts.filter(([n]) => n > 0).map(([n, text]) => `${n} ${text}`).join(", ");
}

/**
 * What moved between the version the editor started from and the one the server has now, for the 409
 * state. Compares by offer id on label, price and weight, plus added and retired offers.
 */
export function describeDrift(
	start: Pick<CatalogProduct, "version" | "variants" | "category_id">,
	latest: Pick<CatalogProduct, "version" | "variants" | "category_id">,
): string[] {
	const lines: string[] = [];
	if (latest.version === start.version) return lines;
	const before = new Map(start.variants.map((v) => [v.id, v]));
	const after = new Map(latest.variants.map((v) => [v.id, v]));
	for (const v of latest.variants) {
		const old = before.get(v.id);
		if (!old) {
			lines.push(`Penawaran baru: ${v.label}.`);
			continue;
		}
		if (old.label !== v.label) lines.push(`Nama ${old.label} sekarang ${v.label}.`);
		if (old.price !== v.price) lines.push(`Harga ${v.label} berubah dari Rp${old.price.toLocaleString("id-ID")} ke Rp${v.price.toLocaleString("id-ID")}.`);
		if (old.weight_grams !== v.weight_grams) lines.push(`Berat ${v.label} berubah dari ${old.weight_grams} g ke ${v.weight_grams} g.`);
	}
	for (const v of start.variants) if (!after.has(v.id)) lines.push(`${v.label} sudah dihentikan.`);
	if (latest.category_id !== start.category_id) lines.push("Kategori produk berubah.");
	return lines;
}

const MESSAGES: Record<string, string> = {
	VERSION_CONFLICT: "Produk sudah berubah sejak halaman ini dibuka.",
	INVALID_INPUT: "Server menolak isian. Periksa harga (bulat Rp1 sampai Rp99.000), berat, nama, dan alasan.",
	INVALID_OFFER_COUNT: "Produk harus punya 1 sampai 100 penawaran aktif.",
	DUPLICATE_VARIANT_TARGET: "Satu penawaran muncul dua kali dalam perubahan. Muat ulang halaman lalu ulangi.",
	CATALOG_IDENTITY_CONFLICT: "SKU ini sudah dipakai penawaran lain. Ganti SKU.",
	FORBIDDEN: "Peran Anda tidak boleh mengubah penawaran produk ini.",
	NOT_FOUND: "Produk, kategori, gudang, barang stok, atau penawaran tidak ditemukan lagi. Muat ulang halaman.",
	INVALID_WAREHOUSE_SCOPE: "Gudang tidak aktif atau di luar cakupan Anda.",
	COMPONENT_NAME_MISMATCH: "Nama isi penawaran tidak sama dengan nama barang stoknya. Muat ulang halaman.",
	DUPLICATE_COMPONENT: "Barang stok yang sama tidak boleh muncul dua kali dalam satu penawaran.",
	IDEMPOTENCY_CONFLICT: "Permintaan yang sama sudah dikirim dengan isi berbeda. Muat ulang halaman lalu ulangi.",
	BELOW_MARGIN_FLOOR: "Harga ini membuat kontribusi di bawah batas minimum, jadi belum bisa diterbitkan.",
	FINANCIAL_REVIEW_REQUIRED: "Perubahan harga perlu tinjauan keuangan sebelum diterbitkan.",
	INVALID_ORIGIN: "Permintaan ditolak karena asal halaman tidak valid. Muat ulang halaman.",
};

/** Concrete Indonesian text for a refused or failed PATCH. */
export function offerErrorMessage(status: number, code: string | null): string {
	if (status === 0) return "Tidak dapat terhubung ke server lokal. Periksa koneksi lalu coba lagi; perubahan Anda masih ada di halaman ini.";
	if (code && MESSAGES[code]) return `${MESSAGES[code]} (kode: ${code})`;
	if (status === 401) return "Sesi Anda berakhir. Masuk kembali untuk melanjutkan.";
	if (status === 403) return `${MESSAGES.FORBIDDEN} (kode: FORBIDDEN)`;
	if (status === 409) return `${MESSAGES.VERSION_CONFLICT} (kode: ${code ?? "409"})`;
	if (status >= 500) return "Server sedang bermasalah. Coba lagi sebentar lagi; perubahan Anda masih ada di halaman ini.";
	return `Permintaan tidak dapat diproses.${code ? ` (kode: ${code})` : ""}`;
}

export const isVersionConflict = (status: number, code: string | null) =>
	status === 409 && (code === null || code === "VERSION_CONFLICT" || code === "CONFLICT" || code === "STALE_VERSION");

export type RebaseBase = Pick<CatalogProduct, "variants" | "category_id">;
export type RebaseResult = {
	rows: OfferRow[];
	retired: { id: string; label: string }[];
	categoryId: string;
	notes: string[];
};

/**
 * S151-1: re-applies the user's typed edits onto the newest server offers. Only the fields the user
 * changed against `start` (label, price, weight, retire, category) are carried; every other field and
 * every offer the server gained comes from `latest`. An edited or retired offer that no longer exists
 * is dropped and named in `notes`. Offers added in the session (`fresh`) stay as they are.
 */
export function rebaseEdits(input: {
	start: RebaseBase;
	latest: RebaseBase;
	rows: readonly OfferRow[];
	retired: readonly { id: string; label: string }[];
	categoryId: string;
}): RebaseResult {
	const { start, latest, rows, retired, categoryId } = input;
	const startById = new Map(start.variants.map((v) => [v.id, v]));
	const latestRows = rowsFrom(latest.variants);
	const latestById = new Map(latestRows.map((r) => [r.key, r]));
	const retiredIds = new Set(retired.map((r) => r.id));
	const notes: string[] = [];
	const edited = new Map<string, OfferRow>();
	for (const row of rows) {
		if (!row.id) continue;
		const was = startById.get(row.id);
		const now = latestById.get(row.id);
		if (!was) continue;
		const changed = was.label !== row.label.trim() || String(was.price) !== row.price.trim() || String(was.weight_grams) !== row.weight.trim();
		if (!now) {
			if (changed) notes.push(`${was.label} sudah dihentikan di versi terbaru; perubahan Anda pada penawaran ini dibuang.`);
			continue;
		}
		edited.set(row.id, {
			...now,
			label: was.label !== row.label.trim() ? row.label : now.label,
			price: String(was.price) !== row.price.trim() ? row.price : now.price,
			weight: String(was.weight_grams) !== row.weight.trim() ? row.weight : now.weight,
		});
	}
	const keptRetired: { id: string; label: string }[] = [];
	for (const r of retired) {
		const now = latestById.get(r.id);
		if (now) keptRetired.push({ id: r.id, label: now.label });
	}
	const out: OfferRow[] = [];
	for (const r of latestRows) {
		if (retiredIds.has(r.key)) continue;
		out.push(edited.get(r.key) ?? r);
	}
	for (const row of rows) if (row.fresh) out.push(row);
	const categoryEdited = categoryId !== (start.category_id ?? "");
	return { rows: out, retired: keptRetired, categoryId: categoryEdited ? categoryId : (latest.category_id ?? ""), notes };
}

/**
 * An idempotency key that follows the request body: the same key is kept only for a byte-identical
 * retry (so a lost response replays instead of applying twice); an edited body gets a fresh key, as
 * the server answers IDEMPOTENCY_CONFLICT to one key with two bodies. `rotate` after a definitive answer.
 */
export function createOperationKey(make: () => string = () => crypto.randomUUID()) {
	let key: string | null = null;
	let body: string | null = null;
	return {
		get(fingerprint?: string) {
			if (key !== null && fingerprint !== undefined && fingerprint !== body) key = null;
			key ??= make();
			if (fingerprint !== undefined) body = fingerprint;
			return key;
		},
		rotate() {
			key = null;
			body = null;
		},
	};
}
