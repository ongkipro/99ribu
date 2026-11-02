import { PRICE_MAX_IDR, PRICE_MIN_IDR, parsePrice, parseWeight, QUANTITY_MAX } from "./offer-editor-model.ts";

// S152 (spec 17 W4-4, DEC-025, PR-1/PR-2/PR-19): pure rules of "Tambah produk". An offer lists its contents
// (component SKU and quantity) from one origin warehouse; the price is its own whole rupiah and never the sum of
// the parts. Limits mirror src/modules/catalog/validation.ts offerInput(); the server stays the authority.

export const OFFER_CAP = 50;
export const LINE_CAP = 20;
export const HPP_MAX_IDR = 999_999;

export type Picked = { id: string; sku: string; name: string };
/** One content line: a SKU created with this product ("new") or an existing one picked through the search. */
export type Line = { key: string; n: number; mode: "new" | "existing"; picked: Picked | null; newName: string; quantity: string };
export type Offer = { key: string; n: number; label: string; price: string; weight: string; warehouse: string; lines: Line[] };
export type FactRule = { key: string; label: string; value_type: "text" | "number" | "boolean" | "enum"; required: boolean; allowed_values: string[] };
export type CategoryRow = { id: string; parent_id: string | null; attribute_definitions?: Partial<FactRule>[] };

export const newLine = (n: number, key: string): Line => ({ key, n, mode: "new", picked: null, newName: "", quantity: "1" });

export const componentKey = (line: Line) => (line.mode === "existing" && line.picked ? `id:${line.picked.id}` : `new:${line.key}`);

export function parseQuantity(raw: string): number | null {
	const text = raw.trim();
	if (!/^\d{1,7}$/.test(text)) return null;
	const n = Number(text);
	return n >= 1 && n <= QUANTITY_MAX ? n : null;
}
export function parseHpp(raw: string): number | null {
	if (!/^\d{1,6}$/.test(raw.trim())) return null;
	const n = Number(raw);
	return n >= 1 && n <= HPP_MAX_IDR ? n : null;
}

/** Wire offer kind: one piece is a unit, several of one SKU a multipack, two or more SKUs a bundle (offerInput). */
export function offerKind(lines: readonly { quantity: number }[]): "unit" | "multipack" | "bundle" {
	if (lines.length >= 2) return "bundle";
	return lines[0]?.quantity === 1 ? "unit" : "multipack";
}

// lazy: no carton dimensions on the form; a cube whose volumetric weight equals the actual weight, as the import does.
export const cube = (grams: number) => Math.min(1000, Math.max(50, Math.ceil(Math.cbrt(grams * 6000))));
// Cut by code point so a name never ends in half a surrogate pair.
export const clip = (value: string, max: number) => Array.from(value).slice(0, max).join("");

/** Name of a SKU created with the product: typed, else the product name (one offer) or product plus offer label. */
export function newComponentName(line: Line, title: string, offer: Offer, offerCount: number): string {
	const typed = line.newName.trim();
	return clip(typed || (offerCount === 1 ? title : `${title} - ${offer.label.trim()}`), 200);
}

/** SKU code of a SKU created with the product; the bare base when it is the only new one. */
export const newComponentSku = (base: string, line: Line, newCount: number) => (newCount === 1 ? base : `${base}-${line.n}`);

export const countNewLines = (offers: readonly Offer[]) => offers.reduce((sum, o) => sum + o.lines.filter((l) => l.mode === "new").length, 0);

export type Inputs = {
	name: string;
	category: string;
	photos: number;
	offers: readonly Offer[];
	/** HPP text by component key; only read when the actor holds finance.costs.write. */
	hpp: Readonly<Record<string, string>>;
	costsWrite: boolean;
	/** Initial stock text by `${componentKey}|${warehouseId}`. */
	stock: Readonly<Record<string, string>>;
	/** Warehouses where this actor may record a receive movement. */
	receivable: ReadonlySet<string>;
};

export const stockKey = (component: string, warehouse: string) => `${component}|${warehouse}`;

