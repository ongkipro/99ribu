"use client";

import {
	ArrowLeft,
	ChevronRight,
	CircleAlert,
	CircleCheck,
	ImageOff,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { rupiah, wibDateTime } from "@/modules/storefront/format";
import { failureText, getJson, readFailure } from "./admin-errors";
import { DataTable } from "./data-table";
import { ErrorState } from "./states";
import {
	BLOCKER_LABELS,
	blockerLabel,
	type CatalogProduct,
	type CatalogVariant,
	type Category,
	catalogStatus,
	categoryPath,
	mapLimit,
	OFFER_KIND_LABELS,
	PRICE_IDR,
	type PublicationState,
	readAll,
	STATUS_BADGE,
	STATUS_LABELS,
} from "./catalog-model";

type Load<T> =
	| { state: "loading" }
	| { state: "error"; error: string }
	| { state: "ready"; data: T };

type Warehouse = { id: string; name: string; city: string };
type Position = {
	id: string;
	warehouse_id: string;
	stock_item_id: string;
	lot_code: string | null;
	expires_on: string | null;
	expired: boolean;
	on_hand: number;
	reserved: number;
	quarantined: number;
	available: number;
};
type Contribution = {
	commission_bps: number;
	minimum_contribution_idr: number;
	evaluated_at: string;
	offers: {
		offer_id: string;
		estimated_hpp: number | null;
		estimated_contribution: number | null;
		complete: boolean;
		missing_inputs: string[];
		below_floor: boolean;
		commission_idr: number;
		assumptions: Record<AssumptionField, number | null>;
		components: {
			stock_item_id: string;
			quantity: number;
			unit_cost: number | null;
		}[];
	}[];
};
type AssumptionField =
	| "packaging_idr"
	| "provider_fee_idr"
	| "subsidy_idr"
	| "returns_reserve_idr";
const ASSUMPTION_LABELS: Record<AssumptionField, string> = {
	packaging_idr: "Kemasan",
	provider_fee_idr: "Biaya penyedia pembayaran",
	subsidy_idr: "Subsidi ongkir",
	returns_reserve_idr: "Cadangan retur",
};

const when = wibDateTime;
const money = (v: number | null) =>
	v === null ? "Belum diisi" : rupiah(v);

function SectionError({
	label,
	error,
	onRetry,
}: {
	label: string;
	error: string;
	onRetry: () => void;
}) {
	return <ErrorState message={`${label} gagal dimuat. ${error}`} onRetry={onRetry} />;
}

function Section({
	id,
	title,
	children,
	description,
}: {
	id: string;
	title: string;
	description?: string;
	children: React.ReactNode;
}) {
	return (
		<section
			aria-labelledby={id}
			className="flex flex-col gap-3 rounded-lg border bg-card p-4 md:p-5"
		>
			<div className="flex flex-col gap-0.5">
				<h2 id={id} tabIndex={-1} className="text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">
					{title}
				</h2>
				{description && (
					<p className="text-xs text-muted-foreground">{description}</p>
				)}
			</div>
			{children}
		</section>
	);
}

export function CatalogProductClient({
	productId,
	access,
	backHref,
}: {
	productId: string;
	/** From catalogAccess(); each section's API still enforces its own grant. */
	access: { edit: boolean; stock: boolean; costs: boolean };
	backHref: string;
}) {
	const { edit: canEdit, stock: canReadStock, costs: canReadCosts } = access;
	const [product, setProduct] = useState<Load<CatalogProduct>>({
		state: "loading",
	});
	const [pub, setPub] = useState<Load<PublicationState>>({ state: "loading" });
	const [stock, setStock] = useState<Load<Position[]>>({ state: "loading" });
	const [costs, setCosts] = useState<Load<Contribution>>({ state: "loading" });
	const [categories, setCategories] = useState<Category[]>([]);
	const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
	const [notice, setNotice] = useState<string | null>(null);

	const base = `/api/v1/admin/products/${encodeURIComponent(productId)}`;

	// `quiet` refreshes in place (no skeleton, failures keep the shown data) so an
	// open publish/withdraw dialog stays mounted while it re-reads state.
	const loadProduct = useCallback(
		async (quiet = false) => {
			if (!quiet) setProduct({ state: "loading" });
			const res = await getJson<CatalogProduct>(base);
			if (res.ok) setProduct({ state: "ready", data: res.data });
			else if (!quiet)
				setProduct({ state: "error", error: failureText(res.failure) });
		},
		[base],
	);

	const loadPub = useCallback(
		async (quiet = false) => {
			if (!quiet) setPub({ state: "loading" });
			const res = await getJson<PublicationState>(`${base}/publications`);
			if (res.ok) setPub({ state: "ready", data: res.data });
			else if (!quiet)
				setPub({ state: "error", error: failureText(res.failure) });
			return res.ok ? res.data : null;
		},
		[base],
	);

	/** After a 409: re-read draft and publication state for the open dialog. */
	const refreshForConflict = useCallback(async () => {
		const [, fresh] = await Promise.all([loadProduct(true), loadPub(true)]);
		return fresh;
	}, [loadProduct, loadPub]);

	// Dialogs close onto the result notice; their opener may no longer exist.
	const noticeRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (notice) noticeRef.current?.focus();
	}, [notice]);

	const loadCosts = useCallback(async () => {
		if (!canReadCosts) return;
		setCosts({ state: "loading" });
		const res = await getJson<Contribution>(`${base}/contribution-reviews`);
		setCosts(
			res.ok
				? { state: "ready", data: res.data }
				: { state: "error", error: failureText(res.failure) },
		);
	}, [base, canReadCosts]);

	const loadStock = useCallback(
		async (p: CatalogProduct) => {
			if (!canReadStock) return;
			setStock({ state: "loading" });
			const ids = [
				...new Set(
					p.variants.flatMap((v) => v.contents.map((c) => c.stock_item_id)),
				),
			];
			const rows: Position[] = [];
			let error: string | null = null;
			await mapLimit(ids, 4, async (id) => {
				const res = await readAll<Position>(
					`/api/v1/admin/inventory?stock_item_id=${id}`,
				);
				if (res.ok) rows.push(...res.data);
				else error ??= failureText(res.failure);
			});
			setStock(
				error ? { state: "error", error } : { state: "ready", data: rows },
			);
		},
		[canReadStock],
	);

	useEffect(() => {
		void loadProduct();
		void loadPub();
		void loadCosts();
		void readAll<Category>("/api/v1/admin/categories").then(
			(r) => r.ok && setCategories(r.data),
		);
		// Warehouse names are readable by the same roles as stock balances.
		if (canReadStock)
			void readAll<Warehouse>("/api/v1/admin/warehouses").then(
				(r) => r.ok && setWarehouses(r.data),
			);
	}, [loadProduct, loadPub, loadCosts, canReadStock]);

	useEffect(() => {
		if (product.state === "ready") void loadStock(product.data);
	}, [product, loadStock]);

	const p = product.state === "ready" ? product.data : null;
	const state = pub.state === "ready" ? pub.data : null;
	const variantName = (offerId: string | null) =>
		(offerId && p?.variants.find((v) => v.id === offerId)?.label) || null;
	// Null when names are not readable for this role (or failed to load).
	const warehouseName = (id: string) =>
		warehouses.find((w) => w.id === id)?.name ?? null;
	// Fact labels from the category chain's attribute definitions, then the
	// product's own facts/attributes; a blocker never shows a raw fact key.
	const factLabels = new Map<string, string>();
	if (p) {
		for (const a of [...p.facts, ...p.variants.flatMap((v) => v.attributes)])
			factLabels.set(a.key, a.label);
		const byId = new Map(categories.map((c) => [c.id, c]));
		for (
			let c = p.category_id ? byId.get(p.category_id) : undefined, depth = 0;
			c && depth < 5;
			c = c.parent_id ? byId.get(c.parent_id) : undefined, depth++
		)
			for (const d of c.attribute_definitions ?? [])
				factLabels.set(d.key, d.label);
	}
	const componentName = (stockItemId: string) =>
		p?.variants
			.flatMap((v) => v.contents)
			.find((c) => c.stock_item_id === stockItemId)?.name ??
		stockItemId.slice(0, 8);

	return (
		<div className="flex flex-col gap-6 px-4 py-5 md:px-8 md:py-6">
			<div>
				<Button asChild variant="ghost" size="sm" className="-ml-2">
					<Link href={backHref}>
						<ArrowLeft data-icon="inline-start" aria-hidden="true" />
						Kembali ke katalog
					</Link>
				</Button>
			</div>

			{product.state === "loading" ? (
				<div className="flex flex-col gap-3" aria-busy="true">
					<span className="sr-only">Memuat produk…</span>
					<Skeleton className="h-8 w-2/3" />
					<Skeleton className="h-4 w-1/3" />
					<Skeleton className="h-48 w-full" />
				</div>
			) : product.state === "error" ? (
				<SectionError
					label="Produk"
					error={product.error}
					onRetry={() => void loadProduct()}
				/>
			) : (
				p && (
					<>
						<header className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
							<div className="flex min-w-0 flex-col gap-1.5">
								<h1 className="text-2xl font-semibold tracking-tight">
									{p.name}
								</h1>
								<p className="text-xs text-muted-foreground">
									<span className="font-mono">{p.catalog_id}</span> · draf versi{" "}
									{p.version} ·{" "}
									{categoryPath(p.category_id, categories) ?? "Tanpa kategori"}
								</p>
								<div className="flex flex-wrap items-center gap-2">
									{state ? (
										<Badge variant={STATUS_BADGE[catalogStatus(state)]}>
											{STATUS_LABELS[catalogStatus(state)]}
										</Badge>
									) : (
										<Skeleton className="h-5 w-24" />
									)}
									<span className="text-sm font-medium tabular-nums">
										{rupiah(PRICE_IDR)} per varian
									</span>
								</div>
							</div>
							{state && canEdit && (
								<PublishAction
									base={base}
									product={p}
									state={state}
									onConflict={refreshForConflict}
									onPublished={(message) => {
										setNotice(message);
										void loadPub(true);
									}}
								/>
							)}
						</header>

						{notice && (
							<Alert
								ref={noticeRef}
								tabIndex={-1}
								role="status"
								className="border-success/30 bg-success-surface outline-none"
							>
								<CircleCheck aria-hidden="true" />
								<AlertDescription className="text-foreground">
									{notice}
								</AlertDescription>
							</Alert>
						)}

						<Section id="photos-heading" title="Foto produk">
							{p.images.length === 0 ? (
								<p className="flex items-center gap-2 text-sm text-muted-foreground">
									<ImageOff aria-hidden="true" className="size-4" />
									Belum ada foto.
								</p>
							) : (
								<ul className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2">
									{p.images.map((img) => (
										<li key={img.url}>
											{/* biome-ignore lint/performance/noImgElement: same-origin catalog photo with known dimensions */}
											<img
												src={img.url}
												alt={img.alt}
												width={img.width}
												height={img.height}
												loading="lazy"
												className="aspect-square w-full rounded-md border object-cover"
											/>
										</li>
									))}
								</ul>
							)}
						</Section>

						<Section id="info-heading" title="Informasi produk">
							<p className="max-w-prose text-sm leading-relaxed whitespace-pre-line">
								{p.description || "Deskripsi belum diisi."}
							</p>
							{p.facts.length > 0 && (
								<dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
									{p.facts.map((f) => (
										<div key={f.key} className="contents">
											<dt className="text-muted-foreground">{f.label}</dt>
											<dd>{f.values.join(", ")}</dd>
										</div>
									))}
								</dl>
							)}
						</Section>

						<Section
							id="variants-heading"
							title={`Varian (${p.variants.length})`}
							description="Setiap varian dijual Rp99.000. Isi bundel mengikuti komponen stok fisik."
						>
							<ul className="flex flex-col divide-y rounded-md border">
								{p.variants.map((v) => (
									<VariantItem
										key={v.id}
										variant={v}
										warehouse={warehouseName(v.default_warehouse_id)}
										readsStock={canReadStock}
										stockShort={Boolean(
											state?.blockers.some(
												(b) =>
													b.offer_id === v.id &&
													b.code === "COMPLETE_STOCK_REQUIRED",
											),
										)}
									/>
								))}
							</ul>
						</Section>

						{canReadStock && (
							<Section
								id="stock-heading"
								title="Stok per gudang"
								description="Saldo fisik komponen dari pencatatan gudang. Tersedia = fisik − dipesan − karantina."
							>
								{stock.state === "loading" ? (
									<Skeleton className="h-24 w-full" />
								) : stock.state === "error" ? (
									<SectionError
										label="Stok"
										error={stock.error}
										onRetry={() => void loadStock(p)}
									/>
) : (
									<DataTable
										rows={[...stock.data].sort((a, b) =>
											componentName(a.stock_item_id).localeCompare(componentName(b.stock_item_id), "id"),
										)}
										rowKey={(row) => row.id}
										status={{ kind: "ready" }}
										loadingLabel="Memuat stok…"
										empty="Belum ada saldo stok untuk komponen produk ini."
										caption="Stok komponen per gudang"
										columns={[
											{ id: "item", header: "Komponen", cellClassName: "max-w-56 whitespace-normal", cell: (row) => componentName(row.stock_item_id) },
											{
												id: "warehouse",
												header: "Gudang",
												cell: (row) => warehouseName(row.warehouse_id) ?? `Gudang ${row.warehouse_id.slice(0, 8)}`,
											},
											{ id: "available", header: "Tersedia", className: "text-right tabular-nums", cellClassName: "font-medium", cell: (row) => row.available },
											{ id: "on_hand", header: "Fisik", className: "hidden text-right tabular-nums sm:table-cell", cell: (row) => row.on_hand },
											{ id: "reserved", header: "Dipesan", className: "hidden text-right tabular-nums sm:table-cell", cell: (row) => row.reserved },
											{ id: "quarantined", header: "Karantina", className: "hidden text-right tabular-nums sm:table-cell", cell: (row) => row.quarantined },
											{
												id: "lot",
												header: "Lot",
												className: "hidden sm:table-cell",
												cellClassName: "text-xs",
												cell: (row) => (
													<>
														{row.lot_code ?? "—"}
														{row.expires_on && ` · ${row.expired ? "kedaluwarsa" : "s.d."} ${row.expires_on}`}
													</>
												),
											},
										]}
									/>
								)}
							</Section>
						)}

						{canReadCosts && (
							<Section
								id="costs-heading"
								title="HPP dan kontribusi"
								description="Estimasi berdasarkan versi biaya yang berlaku sekarang. Nilai kosong tidak dihitung sebagai Rp0."
							>
								{costs.state === "loading" ? (
									<Skeleton className="h-32 w-full" />
								) : costs.state === "error" ? (
									<SectionError
										label="Biaya"
										error={costs.error}
										onRetry={() => void loadCosts()}
									/>
								) : (
									<>
										<p className="text-xs text-muted-foreground">
											Komisi afiliasi {costs.data.commission_bps / 100}% · batas
											kontribusi minimum{" "}
											{rupiah(costs.data.minimum_contribution_idr)} ·
											dihitung {when(costs.data.evaluated_at)}
										</p>
										<ul className="flex flex-col gap-3">
											{costs.data.offers.map((o) => (
												<li
													key={o.offer_id}
													className="flex flex-col gap-2 rounded-md border p-3"
												>
													<div className="flex flex-wrap items-center justify-between gap-2">
														<h3 className="text-sm font-semibold">
															{variantName(o.offer_id) ?? "Varian"}
														</h3>
														{!o.complete ? (
															<Badge variant="warning">
																Data biaya belum lengkap
															</Badge>
														) : o.below_floor ? (
															<Badge variant="warning">
																Di bawah batas minimum
															</Badge>
														) : (
															<Badge variant="success">Memenuhi batas</Badge>
														)}
													</div>
													<dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
														<dt className="text-muted-foreground">
															HPP komponen
														</dt>
														<dd className="text-right tabular-nums">
															{money(o.estimated_hpp)}
														</dd>
														{(
															Object.keys(
																ASSUMPTION_LABELS,
															) as AssumptionField[]
														).map((f) => (
															<div key={f} className="contents">
																<dt className="text-muted-foreground">
																	{ASSUMPTION_LABELS[f]}
																</dt>
																<dd className="text-right tabular-nums">
																	{money(o.assumptions[f])}
																</dd>
															</div>
														))}
														<dt className="text-muted-foreground">
															Komisi afiliasi
														</dt>
														<dd className="text-right tabular-nums">
															{rupiah(o.commission_idr)}
														</dd>
														<dt className="font-medium">Estimasi kontribusi</dt>
														<dd className="text-right font-semibold tabular-nums">
															{o.estimated_contribution === null
																? "Belum lengkap"
																: rupiah(o.estimated_contribution)}
														</dd>
													</dl>
													<VersionHistory
														title="Riwayat asumsi biaya varian"
														url={`/api/v1/admin/offers/${o.offer_id}/cost-assumption-versions?limit=10`}
														kind="assumption"
													/>
													{o.components.map((c) => (
														<VersionHistory
															key={c.stock_item_id}
															title={`Riwayat HPP: ${componentName(c.stock_item_id)} (×${c.quantity}, sekarang ${money(c.unit_cost)})`}
															url={`/api/v1/admin/stock-items/${c.stock_item_id}/cost-versions?limit=10`}
															kind="component"
														/>
													))}
												</li>
											))}
										</ul>
									</>
								)}
							</Section>
						)}

						<Section
							id="publication-heading"
							title="Penerbitan"
							description="Produk hanya tampil di toko setelah terbit. Riwayat versi terbit sebelumnya belum tersedia di konsol."
						>
							{pub.state === "loading" ? (
								<Skeleton className="h-24 w-full" />
							) : pub.state === "error" ? (
								<SectionError
									label="Status penerbitan"
									error={pub.error}
									onRetry={() => void loadPub()}
								/>
							) : (
								<>
									<dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
										<dt className="text-muted-foreground">Versi terbit</dt>
										<dd>
											{pub.data.current
												? `Publikasi ${pub.data.current.version} (draf versi ${pub.data.current.product_revision}) · ${when(pub.data.current.created_at)}${pub.data.current.exception_applied ? " · dengan pengecualian Super Admin" : ""}`
												: pub.data.latest_version > 0
													? "Tidak sedang terbit (pernah ditarik)"
													: "Belum pernah terbit"}
										</dd>
										<dt className="text-muted-foreground">Draf sekarang</dt>
										<dd>Versi {pub.data.draft_version}</dd>
										{pub.data.current_review_state && (
											<>
												<dt className="text-muted-foreground">Tinjauan jual</dt>
												<dd>
													{pub.data.current_review_state === "approved"
														? "Disetujui"
														: "Perlu tinjauan ulang"}
												</dd>
											</>
										)}
									</dl>
									{pub.data.blocker_count === 0 ? (
										<p className="flex items-center gap-2 text-sm text-success">
											<CircleCheck aria-hidden="true" className="size-4" />
											Draf memenuhi semua syarat penerbitan.
										</p>
									) : (
										<div className="flex flex-col gap-2">
											<h3 className="flex items-center gap-2 text-sm font-semibold text-warning">
												<CircleAlert aria-hidden="true" className="size-4" />
												{pub.data.blocker_count} hal menghalangi penerbitan
											</h3>
											<ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
												{uniqueBlockers(pub.data.blockers).map(
													([key, b, n]) => (
														<li key={key}>
															{blockerLabel(b.code)}
															{b.fact_key &&
																factLabels.has(b.fact_key) &&
																` (${factLabels.get(b.fact_key)})`}
															{n > 1 && ` ×${n}`}
															{variantName(b.offer_id) && (
																<span className="text-muted-foreground">
																	{" "}
																	· {variantName(b.offer_id)}
																</span>
															)}
														</li>
													),
												)}
											</ul>
											{pub.data.blockers_truncated && (
												<p className="text-xs text-muted-foreground">
													Hanya 100 pemblokir pertama yang ditampilkan.
												</p>
											)}
										</div>
									)}
									{canEdit && (
										<WithdrawAction
											base={base}
											product={p}
											state={pub.data}
											onConflict={refreshForConflict}
											onWithdrawn={(message) => {
												setNotice(message);
												void loadPub(true);
											}}
										/>
									)}
								</>
							)}
						</Section>
					</>
				)
			)}
		</div>
	);
}

