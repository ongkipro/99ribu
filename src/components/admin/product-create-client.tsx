"use client";

import { ArrowLeft, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { failureText } from "./admin-errors";
import { type Category, readAll } from "./catalog-model";
import { FormField, nativeSelectClass } from "./form";
import { sentText } from "./ops-api";
import { AdminPage, DetailSection, PageHeader, StickyActions } from "./page-blocks";
import { ErrorState, LoadingState } from "./states";

// S-P1 "Tambah Produk": a new product as an inactive draft through the existing catalog APIs, in order: one stock item
// per variant (POST stock-items), the product with one unit offer per variant (POST products), then, for a caller with
// finance.costs.write, each component's HPP and each offer's default variable-cost assumptions. Every step has its own
// idempotency key for the life of the form, so a retry after a lost response replays instead of creating twice; a step
// that already succeeded is not sent again. Publication, stock receipt and edits stay on the product page.

type Warehouse = { id: string; name: string; city: string; district: string | null };
type Photo = { url: string; width: number; height: number; preview: string };
type Variant = { key: string; label: string; weight: string; warehouse: string; hpp: string };
type Created = { stock: Record<string, string>; product?: { id: string; variants: { id: string; sku: string }[] }; costs: Set<string> };

const PHOTO_MAX = 10, PHOTO_BYTES = 500 * 1024, PHOTO_EDGE = 1080;
// Same per-offer defaults the catalog import applies (S69 DEFAULT_OFFER_ASSUMPTIONS in src/modules/local/berlapak.ts).
const ASSUMPTIONS = { packaging_idr: 1000, provider_fee_idr: 1000, subsidy_idr: 5000, returns_reserve_idr: 1000 };
// lazy: no carton dimensions on the form; a cube whose volumetric weight equals the actual weight, as the import does.
const cube = (grams: number) => Math.min(1000, Math.max(50, Math.ceil(Math.cbrt(grams * 6000))));
const skuBase = () => `P${new Date().toISOString().slice(2, 10).replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase()}`;
const newVariant = (label = "", warehouse = ""): Variant => ({ key: crypto.randomUUID(), label, weight: "", warehouse, hpp: "" });

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
	for (const quality of [0.82, 0.72, 0.62, 0.52]) {
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
		if (blob?.type !== "image/webp") throw new Error("Browser ini belum bisa mengubah foto ke WebP. Gunakan Chrome atau Edge terbaru.");
		if (blob.size <= PHOTO_BYTES) return { blob, width, height };
	}
	throw new Error("Foto terlalu detail untuk batas 500 KB. Pilih foto lain.");
}

async function post<T>(url: string, body: BodyInit, type: string, key: string): Promise<T> {
	const res = await fetch(url, { method: "POST", credentials: "include", headers: { "content-type": type, "idempotency-key": key }, body });
	if (res.ok) return (await res.json()) as T;
	const problem = (await res.json().catch(() => null)) as { code?: string } | null;
	throw new Error(sentText(res.status, problem?.code ?? null));
}

