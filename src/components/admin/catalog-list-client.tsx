"use client";

import { cn } from "cn";
import { CircleAlert, ImageOff, Search } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rupiah } from "@/modules/storefront/format";
import { failureText, getJson } from "./admin-errors";
import { CardMeta, CardStatus, CardTitle, DataTable } from "./data-table";
import { FilterSheet } from "./form";
import {
	blockerLabel,
	type CatalogStatus,
	type Category,
	categoryPath,
	type catalogAccess,
	OFFER_KIND_LABELS,
	PRICE_IDR,
	type Page,
	type ProductSummary,
	readAll,
	STATUS_LABELS,
	STATUS_TONE,
} from "./catalog-model";
import { StatusBadge } from "./status";
import { AdminPage, PageHeader } from "./page-blocks";

const PAGE_SIZE = 25;
const STATUSES: CatalogStatus[] = [
	"published",
	"withdrawn",
	"ready",
	"blocked",
];

type Filters = { q: string; category: string; status: CatalogStatus | ""; review: boolean };
type Access = ReturnType<typeof catalogAccess>;
type Load =
	| { state: "loading" }
	| { state: "error"; error: string }
	| { state: "ready"; rows: ProductSummary[]; next: string | null };

export function CatalogListClient({
	initial,
	access,
}: {
	/** `cursors` is the chain that reopens a page (see the page's `kursor`). */
	initial: Filters & { cursors: string[] };
	access: Access;
}) {
	const [filters, setFilters] = useState<Filters>({
		q: initial.q,
		category: initial.category,
		status: initial.status,
		review: initial.review,
	});
	const [query, setQuery] = useState(initial.q); // debounced copy of filters.q
	const [categories, setCategories] = useState<Category[]>([]);
	// cursors[i] opens page i+1; page 1 has no cursor.
	const [cursors, setCursors] = useState<(string | null)[]>([
		null,
		...initial.cursors,
	]);
	// Below md the category/status filters sit behind a toggle so rows stay in view.
	const [load, setLoad] = useState<Load>({ state: "loading" });
	const request = useRef<AbortController | null>(null);

	useEffect(() => {
		void readAll<Category>("/api/v1/admin/categories").then(
			(r) => r.ok && setCategories(r.data),
		);
	}, []);

	useEffect(() => {
		const timer = setTimeout(() => setQuery(filters.q.trim()), 300);
		return () => clearTimeout(timer);
	}, [filters.q]);

	const page = cursors.length;
	const cursor = cursors[cursors.length - 1];

	const fetchPage = useCallback(async () => {
		request.current?.abort();
		const controller = new AbortController();
		request.current = controller;
		setLoad({ state: "loading" });
		const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
		if (query) params.set("q", query);
		if (filters.category) params.set("category_id", filters.category);
		if (filters.status) params.set("state", filters.status);
		if (filters.review) params.set("review", "claim");
		if (cursor) params.set("cursor", cursor);
		const res = await getJson<Page<ProductSummary>>(
			`/api/v1/admin/products?${params.toString()}`,
			controller.signal,
		);
		if (controller.signal.aborted) return;
		setLoad(
			res.ok
				? {
						state: "ready",
						rows: res.data.data,
						next: res.data.pagination.next_cursor,
					}
				: { state: "error", error: failureText(res.failure) },
		);
	}, [query, filters.category, filters.status, filters.review, cursor]);

	useEffect(() => {
		void fetchPage();
		return () => request.current?.abort();
	}, [fetchPage]);

	// Filters and page live in the URL so a list can be shared and Back restores it.
	// Cursor pagination: `kursor` holds the chain of cursors that reopens `hal`.
	const chain = cursors.slice(1).join(",");
	const urlState = {
		q: query,
		kategori: filters.category,
		status: filters.status,
		tinjauan: filters.review ? "klaim" : "",
		hal: page > 1 ? String(page) : "",
		kursor: chain,
	};
	const urlQuery = new URLSearchParams(
		Object.entries(urlState).filter(([, v]) => v),
	).toString();
	useEffect(() => {
		const url = new URL(window.location.href);
		url.search = urlQuery;
		window.history.replaceState(null, "", url);
	}, [urlQuery]);

	const update = (patch: Partial<Filters>) => {
		setFilters((prev) => ({ ...prev, ...patch }));
		setCursors([null]);
	};
	const filtered = Boolean(query || filters.category || filters.status || filters.review);
	const activeFilters =
		Number(Boolean(filters.category)) + Number(Boolean(filters.status)) + Number(filters.review);
	const detailHref = (id: string) =>
		`/admin/catalog/${id}${urlQuery ? `?dari=${encodeURIComponent(urlQuery)}` : ""}`;
	// Readers without stock access get readiness flags, never quantities.
	const ready = access.stock ? "lengkap" : "siap";

	const thumb = (r: ProductSummary) =>
		r.image_url ? (
			// biome-ignore lint/performance/noImgElement: same-origin catalog photo; next/image adds nothing for a 48px admin thumbnail
			<img
				src={r.image_url}
				alt=""
				width={48}
				height={48}
				loading="lazy"
				className="size-12 shrink-0 rounded-md border object-cover"
			/>
		) : (
			<span className="flex size-12 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
				<ImageOff aria-hidden="true" className="size-4" />
				<span className="sr-only">Tanpa foto</span>
			</span>
		);

	const kinds = (r: ProductSummary) => (
		<span className="flex flex-wrap items-center gap-1">
			{r.offer_kinds.map((kind) => (
				<Badge key={kind} variant="outline">
					{OFFER_KIND_LABELS[kind] ?? kind}
				</Badge>
			))}
			<span className="text-xs text-muted-foreground tabular-nums">
				{r.offer_count} varian
			</span>
		</span>
	);

	const stock = (r: ProductSummary) => {
		if (r.blocker_codes.includes("ACTIVE_WAREHOUSE_REQUIRED"))
			return <Badge variant="warning">Gudang belum aktif</Badge>;
		if (r.offer_count === 0)
			return <span className="text-xs text-muted-foreground">—</span>;
		return r.stock_ready_offers === r.offer_count ? (
			<Badge variant="success">{access.stock ? "Lengkap" : "Stok siap"}</Badge>
		) : (
			<Badge variant="warning">
				{r.stock_ready_offers} dari {r.offer_count} varian {ready}
			</Badge>
		);
	};

	// Every offer is fixed at PRICE_IDR; the header states it, so a column of
	// identical prices is noise. Shown only if the API ever returns another price.
	const uniformPrice =
		load.state !== "ready" || load.rows.every((r) => r.price_idr === PRICE_IDR);

	const status = (r: ProductSummary) => (
		<div className="flex min-w-0 flex-col items-start gap-0.5">
			<StatusBadge tone={STATUS_TONE[r.state]}>{STATUS_LABELS[r.state]}</StatusBadge>
			{r.state !== "published" && r.blocker_codes.length > 0 && (
				<span className="text-xs text-muted-foreground">
					{blockerLabel(r.blocker_codes[0])}
					{r.blocker_codes.length > 1
						? ` · +${r.blocker_codes.length - 1} lainnya`
						: ""}
				</span>
			)}
			{r.published_revision !== null && r.version > r.published_revision && (
				<span className="text-xs text-muted-foreground">Ada draf baru</span>
			)}
			{r.claim_review && <ClaimBadge />}
		</div>
	);

	return (
		<AdminPage>
			<PageHeader
				title="Katalog Produk"
				description={
					<>
						{access.company ? "Semua produk" : "Produk dari gudang Anda"},
						termasuk draf dan yang ditarik dari toko. Harga{" "}
						{rupiah(PRICE_IDR)} per varian.
						{access.edit
							? " Produk bisa terbit setelah stok lengkap, HPP, dan asumsi biaya tercatat."
							: access.costs
								? " Produk bisa terbit setelah HPP dan asumsi biaya tercatat."
								: ""}
					</>
				}
			/>

			<section
				aria-labelledby="catalog-list-heading"
				className="flex flex-col gap-4 md:rounded-lg md:border md:bg-card md:p-5"
			>
				<h2 id="catalog-list-heading" className="sr-only">
					Daftar produk
				</h2>
				<search className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
					<div className="flex flex-col gap-1.5">
						<label htmlFor="catalog-search" className="text-sm font-medium">
							Cari produk
						</label>
						<div className="relative">
							<Search
								aria-hidden="true"
								className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
							/>
							<Input
								id="catalog-search"
								type="search"
								value={filters.q}
								onChange={(e) => update({ q: e.target.value })}
								placeholder="Nama atau kode katalog"
								autoComplete="off"
								maxLength={100}
								className="pl-8"
							/>
						</div>
					</div>
					<FilterSheet active={activeFilters}>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="catalog-category" className="text-sm font-medium">
								Kategori
							</label>
							<select
								id="catalog-category"
								value={filters.category}
								onChange={(e) => update({ category: e.target.value })}
								className={selectClass}
							>
								<option value="">Semua kategori</option>
								{categories
									.map((c) => ({
										id: c.id,
										label: categoryPath(c.id, categories) ?? c.name,
									}))
									.sort((a, b) => a.label.localeCompare(b.label, "id"))
									.map((c) => (
										<option key={c.id} value={c.id}>
											{c.label}
										</option>
									))}
							</select>
						</div>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="catalog-status" className="text-sm font-medium">
								Status penerbitan
							</label>
							<select
								id="catalog-status"
								value={filters.status}
								onChange={(e) =>
									update({ status: e.target.value as CatalogStatus | "" })
								}
								className={selectClass}
							>
								<option value="">Semua status</option>
								{STATUSES.map((s) => (
									<option key={s} value={s}>
										{STATUS_LABELS[s]}
									</option>
								))}
							</select>
						</div>
						<div className="flex flex-col gap-1.5">
							<label htmlFor="catalog-review" className="text-sm font-medium">
								Tinjauan konten
							</label>
							<select
								id="catalog-review"
								value={filters.review ? "klaim" : ""}
								onChange={(e) => update({ review: e.target.value === "klaim" })}
								className={selectClass}
							>
								<option value="">Semua produk</option>
								<option value="klaim">Perlu tinjauan klaim</option>
							</select>
						</div>
					</FilterSheet>
				</search>

				{load.state === "ready" && load.rows.length > 0 && (
					<p className="text-sm tabular-nums" role="status">
						Halaman {page} · {load.rows.length} produk
						{filtered ? " cocok" : ""}
					</p>
				)}
				<DataTable
					rows={load.state === "ready" ? load.rows : []}
					rowKey={(r) => r.id}
					status={
						load.state === "ready"
							? { kind: "ready" }
							: load.state === "error"
								? {
										kind: "error",
										message: `Katalog gagal dimuat. ${load.error}`,
										onRetry: () => void fetchPage(),
									}
								: { kind: "loading" }
					}
					loadingLabel="Memuat katalog…"
					empty={
						filtered ? (
							<>
								<p>Tidak ada produk yang cocok dengan filter ini.</p>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => update({ q: "", category: "", status: "", review: false })}
								>
									Hapus filter
								</Button>
							</>
						) : (
							"Katalog belum berisi produk."
						)
					}
					caption="Daftar produk katalog"
					rowTestId={(r) => `catalog-row-${r.id}`}
					columns={[
						{ id: "photo", header: <span className="sr-only">Foto</span>, className: "w-16", cell: thumb },
						{
							id: "product",
							header: "Produk",
							cellClassName: "max-w-72 whitespace-normal",
							cell: (r) => (
								<>
									<Link
										href={detailHref(r.id)}
										className="font-medium text-primary underline-offset-4 hover:underline"
									>
										{r.name}
									</Link>
									<span className="block font-mono text-xs text-muted-foreground">
										{r.catalog_id}
									</span>
								</>
							),
						},
						{
							id: "category",
							header: "Kategori",
							className: "hidden lg:table-cell",
							cellClassName: "max-w-56 whitespace-normal",
							cell: (r) => r.category_path ?? "Tanpa kategori",
						},
						{ id: "kinds", header: "Jenis varian", cell: kinds },
						...(uniformPrice
							? []
							: [
									{
										id: "price",
										header: "Harga",
										className: "text-right tabular-nums",
										cell: (r: ProductSummary) => rupiah(r.price_idr),
									},
								]),
						{ id: "stock", header: access.stock ? "Stok" : "Kesiapan stok", cell: stock },
						{
							id: "status",
							header: "Status",
							cellClassName: "max-w-56 whitespace-normal",
							cell: status,
						},
					]}
					cardTestId={(r) => `catalog-card-${r.id}`}
					card={(r) => (
						<div className="flex gap-3">
							{thumb(r)}
							<div className="flex min-w-0 flex-1 flex-col gap-1.5">
								<CardTitle
									title={
										<Link
											href={detailHref(r.id)}
											className="inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline"
										>
											{r.name}
										</Link>
									}
									aside={<StatusBadge tone={STATUS_TONE[r.state]}>{STATUS_LABELS[r.state]}</StatusBadge>}
								/>
								<CardMeta>
									{r.category_path ?? "Tanpa kategori"}
									{r.state !== "published" && r.blocker_codes.length > 0 && (
										<span className="block">
											{blockerLabel(r.blocker_codes[0])}
											{r.blocker_codes.length > 1 ? ` · +${r.blocker_codes.length - 1} lainnya` : ""}
										</span>
									)}
									{r.published_revision !== null && r.version > r.published_revision && (
										<span className="block">Ada draf baru</span>
									)}
								</CardMeta>
								<CardStatus>
									{kinds(r)}
									{stock(r)}
									{r.claim_review && <ClaimBadge />}
								</CardStatus>
							</div>
						</div>
					)}
					footer={
						load.state === "ready" &&
						(page > 1 || load.next) && (
							<nav
								aria-label="Halaman katalog"
								className="flex flex-wrap items-center justify-between gap-2"
							>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={page <= 1}
									onClick={() => setCursors((prev) => prev.slice(0, -1))}
								>
									Sebelumnya
								</Button>
								<span className="text-sm tabular-nums">Halaman {page}</span>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={!load.next}
									onClick={() =>
										load.next && setCursors((prev) => [...prev, load.next as string])
									}
								>
									Berikutnya
								</Button>
							</nav>
						)
					}
				/>
			</section>
		</AdminPage>
	);
}

/** DEC-013: the name or a photo carries an efficacy, slimming or whitening claim the owner must replace before go-live. */
export function ClaimBadge() {
	return (
		<Badge variant="warning" data-testid="claim-review-badge" className="whitespace-nowrap">
			<CircleAlert aria-hidden="true" />
			Perlu tinjauan klaim
		</Badge>
	);
}

const selectClass = cn(
	"h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none",
	"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
);
