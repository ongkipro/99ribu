"use client";

import {
	ArrowDown,
	ArrowLeft,
	ArrowUp,
	CircleAlert,
	CircleCheck,
	ImageOff,
	Pencil,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { ClaimBadge } from "./catalog-list-client";
import { FormDialog, FormField, useFormDialogErrorId } from "./form";
import { send, useOperationKey } from "./ops-api";
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
import { rupiah, wibDate, wibDateTime } from "@/modules/storefront/format";
import { failureText, getJson, readFailure } from "./admin-errors";
import { DataTable } from "./data-table";
import { ASSUMPTION_LABELS, type AssumptionField, CostDisclosure } from "./cost-versions";
import { AdminPage, DetailSection, PageHeader, StickyActions } from "./page-blocks";
import { ErrorState, LoadingState } from "./states";
import { StatusBadge } from "./status";
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
	STATUS_LABELS,
	STATUS_TONE,
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

export function CatalogProductClient({
	productId,
	access,
	backHref,
}: {
	productId: string;
	/** From catalogAccess(); each section's API still enforces its own grant. */
	access: { edit: boolean; stock: boolean; costs: boolean; costsWrite: boolean };
	backHref: string;
}) {
	const { edit: canEdit, stock: canReadStock, costs: canReadCosts, costsWrite: canWriteCosts } = access;
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

	// `quiet` re-reads in place after a cost version was saved: the open history sections must stay mounted.
	const loadCosts = useCallback(
		async (quiet = false) => {
			if (!canReadCosts) return;
			if (!quiet) setCosts({ state: "loading" });
			const res = await getJson<Contribution>(`${base}/contribution-reviews`);
			if (res.ok) setCosts({ state: "ready", data: res.data });
			else if (!quiet) setCosts({ state: "error", error: failureText(res.failure) });
		},
		[base, canReadCosts],
	);

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
		<AdminPage>
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
						<PageHeader
							title={p.name}
							meta={
								<>
									<span className="basis-full">
										Draf versi {p.version} · {categoryPath(p.category_id, categories) ?? "Tanpa kategori"}
									</span>
									{p.claim_review && <ClaimBadge />}
									{state ? (
										<StatusBadge tone={STATUS_TONE[catalogStatus(state)]}>
											{STATUS_LABELS[catalogStatus(state)]}
										</StatusBadge>
									) : (
										<Skeleton className="h-5 w-24" />
									)}
									<span className="text-sm font-medium text-foreground tabular-nums">
										{rupiah(PRICE_IDR)} per varian
									</span>
								</>
							}
							actions={
								state &&
								canEdit &&
								(() => {
									const publish = (
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
									);
									// The screen's one primary action: a sticky bottom bar on phones while it can still publish.
									return state.current?.product_revision === state.draft_version ? publish : <StickyActions>{publish}</StickyActions>;
								})()
							}
						/>

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

						<DetailSection id="photos-heading" title="Foto produk">
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
						</DetailSection>

						<DetailSection id="info-heading" title="Informasi produk" testId="product-info">
							{p.claim_review && (
								<Alert data-testid="claim-review-notice" className="border-warning/40 bg-warning-surface">
									<CircleAlert aria-hidden="true" />
									<AlertDescription className="text-foreground">
										Perlu tinjauan klaim (DEC-013): nama atau foto memuat klaim khasiat, pelangsing atau pemutih. Ganti nama
										atau foto sebelum toko dibuka untuk umum; produk tetap tampil di pencarian, tidak di etalase beranda.
									</AlertDescription>
								</Alert>
							)}
							<p className="max-w-prose text-sm leading-relaxed whitespace-pre-line">
								{p.description || "Deskripsi belum diisi."}
							</p>
							<dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
								<dt className="text-muted-foreground">Kategori Google</dt>
								<dd data-testid="google-category">
									{p.google_product_category ? (
										<>
											<span className="font-mono">{p.google_product_category}</span>
											<span className="text-muted-foreground"> · dari dataset katalog, hanya baca</span>
										</>
									) : (
										<span className="text-muted-foreground">Belum ada (produk di luar dataset katalog)</span>
									)}
								</dd>
							</dl>
							{canEdit && (
								<ContentAction
									base={base}
									product={p}
									onSaved={(message) => {
										setNotice(message);
										void loadProduct(true);
										void loadPub(true);
									}}
									onConflict={() => void loadProduct(true)}
								/>
							)}
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
						</DetailSection>

						<DetailSection
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
						</DetailSection>

						{canReadStock && (
							<DetailSection
								id="stock-heading"
								title="Stok per gudang"
								description="Saldo fisik komponen dari pencatatan gudang. Tersedia = fisik − dipesan − karantina."
							>
								{stock.state === "loading" ? (
									<LoadingState label="Memuat stok…" lines={3} columns={4} />
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
										stack
										columns={[
											{
												id: "item",
												header: "Komponen",
												stack: "title",
												cellClassName: "whitespace-normal md:max-w-56",
												// md–xl: Fisik, Dipesan, Karantina and Lot move under the name so nothing clips at the table edge.
												cell: (row) => (
													<div className="flex flex-col">
														{componentName(row.stock_item_id)}
														<span className="hidden text-xs font-normal text-muted-foreground tabular-nums md:max-xl:block">
															Fisik {row.on_hand} · Dipesan {row.reserved} · Karantina {row.quarantined}
															{row.lot_code && ` · Lot ${row.lot_code}`}
														</span>
													</div>
												),
											},
											{
												id: "warehouse",
												header: "Gudang",
												stack: "meta",
												cell: (row) => warehouseName(row.warehouse_id) ?? `Gudang ${row.warehouse_id.slice(0, 8)}`,
											},
											{ id: "available", header: "Tersedia", className: "text-right tabular-nums", cellClassName: "font-medium", cell: (row) => row.available },
											{ id: "on_hand", header: "Fisik", className: "text-right tabular-nums md:max-xl:hidden", cell: (row) => row.on_hand },
											{ id: "reserved", header: "Dipesan", className: "text-right tabular-nums md:max-xl:hidden", cell: (row) => row.reserved },
											{ id: "quarantined", header: "Karantina", className: "text-right tabular-nums md:max-xl:hidden", cell: (row) => row.quarantined },
											{
												id: "lot",
												header: "Lot",
												className: "md:max-xl:hidden",
												cellClassName: "tabular-nums",
												cell: (row) => (
													<>
														{row.lot_code ?? "—"}
														{row.expires_on &&
															` · ${row.expired ? "kedaluwarsa" : "s.d."} ${wibDate(`${row.expires_on}T00:00:00+07:00`)}`}
													</>
												),
											},
										]}
									/>
								)}
							</DetailSection>
						)}

						{canReadCosts && (
							<DetailSection
								id="costs-heading"
								title="HPP dan kontribusi"
								description="Estimasi berdasarkan versi biaya yang berlaku sekarang. Nilai kosong tidak dihitung sebagai Rp0."
							>
								{costs.state === "loading" ? (
									<LoadingState label="Memuat biaya…" lines={2} className="h-40 w-full rounded-md" />
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
															<StatusBadge tone="problem">Data biaya belum lengkap</StatusBadge>
														) : o.below_floor ? (
															<StatusBadge tone="danger">Di bawah batas minimum</StatusBadge>
														) : (
															<StatusBadge tone="success">Memenuhi batas</StatusBadge>
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
													<CostDisclosure
														title={canWriteCosts ? "Asumsi biaya varian: riwayat dan versi baru" : "Asumsi biaya varian: riwayat"}
														kind="assumption"
														scopeId={o.offer_id}
														subject={variantName(o.offer_id) ?? "Varian"}
														canWrite={canWriteCosts}
														onWritten={() => void loadCosts(true)}
														testId={`assumption-${o.offer_id}`}
													/>
													{o.components.map((c) => (
														<CostDisclosure
															key={c.stock_item_id}
															title={`HPP ${componentName(c.stock_item_id)} (×${c.quantity}, sekarang ${money(c.unit_cost)}): ${canWriteCosts ? "riwayat dan versi baru" : "riwayat"}`}
															kind="component"
															scopeId={c.stock_item_id}
															subject={componentName(c.stock_item_id)}
															canWrite={canWriteCosts}
															onWritten={() => void loadCosts(true)}
															testId={`hpp-${c.stock_item_id}`}
														/>
													))}
												</li>
											))}
										</ul>
									</>
								)}
							</DetailSection>
						)}

						<DetailSection
							id="publication-heading"
							title="Penerbitan"
							description="Produk hanya tampil di toko setelah terbit. Riwayat versi terbit sebelumnya belum tersedia di konsol."
						>
							{pub.state === "loading" ? (
								<LoadingState label="Memuat status penerbitan…" lines={3} className="h-5 w-full" />
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
						</DetailSection>
					</>
				)
			)}
		</AdminPage>
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
					<StatusBadge tone={stockShort ? "problem" : "success"}>
						{readsStock
							? stockShort
								? "Stok belum lengkap"
								: "Stok lengkap"
							: stockShort
								? "Stok belum siap"
								: "Stok siap"}
					</StatusBadge>
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
		<div className="flex flex-col items-start gap-1.5 sm:items-end max-md:items-stretch">
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