/** Groups identical blockers (e.g. one UNKNOWN_HPP per missing component). */
function uniqueBlockers(list: PublicationState["blockers"]) {
	const groups = new Map<string, [string, (typeof list)[number], number]>();
	for (const b of list) {
		const key = `${b.code}:${b.offer_id ?? ""}:${b.fact_key ?? ""}`;
		const g = groups.get(key);
		if (g) g[2] += 1;
		else groups.set(key, [key, b, 1]);
	}
	return [...groups.values()];
}

function VariantItem({
	variant: v,
	warehouse,
	readsStock,
	stockShort,
}: {
	variant: CatalogVariant;
	warehouse: string | null;
	/** Without stock access this is a readiness flag, not a quantity. */
	readsStock: boolean;
	stockShort: boolean;
}) {
	return (
		<li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
			{v.image ? (
				// biome-ignore lint/performance/noImgElement: same-origin catalog photo with known dimensions
				<img
					src={v.image.url}
					alt=""
					width={64}
					height={64}
					loading="lazy"
					className="size-16 shrink-0 rounded-md border object-cover"
				/>
			) : null}
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<div className="flex flex-wrap items-center gap-2">
					<h3 className="text-sm font-semibold">{v.label}</h3>
					<Badge variant="outline">{OFFER_KIND_LABELS[v.offer_kind]}</Badge>
					<Badge variant={stockShort ? "warning" : "success"}>
						{readsStock
							? stockShort
								? "Stok belum lengkap"
								: "Stok lengkap"
							: stockShort
								? "Stok belum siap"
								: "Stok siap"}
					</Badge>
				</div>
				<p className="text-xs text-muted-foreground">
					SKU <span className="font-mono">{v.sku}</span> ·{" "}
					{warehouse && `gudang ${warehouse} · `}
					{v.weight_grams} g · {v.length_mm}×{v.width_mm}×{v.height_mm} mm
				</p>
				{v.attributes.length > 0 && (
					<p className="text-xs">
						{v.attributes
							.map((a) => `${a.label}: ${a.values.join(", ")}`)
							.join(" · ")}
					</p>
				)}
				<div className="text-xs">
					<span className="font-medium">Isi:</span>{" "}
					{v.contents.map((c) => `${c.name} ×${c.quantity}`).join(", ")}
				</div>
			</div>
		</li>
	);
}