/** Field-level refusals keyed by the control id suffix; empty means the form may be sent. */
export function validate(input: Inputs): Record<string, string> {
	const next: Record<string, string> = {};
	if (!input.name.trim()) next.name = "Isi nama produk.";
	if (!input.category) next.category = "Pilih kategori.";
	if (!input.photos) next.photos = "Tambahkan minimal satu foto.";
	if (input.offers.length < 1 || input.offers.length > OFFER_CAP) next.offers = `Isi 1 sampai ${OFFER_CAP} penawaran.`;
	const labels = new Set<string>();
	input.offers.forEach((o, i) => {
		const label = o.label.trim();
		if (!label) next[`label-${i}`] = "Isi nama penawaran.";
		else if (labels.has(label.toLowerCase())) next[`label-${i}`] = "Nama penawaran sudah dipakai.";
		labels.add(label.toLowerCase());
		if (Array.from(label).length > 200) next[`label-${i}`] = "Nama penawaran maksimal 200 karakter.";
		const price = parsePrice(o.price);
		if (price === null) next[`price-${i}`] = `Harga dalam rupiah, Rp${PRICE_MIN_IDR} sampai Rp${PRICE_MAX_IDR.toLocaleString("id-ID")}.`;
		if (parseWeight(o.weight) === null) next[`weight-${i}`] = "Berat dalam gram, minimal 1.";
		if (!o.warehouse) next[`warehouse-${i}`] = "Pilih gudang asal.";
		if (o.lines.length < 1 || o.lines.length > LINE_CAP) next[`lines-${i}`] = `Isi 1 sampai ${LINE_CAP} barang.`;
		const seen = new Set<string>();
		o.lines.forEach((l, j) => {
			if (l.mode === "existing" && !l.picked) next[`component-${i}-${j}`] = "Cari lalu pilih SKU.";
			else if (l.mode === "new" && o.lines.length > 1 && !l.newName.trim()) next[`component-${i}-${j}`] = "Isi nama barang baru.";
			else if (l.mode === "new" && Array.from(l.newName.trim()).length > 200) next[`component-${i}-${j}`] = "Nama barang maksimal 200 karakter.";
			const quantity = parseQuantity(l.quantity);
			if (quantity === null) next[`quantity-${i}-${j}`] = "Jumlah bilangan bulat minimal 1.";
			const ck = componentKey(l);
			if (seen.has(ck)) next[`component-${i}-${j}`] = "SKU yang sama tidak boleh dua kali dalam satu penawaran.";
			seen.add(ck);
			const hpp = input.costsWrite && l.mode === "new" ? input.hpp[ck]?.trim() : "";
			if (hpp && parseHpp(hpp) === null) next[`hpp-${ck}`] = "HPP dalam rupiah, 1 sampai 999.999.";
		});
	});
	// Initial stock text is optional; when typed it must be a whole quantity. Only the pairs the form shows are checked:
	// a value typed for a line, warehouse or offer that is gone is stale text nobody can see or fix.
	for (const pair of receivePairs(input.offers)) {
		const value = input.stock[pair.key];
		if (value?.trim() && input.receivable.has(pair.warehouse) && parseQuantity(value) === null) next[`stock-${pair.key}`] = "Jumlah stok awal bilangan bulat minimal 1.";
	}
	return next;
}

export type ReceivePair = { key: string; component: string; warehouse: string; line: Line; offer: Offer };
/** One pair per component and warehouse, in offer order: each becomes at most one receive movement. */
export function receivePairs(offers: readonly Offer[]): ReceivePair[] {
	const seen = new Set<string>();
	const pairs: ReceivePair[] = [];
	for (const offer of offers)
		for (const line of offer.lines) {
			const component = componentKey(line);
			const key = stockKey(component, offer.warehouse);
			if (!offer.warehouse || seen.has(key)) continue;
			seen.add(key);
			pairs.push({ key, component, warehouse: offer.warehouse, line, offer });
		}
	return pairs;
}