/**
 * S102 / spec 17 A9: content edit of the draft (title, description, photo order, alt text). Saves a
 * new draft version with a reason (the API appends a revision; the catalog import then preserves
 * it). A published product shows the change only after it is published again.
 */
function ContentAction({
	base,
	product,
	onSaved,
	onConflict,
}: {
	base: string;
	product: CatalogProduct;
	onSaved: (message: string) => void;
	onConflict: () => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button variant="outline" className="self-start max-md:self-stretch" data-testid="content-edit" onClick={() => setOpen(true)}>
				<Pencil data-icon="inline-start" aria-hidden="true" />
				Ubah konten
			</Button>
			{open && (
				<ContentDialog
					base={base}
					product={product}
					onClose={() => setOpen(false)}
					onConflict={onConflict}
					onSaved={(message) => {
						setOpen(false);
						onSaved(message);
					}}
				/>
			)}
		</>
	);
}

const TITLE_CARD_LIMIT = 40;

/** Hands the open FormDialog's error id to a field, so the refusal is read with the control. */
function DialogErrorId({ children }: { children: (errorId: string | undefined) => React.ReactNode }) {
	return children(useFormDialogErrorId());
}

function ContentDialog({
	base,
	product,
	onClose,
	onSaved,
	onConflict,
}: {
	base: string;
	product: CatalogProduct;
	onClose: () => void;
	onSaved: (message: string) => void;
	onConflict: () => void;
}) {
	const [name, setName] = useState(product.name);
	const [description, setDescription] = useState(product.description);
	const [images, setImages] = useState(product.images);
	const [reason, setReason] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const [moved, setMoved] = useState<{ focus: string; text: string } | null>(null);
	const key = useOperationKey();
	const listRef = useRef<HTMLOListElement>(null);
	// Focus follows the moved photo (same button, or its other button at the list edge) so repeated
	// moves need no re-navigation; the live region announces the new position.
	useEffect(() => {
		if (!moved) return;
		const list = listRef.current;
		const target = list?.querySelector<HTMLButtonElement>(`[data-move="${moved.focus}"]:not(:disabled)`);
		(target ?? list?.querySelector<HTMLButtonElement>(`[data-photo="${moved.focus.split(":")[1]}"] button:not(:disabled)`))?.focus();
	}, [moved]);
	const move = (index: number, by: -1 | 1) => {
		const next = [...images];
		[next[index], next[index + by]] = [next[index + by], next[index]];
		setImages(next);
		setMoved({
			focus: `${by < 0 ? "up" : "down"}:${index + by}`,
			text: `Foto dipindah ke posisi ${index + by + 1} dari ${next.length}.`,
		});
	};
	const length = Array.from(name.trim()).length;
	// Field the last client-side refusal points at (aria-invalid on it).
	const [invalid, setInvalid] = useState<"name" | "alt" | "reason" | null>(null);
	const dirty =
		name !== product.name ||
		description !== product.description ||
		reason.trim() !== "" ||
		JSON.stringify(images) !== JSON.stringify(product.images);
	const refuse = (field: "name" | "alt" | "reason" | null, message: string) => {
		setInvalid(field);
		setError(message);
	};
	async function submit() {
		if (!name.trim()) return refuse("name", "Judul wajib diisi.");
		if (images.some((img) => !img.alt.trim())) return refuse("alt", "Setiap foto perlu teks alternatif.");
		if (!reason.trim()) return refuse("reason", "Alasan wajib diisi.");
		const cleaned = images.map((img) => ({ ...img, alt: img.alt.trim() }));
		const changes = {
			...(name.trim() !== product.name ? { name: name.trim() } : {}),
			...(description !== product.description ? { description } : {}),
			...(JSON.stringify(cleaned) !== JSON.stringify(product.images) ? { images: cleaned } : {}),
		};
		if (!Object.keys(changes).length) return refuse(null, "Belum ada perubahan. Ubah judul, deskripsi atau foto, lalu simpan.");
		setPending(true);
		setInvalid(null);
		setError(null);
		const result = await send<CatalogProduct>("PATCH", base, { ...changes, expected_version: product.version, reason: reason.trim() }, key);
		setPending(false);
		if (!result.ok) {
			if (result.code === "VERSION_CONFLICT") onConflict();
			return setError(result.text);
		}
		onSaved(`Konten disimpan sebagai draf versi ${result.data.version}. Produk yang sudah terbit perlu diterbitkan ulang agar perubahan tampil di toko.`);
	}
	return (
		<FormDialog
			title="Ubah konten produk"
			description={`Draf versi ${product.version}. Perubahan disimpan sebagai versi draf baru; impor katalog tidak menimpa suntingan staf.`}
			pending={pending}
			error={error}
			submitLabel="Simpan draf"
			dirty={dirty}
			onClose={onClose}
			onSubmit={() => void submit()}
		>
			<FormField
				id="content-name"
				label="Judul"
				hint={`${length} karakter${length > TITLE_CARD_LIMIT ? `; kartu produk menampilkan ±${TITLE_CARD_LIMIT} karakter pertama` : ""}. Tanpa klaim khasiat atau kata promosi.`}
			>
				<DialogErrorId>
					{(errorId) => (
						<Input
							id="content-name"
							maxLength={200}
							aria-describedby={invalid === "name" && errorId ? `content-name-hint ${errorId}` : "content-name-hint"}
							aria-invalid={invalid === "name" || undefined}
							value={name}
							onChange={(e) => setName(e.target.value)}
						/>
					)}
				</DialogErrorId>
			</FormField>
			<FormField id="content-description" label="Deskripsi">
				<Textarea id="content-description" rows={6} maxLength={10000} value={description} onChange={(e) => setDescription(e.target.value)} />
			</FormField>
			<fieldset className="flex min-w-0 flex-col gap-2">
				<legend className="text-sm font-medium">Foto ({images.length})</legend>
				<p className="text-xs text-muted-foreground">Foto pertama menjadi sampul. Teks alternatif menjelaskan isi foto untuk pembaca layar.</p>
				{images.length === 0 ? (
					<p className="text-sm text-muted-foreground">Belum ada foto.</p>
				) : (
					<ol ref={listRef} className="flex flex-col divide-y rounded-md border" data-testid="content-photos">
						{images.map((img, i) => (
							<li key={img.url} data-photo={i} className="flex items-start gap-3 p-2">
								{/* biome-ignore lint/performance/noImgElement: same-origin catalog photo thumbnail */}
								<img src={img.url} alt="" width={56} height={56} className="size-14 shrink-0 rounded-md border object-cover" />
								<div className="flex min-w-0 flex-1 flex-col gap-1.5">
									<FormField id={`content-alt-${i}`} label={i === 0 ? "Foto 1 (sampul): teks alternatif" : `Foto ${i + 1}: teks alternatif`}>
										<Input
											id={`content-alt-${i}`}
											maxLength={500}
											aria-invalid={(invalid === "alt" && !img.alt.trim()) || undefined}
											value={img.alt}
											onChange={(e) => setImages(images.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
										/>
									</FormField>
									<div className="flex gap-2">
										<Button
											type="button"
											size="sm"
											variant="outline"
											data-move={`up:${i}`}
											disabled={i === 0}
											aria-label={`Pindahkan foto ${i + 1} ke atas`}
											onClick={() => move(i, -1)}
										>
											<ArrowUp aria-hidden="true" />
											Naik
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											data-move={`down:${i}`}
											disabled={i === images.length - 1}
											aria-label={`Pindahkan foto ${i + 1} ke bawah`}
											onClick={() => move(i, 1)}
										>
											<ArrowDown aria-hidden="true" />
											Turun
										</Button>
									</div>
								</div>
							</li>
						))}
					</ol>
				)}
				<p className="sr-only" aria-live="polite">
					{moved?.text ?? ""}
				</p>
			</fieldset>
			<FormField id="content-reason" label="Alasan" hint="Contoh: ganti klaim di judul, urutkan foto sampul.">
				<DialogErrorId>
					{(errorId) => (
						<Input
							id="content-reason"
							maxLength={500}
							aria-describedby={invalid === "reason" && errorId ? `content-reason-hint ${errorId}` : "content-reason-hint"}
							aria-invalid={invalid === "reason" || undefined}
							value={reason}
							onChange={(e) => setReason(e.target.value)}
						/>
					)}
				</DialogErrorId>
			</FormField>
		</FormDialog>
	);
}
