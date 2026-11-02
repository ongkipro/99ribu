"use client";

import { CircleAlert, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { rupiah } from "@/modules/storefront/format";
import { getJson } from "./admin-errors";
import {
	blockerLabel,
	type CatalogProduct,
	type Category,
	categoryPath,
	OFFER_KIND_LABELS,
	type PublicationState,
} from "./catalog-model";
import { FormDialog, FormField, nativeSelectClass } from "./form";
import {
	buildPatch,
	describeChanges,
	describeDrift,
	diffOffers,
	isVersionConflict,
	LABEL_MAX,
	offerErrorMessage,
	type OfferIssue,
	type OfferRow,
	parsePrice,
	PRICE_MAX_IDR,
	REASON_MAX,
	rebaseEdits,
	rowsFrom,
	validateFresh,
	validateRows,
} from "./offer-editor-model";
import { send, useOperationKey } from "./ops-api";
import { StickyActions } from "./page-blocks";
import { StatusBadge } from "./status";

type Warehouse = { id: string; name: string; city: string };
type StockItem = { id: string; sku: string; name: string };
/** `product` is the newest server copy when it is known; "apply again" needs it. */
type Conflict = { lines: string[]; latest: number | null; product: CatalogProduct | null };

const GRID = "md:grid-cols-[minmax(0,1fr)_9rem_8rem_9rem_auto]";

/**
 * S151 / spec 17 W4-3: edit the live offers of the draft product (label, price, weight), add and retire
 * offers, and change the category, as one PATCH with a reason. The API saves a new draft version; a product
 * that is already published shows the change only after it is published again (same as the content dialog).
 * Margin and cost never appear here: the margin floor is checked at publication and surfaces as a blocker.
 */
export function OfferEditor({
	product: propProduct,
	base,
	categories,
	warehouses,
	blockers,
	onSaved,
	onReload,
	onDirtyChange,
}: {
	product: CatalogProduct;
	base: string;
	categories: Category[];
	warehouses: Warehouse[];
	blockers: PublicationState["blockers"];
	onSaved: (message: string) => void;
	/** Re-reads the product; the new copy arrives as the `product` prop and is adopted or offered for re-applying. */
	onReload: () => void;
	onDirtyChange?: (dirty: boolean) => void;
}) {
	// The version the rows below were edited against. The parent no longer remounts this editor on a
	// version bump: that silently dropped typed edits (S151-1).
	const [product, setProduct] = useState(propProduct);
	const discardNext = useRef(false);
	const [notes, setNotes] = useState<string[]>([]);
	const [rows, setRows] = useState<OfferRow[]>(() => rowsFrom(propProduct.variants));
	const [retired, setRetired] = useState<{ id: string; label: string }[]>([]);
	const [categoryId, setCategoryId] = useState(product.category_id ?? "");
	const [reason, setReason] = useState("");
	const [issues, setIssues] = useState<OfferIssue[]>([]);
	const [serverError, setServerError] = useState<string | null>(null);
	const [conflict, setConflict] = useState<Conflict | null>(null);
	const [pending, setPending] = useState(false);
	const [retireTarget, setRetireTarget] = useState<OfferRow | null>(null);
	const [addOpen, setAddOpen] = useState(false);
	const [announce, setAnnounce] = useState("");
	const key = useOperationKey();
	const summaryRef = useRef<HTMLDivElement>(null);
	const addRef = useRef<HTMLButtonElement>(null);
	const nextNew = useRef(1);

	const coverUrl = product.images[0]?.url ?? null;
	const retiredIds = retired.map((r) => r.id);
	const patch = buildPatch({ product, rows, retiredIds, categoryId: categoryId || null, reason });
	const dirty = patch !== null || reason.trim() !== "";

	// A newer version arrives (content saved, reload, another tab's save): adopt it when nothing is typed or
	// the user chose to discard; otherwise keep the typed rows and offer to apply them to the new data.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reacts to a new product copy only
	useEffect(() => {
		if (propProduct.version <= product.version) return;
		if (!dirty || discardNext.current) {
			discardNext.current = false;
			adopt(propProduct);
			return;
		}
		setConflict({ latest: propProduct.version, lines: describeDrift(product, propProduct), product: propProduct });
		setAnnounce(`Draf produk berubah ke versi ${propProduct.version}. Perubahan Anda belum disimpan.`);
	}, [propProduct]);

	useEffect(() => {
		onDirtyChange?.(dirty);
	}, [dirty, onDirtyChange]);
	useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

	// Leaving the page (reload, close tab, outside link) with unsaved offer edits asks first.
	useEffect(() => {
		if (!dirty) return;
		const guard = (e: BeforeUnloadEvent) => e.preventDefault();
		window.addEventListener("beforeunload", guard);
		return () => window.removeEventListener("beforeunload", guard);
	}, [dirty]);

	const showSummary = Boolean(issues.length || serverError || conflict);
	// Every failed attempt, even a repeat of the same one, moves focus to the summary.
	const [failures, setFailures] = useState(0);
	useEffect(() => {
		if (failures) summaryRef.current?.focus();
	}, [failures]);

	const issueFor = (rowKey: string, field: OfferIssue["field"]) =>
		issues.find((i) => i.key === rowKey && i.field === field);
	const setRow = (rowKey: string, patchRow: Partial<OfferRow>) =>
		setRows((all) => all.map((r) => (r.key === rowKey ? { ...r, ...patchRow } : r)));

	function adopt(next: CatalogProduct) {
		setProduct(next);
		setRows(rowsFrom(next.variants));
		setRetired([]);
		setCategoryId(next.category_id ?? "");
		setReason("");
		setIssues([]);
		setServerError(null);
		setConflict(null);
		setNotes([]);
	}
	function discard() {
		adopt(product);
		setAnnounce("Perubahan dibuang. Data kembali ke draf tersimpan.");
	}
	/** Throws the typed edits away and loads the newest draft. */
	function discardAndReload() {
		if (conflict?.product) adopt(conflict.product);
		else discardNext.current = true;
		onReload();
	}
	/** Keeps the typed edits and re-applies only what changed onto the newest offers. */
	function applyMine(latest: CatalogProduct) {
		const result = rebaseEdits({ start: product, latest, rows, retired, categoryId });
		setProduct(latest);
		setRows(result.rows);
		setRetired(result.retired);
		setCategoryId(result.categoryId);
		setIssues([]);
		setServerError(null);
		setConflict(null);
		setNotes(result.notes);
		setAnnounce(`Perubahan Anda diterapkan ulang ke versi ${latest.version}. Periksa lalu simpan.${result.notes.length ? ` ${result.notes.join(" ")}` : ""}`);
	}

	// The trigger of the retire dialog is gone once the row is removed: focus goes to the add button.
	const focusAddAfterClose = useRef(false);
	function retire(row: OfferRow) {
		focusAddAfterClose.current = retireTarget !== null;
		setRetireTarget(null);
		const id = row.id;
		if (id) setRetired((all) => [...all, { id, label: product.variants.find((v) => v.id === id)?.label ?? id }]);
		setRows((all) => all.filter((r) => r.key !== row.key));
		setAnnounce(`${row.label.trim() || "Penawaran"} ditandai dihentikan. Belum disimpan.`);
		addRef.current?.focus();
	}
	function restore(id: string) {
		const original = rowsFrom(product.variants).find((r) => r.id === id);
		if (!original) return;
		setRetired((all) => all.filter((r) => r.id !== id));
		setRows((all) => [...all, original]);
		setAnnounce(`${original.label} dikembalikan ke daftar.`);
	}

	async function submit() {
		setServerError(null);
		setConflict(null);
		const found = validateRows(rows);
		if (patch && !reason.trim())
			found.push({ key: "", field: "reason", message: "Alasan perubahan wajib diisi." });
		if (!patch && !found.length)
			found.push({ key: "", field: "count", message: "Belum ada perubahan. Ubah nama, harga, berat, kategori, atau tambah dan hentikan penawaran, lalu simpan." });
		setIssues(found);
		if (found.length || !patch) return setFailures((n) => n + 1);

		setPending(true);
		const result = await send<CatalogProduct>("PATCH", base, patch, key);
		if (result.ok) {
			setPending(false);
			discardNext.current = true;
			const changes = diffOffers(product.variants, rows, retiredIds, coverUrl);
			onSaved(
				`Penawaran disimpan sebagai draf versi ${result.data.version} (${describeChanges(changes, Boolean(patch.category_id))}). Produk yang sudah terbit perlu diterbitkan ulang agar perubahan tampil di toko. Keranjang dan pesanan yang sudah ada tetap memakai harga lama.`,
			);
			return;
		}
		if (isVersionConflict(result.status, result.code)) {
			const latest = await getJson<CatalogProduct>(base);
			setPending(false);
			setFailures((n) => n + 1);
			setConflict(
				latest.ok
					? { latest: latest.data.version, lines: describeDrift(product, latest.data), product: latest.data }
					: { latest: null, lines: [], product: null },
			);
			return;
		}
		setPending(false);
		setFailures((n) => n + 1);
		setServerError(offerErrorMessage(result.status, result.code));
	}

	const warehouseOptions = warehouses.length
		? warehouses.map((w) => ({ id: w.id, name: `${w.name} · ${w.city}` }))
		: [...new Set(product.variants.map((v) => v.default_warehouse_id))].map((id) => ({ id, name: `Gudang ${id.slice(0, 8)}` }));
	const categoryOptions = [...categories]
		.map((c) => ({ id: c.id, name: categoryPath(c.id, categories) ?? c.name }))
		.sort((a, b) => a.name.localeCompare(b.name, "id"));
	if (product.category_id && !categoryOptions.some((c) => c.id === product.category_id))
		categoryOptions.unshift({ id: product.category_id, name: "Kategori saat ini" });

	// The dialogs sit beside the form, not inside it: a React portal still bubbles submit to its React parent.
	return (
		<>
		<form
			noValidate
			className="flex flex-col gap-4"
			data-testid="offer-editor"
			onSubmit={(e) => {
				e.preventDefault();
				if (!pending) void submit();
			}}
		>
			{showSummary && (
				<Alert ref={summaryRef} tabIndex={-1} variant="destructive" className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50" data-testid="offer-editor-errors">
					<CircleAlert aria-hidden="true" />
					{conflict ? (
						<>
							<AlertTitle>Produk sudah berubah sejak Anda membukanya</AlertTitle>
							<AlertDescription>
								<p>
									{conflict.latest
										? `Draf sekarang versi ${conflict.latest}; Anda mengedit versi ${product.version}.`
										: `Versi draf di server berbeda dari versi ${product.version} yang Anda edit, dan perubahannya gagal dimuat.`}{" "}
									Perubahan Anda belum disimpan. Memuat ulang membuang perubahan yang belum disimpan.
								</p>
								{conflict.lines.length > 0 && (
									<ul className="ml-4 list-disc">
										{conflict.lines.map((line) => (
											<li key={line}>{line}</li>
										))}
									</ul>
								)}
								<div className="mt-2 flex flex-wrap gap-2">
									{conflict.product && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											data-testid="offer-editor-rebase"
											onClick={() => conflict.product && applyMine(conflict.product)}
										>
											Terapkan ulang perubahan saya ke data terbaru
										</Button>
									)}
									<Button type="button" variant="outline" size="sm" onClick={discardAndReload}>
										<RotateCcw data-icon="inline-start" aria-hidden="true" />
										Buang perubahan dan muat ulang
									</Button>
								</div>
							</AlertDescription>
						</>
					) : (
						<>
							<AlertTitle>{serverError ? "Perubahan belum tersimpan" : `Periksa ${issues.length} isian`}</AlertTitle>
							<AlertDescription>
								{serverError ? (
									<p>{serverError}</p>
								) : (
									<ul className="ml-4 list-disc">
										{issues.map((i) => (
											<li key={`${i.key}:${i.field}`}>{i.message}</li>
										))}
									</ul>
								)}
							</AlertDescription>
						</>
					)}
				</Alert>
			)}

			{notes.length > 0 && (
				<ul className="ml-4 list-disc text-sm" data-testid="offer-editor-rebase-notes">
					{notes.map((note) => (
						<li key={note}>{note}</li>
					))}
				</ul>
			)}

			<div className="flex flex-col gap-2">
				<div aria-hidden="true" className={`hidden gap-3 px-3 text-xs font-medium text-muted-foreground md:grid ${GRID}`}>
					<span>Nama penawaran</span>
					<span>Harga (Rp)</span>
					<span>Berat (g)</span>
					<span>Status</span>
					<span className="w-9" />
				</div>
				<ul className="flex flex-col gap-3 md:gap-0 md:divide-y md:rounded-md md:border" data-testid="offer-editor-rows">
					{rows.map((row) => {
						const source = row.id ? product.variants.find((v) => v.id === row.id) : undefined;
						const price = parsePrice(row.price);
						const changed =
							source &&
							(source.label !== row.label.trim() || source.price !== price || String(source.weight_grams) !== row.weight.trim());
						const blocker = row.id ? blockers.find((b) => b.offer_id === row.id) : undefined;
						const label = issueFor(row.key, "label");
						const priceIssue = issueFor(row.key, "price");
						const weight = issueFor(row.key, "weight");
						return (
							<li key={row.key} className={`grid gap-3 p-3 max-md:rounded-md max-md:border md:items-start ${GRID}`}>
								<div className="flex min-w-0 flex-col gap-1.5">
									<Label htmlFor={`offer-label-${row.key}`} className="md:sr-only">
										Nama penawaran
									</Label>
									<Input
										id={`offer-label-${row.key}`}
										maxLength={LABEL_MAX}
										aria-invalid={label ? true : undefined}
										value={row.label}
										onChange={(e) => setRow(row.key, { label: e.target.value })}
									/>
									<p className="text-xs text-muted-foreground">
										SKU <span className="font-mono">{source?.sku ?? row.fresh?.sku}</span> tidak bisa diubah ·{" "}
										{OFFER_KIND_LABELS[source?.offer_kind ?? (row.fresh?.quantity === 1 ? "unit" : "multipack")]}
										{row.fresh && ` · isi ${row.fresh.stock_name} ×${row.fresh.quantity}`}
									</p>
								</div>
								<div className="flex min-w-0 flex-col gap-1.5">
									<Label htmlFor={`offer-price-${row.key}`} className="md:sr-only">
										Harga (Rp)
									</Label>
									<Input
										id={`offer-price-${row.key}`}
										inputMode="numeric"
										pattern="[0-9]*"
										maxLength={5}
										className="tabular-nums"
										aria-invalid={priceIssue ? true : undefined}
										value={row.price}
										onChange={(e) => setRow(row.key, { price: e.target.value })}
									/>
								</div>
								<div className="flex min-w-0 flex-col gap-1.5">
									<Label htmlFor={`offer-weight-${row.key}`} className="md:sr-only">
										Berat (g)
									</Label>
									<Input
										id={`offer-weight-${row.key}`}
										inputMode="numeric"
										pattern="[0-9]*"
										maxLength={7}
										className="tabular-nums"
										aria-invalid={weight ? true : undefined}
										value={row.weight}
										onChange={(e) => setRow(row.key, { weight: e.target.value })}
									/>
								</div>
								<div className="flex min-h-9 items-center">
									{row.fresh ? (
										<StatusBadge tone="progress">Baru</StatusBadge>
									) : blocker ? (
										<StatusBadge tone="problem">{blockerLabel(blocker.code)}</StatusBadge>
									) : changed ? (
										<StatusBadge tone="progress">Diubah</StatusBadge>
									) : (
										<StatusBadge tone="neutral">Tersimpan</StatusBadge>
									)}
								</div>
								<div className="flex md:justify-end">
									<Button
										type="button"
										variant="outline"
										size="icon"
										className="max-md:w-full"
										disabled={rows.length <= 1}
										aria-label={`${row.fresh ? "Hapus" : "Hentikan"} ${row.label.trim() || "penawaran"}`}
										title={rows.length <= 1 ? "Produk perlu minimal satu penawaran aktif" : undefined}
										onClick={() => (row.fresh ? retire(row) : setRetireTarget(row))}
									>
										<Trash2 aria-hidden="true" />
									</Button>
								</div>
							</li>
						);
					})}
				</ul>
				{retired.length > 0 && (
					<ul className="flex flex-col gap-1 text-sm" data-testid="offer-editor-retired">
						{retired.map((r) => (
							<li key={r.id} className="flex flex-wrap items-center gap-2">
								<span>
									<span className="font-medium">{r.label}</span> akan dihentikan saat disimpan.
								</span>
								<Button type="button" variant="ghost" size="sm" onClick={() => restore(r.id)}>
									<RotateCcw data-icon="inline-start" aria-hidden="true" />
									Batalkan
								</Button>
							</li>
						))}
					</ul>
				)}
				<div>
					<Button ref={addRef} type="button" variant="outline" className="max-md:w-full" onClick={() => setAddOpen(true)}>
						<Plus data-icon="inline-start" aria-hidden="true" />
						Tambah penawaran
					</Button>
				</div>
			</div>

			<FieldGroup>
				<FormField
					id="offer-category"
					label="Kategori"
					hint="Mengganti kategori mengubah atribut wajib; periksa blokir penerbitan setelah disimpan."
				>
					<select
						id="offer-category"
						aria-describedby="offer-category-hint"
						className={nativeSelectClass}
						value={categoryId}
						onChange={(e) => setCategoryId(e.target.value)}
					>
						{!categoryId && <option value="">Pilih kategori</option>}
						{categoryOptions.map((c) => (
							<option key={c.id} value={c.id}>
								{c.name}
							</option>
						))}
					</select>
				</FormField>
				<FormField
					id="offer-reason"
					label="Alasan perubahan"
					invalid={Boolean(issueFor("", "reason"))}
					hint={`Dicatat di riwayat audit. Harga baru berlaku untuk versi berikutnya, maksimal ${rupiah(PRICE_MAX_IDR)}; batas margin diperiksa saat penerbitan.`}
				>
					<Input
						id="offer-reason"
						maxLength={REASON_MAX}
						aria-describedby="offer-reason-hint"
						aria-invalid={issueFor("", "reason") ? true : undefined}
						value={reason}
						onChange={(e) => setReason(e.target.value)}
					/>
				</FormField>
			</FieldGroup>

			<p className="sr-only" role="status" aria-live="polite">
				{announce}
			</p>

			<StickyActions className="md:justify-end">
				{dirty && (
					<Button type="button" variant="outline" disabled={pending} onClick={discard}>
						Buang perubahan
					</Button>
				)}
				<Button type="submit" disabled={pending} data-testid="offer-editor-save">
					{pending ? "Menyimpan…" : "Simpan perubahan"}
				</Button>
			</StickyActions>
		</form>
			{retireTarget && (
				<Dialog open onOpenChange={(open) => !open && setRetireTarget(null)}>
					<DialogContent
						onCloseAutoFocus={(event) => {
							if (!focusAddAfterClose.current) return;
							focusAddAfterClose.current = false;
							event.preventDefault();
							addRef.current?.focus();
						}}
					>
						<DialogHeader>
							<DialogTitle>Hentikan {retireTarget.label.trim() || "penawaran ini"}?</DialogTitle>
							<DialogDescription>
								Penawaran keluar dari draf setelah Anda menyimpan perubahan dan tidak bisa dikembalikan dari layar ini. Keranjang dan
								pesanan yang sudah ada tetap memakai harga lama.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setRetireTarget(null)}>
								Batal
							</Button>
							<Button type="button" variant="destructive" onClick={() => retire(retireTarget)}>
								Hentikan penawaran
							</Button>
						</DialogFooter>
					</DialogContent>
				</Dialog>
			)}
			{addOpen && (
				<AddOfferDialog
					warehouses={warehouseOptions}
					defaultWarehouse={product.variants[0]?.default_warehouse_id ?? ""}
					onClose={() => setAddOpen(false)}
					onAdd={(row) => {
						const rowKey = `new-${nextNew.current++}`;
						setRows((all) => [...all, { ...row, key: rowKey }]);
						setAddOpen(false);
						setAnnounce(`${row.label} ditambahkan. Belum disimpan.`);
					}}
				/>
			)}
		</>
	);
}