export type Image = { url: string; width: number; height: number };
export function productBody(input: {
	title: string;
	description: string;
	category: string;
	photos: readonly Image[];
	offers: readonly Offer[];
	stockIdOf: (line: Line) => string;
	componentNameOf: (line: Line, offer: Offer) => string;
	offerSkuOf: (offer: Offer) => string;
}) {
	return {
		name: input.title,
		description: input.description.trim(),
		category_id: input.category,
		images: input.photos.map((p, i) => ({ url: p.url, alt: i ? `${input.title}, foto ${i + 1}` : input.title, width: p.width, height: p.height })),
		variants: input.offers.map((o) => {
			const grams = Number(o.weight), side = cube(grams);
			const contents = o.lines.map((l) => ({ stock_item_id: input.stockIdOf(l), name: input.componentNameOf(l, o), quantity: Number(l.quantity) }));
			return {
				sku: input.offerSkuOf(o), label: o.label.trim(), attributes: [], price: Number(o.price), offer_kind: offerKind(contents), weight_grams: grams,
				length_mm: side, width_mm: side, height_mm: side, default_warehouse_id: o.warehouse, contents,
			};
		}),
	};
}

export const receiveBody = (warehouseId: string, stockItemId: string, quantity: number, expectedVersion: number) => ({
	warehouse_id: warehouseId, stock_item_id: stockItemId, lot_id: null, kind: "receive", quantity,
	reason: "Stok awal produk baru", expected_version: expectedVersion,
});

/** Version of the lot-less position among the rows of GET /inventory, 0 when it has none yet. */
export const positionVersion = (rows: readonly { lot_id: string | null; version: number }[]) => rows.find((p) => p.lot_id === null)?.version ?? 0;

// Same per-offer defaults the catalog import applies (S69 DEFAULT_OFFER_ASSUMPTIONS in src/modules/local/berlapak.ts).
export const ASSUMPTION_DEFAULTS = { packaging_idr: 1000, provider_fee_idr: 1000, subsidy_idr: 5000, returns_reserve_idr: 1000 };
/** Only an offer whose HPP was typed here gets default assumptions: finance, not this form, confirms the rest (PR-19). */
export const offerHasHpp = (offer: Offer, hpp: Readonly<Record<string, string>>) => offer.lines.some((l) => l.mode === "new" && parseHpp(hpp[componentKey(l)] ?? "") !== null);
export const assumptionBody = () => ({
	expected_version: 0, effective_from: null, ...ASSUMPTION_DEFAULTS,
	source: "Asumsi biaya bawaan per penawaran", reason: "Nilai bawaan (default) saat produk dibuat bersama HPP awal; belum dikonfirmasi keuangan",
});

/**
 * PR-1 margin floor: HPP × quantity at or above the price can never publish. The API accepts such an HPP (the floor is
 * checked at publication), so this is a warning keyed like an error (`hpp-<component>`), never a reason to refuse the draft.
 */
export function hppWarnings(offers: readonly Offer[], hpp: Readonly<Record<string, string>>, costsWrite: boolean): Record<string, string> {
	const out: Record<string, string> = {};
	if (!costsWrite) return out;
	for (const o of offers) {
		const price = parsePrice(o.price);
		if (price === null) continue;
		let known = 0, first: string | null = null;
		for (const l of o.lines) {
			const ck = componentKey(l), value = l.mode === "new" ? parseHpp(hpp[ck] ?? "") : null;
			if (value === null) continue;
			first ??= ck;
			known += value * (parseQuantity(l.quantity) ?? 1);
		}
		if (first && known >= price) out[`hpp-${first}`] = `HPP isi (Rp${known.toLocaleString("id-ID")}) sama dengan atau di atas harga Rp${price.toLocaleString("id-ID")}: penawaran ${o.label.trim() || "ini"} tidak akan bisa terbit. Draf tetap bisa disimpan.`;
	}
	return out;
}

export const costVersionBody = (unitCost: number) => ({
	expected_version: 0, unit_cost: unitCost, effective_from: null, source: "Form Tambah Produk", reason: "HPP awal produk baru",
});

