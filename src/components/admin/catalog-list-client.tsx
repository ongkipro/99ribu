"use client";

import { cn } from "cn";
import { ImageOff, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { rupiah } from "@/modules/storefront/format";
import { failureText, getJson } from "./admin-errors";
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
	STATUS_BADGE,
	STATUS_LABELS,
} from "./catalog-model";

const PAGE_SIZE = 25;
const STATUSES: CatalogStatus[] = [
	"published",
	"withdrawn",
	"ready",
	"blocked",
];

type Filters = { q: string; category: string; status: CatalogStatus | "" };
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
	});
	const [query, setQuery] = useState(initial.q); // debounced copy of filters.q
	const [categories, setCategories] = useState<Category[]>([]);
	// cursors[i] opens page i+1; page 1 has no cursor.
	const [cursors, setCursors] = useState<(string | null)[]>([
		null,
		...initial.cursors,
	]);
	// Below md the category/status filters sit behind a toggle so rows stay in view.
	const [filtersOpen, setFiltersOpen] = useState(false);
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
	}, [query, filters.category, filters.status, cursor]);

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
	const filtered = Boolean(query || filters.category || filters.status);
	const activeFilters =
		Number(Boolean(filters.category)) + Number(Boolean(filters.status));
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
			<Badge variant={STATUS_BADGE[r.state]}>{STATUS_LABELS[r.state]}</Badge>
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
		</div>
	);

	return (
		<div className="flex flex-col gap-6 px-4 py-5 md:px-8 md:py-6">
			<header className="flex flex-col gap-1.5 border-b pb-5">
				<h1 className="text-2xl font-semibold tracking-tight">
					Katalog Produk
				</h1>
				<p className="max-w-prose text-sm text-muted-foreground">
					{access.company ? "Semua produk" : "Produk dari gudang Anda"},
					termasuk draf dan yang ditarik dari toko. Harga{" "}
					{rupiah(PRICE_IDR)} per varian.
					{access.edit
						? " Produk bisa terbit setelah stok lengkap, HPP, dan asumsi biaya tercatat."
						: access.costs
							? " Produk bisa terbit setelah HPP dan asumsi biaya tercatat."
							: ""}
				</p>
			</header>

			<section
				aria-labelledby="catalog-list-heading"
				className="flex flex-col gap-4 rounded-lg border bg-card p-4 md:p-5"
			>
				<h2 id="catalog-list-heading" className="sr-only">
					Daftar produk
				</h2>
				<search className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
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
					<Button
						type="button"
						variant="outline"
						className="justify-self-start md:hidden"
						aria-expanded={filtersOpen}
						aria-controls="catalog-filters"
						onClick={() => setFiltersOpen((open) => !open)}
					>
						<SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
						Filter
						{activeFilters > 0 && (
							<Badge variant="secondary" className="tabular-nums">
								{activeFilters}
								<span className="sr-only"> aktif</span>
							</Badge>
						)}
					</Button>
					<div
						id="catalog-filters"
						className={cn("gap-3 md:contents", filtersOpen ? "grid" : "hidden")}
					>
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
					</div>
				</search>

				{load.state === "loading" ? (
					<div className="flex flex-col gap-2" aria-busy="true">
						<span className="sr-only">Memuat katalog…</span>
						<Skeleton className="h-14 w-full" />
						<Skeleton className="h-14 w-full" />
						<Skeleton className="h-14 w-full" />
					</div>
				) : load.state === "error" ? (
					<Alert
						variant="destructive"
						className="flex flex-wrap items-center justify-between gap-3 border-destructive/40 bg-destructive-surface"
					>
						<AlertDescription className="text-foreground">
							Katalog gagal dimuat. {load.error}
						</AlertDescription>
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={() => void fetchPage()}
						>
							<RefreshCw data-icon="inline-start" aria-hidden="true" />
							Coba lagi
						</Button>
					</Alert>
				) : load.rows.length === 0 ? (
					filtered ? (
						<div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
							<p>Tidak ada produk yang cocok dengan filter ini.</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => update({ q: "", category: "", status: "" })}
							>
								Hapus filter
							</Button>
						</div>
					) : (
						<p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
							Katalog belum berisi produk.
						</p>
					)
				) : (
					<>
						<p className="text-sm tabular-nums" role="status">
							Halaman {page} · {load.rows.length} produk
							{filtered ? " cocok" : ""}
						</p>
						<div className="hidden md:block">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead className="w-16">
											<span className="sr-only">Foto</span>
										</TableHead>
										<TableHead>Produk</TableHead>
										<TableHead className="hidden lg:table-cell">
											Kategori
										</TableHead>
										<TableHead>Jenis varian</TableHead>
										{!uniformPrice && (
											<TableHead className="text-right">Harga</TableHead>
										)}
										<TableHead>
											{access.stock ? "Stok" : "Kesiapan stok"}
										</TableHead>
										<TableHead>Status</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{load.rows.map((r) => (
										<TableRow key={r.id} data-testid={`catalog-row-${r.id}`}>
											<TableCell>{thumb(r)}</TableCell>
											<TableCell className="max-w-72 whitespace-normal">
												<Link
													href={detailHref(r.id)}
													className="font-medium text-primary underline-offset-4 hover:underline"
												>
													{r.name}
												</Link>
												<span className="block font-mono text-xs text-muted-foreground">
													{r.catalog_id}
												</span>
											</TableCell>
											<TableCell className="hidden max-w-56 whitespace-normal lg:table-cell">
												{r.category_path ?? "Tanpa kategori"}
											</TableCell>
											<TableCell>{kinds(r)}</TableCell>
											{!uniformPrice && (
												<TableCell className="text-right tabular-nums">
													{rupiah(r.price_idr)}
												</TableCell>
											)}
											<TableCell>{stock(r)}</TableCell>
											<TableCell className="max-w-56 whitespace-normal">
												{status(r)}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						<ul className="flex flex-col divide-y rounded-md border md:hidden">
							{load.rows.map((r) => (
								<li
									key={r.id}
									data-testid={`catalog-card-${r.id}`}
									className="flex gap-3 p-3"
								>
									{thumb(r)}
									<div className="flex min-w-0 flex-1 flex-col gap-1.5">
										<Link
											href={detailHref(r.id)}
											className="inline-flex min-h-11 items-center font-medium text-primary underline-offset-4 hover:underline"
										>
											{r.name}
										</Link>
										<span className="text-xs text-muted-foreground">
											{r.category_path ?? "Tanpa kategori"}
										</span>
										<div className="flex flex-wrap items-center gap-1.5">
											{kinds(r)}
											{stock(r)}
										</div>
										{status(r)}
									</div>
								</li>
							))}
						</ul>
						{(page > 1 || load.next) && (
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
										load.next &&
										setCursors((prev) => [...prev, load.next as string])
									}
								>
									Berikutnya
								</Button>
							</nav>
						)}
					</>
				)}
			</section>
		</div>
	);
}

const selectClass = cn(
	"h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none",
	"focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
);