type VersionRow = {
	id: string;
	version: number;
	effective_from: string;
	source: string;
	reason: string;
	unit_cost?: number | null;
} & Partial<Record<AssumptionField, number | null>>;

/** Loads a cost version history only when opened (each read is audited). */
function VersionHistory({
	title,
	url,
	kind,
}: {
	title: string;
	url: string;
	kind: "component" | "assumption";
}) {
	const [data, setData] = useState<Load<VersionRow[]> | null>(null);
	const load = async () => {
		setData({ state: "loading" });
		const res = await getJson<{ data: VersionRow[] }>(url);
		setData(
			res.ok
				? { state: "ready", data: res.data.data }
				: { state: "error", error: failureText(res.failure) },
		);
	};
	return (
		<details
			className="group text-xs"
			onToggle={(e) => {
				if (e.currentTarget.open && data === null) void load();
			}}
		>
			<summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 text-muted-foreground [&::-webkit-details-marker]:hidden">
				<ChevronRight
					aria-hidden="true"
					className="size-3.5 shrink-0 transition-transform group-open:rotate-90 motion-reduce:transition-none"
				/>
				{title}
			</summary>
			{data?.state === "loading" && <Skeleton className="mt-2 h-16 w-full" />}
			{data?.state === "error" && (
				<div className="mt-2">
					<SectionError
						label="Riwayat"
						error={data.error}
						onRetry={() => void load()}
					/>
				</div>
			)}
			{data?.state === "ready" && (
				<div className="mt-2">
					<DataTable
						rows={data.data}
						rowKey={(r) => r.id}
						status={{ kind: "ready" }}
						loadingLabel="Memuat riwayat…"
						empty="Belum ada versi biaya."
						caption={title}
						columns={[
							{ id: "version", header: "Versi", className: "tabular-nums", cell: (r) => r.version },
							{ id: "from", header: "Berlaku sejak", className: "tabular-nums", cell: (r) => when(r.effective_from) },
							...(kind === "component"
								? [{ id: "unit_cost", header: "HPP satuan", className: "text-right tabular-nums", cell: (r: (typeof data.data)[number]) => money(r.unit_cost ?? null) }]
								: (Object.keys(ASSUMPTION_LABELS) as AssumptionField[]).map((f) => ({
										id: f,
										header: ASSUMPTION_LABELS[f],
										className: "text-right tabular-nums",
										cell: (r: (typeof data.data)[number]) => money(r[f] ?? null),
									}))),
							{ id: "source", header: "Sumber", cellClassName: "max-w-48 whitespace-normal", cell: (r) => r.source },
							{ id: "reason", header: "Alasan", cellClassName: "max-w-48 whitespace-normal", cell: (r) => r.reason },
						]}
					/>
				</div>
			)}
		</details>
	);
}