/** Rules a product of this category must answer: its own and every ancestor's, nearest first. */
export function factRules(categories: readonly CategoryRow[], categoryId: string): FactRule[] {
	const byId = new Map(categories.map((c) => [c.id, c]));
	const rules: FactRule[] = [];
	const seen = new Set<string>();
	for (let c = byId.get(categoryId), guard = 0; c && guard < 10; c = c.parent_id ? byId.get(c.parent_id) : undefined, guard++)
		for (const d of c.attribute_definitions ?? []) {
			if (!d.key || seen.has(d.key)) continue;
			seen.add(d.key);
			rules.push({ key: d.key, label: d.label ?? d.key, value_type: d.value_type ?? "text", required: Boolean(d.required), allowed_values: d.allowed_values ?? [] });
		}
	return rules;
}

/** PATCH body for the optional attributes of the new draft (`version` read just before sending; a new draft is 1), or null when none was typed. */
export function factsPatch(rules: readonly FactRule[], values: Readonly<Record<string, string>>, version = 1) {
	const facts = rules.flatMap((r) => (values[r.key]?.trim() ? [{ key: r.key, label: r.label, values: [values[r.key].trim()] }] : []));
	return facts.length ? { expected_version: version, reason: "Atribut awal produk baru", facts } : null;
}

/** Why a typed fact value would be refused at publication, or null (mirrors publicationChecks). */
export function factProblem(rule: FactRule, raw: string): string | null {
	const value = raw.trim();
	if (!value) return null;
	if (Array.from(value).length > 500) return "Maksimal 500 karakter.";
	if (rule.value_type === "number" && !(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value)))) return "Isi angka.";
	if (rule.value_type === "boolean" && !["true", "false"].includes(value)) return "Pilih Ya atau Tidak.";
	if (rule.value_type === "enum" && !rule.allowed_values.includes(value)) return "Pilih salah satu nilai.";
	return null;
}

/** Where the field of a validation key lives (its control id), so focus and summary links agree with the markup. */
export function controlId(key: string): string {
	if (key === "name") return "product-name";
	if (key === "category") return "product-category";
	if (key === "photos") return "product-photo-file";
	if (key === "offers") return "product-variant-add";
	if (/^(label|price|weight|warehouse)-\d+$/.test(key)) return `variant-${key}`;
	const lines = /^lines-(\d+)$/.exec(key);
	if (lines) return `offer-contents-${lines[1]}`;
	return key;
}
/** Short name of the field for the error summary. */
export function errorLabel(key: string): string {
	const index = (re: RegExp) => Number(re.exec(key)?.[1] ?? 0) + 1;
	if (key === "name") return "Nama produk";
	if (key === "category") return "Kategori";
	if (key === "photos") return "Foto";
	if (key === "offers") return "Penawaran";
	if (/^label-\d+$/.test(key)) return `Nama penawaran ${index(/(\d+)$/)}`;
	if (/^price-\d+$/.test(key)) return `Harga penawaran ${index(/(\d+)$/)}`;
	if (/^weight-\d+$/.test(key)) return `Berat penawaran ${index(/(\d+)$/)}`;
	if (/^warehouse-\d+$/.test(key)) return `Gudang penawaran ${index(/(\d+)$/)}`;
	if (/^lines-\d+$/.test(key)) return `Isi penawaran ${index(/(\d+)$/)}`;
	const c = /^component-(\d+)-(\d+)$/.exec(key);
	if (c) return `Barang ${Number(c[2]) + 1} di penawaran ${Number(c[1]) + 1}`;
	const q = /^quantity-(\d+)-(\d+)$/.exec(key);
	if (q) return `Jumlah barang ${Number(q[2]) + 1} di penawaran ${Number(q[1]) + 1}`;
	if (key.startsWith("hpp-")) return "HPP";
	if (key.startsWith("stock-")) return "Stok awal";
	if (key.startsWith("fact-")) return "Atribut";
	return key;
}

// ---- the create sequence: every step after the product is independent -------------------------------------------

/** A refusal or failure of one HTTP step. status 0 is a lost connection (outcome unknown). */
export class Refused extends Error {
	status: number;
	code: string | null;
	constructor(status: number, code: string | null, message: string) {
		super(message);
		this.status = status;
		this.code = code;
	}
}
/** A definitive refusal created nothing, so the step may be sent again with a fresh key. IDEMPOTENCY_CONFLICT proves the earlier request committed. */
export const isDefinitive = (error: unknown) => error instanceof Refused && error.status >= 400 && error.status < 500 && error.code !== "IDEMPOTENCY_CONFLICT";