export function ProductCreateClient({ costsWrite }: { costsWrite: boolean }) {
	const router = useRouter();
	const formId = useId();
	const [categories, setCategories] = useState<Category[] | null>(null);
	const [warehouses, setWarehouses] = useState<Warehouse[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [category, setCategory] = useState("");
	const [description, setDescription] = useState("");
	const [photos, setPhotos] = useState<Photo[]>([]);
	const [photoBusy, setPhotoBusy] = useState(false);
	const [photoError, setPhotoError] = useState<string | null>(null);
	const [variants, setVariants] = useState<Variant[]>([newVariant("Satuan")]);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState<string | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const failureRef = useRef<HTMLDivElement>(null);
	// Stable for the life of the form: SKUs, step keys and what already succeeded.
	const sku = useRef(skuBase());
	const keys = useRef(new Map<string, string>());
	const created = useRef<Created>({ stock: {}, costs: new Set() });
	const key = (step: string) => {
		const value = keys.current.get(step) ?? crypto.randomUUID();
		keys.current.set(step, value);
		return value;
	};

	useEffect(() => {
		let live = true;
		void (async () => {
			const [c, w] = await Promise.all([readAll<Category>("/api/v1/admin/categories?limit=100"), readAll<Warehouse>("/api/v1/admin/warehouses?limit=100")]);
			if (!live) return;
			if (!c.ok) return setLoadError(failureText(c.failure));
			if (!w.ok) return setLoadError(failureText(w.failure));
			setCategories(c.data);
			setWarehouses([...w.data].sort((a, b) => a.name.localeCompare(b.name, "id")));
		})();
		return () => {
			live = false;
		};
	}, []);
	useEffect(() => {
		if (failure) failureRef.current?.focus();
	}, [failure]);

	const locked = Boolean(created.current.product) || busy !== null;
	const single = variants.length === 1;
	const setVariant = (index: number, patch: Partial<Variant>) => setVariants((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

	async function addPhotos(files: FileList | null) {
		if (!files?.length) return;
		setPhotoError(null);
		setPhotoBusy(true);
		try {
			for (const file of [...files].slice(0, PHOTO_MAX - photos.length)) {
				const { blob, width, height } = await toWebp(file);
				const saved = await post<{ url: string; width: number; height: number }>("/api/v1/admin/product-photos", blob, "image/webp", crypto.randomUUID());
				setPhotos((rows) => [...rows, { url: saved.url, width: saved.width, height: saved.height, preview: URL.createObjectURL(blob) }]);
				if (width < 300 || height < 300) break;
			}
		} catch (error) {
			setPhotoError(error instanceof Error ? error.message : "Foto gagal diunggah.");
		} finally {
			setPhotoBusy(false);
		}
	}

	function validate() {
		const next: Record<string, string> = {};
		if (!name.trim()) next.name = "Isi nama produk.";
		if (!category) next.category = "Pilih kategori.";
		if (!photos.length) next.photos = "Tambahkan minimal satu foto.";
		const labels = new Set<string>();
		variants.forEach((v, i) => {
			if (!v.label.trim()) next[`label-${i}`] = "Isi nama varian.";
			else if (labels.has(v.label.trim().toLowerCase())) next[`label-${i}`] = "Nama varian sudah dipakai.";
			labels.add(v.label.trim().toLowerCase());
			if (!/^\d{1,6}$/.test(v.weight) || Number(v.weight) < 1) next[`weight-${i}`] = "Berat dalam gram, minimal 1.";
			if (!v.warehouse) next[`warehouse-${i}`] = "Pilih gudang asal.";
			if (costsWrite && v.hpp && (!/^\d{1,6}$/.test(v.hpp) || Number(v.hpp) >= 99000)) next[`hpp-${i}`] = "HPP dalam rupiah, di bawah Rp99.000.";
		});
		setErrors(next);
		return Object.keys(next).length === 0;
	}

	async function submit(event: { preventDefault: () => void }) {
		event.preventDefault();
		if (busy || !validate()) return;
		setFailure(null);
		const title = name.trim();
		const stockName = (v: Variant) => (single ? title : `${title} - ${v.label.trim()}`).slice(0, 200);
		const variantSku = (index: number) => (single ? sku.current : `${sku.current}-${index + 1}`);
		try {
			setBusy("Membuat SKU…");
			for (const [index, v] of variants.entries()) {
				if (created.current.stock[v.key]) continue;
				const row = await post<{ id: string }>("/api/v1/admin/stock-items", JSON.stringify({ sku: variantSku(index), name: stockName(v) }), "application/json", key(`stock:${v.key}`));
				created.current.stock[v.key] = row.id;
			}
			if (!created.current.product) {
				setBusy("Menyimpan draf produk…");
				const images = photos.map((p, i) => ({ url: p.url, alt: i ? `${title}, foto ${i + 1}` : title, width: p.width, height: p.height }));
				const body = {
					name: title,
					description: description.trim(),
					category_id: category,
					images,
					variants: variants.map((v, index) => {
						const grams = Number(v.weight), side = cube(grams);
						return {
							sku: `${variantSku(index)}_OFFER`, label: v.label.trim(), attributes: [], offer_kind: "unit", weight_grams: grams,
							length_mm: side, width_mm: side, height_mm: side, default_warehouse_id: v.warehouse,
							contents: [{ stock_item_id: created.current.stock[v.key], name: stockName(v), quantity: 1 }],
						};
					}),
				};
				created.current.product = await post("/api/v1/admin/products", JSON.stringify(body), "application/json", key("product"));
			}
			const product = created.current.product as NonNullable<Created["product"]>;
			if (costsWrite) {
				setBusy("Menyimpan HPP dan biaya…");
				for (const [index, v] of variants.entries()) {
					const stockId = created.current.stock[v.key];
					if (v.hpp && !created.current.costs.has(`hpp:${v.key}`)) {
						await post(`/api/v1/admin/stock-items/${stockId}/cost-versions`, JSON.stringify({ expected_version: 0, unit_cost: Number(v.hpp), effective_from: null,
							source: "Form Tambah Produk", reason: "HPP awal produk baru" }), "application/json", key(`hpp:${v.key}`));
						created.current.costs.add(`hpp:${v.key}`);
					}
					const offer = product.variants.find((o) => o.sku === `${variantSku(index)}_OFFER`);
					if (offer && !created.current.costs.has(`assumption:${v.key}`)) {
						await post(`/api/v1/admin/offers/${offer.id}/cost-assumption-versions`, JSON.stringify({ expected_version: 0, effective_from: null, ...ASSUMPTIONS,
							source: "Asumsi biaya bawaan per penawaran", reason: "Asumsi biaya awal produk baru" }), "application/json", key(`assumption:${v.key}`));
						created.current.costs.add(`assumption:${v.key}`);
					}
				}
			}
			setBusy("Membuka produk…");
			router.push(`/admin/produk/${product.id}`);
		} catch (error) {
			setBusy(null);
			setFailure(error instanceof Error ? error.message : "Produk belum tersimpan. Coba lagi.");
		}
	}

	if (loadError) return <AdminPage testId="product-create"><ErrorState message={loadError} /></AdminPage>;
	if (!categories || !warehouses) return <AdminPage testId="product-create"><LoadingState label="Memuat kategori dan gudang…" /></AdminPage>;
	const fieldError = (id: string) => errors[id];
	return (
		<AdminPage testId="product-create">
			<PageHeader
				title="Tambah Produk"
				back={{ href: "/admin/produk", label: "Katalog Produk" }}
				description="Produk tersimpan sebagai draf. Setelah stok diterima di gudang, terbitkan dari halaman produk."
			/>
			<form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-6" data-testid="product-create-form">
				{failure && (
					<Alert ref={failureRef} tabIndex={-1} variant="destructive" className="outline-none" data-testid="product-create-error">
						<AlertDescription>{failure}</AlertDescription>
					</Alert>
				)}
				<DetailSection id="product-info" title="Informasi produk">
					<FormField id="product-name" label="Nama produk" invalid={Boolean(fieldError("name"))} hint={fieldError("name") ?? "Nama yang dilihat pembeli, tanpa kata promosi."}>
						<Input id="product-name" value={name} maxLength={200} disabled={locked} onChange={(e) => setName(e.target.value)}
							aria-invalid={Boolean(fieldError("name"))} aria-describedby="product-name-hint" data-testid="product-name" />
					</FormField>
					<FormField id="product-category" label="Kategori" invalid={Boolean(fieldError("category"))} hint={fieldError("category")}>
						<select id="product-category" value={category} disabled={locked} onChange={(e) => setCategory(e.target.value)} className={`${nativeSelectClass} w-full`}
							aria-invalid={Boolean(fieldError("category"))} aria-describedby="product-category-hint" data-testid="product-category">
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
							<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={locked || photoBusy}
								onChange={(e) => { void addPhotos(e.target.files); e.target.value = ""; }} data-testid="product-photo-input" />
						</label>
					)}
					{(photoError || fieldError("photos")) && <p className="text-sm text-destructive" role="alert">{photoError ?? fieldError("photos")}</p>}
				</DetailSection>

				<DetailSection id="product-variants-section" title="Varian" description="Satu baris untuk tiap pilihan yang dijual (warna, ukuran). Semua varian dijual Rp99.000.">
					<ol className="flex flex-col gap-4" data-testid="product-variants">
						{variants.map((v, index) => (
							<li key={v.key} className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1.6fr)_minmax(0,0.9fr)_auto] md:items-start">
								<FormField id={`variant-label-${index}`} label="Nama varian" invalid={Boolean(fieldError(`label-${index}`))} hint={fieldError(`label-${index}`)}>
									<Input id={`variant-label-${index}`} value={v.label} maxLength={200} disabled={locked} placeholder="Contoh: Hitam / L"
										onChange={(e) => setVariant(index, { label: e.target.value })} aria-invalid={Boolean(fieldError(`label-${index}`))} aria-describedby={`variant-label-${index}-hint`} />
								</FormField>
								<FormField id={`variant-weight-${index}`} label="Berat (gram)" invalid={Boolean(fieldError(`weight-${index}`))} hint={fieldError(`weight-${index}`)}>
									<Input id={`variant-weight-${index}`} inputMode="numeric" value={v.weight} disabled={locked}
										onChange={(e) => setVariant(index, { weight: e.target.value.replace(/\D/g, "") })} aria-invalid={Boolean(fieldError(`weight-${index}`))} aria-describedby={`variant-weight-${index}-hint`} />
								</FormField>
								<FormField id={`variant-warehouse-${index}`} label="Gudang asal" invalid={Boolean(fieldError(`warehouse-${index}`))} hint={fieldError(`warehouse-${index}`)}>
									<select id={`variant-warehouse-${index}`} value={v.warehouse} disabled={locked} className={`${nativeSelectClass} w-full`}
										onChange={(e) => setVariant(index, { warehouse: e.target.value })} aria-invalid={Boolean(fieldError(`warehouse-${index}`))} aria-describedby={`variant-warehouse-${index}-hint`}>
										<option value="">Pilih gudang</option>
										{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
									</select>
								</FormField>
								{costsWrite ? (
									<FormField id={`variant-hpp-${index}`} label="HPP (Rp)" invalid={Boolean(fieldError(`hpp-${index}`))} hint={fieldError(`hpp-${index}`)}>
										<Input id={`variant-hpp-${index}`} inputMode="numeric" value={v.hpp} disabled={locked}
											onChange={(e) => setVariant(index, { hpp: e.target.value.replace(/\D/g, "") })} aria-invalid={Boolean(fieldError(`hpp-${index}`))} aria-describedby={`variant-hpp-${index}-hint`} />
									</FormField>
								) : <span className="hidden md:block" />}
								<Button type="button" variant="ghost" size="icon" className="md:mt-6" disabled={locked || single}
									onClick={() => setVariants((rows) => rows.filter((_, i) => i !== index))} aria-label={`Hapus varian ${index + 1}`}>
									<Trash2 aria-hidden="true" />
								</Button>
							</li>
						))}
					</ol>
					<Button type="button" variant="outline" className="self-start max-md:self-stretch" disabled={locked || variants.length >= 50}
						onClick={() => setVariants((rows) => [...rows.map((r) => (rows.length === 1 && r.label === "Satuan" ? { ...r, label: "" } : r)), newVariant("", rows[0]?.warehouse ?? "")])}
						data-testid="product-variant-add">
						<Plus aria-hidden="true" data-icon="inline-start" />
						Tambah varian
					</Button>
					{!costsWrite && <p className="text-sm text-muted-foreground">HPP diisi oleh Super Admin atau tim keuangan di SKU &amp; HPP sebelum produk bisa terbit.</p>}
				</DetailSection>

				<StickyActions>
					<Button type="button" variant="outline" onClick={() => router.push("/admin/produk")} disabled={busy !== null}>
						<ArrowLeft aria-hidden="true" data-icon="inline-start" />
						Batal
					</Button>
					<Button type="submit" disabled={busy !== null || photoBusy} data-testid="product-create-submit">
						{busy ?? (created.current.product ? "Lanjutkan menyimpan" : "Simpan draf")}
					</Button>
				</StickyActions>
			</form>
		</AdminPage>
	);
}