/** 409s meaning the draft or publication moved since the dialog opened. */
const CONFLICT_CODES = new Set([
	"CONFLICT",
	"VERSION_CONFLICT",
	"STALE_VERSION",
	"PUBLICATION_VERSION_CONFLICT",
	"PUBLICATION_ALREADY_WITHDRAWN",
]);
const NETWORK_ERROR =
	"Tidak dapat terhubung ke server lokal. Periksa koneksi lalu coba lagi.";
const REFRESH_FAILED =
	"Data penerbitan sudah berubah, tetapi status terbarunya gagal dimuat. Tutup dialog lalu muat ulang halaman.";

/** What changed under an open dialog, and whether confirming again makes sense. */
type Conflict = { message: string; retry: boolean };

/**
 * Shared dialog-session plumbing for publish/withdraw: one idempotency key per
 * attempt (a network retry replays the same request; a timed-out-but-applied
 * call returns its saved result instead of a version conflict), and focus that
 * returns to the opener unless the action succeeded (the page focuses its notice).
 */
function useActionDialog() {
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [reasonError, setReasonError] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [conflict, setConflict] = useState<Conflict | null>(null);
	const [pending, setPending] = useState(false);
	const opener = useRef<HTMLButtonElement>(null);
	const reasonRef = useRef<HTMLTextAreaElement>(null);
	const conflictRef = useRef<HTMLDivElement>(null);
	const key = useRef("");
	const succeeded = useRef(false);

	useEffect(() => {
		if (conflict) conflictRef.current?.focus();
	}, [conflict]);

	return {
		open,
		reason,
		setReason,
		reasonError,
		error,
		setError,
		conflict,
		setConflict,
		pending,
		setPending,
		opener,
		reasonRef,
		conflictRef,
		key,
		start() {
			key.current = crypto.randomUUID();
			succeeded.current = false;
			setReason("");
			setReasonError(null);
			setError(null);
			setConflict(null);
			setOpen(true);
		},
		close(success = false) {
			key.current = "";
			succeeded.current = success;
			setOpen(false);
		},
		/** New attempt against re-read versions: a new key, the typed reason kept. */
		renewKey() {
			key.current = crypto.randomUUID();
		},
		requireReason(message: string) {
			if (reason.trim()) {
				setReasonError(null);
				return true;
			}
			setReasonError(message);
			reasonRef.current?.focus();
			return false;
		},
		onCloseAutoFocus(e: Event) {
			e.preventDefault();
			if (succeeded.current) return;
			// A conflict can remove the opener (already published/withdrawn); fall back to the section.
			if (opener.current?.isConnected) opener.current.focus();
			else document.getElementById("publication-heading")?.focus();
		},
	};
}