export type PlannedStep = { id: string; label: string; run: () => Promise<void> };
export type PendingStep = { id: string; label: string; text: string };

/**
 * Runs every step even when an earlier one failed. A failed step is reported as pending (and, when the refusal was
 * definitive, `onDefinitive` frees its key and frozen body so the retry rebuilds it); the caller sends again only those.
 */
export async function runIndependent(steps: readonly PlannedStep[], onDefinitive: (id: string) => void): Promise<PendingStep[]> {
	const pending: PendingStep[] = [];
	for (const step of steps) {
		try {
			await step.run();
		} catch (error) {
			if (isDefinitive(error)) onDefinitive(step.id);
			pending.push({ id: step.id, label: step.label, text: error instanceof Error ? error.message : "Langkah ini belum tersimpan." });
		}
	}
	return pending;
}

// ---- session snapshot: survives a reload so created SKUs and step keys are not orphaned --------------------------

export const SAVED_KEY = "99ribu:product-create:v1";
export type Saved = {
	v: 1;
	sku: string;
	keys: [string, string][];
	frozen: [string, string][];
	stock: Record<string, { id: string; sku: string; name: string }>;
	product: { id: string; variants: { id: string; sku: string }[] } | null;
	done: string[];
	form: {
		name: string; category: string; description: string; photos: Image[]; offers: Offer[];
		hpp: Record<string, string>; qty: Record<string, string>; facts: Record<string, string>; counters: { offer: number; line: number };
	};
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const stringPairs = (v: unknown): v is [string, string][] => Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && isStr(p[0]) && isStr(p[1]));
const strings = (v: unknown): v is Record<string, string> => isObj(v) && Object.values(v).every(isStr);
const isLine = (l: unknown): l is Line => isObj(l) && isStr(l.key) && typeof l.n === "number" && (l.mode === "new" || l.mode === "existing") && isStr(l.newName) && isStr(l.quantity) &&
	(l.picked === null || (isObj(l.picked) && isStr(l.picked.id) && isStr(l.picked.sku) && isStr(l.picked.name)));
const isOffer = (o: unknown): o is Offer => isObj(o) && isStr(o.key) && typeof o.n === "number" && isStr(o.label) && isStr(o.price) && isStr(o.weight) && isStr(o.warehouse) && Array.isArray(o.lines) && o.lines.length > 0 && o.lines.every(isLine);

/** Reads a stored snapshot; anything that does not have the exact shape is treated as absent. */
export function parseSaved(raw: string | null): Saved | null {
	if (!raw) return null;
	try {
		const s = JSON.parse(raw) as unknown;
		if (!isObj(s) || s.v !== 1 || !isStr(s.sku) || !stringPairs(s.keys) || !stringPairs(s.frozen) || !Array.isArray(s.done) || !s.done.every(isStr) || !isObj(s.stock) || !isObj(s.form)) return null;
		const stock = Object.values(s.stock).every((x) => isObj(x) && isStr(x.id) && isStr(x.sku) && isStr(x.name));
		const product = s.product === null || (isObj(s.product) && isStr(s.product.id) && Array.isArray(s.product.variants) && s.product.variants.every((v) => isObj(v) && isStr(v.id) && isStr(v.sku)));
		const f = s.form;
		const counters = isObj(f.counters) && typeof f.counters.offer === "number" && typeof f.counters.line === "number";
		const photos = Array.isArray(f.photos) && f.photos.every((p) => isObj(p) && isStr(p.url) && typeof p.width === "number" && typeof p.height === "number");
		if (!stock || !product || !counters || !photos || !isStr(f.name) || !isStr(f.category) || !isStr(f.description) || !Array.isArray(f.offers) || f.offers.length === 0 || !f.offers.every(isOffer) ||
			!strings(f.hpp) || !strings(f.qty) || !strings(f.facts)) return null;
		return s as unknown as Saved;
	} catch {
		return null;
	}
}
