"use client";

import { ArrowLeft, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { failureText, getJson } from "./admin-errors";
import { type Category, readAll } from "./catalog-model";
import { consoleAccess } from "./console-access";
import { FormField, nativeSelectClass } from "./form";
import { OfferContentsPicker } from "./offer-contents-picker";
import { sentText } from "./ops-api";
import { AdminPage, DetailSection, PageHeader, StickyActions } from "./page-blocks";
import {
	assumptionBody,
	type CategoryRow,
	clip,
	componentKey,
	controlId,
	costVersionBody,
	countNewLines,
	errorLabel,
	factProblem,
	factRules,
	factsPatch,
	hppWarnings,
	isDefinitive,
	type Line,
	newComponentName,
	newComponentSku,
	newLine,
	type Offer,
	OFFER_CAP,
	offerHasHpp,
	type PlannedStep,
	parseHpp,
	parseQuantity,
	parseSaved,
	positionVersion,
	productBody,
	Refused,
	receiveBody,
	receivePairs,
	runIndependent,
	SAVED_KEY,
	type Saved,
	validate,
} from "./product-create-model";
import { ErrorState, LoadingState } from "./states";

// "Tambah Produk" (S-P1, completed by S152 / spec 17 W4-4): a new product as an inactive DRAFT through the existing
// catalog APIs, in order: one stock item per new content line (POST stock-items; existing SKUs are only referenced),
// the product with its offers (POST products), the optional attributes (PATCH products), then, for a caller with
// finance.costs.write, each new SKU's HPP and each offer's default variable-cost assumptions, and last the optional
// initial stock as ONE `receive` movement per component and warehouse (POST inventory/movements). Every step has its
// own idempotency key for the life of the form, so a retry after a lost response replays instead of creating twice; a
// step that already succeeded is not sent again; a definitive refusal (4xx) rotates that step's key so corrected input is
// not an IDEMPOTENCY_CONFLICT (an IDEMPOTENCY_CONFLICT itself proves the earlier request committed, so it keeps the key).
// While a step holds a key (sent, outcome unknown or created) the fields its body is built from are locked, so a retry
// after a lost response sends the same body: stock steps lock the product name, the offer and content structure; the
// product step locks the rest of the product body; an HPP, stock or attribute step locks its own input. A receive body
// also keeps the position version it first read. Publication and edits stay on the product page (PR-19 blocks it until
// stock and HPP exist).
//
// After the product exists every remaining step (attributes, each HPP, each assumption, each receive) is independent: a
// definitive refusal of one is recorded and the others still run; the message lists exactly the pending steps and a retry
// sends only those. The attribute PATCH reads the product version just before sending. The SKU codes, keys, frozen bodies
// and created ids are mirrored in sessionStorage, so a reload neither forgets a created SKU nor sends a second one;
// "Mulai ulang" drops that record and names the SKUs left behind. Default cost assumptions are written only for an offer
// whose HPP was typed here (PR-19 "assumptions known" must come from finance otherwise).

type Warehouse = { id: string; name: string; city: string; district: string | null };
type Photo = { url: string; width: number; height: number; preview: string };
type Stock = { id: string; sku: string; name: string };
type Created = { stock: Record<string, Stock>; product?: { id: string; variants: { id: string; sku: string }[] }; done: Set<string> };
type Me = { roles: string[] };
type Position = { lot_id: string | null; version: number };
type Failure = { text: string; pending: string[]; draftId: string | null };

const PHOTO_MAX = 10, PHOTO_BYTES = 500 * 1024, PHOTO_EDGE = 1080;
const skuBase = () => `P${new Date().toISOString().slice(2, 10).replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;

// Inside 1080 px, WebP, quality lowered until it fits the catalog media limit. Safari cannot encode WebP from a canvas.
async function toWebp(file: File): Promise<{ blob: Blob; width: number; height: number }> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(1, PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
	const width = Math.round(bitmap.width * scale), height = Math.round(bitmap.height * scale);
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	canvas.getContext("2d")?.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();
	if (width < 300 || height < 300) throw new Error("Foto terlalu kecil; sisi terpendek minimal 300 px.");
	for (const quality of [0.82, 0.72, 0.62, 0.52]) {
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
		if (blob?.type !== "image/webp") throw new Error("Browser ini belum bisa mengubah foto ke WebP. Gunakan Chrome atau Edge terbaru.");
		if (blob.size <= PHOTO_BYTES) return { blob, width, height };
	}
	throw new Error("Foto terlalu detail untuk batas 500 KB. Pilih foto lain.");
}

async function call<T>(method: "POST" | "PATCH", url: string, body: BodyInit, type: string, key: string): Promise<T> {
	let res: Response;
	try {
		res = await fetch(url, { method, credentials: "include", headers: { "content-type": type, "idempotency-key": key }, body });
	} catch {
		throw new Error("Koneksi terputus. Periksa jaringan lalu coba lagi; langkah yang sudah tersimpan tidak dibuat dua kali.");
	}
	if (res.ok) return (await res.json()) as T;
	const problem = (await res.json().catch(() => null)) as { code?: string } | null;
	throw new Refused(res.status, problem?.code ?? null, sentText(res.status, problem?.code ?? null));
}
const post = <T,>(url: string, body: BodyInit, type: string, key: string) => call<T>("POST", url, body, type, key);

const newOffer = (n: number, line: Line, label = "", warehouse = ""): Offer => ({ key: crypto.randomUUID(), n, label, price: "", weight: "", warehouse, lines: [line] });
const firstOffer = () => [newOffer(1, newLine(1, crypto.randomUUID()), "Satuan")];

function readSaved(): Saved | null {
	try {
		return parseSaved(window.sessionStorage.getItem(SAVED_KEY));
	} catch {
		return null;
	}
}
function writeSaved(value: Saved | null) {
	try {
		if (value) window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(value));
		else window.sessionStorage.removeItem(SAVED_KEY);
	} catch {
		// Private window or blocked storage: the form still works, it only cannot survive a reload.
	}
}

export function ProductCreateClient({ costsWrite }: { costsWrite: boolean }) {
	const router = useRouter();
	const formId = useId();
	// A snapshot of this tab's unfinished create (see the header comment). The first render shows the loading state on the
	// server and the client alike, so reading it here cannot cause a hydration difference.
	const [saved] = useState(readSaved);
	const [categories, setCategories] = useState<Category[] | null>(null);
	const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);
	const [inventoryRole, setInventoryRole] = useState<boolean | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [name, setName] = useState(saved?.form.name ?? "");
	const [category, setCategory] = useState(saved?.form.category ?? "");
	const [description, setDescription] = useState(saved?.form.description ?? "");
	// A restored photo previews from its published URL; a fresh one from the local blob.
	const [photos, setPhotos] = useState<Photo[]>(() => (saved?.form.photos ?? []).map((p) => ({ ...p, preview: p.url })));
	const [photoBusy, setPhotoBusy] = useState(false);
	const [photoError, setPhotoError] = useState<string | null>(null);
	const counters = useRef(saved?.form.counters ?? { offer: 2, line: 2 });
	const [offers, setOffers] = useState<Offer[]>(() => saved?.form.offers ?? firstOffer());
	const [hpp, setHpp] = useState<Record<string, string>>(saved?.form.hpp ?? {});
	const [stock, setStock] = useState<Record<string, string>>(saved?.form.qty ?? {});
	const [facts, setFacts] = useState<Record<string, string>>(saved?.form.facts ?? {});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState<string | null>(null);
	const [failure, setFailure] = useState<Failure | null>(() =>
		saved ? { text: "Isian dipulihkan dari sesi ini. Langkah yang sudah terkirim tidak dikirim ulang: tekan Lanjutkan menyimpan, atau Mulai ulang untuk mengosongkan formulir.", pending: [], draftId: saved.product?.id ?? null } : null);
	const failureRef = useRef<HTMLDivElement>(null);
	// Stable for the life of the form: SKUs, step keys, frozen step bodies and what already succeeded.
	const sku = useRef(saved?.sku ?? skuBase());
	const keys = useRef(new Map<string, string>(saved?.keys));
	const frozen = useRef(new Map<string, string>(saved?.frozen));
	const created = useRef<Created>({ stock: saved?.stock ?? {}, product: saved?.product ?? undefined, done: new Set(saved?.done) });
	// Mirrors the refs and the fields in sessionStorage once anything was sent (every render, and before each request).
	const persist = () => {
		if (keys.current.size === 0 && !created.current.product) return;
		writeSaved({
			v: 1, sku: sku.current, keys: [...keys.current], frozen: [...frozen.current], stock: created.current.stock, product: created.current.product ?? null, done: [...created.current.done],
			form: { name, category, description, photos: photos.map(({ url, width, height }) => ({ url, width, height })), offers, hpp, qty: stock, facts, counters: counters.current },
		});
	};
	useEffect(persist);
	const key = (step: string) => {
		const value = keys.current.get(step) ?? crypto.randomUUID();
		keys.current.set(step, value);
		persist();
		return value;
	};

	useEffect(() => {
		let live = true;
		void (async () => {
			const [c, w, me] = await Promise.all([
				readAll<Category>("/api/v1/admin/categories"),
				readAll<Warehouse>("/api/v1/admin/warehouses"),
				getJson<Me>("/api/v1/me"),
			]);
			if (!live) return;
			if (!c.ok) return setLoadError(failureText(c.failure));
			if (!w.ok) return setLoadError(failureText(w.failure));
			setCategories(c.data);
			setWarehouses([...w.data].sort((a, b) => a.name.localeCompare(b.name, "id")));
			// The warehouse list holds only the caller's own warehouses (owner: all; others: membership, access/routes.ts); the role decides the movement right (inventoryAuthority).
			setInventoryRole(me.ok ? consoleAccess(me.data.roles, []).inventory : false);
		})();
		return () => {
			live = false;
		};
	}, []);
	useEffect(() => {
		if (failure) failureRef.current?.focus();
	}, [failure]);

	const sent = (step: string) => keys.current.has(step);
	const locked = Boolean(created.current.product) || busy !== null || sent("product");
	// Once any stock step was sent: the name, the offers and their contents are fixed (see the header comment).
	const named = locked || [...keys.current.keys()].some((step) => step.startsWith("stock:"));
	const single = offers.length === 1;
	const setOffer = (index: number, patch: Partial<Offer>) => setOffers((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
	const nextLine = () => ({ n: counters.current.line++, key: crypto.randomUUID() });
	const receivable = new Set(inventoryRole ? (warehouses ?? []).map((w) => w.id) : []);
	const rules = category ? factRules((categories ?? []) as CategoryRow[], category) : [];
	const title = name.trim();
	const newCount = countNewLines(offers);
	const lineName = (line: Line, offer: Offer) => (line.mode === "existing" && line.picked ? line.picked.name : newComponentName(line, title, offer, offers.length));
	const warnings = hppWarnings(offers, hpp, costsWrite);

	async function addPhotos(files: FileList | null) {
		if (!files?.length) return;
		setPhotoError(null);
		setPhotoBusy(true);
		try {
			for (const file of [...files].slice(0, PHOTO_MAX - photos.length)) {
				const { blob } = await toWebp(file);
				const uploaded = await post<{ url: string; width: number; height: number }>("/api/v1/admin/product-photos", blob, "image/webp", crypto.randomUUID());
				// Content-addressed URL: the same photo twice is one entry.
				setPhotos((rows) => (rows.some((row) => row.url === uploaded.url) ? rows : [...rows, { url: uploaded.url, width: uploaded.width, height: uploaded.height, preview: URL.createObjectURL(blob) }]));
			}
		} catch (error) {
			setPhotoError(error instanceof Error ? error.message : "Foto gagal diunggah.");
		} finally {
			setPhotoBusy(false);
		}
	}

	// Moves focus to the control of an error key (summary links and the first invalid field).
	const focusControl = (errorKey: string) => document.getElementById(controlId(errorKey))?.focus();
	function check() {
		const next = validate({ name, category, photos: photos.length, offers, hpp, costsWrite, stock, receivable });
		for (const r of rules) {
			const problem = factProblem(r, facts[r.key] ?? "");
			if (problem) next[`fact-${r.key}`] = problem;
		}
		setErrors(next);
		// The first invalid field in page order, not in the order the rules ran.
		const first = Object.keys(next)
			.map((k) => ({ k, el: document.getElementById(controlId(k)) }))
			.filter((x): x is { k: string; el: HTMLElement } => x.el !== null)
			.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0];
		first?.el.focus();
		return Object.keys(next).length === 0;
	}

	function restart() {
		if (busy) return;
		const orphans = Object.values(created.current.stock).map((s) => s.sku);
		const draftId = created.current.product?.id ?? null;
		writeSaved(null);
		keys.current = new Map();
		frozen.current = new Map();
		created.current = { stock: {}, done: new Set() };
		sku.current = skuBase();
		counters.current = { offer: 2, line: 2 };
		setName("");
		setCategory("");
		setDescription("");
		setPhotos([]);
		setOffers(firstOffer());
		setHpp({});
		setStock({});
		setFacts({});
		setErrors({});
		const left = orphans.length ? ` SKU yang sudah terbuat dan tidak terpakai oleh formulir baru: ${orphans.join(", ")}. Cari di SKU Fisik; pakai lagi lewat "SKU yang ada" atau biarkan.` : "";
		setFailure(orphans.length || draftId ? { text: `Formulir dikosongkan.${draftId ? " Draf produk sebelumnya tetap tersimpan." : ""}${left}`, pending: [], draftId } : null);
	}

	async function submit(event: { preventDefault: () => void }) {
		event.preventDefault();
		if (busy || !check()) return;
		setFailure(null);
		let step = "";
		const stockIdOf = (line: Line) => (line.mode === "existing" ? (line.picked as NonNullable<Line["picked"]>).id : created.current.stock[line.key].id);
		const skuOf = (line: Line) => newComponentSku(sku.current, line, newCount);
		const offerSkuOf = (offer: Offer) => (offer.lines[0].mode === "new" ? `${skuOf(offer.lines[0])}_OFFER` : `${sku.current}-O${offer.n}_OFFER`);
		const warehouseName = (id: string) => (warehouses ?? []).find((w) => w.id === id)?.name ?? "gudang";
		try {
			persist();
			setBusy("Membuat SKU…");
			for (const offer of offers)
				for (const line of offer.lines) {
					if (line.mode !== "new" || created.current.stock[line.key]) continue;
					const body = { sku: skuOf(line), name: clip(lineName(line, offer), 200) };
					step = `stock:${line.key}`;
					const row = await post<{ id: string }>("/api/v1/admin/stock-items", JSON.stringify(body), "application/json", key(step));
					created.current.stock[line.key] = { id: row.id, ...body };
					persist();
				}
			if (!created.current.product) {
				setBusy("Menyimpan draf produk…");
				const body = productBody({ title, description, category, photos, offers, stockIdOf, componentNameOf: lineName, offerSkuOf });
				step = "product";
				created.current.product = await post("/api/v1/admin/products", JSON.stringify(body), "application/json", key(step));
				persist();
			}
			const product = created.current.product as NonNullable<Created["product"]>;
			const done = created.current.done;
			const finish = (id: string) => {
				done.add(id);
				persist();
			};
			// From here on nothing depends on a sibling: each step below runs even when another one is refused.
			const steps: PlannedStep[] = [];
			if (factsPatch(rules, facts) && !done.has("facts"))
				steps.push({
					id: "facts",
					label: "Atribut produk",
					run: async () => {
						let body = frozen.current.get("facts");
						if (!body) {
							// Someone may have edited the draft since it was created: patch against the version it has now.
							const read = await getJson<{ version: number }>(`/api/v1/admin/products/${product.id}`);
							if (!read.ok) throw new Refused(read.failure.status, read.failure.code, failureText(read.failure));
							body = JSON.stringify(factsPatch(rules, facts, read.data.version));
							frozen.current.set("facts", body);
						}
						await call("PATCH", `/api/v1/admin/products/${product.id}`, body, "application/json", key("facts"));
						finish("facts");
					},
				});
			if (costsWrite)
				for (const offer of offers) {
					for (const line of offer.lines) {
						const ck = componentKey(line), value = line.mode === "new" ? parseHpp(hpp[ck] ?? "") : null, id = `hpp:${ck}`;
						if (value === null || done.has(id)) continue;
						steps.push({
							id,
							label: `HPP ${lineName(line, offer)}`,
							run: async () => {
								await post(`/api/v1/admin/stock-items/${stockIdOf(line)}/cost-versions`, JSON.stringify(costVersionBody(value)), "application/json", key(id));
								finish(id);
							},
						});
					}
					const row = product.variants.find((o) => o.sku === offerSkuOf(offer)), id = `assumption:${offer.key}`;
					// Default assumptions only next to an HPP typed here; otherwise finance records them (PR-19).
					if (row && offerHasHpp(offer, hpp) && !done.has(id))
						steps.push({
							id,
							label: `Asumsi biaya bawaan ${offer.label.trim()}`,
							run: async () => {
								await post(`/api/v1/admin/offers/${row.id}/cost-assumption-versions`, JSON.stringify(assumptionBody()), "application/json", key(id));
								finish(id);
							},
						});
				}
			for (const pair of receivePairs(offers)) {
				const quantity = parseQuantity(stock[pair.key] ?? ""), id = `receive:${pair.key}`;
				if (quantity === null || !receivable.has(pair.warehouse) || done.has(id)) continue;
				steps.push({
					id,
					label: `Stok awal ${lineName(pair.line, pair.offer)} di ${warehouseName(pair.warehouse)}`,
					run: async () => {
						// A new SKU has no position yet (version 0). An existing one carries its own version, read once and then frozen with
						// the key. When another receive moved the position first (409), the version is read again, once; a second 409 is reported.
						for (let attempt = 0; ; attempt++) {
							let body = frozen.current.get(id);
							if (!body) {
								let version = 0;
								if (pair.line.mode === "existing" || attempt > 0) {
									const read = await getJson<{ data: Position[] }>(`/api/v1/admin/inventory?warehouse_id=${pair.warehouse}&stock_item_id=${stockIdOf(pair.line)}&limit=100`);
									if (!read.ok) throw new Refused(read.failure.status, read.failure.code, failureText(read.failure));
									version = positionVersion(read.data.data);
								}
								body = JSON.stringify(receiveBody(pair.warehouse, stockIdOf(pair.line), quantity, version));
								frozen.current.set(id, body);
							}
							try {
								await post("/api/v1/admin/inventory/movements", body, "application/json", key(id));
								return finish(id);
							} catch (error) {
								if (attempt > 0 || !(error instanceof Refused) || error.status !== 409 || !isDefinitive(error)) throw error;
								keys.current.delete(id);
								frozen.current.delete(id);
							}
						}
					},
				});
			}
			setBusy("Menyimpan HPP, atribut dan stok…");
			const pending = await runIndependent(steps, (id) => {
				keys.current.delete(id);
				frozen.current.delete(id);
			});
			persist();
			if (pending.length > 0) {
				setBusy(null);
				return setFailure({
					text: `${pending.length} langkah belum tersimpan. Perbaiki isiannya bila perlu, lalu tekan Lanjutkan menyimpan: hanya langkah ini yang dikirim lagi.`,
					pending: pending.map((p) => `${p.label}: ${p.text}`),
					draftId: product.id,
				});
			}
			setBusy("Membuka produk…");
			writeSaved(null);
			router.push(`/admin/produk/${product.id}`);
		} catch (error) {
			// A definitive refusal created nothing: the corrected retry gets a fresh key and a fresh body.
			if (isDefinitive(error)) {
				keys.current.delete(step);
				frozen.current.delete(step);
				// A taken SKU code would be refused again by the same body: draw a new code for the next try.
				if ((error as Refused).code === "CATALOG_IDENTITY_CONFLICT") sku.current = skuBase();
			}
			persist();
			setBusy(null);
			setFailure({
				text: `${error instanceof Error ? error.message : "Produk belum tersimpan. Coba lagi."}${isDefinitive(error) && (error as Refused).code === "CATALOG_IDENTITY_CONFLICT" ? " Kode SKU baru dipakai pada percobaan berikutnya." : ""}`,
				pending: [],
				draftId: created.current.product?.id ?? null,
			});
		}
	}

	if (loadError) return <AdminPage testId="product-create"><ErrorState message={loadError} /></AdminPage>;
	if (!categories || !warehouses || inventoryRole === null) return <AdminPage testId="product-create"><LoadingState label="Memuat kategori dan gudang…" /></AdminPage>;
	const fieldError = (id: string) => errors[id];
	const errorKeys = Object.keys(errors);
	const warehouseLabel = (id: string) => warehouses.find((w) => w.id === id)?.name ?? "";
	const pairs = receivePairs(offers);
	const hasHppWithoutGrant = !costsWrite;
	return (
		<AdminPage testId="product-create">
			<PageHeader
				title="Tambah Produk"
				back={{ href: "/admin/produk", label: "Katalog Produk" }}
				description="Produk selalu tersimpan sebagai draf. Terbitkan dari halaman produk setelah stok dan HPP lengkap."
			/>
			<form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-6" data-testid="product-create-form">
				<div role="status" aria-live="polite" data-testid="product-create-summary">
					{errorKeys.length > 0 && (
						<Alert role="none" variant="destructive">
							<AlertDescription>
								<p className="font-medium">Periksa {errorKeys.length} isian sebelum menyimpan:</p>
								<ul className="mt-1 list-disc pl-5">
									{errorKeys.map((k) => (
										<li key={k}>
											<a className="font-medium underline" href={`#${controlId(k)}`} onClick={(e) => { e.preventDefault(); focusControl(k); }}>{errorLabel(k)}</a>: {errors[k]}
										</li>
									))}
								</ul>
							</AlertDescription>
						</Alert>
					)}
				</div>
				<p role="status" aria-live="polite" className="sr-only" data-testid="product-create-progress">{busy ?? ""}</p>
				{failure && (
					<Alert ref={failureRef} tabIndex={-1} variant="destructive" className="outline-none" data-testid="product-create-error">
						<AlertDescription>
							<p>{failure.text}</p>
							{failure.pending.length > 0 && (
								<ul className="mt-1 list-disc pl-5" data-testid="product-create-pending">
									{failure.pending.map((item) => <li key={item}>{item}</li>)}
								</ul>
							)}
							{failure.draftId && (
								<p className="mt-1">
									Draf sudah tersimpan: <a className="font-medium underline" href={`/admin/produk/${failure.draftId}`}>buka draf produk</a>.
								</p>
							)}
						</AlertDescription>
					</Alert>
				)}
				<DetailSection id="product-info" title="Informasi produk">
					<FormField id="product-name" label="Nama produk" invalid={Boolean(fieldError("name"))} hint={fieldError("name") ?? "Nama yang dilihat pembeli, tanpa kata promosi."}>
						<Input id="product-name" value={name} maxLength={200} disabled={named} onChange={(e) => setName(e.target.value)}
							aria-invalid={Boolean(fieldError("name"))} aria-describedby="product-name-hint" data-testid="product-name" />
					</FormField>
					<FormField id="product-category" label="Kategori" invalid={Boolean(fieldError("category"))} hint={fieldError("category")}>
						<select id="product-category" value={category} disabled={locked} onChange={(e) => setCategory(e.target.value)} className={`${nativeSelectClass} w-full`}
							aria-invalid={Boolean(fieldError("category"))} aria-describedby={fieldError("category") ? "product-category-hint" : undefined} data-testid="product-category">
							<option value="">Pilih kategori</option>
							{categories.map((c) => (
								<option key={c.id} value={c.id}>{`${"— ".repeat(c.depth)}${c.name}`}</option>
							))}
						</select>
					</FormField>
					<FormField id="product-description" label="Deskripsi" hint="Bahan, ukuran, isi kemasan dan cara pakai. Hindari klaim kesehatan.">
						<Textarea id="product-description" value={description} maxLength={10000} rows={6} disabled={locked}
							onChange={(e) => setDescription(e.target.value)} aria-describedby="product-description-hint" data-testid="product-description" />
					</FormField>
				</DetailSection>

				<DetailSection id="product-photos-section" title="Foto" description={`Maksimal ${PHOTO_MAX} foto. Foto pertama menjadi sampul. JPG, PNG atau WebP; diubah otomatis ke WebP.`}>
					<ul className="grid grid-cols-3 gap-2 sm:grid-cols-5" data-testid="product-photos">
						{photos.map((photo, index) => (
							<li key={photo.url} className="relative overflow-hidden rounded-md border bg-muted">
								{/* biome-ignore lint/performance/noImgElement: local object URL preview before the photo is published */}
								<img src={photo.preview} alt={`Foto ${index + 1}`} className="aspect-square w-full object-cover" />
								{index === 0 && <span className="absolute top-1 left-1 rounded bg-background/90 px-1.5 text-xs font-medium">Sampul</span>}
								<Button type="button" size="icon" variant="secondary" className="absolute top-1 right-1 size-8" disabled={locked}
									onClick={() => setPhotos((rows) => rows.filter((_, i) => i !== index))} aria-label={`Hapus foto ${index + 1}`}>
									<Trash2 aria-hidden="true" />
								</Button>
							</li>
						))}
					</ul>
					{photos.length < PHOTO_MAX && (
						<label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 max-md:w-full max-md:justify-center">
							<ImagePlus aria-hidden="true" className="size-4" />
							{photoBusy ? "Mengunggah foto…" : "Tambah foto"}
							<input id="product-photo-file" type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={locked || photoBusy}
								aria-describedby={photoError || fieldError("photos") ? "product-photo-error" : undefined}
								onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} data-testid="product-photo-input" />
						</label>
					)}
					{(photoError || fieldError("photos")) && <p id="product-photo-error" className="text-sm text-destructive" role="alert">{photoError ?? fieldError("photos")}</p>}
				</DetailSection>

				<DetailSection id="product-variants-section" title="Penawaran" description="Satu penawaran per pilihan yang dijual. Isi penawaran: barang dan jumlahnya dari satu gudang asal. Harga penawaran berdiri sendiri, Rp1 sampai Rp99.000, dan tidak harus sama dengan jumlah harga isinya.">
					{fieldError("offers") && <p className="text-sm text-destructive" role="alert">{fieldError("offers")}</p>}
					<ol className="flex flex-col gap-4" data-testid="product-variants">
						{offers.map((o, index) => (
							<li key={o.key} className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_auto] md:items-start" data-testid={`offer-${index}`}>
								<FormField id={`variant-label-${index}`} label={`Nama penawaran ${index + 1}`} invalid={Boolean(fieldError(`label-${index}`))} hint={fieldError(`label-${index}`)}>
									<Input id={`variant-label-${index}`} value={o.label} maxLength={200} disabled={named} placeholder="Contoh: Hitam / L atau Paket hemat"
										onChange={(e) => setOffer(index, { label: e.target.value })} aria-invalid={Boolean(fieldError(`label-${index}`))} aria-describedby={fieldError(`label-${index}`) ? `variant-label-${index}-hint` : undefined} />
								</FormField>
								<FormField id={`variant-price-${index}`} label="Harga (Rp)" invalid={Boolean(fieldError(`price-${index}`))} hint={fieldError(`price-${index}`)}>
									<Input id={`variant-price-${index}`} inputMode="numeric" value={o.price} disabled={locked} placeholder="Maks. 99000"
										onChange={(e) => setOffer(index, { price: e.target.value.replace(/\D/g, "") })} aria-invalid={Boolean(fieldError(`price-${index}`))} aria-describedby={fieldError(`price-${index}`) ? `variant-price-${index}-hint` : undefined} />
								</FormField>
								<FormField id={`variant-weight-${index}`} label="Berat kirim (gram)" invalid={Boolean(fieldError(`weight-${index}`))} hint={fieldError(`weight-${index}`)}>
									<Input id={`variant-weight-${index}`} inputMode="numeric" value={o.weight} disabled={locked}
										onChange={(e) => setOffer(index, { weight: e.target.value.replace(/\D/g, "") })} aria-invalid={Boolean(fieldError(`weight-${index}`))} aria-describedby={fieldError(`weight-${index}`) ? `variant-weight-${index}-hint` : undefined} />
								</FormField>
								<FormField id={`variant-warehouse-${index}`} label="Gudang asal" invalid={Boolean(fieldError(`warehouse-${index}`))} hint={fieldError(`warehouse-${index}`)}>
									<select id={`variant-warehouse-${index}`} value={o.warehouse} disabled={locked} className={`${nativeSelectClass} w-full`}
										onChange={(e) => setOffer(index, { warehouse: e.target.value })} aria-invalid={Boolean(fieldError(`warehouse-${index}`))} aria-describedby={fieldError(`warehouse-${index}`) ? `variant-warehouse-${index}-hint` : undefined}>
										<option value="">Pilih gudang</option>
										{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
									</select>
								</FormField>
								<Button type="button" variant="ghost" size="icon" className="md:mt-6" disabled={named || single}
									onClick={() => setOffers((rows) => rows.filter((_, i) => i !== index))} aria-label={`Hapus penawaran ${index + 1}`}>
									<Trash2 aria-hidden="true" />
								</Button>
								<OfferContentsPicker offerIndex={index} lines={o.lines} nextLine={nextLine} disabled={busy !== null} structureLocked={named}
									errors={errors} onChange={(lines) => setOffer(index, { lines })}
									hppField={costsWrite ? (line) => {
										if (line.mode !== "new") return <p className="text-xs text-muted-foreground md:mt-6">HPP SKU ini diatur di SKU &amp; HPP.</p>;
										const ck = componentKey(line);
										return (
											<FormField id={`hpp-${ck}`} label="HPP (Rp)" invalid={Boolean(fieldError(`hpp-${ck}`))} hint={fieldError(`hpp-${ck}`) ?? warnings[`hpp-${ck}`]}>
												<Input id={`hpp-${ck}`} inputMode="numeric" value={hpp[ck] ?? ""} disabled={busy !== null || sent(`hpp:${ck}`)}
													onChange={(e) => setHpp((v) => ({ ...v, [ck]: e.target.value.replace(/\D/g, "") }))}
													aria-invalid={Boolean(fieldError(`hpp-${ck}`))} aria-describedby={fieldError(`hpp-${ck}`) || warnings[`hpp-${ck}`] ? `hpp-${ck}-hint` : undefined} />
											</FormField>
										);
									} : undefined} />
								{fieldError(`lines-${index}`) && <p className="text-sm text-destructive md:col-span-full" role="alert">{fieldError(`lines-${index}`)}</p>}
							</li>
						))}
					</ol>
					<Button id="product-variant-add" type="button" variant="outline" className="self-start max-md:self-stretch" disabled={named || offers.length >= OFFER_CAP}
						onClick={() => {
							const n = counters.current.offer++, line = nextLine();
							setOffers((rows) => [...rows.map((r) => (rows.length === 1 && r.label === "Satuan" ? { ...r, label: "" } : r)), newOffer(n, newLine(line.n, line.key), "", rows[0]?.warehouse ?? "")]);
						}}
						data-testid="product-variant-add">
						<Plus aria-hidden="true" data-icon="inline-start" />
						Tambah penawaran
					</Button>
					{costsWrite && (
						<p className="text-sm text-muted-foreground" data-testid="assumption-note">
							Penawaran yang HPP-nya Anda isi di sini juga mendapat asumsi biaya bawaan (kemasan Rp1.000, biaya penyedia Rp1.000, subsidi Rp5.000, cadangan retur Rp1.000), dicatat sebagai nilai bawaan yang belum dikonfirmasi keuangan. Tanpa HPP di sini, tidak ada asumsi yang dicatat.
						</p>
					)}
					{hasHppWithoutGrant && (
						<p className="text-sm text-muted-foreground" data-testid="hpp-absent">
							Kolom HPP tidak tampil karena peran Anda tidak punya izin mengisi HPP (finance.costs.write). HPP tetap kosong dan produk belum bisa terbit sampai Super Admin atau tim keuangan mengisinya di SKU &amp; HPP.
						</p>
					)}
				</DetailSection>

				{rules.length > 0 && (
					<DetailSection id="product-facts" title="Atribut" description="Isian yang diminta kategori ini. Boleh dikosongkan sekarang; kolom wajib harus terisi sebelum produk terbit.">
						<div className="grid gap-3 md:grid-cols-2">
							{rules.map((r) => {
								const id = `fact-${r.key}`, err = fieldError(id);
								const hint = err ?? (r.required ? "Wajib sebelum terbit." : undefined);
								return (
									<FormField key={r.key} id={id} label={r.label} invalid={Boolean(err)} hint={hint}>
										{r.value_type === "enum" || r.value_type === "boolean" ? (
											<select id={id} value={facts[r.key] ?? ""} disabled={busy !== null || sent("facts")} className={`${nativeSelectClass} w-full`}
												onChange={(e) => setFacts((v) => ({ ...v, [r.key]: e.target.value }))} aria-invalid={Boolean(err)} aria-describedby={hint ? `${id}-hint` : undefined}>
												<option value="">Belum diisi</option>
												{r.value_type === "boolean"
													? [<option key="true" value="true">Ya</option>, <option key="false" value="false">Tidak</option>]
													: r.allowed_values.map((v) => <option key={v} value={v}>{v}</option>)}
											</select>
										) : (
											<Input id={id} value={facts[r.key] ?? ""} maxLength={500} disabled={busy !== null || sent("facts")} inputMode={r.value_type === "number" ? "decimal" : undefined}
												onChange={(e) => setFacts((v) => ({ ...v, [r.key]: e.target.value }))} aria-invalid={Boolean(err)} aria-describedby={hint ? `${id}-hint` : undefined} />
										)}
									</FormField>
								);
							})}
						</div>
					</DetailSection>
				)}

				<DetailSection id="product-stock-section" title="Stok awal" description="Opsional. Tiap jumlah dicatat sebagai satu penerimaan (receive) per SKU dan gudang, bukan angka bebas. Tanpa stok, produk belum bisa terbit.">
					{pairs.length === 0 ? (
						<p className="text-sm text-muted-foreground">Pilih gudang asal pada penawaran untuk mengisi stok awal.</p>
					) : (
						<ul className="flex flex-col divide-y rounded-md border" data-testid="initial-stock">
							{pairs.map((pair) => {
								const id = `stock-${pair.key}`, err = fieldError(id), canReceive = receivable.has(pair.warehouse);
								return (
									<li key={pair.key} className="grid gap-2 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)] md:items-start">
										<div className="flex min-w-0 flex-col text-sm">
											<span className="font-medium">{lineName(pair.line, pair.offer)}</span>
											<span className="text-xs text-muted-foreground">{pair.line.mode === "existing" ? pair.line.picked?.sku : "SKU baru"}</span>
										</div>
										<span className="text-sm">{warehouseLabel(pair.warehouse)}</span>
										{canReceive ? (
											<FormField id={id} label="Jumlah diterima" invalid={Boolean(err)} hint={err}>
												<Input id={id} inputMode="numeric" value={stock[pair.key] ?? ""} disabled={busy !== null || sent(`receive:${pair.key}`)} placeholder="Kosongkan bila belum ada"
													onChange={(e) => setStock((v) => ({ ...v, [pair.key]: e.target.value.replace(/\D/g, "") }))}
													aria-invalid={Boolean(err)} aria-describedby={err ? `${id}-hint` : undefined} />
											</FormField>
										) : (
											<p className="text-xs text-muted-foreground">{inventoryRole ? "Gudang ini di luar cakupan Anda." : "Peran Anda tidak boleh mencatat stok."} Minta tim gudang mencatat penerimaan sebelum produk diterbitkan.</p>
										)}
									</li>
								);
							})}
						</ul>
					)}
				</DetailSection>

				<StickyActions>
					<Button type="button" variant="outline" onClick={() => router.push("/admin/produk")} disabled={busy !== null}>
						<ArrowLeft aria-hidden="true" data-icon="inline-start" />
						Batal
					</Button>
					{(keys.current.size > 0 || created.current.product) && (
						<Button type="button" variant="ghost" onClick={restart} disabled={busy !== null} data-testid="product-create-restart">
							Mulai ulang
						</Button>
					)}
					<Button type="submit" disabled={busy !== null || photoBusy} data-testid="product-create-submit">
						{busy ?? (created.current.product ? "Lanjutkan menyimpan" : "Simpan draf")}
					</Button>
				</StickyActions>
			</form>
		</AdminPage>
	);
}