function ConflictNotice({
	conflict,
	innerRef,
}: {
	conflict: Conflict;
	innerRef: React.Ref<HTMLDivElement>;
}) {
	return (
		<Alert
			ref={innerRef}
			tabIndex={-1}
			role="alert"
			data-testid="catalog-conflict"
			className="border-warning/40 bg-warning-surface outline-none"
		>
			<CircleAlert aria-hidden="true" />
			<AlertDescription className="text-foreground">
				{conflict.message}
			</AlertDescription>
		</Alert>
	);
}

function PublishAction({
	base,
	product,
	state,
	onPublished,
	onConflict,
}: {
	base: string;
	product: CatalogProduct;
	state: PublicationState;
	onPublished: (message: string) => void;
	/** Re-reads product and publication state; null when the read failed. */
	onConflict: () => Promise<PublicationState | null>;
}) {
	const d = useActionDialog();
	// Versions the operator is confirming; set on open, replaced after a conflict.
	const [expected, setExpected] = useState({ draft: 0, publication: 0 });

	const alreadyLive = state.current?.product_revision === state.draft_version;
	if (alreadyLive && !d.open)
		return (
			<p className="flex items-center gap-2 text-sm text-success">
				<CircleCheck aria-hidden="true" className="size-4" />
				Draf versi {state.draft_version} sudah terbit.
			</p>
		);

	const explainConflict = (fresh: PublicationState): Conflict => {
		const notes: string[] = [];
		if (fresh.draft_version !== expected.draft)
			notes.push(
				`Draf berubah dari versi ${expected.draft} ke versi ${fresh.draft_version}.`,
			);
		if (fresh.latest_version !== expected.publication)
			notes.push(
				fresh.current
					? `Sudah ada publikasi ${fresh.current.version} (draf versi ${fresh.current.product_revision}) dari tab lain atau pengguna lain.`
					: "Produk sudah ditarik dari toko dari tab lain atau oleh pengguna lain.",
			);
		if (!notes.length) notes.push("Status penerbitan berubah.");
		if (fresh.current?.product_revision === fresh.draft_version) {
			notes.push(`Draf versi ${fresh.draft_version} sudah terbit.`);
			return { message: notes.join(" "), retry: false };
		}
		if (!fresh.ready) {
			notes.push(
				`Draf sekarang punya ${fresh.blocker_count} pemblokir, jadi belum bisa terbit. Lihat bagian Penerbitan.`,
			);
			return { message: notes.join(" "), retry: false };
		}
		notes.push(
			`Periksa perubahannya, lalu terbitkan draf versi ${fresh.draft_version} bila sudah sesuai.`,
		);
		return { message: notes.join(" "), retry: true };
	};

	const submit = async () => {
		if (!d.requireReason("Alasan penerbitan wajib diisi untuk jejak audit."))
			return;
		d.setPending(true);
		d.setError(null);
		try {
			const res = await fetch(`${base}/publications`, {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": d.key.current,
				},
				body: JSON.stringify({
					expected_version: expected.draft,
					expected_publication_version: expected.publication,
					reason: d.reason.trim(),
				}),
			});
			if (!res.ok) {
				const failure = await readFailure(res);
				if (res.status === 409 && CONFLICT_CODES.has(failure.code)) {
					const fresh = await onConflict();
					d.renewKey();
					if (!fresh) {
						d.setConflict({ message: REFRESH_FAILED, retry: false });
						return;
					}
					d.setConflict(explainConflict(fresh));
					setExpected({
						draft: fresh.draft_version,
						publication: fresh.latest_version,
					});
					return;
				}
				d.setError(
					failure.code in BLOCKER_LABELS
						? `${blockerLabel(failure.code)}. ${failureText(failure)}`
						: failureText(failure),
				);
				return;
			}
			const published = (await res.json()) as { version: number };
			d.close(true);
			onPublished(
				`${product.name} terbit sebagai publikasi ${published.version}.`,
			);
		} catch {
			// Same key on retry: if the request was applied, the server replays it.
			d.setError(NETWORK_ERROR);
		} finally {
			d.setPending(false);
		}
	};

	const canConfirm = !d.conflict || d.conflict.retry;

	return (
		<div className="flex flex-col items-start gap-1.5 sm:items-end">
			<Button
				ref={d.opener}
				type="button"
				disabled={!state.ready}
				aria-describedby={state.ready ? undefined : "publish-blocked-hint"}
				onClick={() => {
					setExpected({
						draft: state.draft_version,
						publication: state.latest_version,
					});
					d.start();
				}}
			>
				{state.current
					? "Terbitkan draf terbaru"
					: state.latest_version > 0
						? "Terbitkan lagi"
						: "Terbitkan"}
			</Button>
			{!state.ready && (
				<p id="publish-blocked-hint" className="text-xs text-muted-foreground">
					Selesaikan {state.blocker_count} pemblokir di bagian Penerbitan.
				</p>
			)}
			<Dialog
				open={d.open}
				onOpenChange={(next) => {
					if (!next && !d.pending) d.close();
				}}
			>
				<DialogContent onCloseAutoFocus={d.onCloseAutoFocus}>
					<form
						noValidate
						className="flex flex-col gap-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (canConfirm) void submit();
						}}
					>
						<DialogHeader>
							<DialogTitle>Terbitkan {product.name}?</DialogTitle>
							<DialogDescription>
								Draf versi {expected.draft} dengan {product.variants.length}{" "}
								varian akan tampil di toko seharga Rp99.000 per varian. Tindakan
								ini tercatat di audit.
							</DialogDescription>
						</DialogHeader>
						{d.conflict && (
							<ConflictNotice conflict={d.conflict} innerRef={d.conflictRef} />
						)}
						<ReasonField
							id="publish-reason"
							label="Alasan penerbitan (wajib)"
							dialog={d}
						/>
						{d.error && (
							<p role="alert" className="text-sm text-destructive">
								{d.error}
							</p>
						)}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={d.pending}
								onClick={() => d.close()}
							>
								{canConfirm ? "Batal" : "Tutup"}
							</Button>
							{canConfirm && (
								<Button type="submit" disabled={d.pending}>
									{d.pending
										? "Menerbitkan…"
										: d.conflict
											? `Terbitkan versi ${expected.draft}`
											: "Terbitkan sekarang"}
								</Button>
							)}
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function ReasonField({
	id,
	label,
	dialog: d,
}: {
	id: string;
	label: string;
	dialog: ReturnType<typeof useActionDialog>;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className="text-sm font-medium">
				{label}
			</label>
			<Textarea
				ref={d.reasonRef}
				id={id}
				value={d.reason}
				onChange={(e) => d.setReason(e.target.value)}
				maxLength={500}
				required
				aria-invalid={d.reasonError ? true : undefined}
				aria-describedby={d.reasonError ? `${id}-error` : undefined}
			/>
			{d.reasonError && (
				<p id={`${id}-error`} className="text-sm text-destructive">
					{d.reasonError}
				</p>
			)}
		</div>
	);
}