/** Collects what the API requires for a new offer: SKU, price, weight, size, warehouse and one stock item. */
function AddOfferDialog({
	warehouses,
	defaultWarehouse,
	onClose,
	onAdd,
}: {
	warehouses: { id: string; name: string }[];
	defaultWarehouse: string;
	onClose: () => void;
	onAdd: (row: Omit<OfferRow, "key">) => void;
}) {
	const [v, setV] = useState({
		sku: "",
		label: "",
		price: "",
		weight: "",
		length: "",
		width: "",
		height: "",
		warehouseId: defaultWarehouse,
		stockItemId: "",
		quantity: "1",
	});
	// S151-8: the SKU dictionary is searched on the server (`q`), never loaded whole.
	const [stockQ, setStockQ] = useState("");
	const [found, setFound] = useState<StockItem[] | null>(null);
	const [picked, setPicked] = useState<StockItem | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [bad, setBad] = useState<string | null>(null);

	useEffect(() => {
		let live = true;
		setFound(null);
		const timer = setTimeout(() => {
			const q = Array.from(stockQ.trim()).slice(0, 100).join("");
			const params = new URLSearchParams({ limit: "20" });
			if (q) params.set("q", q);
			void getJson<{ data: StockItem[] }>(`/api/v1/admin/stock-items?${params}`).then((r) => {
				if (!live) return;
				if (r.ok) {
					setLoadError(null);
					setFound(r.data.data);
				} else {
					setFound([]);
					setLoadError("Barang stok gagal dicari. Ubah kata kunci atau coba lagi.");
				}
			});
		}, 300);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [stockQ]);

	const set = (field: keyof typeof v) => (e: { target: { value: string } }) => setV((all) => ({ ...all, [field]: e.target.value }));
	const text = (field: keyof typeof v, id: string, label: string, extra: { numeric?: boolean; max?: number; hint?: string } = {}) => (
		<FormField id={id} label={label} hint={extra.hint} invalid={bad === field}>
			<Input
				id={id}
				maxLength={extra.max}
				inputMode={extra.numeric ? "numeric" : undefined}
				className={extra.numeric ? "tabular-nums" : undefined}
				aria-invalid={bad === field ? true : undefined}
				aria-describedby={extra.hint ? `${id}-hint` : undefined}
				value={v[field]}
				onChange={set(field)}
			/>
		</FormField>
	);

	function submit() {
		const refusal = validateFresh(v);
		if (refusal) {
			setBad(refusal.field);
			setError(refusal.message);
			return;
		}
		const stock = picked && picked.id === v.stockItemId ? picked : null;
		if (!stock) {
			setBad("stockItemId");
			setError("Barang stok tidak ditemukan. Pilih ulang.");
			return;
		}
		onAdd({
			id: null,
			label: v.label.trim(),
			price: v.price.trim(),
			weight: v.weight.trim(),
			fresh: {
				sku: v.sku.trim(),
				length_mm: Number(v.length),
				width_mm: Number(v.width),
				height_mm: Number(v.height),
				default_warehouse_id: v.warehouseId,
				stock_item_id: stock.id,
				stock_name: stock.name,
				quantity: Number(v.quantity),
			},
		});
	}

	return (
		<FormDialog
			title="Tambah penawaran"
			description="Penawaran baru masuk ke draf setelah Anda menyimpan perubahan. SKU tidak bisa diubah setelah disimpan. Satu barang stok per penawaran; jumlah 2 atau lebih menjadi multipak."
			pending={false}
			error={error ?? loadError}
			submitLabel="Tambahkan"
			dirty={Object.entries(v).some(([k, val]) => val !== "" && !(k === "quantity" && val === "1") && !(k === "warehouseId" && val === defaultWarehouse))}
			onClose={onClose}
			onSubmit={submit}
		>
			{text("sku", "add-offer-sku", "SKU", { max: 100, hint: "Huruf besar, angka, garis bawah, tanda hubung." })}
			{text("label", "add-offer-label", "Nama penawaran", { max: LABEL_MAX })}
			<div className="grid gap-3 sm:grid-cols-2">
				{text("price", "add-offer-price", "Harga (Rp)", { numeric: true, max: 5 })}
				{text("weight", "add-offer-weight", "Berat (g)", { numeric: true, max: 7 })}
			</div>
			<div className="grid gap-3 sm:grid-cols-3">
				{text("length", "add-offer-length", "Panjang (mm)", { numeric: true, max: 5 })}
				{text("width", "add-offer-width", "Lebar (mm)", { numeric: true, max: 5 })}
				{text("height", "add-offer-height", "Tinggi (mm)", { numeric: true, max: 5 })}
			</div>
			<FormField id="add-offer-warehouse" label="Gudang asal" invalid={bad === "warehouseId"}>
				<select id="add-offer-warehouse" className={nativeSelectClass} aria-invalid={bad === "warehouseId" ? true : undefined} value={v.warehouseId} onChange={set("warehouseId")}>
					<option value="">Pilih gudang</option>
					{warehouses.map((w) => (
						<option key={w.id} value={w.id}>
							{w.name}
						</option>
					))}
				</select>
			</FormField>
			<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
				<FormField
					id="add-offer-stock-q"
					label="Barang stok"
					invalid={bad === "stockItemId"}
					hint={picked ? `Dipilih: ${picked.name} · ${picked.sku}` : "Cari dengan SKU atau nama, lalu pilih satu dari daftar."}
				>
					<Input
						id="add-offer-stock-q"
						type="search"
						maxLength={100}
						autoComplete="off"
						aria-describedby="add-offer-stock-q-hint"
						aria-invalid={bad === "stockItemId" ? true : undefined}
						value={stockQ}
						onChange={(e) => setStockQ(e.target.value)}
					/>
					<select
						id="add-offer-stock"
						size={5}
						aria-label="Hasil pencarian barang stok"
						className={`${nativeSelectClass} h-auto py-1`}
						value={v.stockItemId}
						onChange={(e) => {
							const hit = [...(found ?? []), ...(picked ? [picked] : [])].find((i) => i.id === e.target.value) ?? null;
							setPicked(hit);
							setV((all) => ({ ...all, stockItemId: hit?.id ?? "" }));
						}}
					>
						{picked && !found?.some((i) => i.id === picked.id) && (
							<option value={picked.id}>
								{picked.name} · {picked.sku}
							</option>
						)}
						{found?.map((i) => (
							<option key={i.id} value={i.id}>
								{i.name} · {i.sku}
							</option>
						))}
					</select>
					<p className="text-xs text-muted-foreground" role="status" aria-live="polite">
						{found === null ? "Mencari…" : found.length === 0 ? "Tidak ada barang yang cocok." : found.length === 20 ? "20 hasil pertama; persempit kata kunci." : `${found.length} barang ditemukan.`}
					</p>
				</FormField>
				{text("quantity", "add-offer-quantity", "Jumlah isi", { numeric: true, max: 7 })}
			</div>
		</FormDialog>
	);
}