function WithdrawAction({
	base,
	product,
	state,
	onWithdrawn,
	onConflict,
}: {
	base: string;
	product: CatalogProduct;
	state: PublicationState;
	onWithdrawn: (message: string) => void;
	onConflict: () => Promise<PublicationState | null>;
}) {
	const d = useActionDialog();
	const [expected, setExpected] = useState(0);

	// Stays mounted while open so a conflict can explain "already withdrawn".
	if (!state.current && !d.open) return null;

	const submit = async () => {
		if (!d.requireReason("Alasan penarikan wajib diisi untuk jejak audit."))
			return;
		d.setPending(true);
		d.setError(null);
		try {
			const res = await fetch(`${base}/publication-retractions`, {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": d.key.current,
				},
				body: JSON.stringify({
					expected_publication_version: expected,
					reason: d.reason.trim(),
				}),
			});
			if (!res.ok) {
				const failure = await readFailure(res);
				if (res.status === 409 && CONFLICT_CODES.has(failure.code)) {
					const fresh = await onConflict();
					d.renewKey();
					if (!fresh) d.setConflict({ message: REFRESH_FAILED, retry: false });
					else if (!fresh.current)
						d.setConflict({
							message:
								"Produk sudah ditarik dari toko dari tab lain atau oleh pengguna lain. Tidak ada yang perlu ditarik.",
							retry: false,
						});
					else {
						d.setConflict({
							message: `Publikasi berubah dari ${expected} ke publikasi ${fresh.current.version} (draf versi ${fresh.current.product_revision}). Tarik publikasi ${fresh.current.version} bila tetap perlu.`,
							retry: true,
						});
						setExpected(fresh.latest_version);
					}
					return;
				}
				d.setError(failureText(failure));
				return;
			}
			d.close(true);
			onWithdrawn(
				`${product.name} ditarik dari toko. Pesanan yang sudah dibuat tidak berubah.`,
			);
		} catch {
			d.setError(NETWORK_ERROR);
		} finally {
			d.setPending(false);
		}
	};

	const canConfirm = !d.conflict || d.conflict.retry;

	return (
		<div className="flex flex-col items-start gap-2 border-t pt-3">
			<p className="text-xs text-muted-foreground">
				Menarik produk menghentikan pembelian baru. Pesanan yang sudah dibuat
				tidak berubah.
			</p>
			<Button
				ref={d.opener}
				type="button"
				variant="destructive"
				onClick={() => {
					setExpected(state.latest_version);
					d.start();
				}}
			>
				Tarik dari toko
			</Button>
			<Dialog
				open={d.open}
				onOpenChange={(next) => {
					if (!next && !d.pending) d.close();
				}}
			>
				<DialogContent onCloseAutoFocus={d.onCloseAutoFocus}>
					<form
						noValidate
						className="flex flex-col gap-4"
						onSubmit={(e) => {
							e.preventDefault();
							if (canConfirm) void submit();
						}}
					>
						<DialogHeader>
							<DialogTitle>Tarik {product.name} dari toko?</DialogTitle>
							<DialogDescription>
								Publikasi {expected} berhenti dijual: produk hilang dari toko,
								keranjang, dan perhitungan ongkir untuk pembelian baru. Pesanan
								yang sudah dibuat tidak berubah. Produk bisa diterbitkan lagi
								kapan saja. Tindakan ini tercatat di audit.
							</DialogDescription>
						</DialogHeader>
						{d.conflict && (
							<ConflictNotice conflict={d.conflict} innerRef={d.conflictRef} />
						)}
						<ReasonField
							id="withdraw-reason"
							label="Alasan penarikan (wajib)"
							dialog={d}
						/>
						{d.error && (
							<p role="alert" className="text-sm text-destructive">
								{d.error}
							</p>
						)}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={d.pending}
								onClick={() => d.close()}
							>
								{canConfirm ? "Batal" : "Tutup"}
							</Button>
							{canConfirm && (
								<Button
									type="submit"
									variant="destructive"
									disabled={d.pending}
								>
									{d.pending
										? "Menarik…"
										: d.conflict
											? `Tarik publikasi ${expected}`
											: "Tarik dari toko"}
								</Button>
							)}
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</div>
	);
}
