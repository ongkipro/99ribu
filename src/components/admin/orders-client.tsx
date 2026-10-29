"use client";

import { CircleAlert, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { type ApiFailure, failureText, getJson } from "./admin-errors";
import { DataTable } from "./data-table";
import { formatWib, rupiah } from "./format";
import { FilterSheet, FormField, nativeSelectClass, SegmentedControl } from "./form";
import {
	FULFILLMENT_STATUS,
	HISTORY_KIND,
	historyStatus,
	ORDER_FILTER_KEYS,
	ORDER_FILTERS,
	ORDER_STATUS,
	ORDER_TONE,
	type OrderFilterKey,
	type OrderFilters,
	paymentLabel,
	paymentText,
	paymentTone,
	SHIPMENT_STATUS,
	SHIPMENT_TONE,
	searchQuery,
	TRACKING_STATUS,
} from "./order-model";
import { StatusBadge } from "./status";
import { AdminPage, DetailSection, PageHeader } from "./page-blocks";
import { adminPath } from "@/modules/access/admin-paths";

export type SearchKind = "nomor" | "resi" | "hp";
type Summary = {
	id: string;
	/** Short admin handle: the order opens at `/admin/orders/{admin_no}`. */
	admin_no: number;
	number: string;
	status: string;
	payment_status: string;
	payment_method: "prepaid" | "cod";
	buyer_total: number;
	created_at: string;
};
type Page<T> = { data: T[]; pagination: { next_cursor: string | null } };

const selectClass = `${nativeSelectClass} w-full`;
// Tabs follow the fulfillment axis (where the parcels are); the other axes are selects.
const FULFILLMENT_TABS = [["", "Semua"], ...Object.entries(FULFILLMENT_STATUS)] as const;
const SELECT_FILTERS = ORDER_FILTER_KEYS.filter((key) => key !== "kirim");
const KIND_LABELS: Record<SearchKind, { label: string; hint: string; placeholder: string }> = {
	nomor: {
		label: "Nomor pesanan",
		hint: "Nomor lengkap, contoh 99-1A2B3C4D5E6F7G8H. Huruf kecil diterima.",
		placeholder: "99-…",
	},
	resi: {
		label: "Nomor resi",
		hint: "Resi persis seperti di dasbor Mengantar; spasi diabaikan. Resi lama yang sudah dikoreksi tetap ditemukan.",
		placeholder: "JP1234567890",
	},
	hp: {
		label: "Akhiran nomor HP",
		hint: "6–8 digit terakhir nomor HP pembeli atau penerima. Nomor HP tidak ditampilkan di hasil dan tidak disimpan di alamat halaman.",
		placeholder: "345678",
	},
};

/** Client checks only mirror the API; the server is the authority. */
function validate(kind: SearchKind, term: string): string | null {
	if (!term) return null;
	if (kind === "hp" && !/^\d{6,8}$/.test(term)) return "Isi 6–8 digit angka saja.";
	if (kind === "nomor" && !/^99-[A-Za-z0-9]{16}$/.test(term))
		return "Nomor pesanan diawali 99- lalu 16 huruf atau angka.";
	if (kind === "resi" && !/^[A-Za-z0-9][A-Za-z0-9-]{7,39}$/.test(term.replace(/\s+/g, "")))
		return "Nomor resi 8–40 huruf, angka atau tanda hubung.";
	return null;
}
function failureMessage(failure: ApiFailure) {
	if (failure.status === 429)
		return "Terlalu banyak pencarian dalam satu menit. Tunggu sebentar lalu coba lagi.";
	if (failure.status === 403)
		return "Peran Anda tidak memiliki izin membaca riwayat pesanan, atau verifikasi dua langkah belum aktif.";
	return failureText(failure);
}

export function OrderSearchClient({
	initialKind,
	initialTerm,
	initialFilters,
	companyWide,
}: {
	initialKind: SearchKind;
	initialTerm: string;
	initialFilters: OrderFilters;
	companyWide: boolean;
}) {
	const router = useRouter();
	const [kind, setKind] = useState<SearchKind>(initialKind);
	const [term, setTerm] = useState(initialTerm);
	const [applied, setApplied] = useState({ kind: initialKind, term: initialTerm.trim() });
	const [filters, setFilters] = useState<OrderFilters>(initialFilters);
	const [fieldError, setFieldError] = useState<string | null>(null);
	const [rows, setRows] = useState<Summary[]>([]);
	const [cursor, setCursor] = useState<string | null>(null);
	const [state, setState] = useState<"loading" | "ready" | "error" | "denied">("loading");
	const [error, setError] = useState("");
	const [more, setMore] = useState(false);
	const [moreError, setMoreError] = useState<string | null>(null);

	const query = useCallback(
		(next: string | null) => {
			const params = new URLSearchParams({ limit: "20" });
			if (applied.term)
				params.set(
					applied.kind === "hp" ? "phone_suffix" : "reference",
					applied.kind === "resi" ? applied.term.replace(/\s+/g, "") : applied.term,
				);
			for (const key of ORDER_FILTER_KEYS) {
				const value = filters[key];
				if (value) params.set(ORDER_FILTERS[key].api, value);
			}
			if (next) params.set("cursor", next);
			return getJson<Page<Summary>>(`/api/v1/admin/orders?${params}`);
		},
		[applied, filters],
	);
	const load = useCallback(async () => {
		setMoreError(null);
		if (validate(applied.kind, applied.term)) {
			setRows([]);
			setCursor(null);
			setState("ready");
			return;
		}
		setState("loading");
		const result = await query(null);
		if (result.ok) {
			setRows(result.data.data);
			setCursor(result.data.pagination.next_cursor);
			setState("ready");
		} else {
			setError(failureMessage(result.failure));
			setState(result.failure.status === 403 ? "denied" : "error");
		}
	}, [applied, query]);
	useEffect(() => {
		void load();
	}, [load]);

	// A failed next page keeps the rows already shown and says so under them.
	const loadMore = async () => {
		if (!cursor) return;
		setMore(true);
		setMoreError(null);
		const result = await query(cursor);
		setMore(false);
		if (!result.ok) {
			setMoreError(`Pesanan berikutnya gagal dimuat. ${failureMessage(result.failure)}`);
			return;
		}
		setRows((current) => [...current, ...result.data.data]);
		setCursor(result.data.pagination.next_cursor);
	};
	const navigate = (nextKind: SearchKind, nextTerm: string, nextFilters: OrderFilters) => {
		const params = searchQuery(nextKind, nextTerm, nextFilters);
		router.replace(`/admin/orders${params.size ? `?${params}` : ""}`, { scroll: false });
	};
	const submit = (nextKind: SearchKind, nextTerm: string) => {
		const clean = nextTerm.trim();
		const problem = validate(nextKind, clean);
		setFieldError(problem);
		if (problem) return;
		setApplied({ kind: nextKind, term: clean });
		navigate(nextKind, clean, filters);
	};
	const setFilter = (key: OrderFilterKey, value: string) => {
		const next = { ...filters, [key]: value || undefined };
		setFilters(next);
		navigate(applied.kind, applied.term, next);
	};
	const active = SELECT_FILTERS.filter((key) => filters[key]);
	const filtered = ORDER_FILTER_KEYS.some((key) => filters[key]);
	const clearFilters = () => {
		setFilters({});
		navigate(applied.kind, applied.term, {});
	};
	const back = searchQuery(applied.kind, applied.term, filters).toString();
	const label = KIND_LABELS[kind];
	const hintId = fieldError ? "order-search-error" : "order-search-hint";
	return (
		<AdminPage>
			<PageHeader
				title="Pesanan"
				description={
					<>
						Cari pesanan dengan nomor pesanan, nomor resi atau akhiran nomor HP, lalu
						buka detail pembayaran, pengiriman dan riwayatnya.{" "}
						{companyWide
							? "Super Admin melihat pesanan semua gudang."
							: "Anda hanya melihat pesanan yang semua paketnya berasal dari gudang yang ditugaskan ke akun Anda."}
					</>
				}
			/>
			<search aria-label="Cari pesanan">
			<form
				noValidate
				className="grid gap-3 md:grid-cols-[14rem_minmax(0,28rem)_auto] md:items-start"
				onSubmit={(e) => {
					e.preventDefault();
					submit(kind, term);
				}}
			>
				<div className="flex flex-col gap-1.5">
					<label htmlFor="order-search-kind" className="text-sm font-medium">
						Cari berdasarkan
					</label>
					<select
						id="order-search-kind"
						className={selectClass}
						value={kind}
						onChange={(e) => {
							setKind(e.target.value as SearchKind);
							setFieldError(null);
						}}
					>
						{(Object.keys(KIND_LABELS) as SearchKind[]).map((k) => (
							<option key={k} value={k}>
								{KIND_LABELS[k].label}
							</option>
						))}
					</select>
				</div>
				<div className="flex flex-col gap-1.5">
					<label htmlFor="order-search-term" className="text-sm font-medium">
						{label.label}
					</label>
					<Input
						id="order-search-term"
						value={term}
						maxLength={100}
						autoComplete="off"
						inputMode={kind === "hp" ? "numeric" : "text"}
						placeholder={label.placeholder}
						onChange={(e) => setTerm(e.target.value)}
						aria-invalid={fieldError ? true : undefined}
						aria-describedby={hintId}
					/>
					{fieldError ? (
						<p id="order-search-error" role="alert" className="text-sm text-destructive">
							{fieldError}
						</p>
					) : (
						<p id="order-search-hint" className="text-xs text-muted-foreground">
							{label.hint}
						</p>
					)}
				</div>
				<div className="flex gap-2 md:pt-6 max-md:*:flex-1">
					<Button type="submit">
						<Search aria-hidden="true" />
						Cari
					</Button>
					{applied.term && (
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setTerm("");
								submit(kind, "");
							}}
						>
							Hapus pencarian
						</Button>
					)}
				</div>
			</form>
			</search>

			<section aria-labelledby="orders-result-heading" className="flex flex-col gap-3">
				<h2 id="orders-result-heading" className="text-base font-semibold">
					{applied.term
						? `Hasil untuk ${KIND_LABELS[applied.kind].label.toLowerCase()} ${applied.kind === "hp" ? `…${applied.term}` : applied.term}`
						: "Pesanan terbaru"}
				</h2>
				<SegmentedControl
					legend="Tahap pengiriman"
					value={filters.kirim ?? ""}
					options={FULFILLMENT_TABS}
					onChange={(value) => setFilter("kirim", value)}
					testId={(key) => `orders-tab-${key || "all"}`}
				/>
				<div className="grid gap-3 md:grid-cols-3 md:max-w-3xl">
					<FilterSheet active={active.length}>
						{SELECT_FILTERS.map((key) => (
							<FormField key={key} id={`orders-filter-${key}`} label={ORDER_FILTERS[key].label}>
								<select
									id={`orders-filter-${key}`}
									className={selectClass}
									value={filters[key] ?? ""}
									onChange={(e) => setFilter(key, e.target.value)}
								>
									<option value="">Semua</option>
									{Object.entries(ORDER_FILTERS[key].options).map(([value, text]) => (
										<option key={value} value={value}>
											{text}
										</option>
									))}
								</select>
							</FormField>
						))}
					</FilterSheet>
				</div>
				{active.length > 0 && (
					<ul aria-label="Filter aktif" className="flex flex-wrap items-center gap-2" data-testid="orders-active-filters">
						{active.map((key) => (
							<li key={key}>
								<Button
									type="button"
									variant="outline"
									size="sm"
									aria-label={`Hapus filter ${ORDER_FILTERS[key].label.toLowerCase()}: ${ORDER_FILTERS[key].options[filters[key] ?? ""]}`}
									onClick={() => setFilter(key, "")}
								>
									{ORDER_FILTERS[key].label}: {ORDER_FILTERS[key].options[filters[key] ?? ""]}
									<X data-icon="inline-end" aria-hidden="true" />
								</Button>
							</li>
						))}
						<li>
							<Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
								Hapus semua filter
							</Button>
						</li>
					</ul>
				)}
				<DataTable
					rows={rows}
					rowKey={(row) => row.id}
					status={
						state === "loading"
							? { kind: "loading" }
							: state === "error"
								? { kind: "error", message: error, onRetry: () => void load() }
								: state === "denied"
									? { kind: "denied", message: error }
									: { kind: "ready" }
					}
					loadingLabel="Memuat pesanan…"
					emptyTestId="orders-empty"
					empty={
						applied.term ? (
							"Tidak ada pesanan yang cocok dalam cakupan Anda. Periksa kembali isian atau ganti jenis pencarian."
						) : filtered ? (
							<>
								Tidak ada pesanan dengan filter ini dalam cakupan Anda.{" "}
								<Button type="button" variant="link" className="h-auto p-0" onClick={clearFilters}>
									Hapus semua filter
								</Button>
							</>
						) : (
							"Belum ada pesanan dalam cakupan Anda. Pesanan baru muncul di sini setelah pembeli membuat pesanan."
						)
					}
					testId="orders-table"
					caption="Daftar pesanan, terbaru di atas"
					rowTestId={() => "order-row"}
					stack
					columns={[
						{
							id: "number",
							header: "Nomor pesanan",
							stack: "title",
							// md–xl: the creation time moves under the number so the payment text never clips.
							cell: (row) => (
								<div className="flex flex-col items-start">
									<Link
										href={`${adminPath("order", row.admin_no)}${back ? `?dari=${encodeURIComponent(back)}` : ""}`}
										className="font-mono font-medium text-primary underline-offset-4 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
									>
										{row.number}
									</Link>
									<span className="hidden text-xs font-normal text-muted-foreground md:max-xl:block">
										{formatWib(row.created_at)}
									</span>
								</div>
							),
						},
						{
							id: "created",
							header: "Dibuat",
							stack: "meta",
							kind: "datetime",
							className: "md:max-xl:hidden",
							cell: (row) => formatWib(row.created_at),
						},
						{
							id: "status",
							header: "Status pesanan",
							stack: "status",
							cell: (row) => (
								<StatusBadge tone={ORDER_TONE[row.status] ?? "open"}>
									{ORDER_STATUS[row.status] ?? row.status}
								</StatusBadge>
							),
						},
						{
							// The method is plain text, the state a badge: a collected COD order never reads "Lunas".
							id: "payment",
							header: "Pembayaran",
							stack: "status",
							cell: (row) => (
								<span className="inline-flex flex-wrap items-center gap-1.5">
									<span className="text-xs text-muted-foreground">
										{row.payment_method === "cod" ? "COD" : "Prabayar"}
									</span>
									<StatusBadge tone={paymentTone(row.payment_method, row.payment_status)}>
										{paymentLabel(row.payment_method, row.payment_status)}
									</StatusBadge>
								</span>
							),
						},
						{
							// Before the COD fee or transfer code; the detail page shows both totals.
							id: "total",
							header: "Total pesanan",
							stack: "aside",
							className: "text-right tabular-nums",
							cell: (row) => rupiah(row.buyer_total),
						},
					]}
					paging={{
						hasMore: cursor !== null,
						loading: more,
						onMore: () => void loadMore(),
						error: moreError,
						summary: `${rows.length} pesanan ditampilkan`,
					}}
				/>
			</section>
		</AdminPage>
	);
}

type OrderItem = {
	id: string;
	name: string;
	variant_label: string;
	quantity: number;
	unit_price: number;
	subtotal: number;
	cancelled_quantity: number;
	received_quantity: number;
	returned_quantity: number;
	refunded_quantity: number;
};
/** "2 diterima, 1 diretur"; empty when nothing happened to the item after ordering. */
const itemNotes = (item: OrderItem) =>
	[
		item.received_quantity && `${item.received_quantity} diterima`,
		item.cancelled_quantity && `${item.cancelled_quantity} dibatalkan`,
		item.returned_quantity && `${item.returned_quantity} diretur`,
		item.refunded_quantity && `${item.refunded_quantity} dana kembali`,
	]
		.filter(Boolean)
		.join(", ");
type Shipment = {
	id: string;
	kind: "original" | "replacement";
	origin_city: string;
	status: string;
	courier_name: string;
	service_name: string;
	tracking_number?: string;
	waybill_issued_at?: string;
	tracking_status?: string;
	delivered_at?: string;
	buyer_shipping_amount: number;
	cod_collect_amount?: number;
	cod_fee_amount?: number;
	items: { order_item_id: string; cancelled: boolean }[];
};
type Order = {
	id: string;
	number: string;
	status: string;
	payment_status: string;
	payment_method: "prepaid" | "cod";
	payment_channel: string;
	payment_channel_label: string;
	payment_charge_total: number;
	cod_fee_bps?: number;
	created_at: string;
	merchandise_total: number;
	shipping_total: number;
	subsidy_total: number;
	buyer_total: number;
	amount_due: number;
	refund_total: number;
	pending_refund_total: number;
	items: OrderItem[];
	shipments: Shipment[];
};
type HistoryEvent = {
	id: string;
	kind: string;
	occurred_at: string;
	recorded_at: string | null;
	status: string;
	/** Parcel of a fulfillment event; null for order-level events. */
	shipment_id?: string | null;
};
type Detail = {
	order: Order;
	history: HistoryEvent[];
	history_pagination: { next_cursor: string | null };
	as_of: string;
};

const percent = (bps: number) =>
	`${(bps / 100).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

function Money({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
	return (
		<div className={`flex justify-between gap-4 ${strong ? "border-t pt-2 font-semibold" : ""}`}>
			<dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
			<dd className="tabular-nums">{value}</dd>
		</div>
	);
}

export function OrderDetailClient({
	orderId,
	backHref,
}: {
	orderId: string;
	backHref: string;
}) {
	const [detail, setDetail] = useState<Detail | null>(null);
	const [failure, setFailure] = useState<ApiFailure | null>(null);
	const [history, setHistory] = useState<HistoryEvent[]>([]);
	const [historyCursor, setHistoryCursor] = useState<string | null>(null);
	const [historyState, setHistoryState] = useState<"idle" | "loading" | "error">("idle");

	const load = useCallback(async () => {
		setFailure(null);
		setDetail(null);
		const result = await getJson<Detail>(
			`/api/v1/admin/orders/${encodeURIComponent(orderId)}?history_limit=50`,
		);
		if (!result.ok) {
			setFailure(result.failure);
			return;
		}
		setDetail(result.data);
		setHistory(result.data.history);
		setHistoryCursor(result.data.history_pagination.next_cursor);
	}, [orderId]);
	useEffect(() => {
		void load();
	}, [load]);

	const olderHistory = async () => {
		if (!historyCursor) return;
		setHistoryState("loading");
		const params = new URLSearchParams({ history_limit: "50", history_cursor: historyCursor });
		const result = await getJson<Detail>(
			`/api/v1/admin/orders/${encodeURIComponent(orderId)}?${params}`,
		);
		if (!result.ok) {
			setHistoryState("error");
			return;
		}
		setHistory((current) => [...current, ...result.data.history]);
		setHistoryCursor(result.data.history_pagination.next_cursor);
		setHistoryState("idle");
	};

	const back = { href: backHref, label: "Kembali ke pencarian pesanan" };

	if (failure)
		return (
			<AdminPage>
				<PageHeader back={back} title="Detail pesanan" />
				<Alert role="alert" data-testid="order-detail-error">
					<CircleAlert aria-hidden="true" />
					<AlertDescription className="flex flex-wrap items-center gap-3 text-foreground">
						{failure.status === 404 || failure.code === "INVALID_INPUT"
							? "Pesanan tidak ditemukan atau berada di luar gudang yang ditugaskan ke akun Anda."
							: failureMessage(failure)}
						{failure.status !== 404 && failure.status !== 403 && (
							<Button size="sm" variant="outline" onClick={() => void load()}>
								Coba lagi
							</Button>
						)}
					</AlertDescription>
				</Alert>
			</AdminPage>
		);
	if (!detail)
		return (
			<AdminPage>
				<PageHeader back={back} title="Detail pesanan" />
				{/* Same shape as the loaded page: payment first on phones, the right column from lg. */}
				<div className="flex flex-col gap-3" aria-live="polite" aria-busy="true">
					<p className="text-sm text-muted-foreground">Memuat detail pesanan…</p>
					<div aria-hidden="true" className="grid gap-5 md:gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
						<div className="flex flex-col gap-3 rounded-lg border p-4 lg:col-start-2 lg:row-start-1">
							<Skeleton className="h-5 w-28 bg-border/70" />
							{[0, 1, 2, 3].map((i) => (
								<Skeleton key={i} className="h-4 w-full bg-border/70" />
							))}
						</div>
						<div className="flex flex-col gap-5 md:gap-6 lg:col-start-1 lg:row-start-1">
							{["items", "shipments", "history"].map((section) => (
								<div key={section} className="flex flex-col gap-3 rounded-lg border p-4">
									<Skeleton className="h-5 w-32 bg-border/70" />
									<Skeleton className="h-12 w-full bg-border/70" />
								</div>
							))}
						</div>
					</div>
				</div>
			</AdminPage>
		);

	const o = detail.order;
	const cod = o.payment_method === "cod";
	const manualBank = o.payment_channel === "manual-bank";
	const itemName = new Map(o.items.map((i) => [i.id, `${i.name} · ${i.variant_label}`]));
	// A revision that keeps its status (e.g. payment confirmed while the order is still "Menunggu",
	// a parcel re-queued as "Siap dikemas" or "Dikemas") would repeat the same line: show each
	// subject's status only the first time it entered it, adjacent or not (history is newest first,
	// so the oldest occurrence is the one kept; the line has no other detail).
	const firstSeen = new Set<string>();
	const timeline = [...history]
		.reverse()
		.filter((e) => {
			const key = `${e.kind}\u0000${e.status}\u0000${e.shipment_id ?? ""}`;
			if (firstSeen.has(key)) return false;
			firstSeen.add(key);
			return true;
		})
		.reverse();
	// "Paket 1/2" in the shipment cards and the history, so per-parcel events read as distinct.
	const originals = o.shipments.filter((s) => s.kind !== "replacement");
	const parcelLabel = (s: Shipment) =>
		s.kind === "replacement"
			? "Paket pengganti"
			: originals.length > 1
				? `Paket ${originals.indexOf(s) + 1}/${originals.length}`
				: "Paket";
	const parcelById = new Map(o.shipments.map((s) => [s.id, parcelLabel(s)]));

	return (
		<AdminPage>
			<PageHeader
				back={back}
				mono
				title={o.number}
				meta={
					<>
						<StatusBadge tone={ORDER_TONE[o.status] ?? "open"}>{ORDER_STATUS[o.status] ?? o.status}</StatusBadge>
						<StatusBadge tone={paymentTone(o.payment_method, o.payment_status)}>
							{paymentText(o.payment_method, o.payment_status)}
						</StatusBadge>
						<span className="text-sm">Dibuat {formatWib(o.created_at)}</span>
						<span className="basis-full">
							Data per {formatWib(detail.as_of)}. Kontak dan alamat pembeli tidak ditampilkan di riwayat pesanan.
						</span>
					</>
				}
			/>

			{/* Key facts first: on phones the payment summary leads; from lg it is the right column. */}
			<div className="grid gap-5 md:gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
				<DetailSection id="order-payment-heading" title="Pembayaran" className="lg:col-start-2 lg:row-start-1">
					<dl className="flex flex-col gap-1.5 text-sm" data-testid="order-payment">
						<div className="flex justify-between gap-4">
							<dt className="text-muted-foreground">Metode</dt>
							<dd className="text-right">{o.payment_channel_label}</dd>
						</div>
						<div className="flex justify-between gap-4">
							<dt className="text-muted-foreground">Status</dt>
							<dd className="text-right">{paymentLabel(o.payment_method, o.payment_status)}</dd>
						</div>
						<Money label="Barang" value={rupiah(o.merchandise_total)} />
						<Money label="Ongkos kirim" value={rupiah(o.shipping_total)} />
						{o.subsidy_total > 0 && <Money label="Subsidi ongkir" value={`−${rupiah(o.subsidy_total)}`} />}
						{/* The orders list shows this total; the fee or transfer code below makes the amount due. */}
						{o.payment_charge_total > 0 && <Money label="Total pesanan" value={rupiah(o.buyer_total)} />}
						{cod && o.payment_charge_total > 0 && (
							<Money label={`Biaya COD (${percent(o.cod_fee_bps ?? 0)})`} value={rupiah(o.payment_charge_total)} />
						)}
						{manualBank && <Money label="Kode unik transfer" value={rupiah(o.payment_charge_total)} />}
						<Money label={cod ? "Total ditagih kurir" : "Total dibayar"} value={rupiah(o.amount_due)} strong />
						{(o.refund_total > 0 || o.pending_refund_total > 0) && (
							<>
								<Money label="Dana dikembalikan" value={rupiah(o.refund_total)} />
								{o.pending_refund_total > 0 && (
									<Money label="Pengembalian diproses" value={rupiah(o.pending_refund_total)} />
								)}
							</>
						)}
					</dl>
				</DetailSection>

				<div className="flex min-w-0 flex-col gap-5 md:gap-6 lg:col-start-1 lg:row-start-1">
					<DetailSection id="order-items-heading" title="Barang">
						<DataTable
							rows={o.items}
							rowKey={(item) => item.id}
							status={{ kind: "ready" }}
							loadingLabel="Memuat barang…"
							empty="Pesanan ini tidak memiliki barang."
							testId="order-items"
							caption="Barang dalam pesanan"
							stack
							columns={[
								{
									id: "product",
									header: "Produk",
									stack: "title",
									cellClassName: "min-w-48 whitespace-normal max-md:block",
									cell: (item) => (
										<>
											<span className="block font-medium">{item.name}</span>
											<span className="text-xs font-normal text-muted-foreground">{item.variant_label}</span>
										</>
									),
								},
								{ id: "qty", header: "Jumlah", className: "text-right tabular-nums", cell: (item) => item.quantity },
								{ id: "subtotal", header: "Subtotal", stack: "aside", className: "text-right tabular-nums", cell: (item) => rupiah(item.subtotal) },
								// Shown only when some item has a note (no column of dashes).
								...(o.items.some((item) => itemNotes(item))
									? [
											{
												id: "notes",
												header: "Keterangan",
												cellClassName: "text-sm text-muted-foreground",
												cell: (item: OrderItem) => itemNotes(item) || "—",
											},
										]
									: []),
							]}
						/>
					</DetailSection>

					<DetailSection id="order-shipments-heading" title="Pengiriman">
						<ul className="flex flex-col gap-3" data-testid="order-shipments">
							{o.shipments.map((s) => (
								<li key={s.id} className="flex flex-col gap-2 rounded-md border p-3">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<p className="font-medium">
											{parcelLabel(s)} · dari {s.origin_city}
										</p>
										<StatusBadge tone={SHIPMENT_TONE[s.status] ?? "open"}>
											{SHIPMENT_STATUS[s.status] ?? s.status}
										</StatusBadge>
									</div>
									<dl className="grid gap-1.5 text-sm sm:grid-cols-2">
										<div>
											<dt className="text-muted-foreground">Kurir</dt>
											<dd>
												{s.courier_name} · {s.service_name}
											</dd>
										</div>
										<div>
											<dt className="text-muted-foreground">Resi</dt>
											<dd className="font-mono break-all" data-testid="shipment-resi">
												{s.tracking_number ?? "Belum terbit"}
											</dd>
										</div>
										<div>
											<dt className="text-muted-foreground">Pelacakan</dt>
											<dd>
												{s.tracking_status
													? TRACKING_STATUS[s.tracking_status] ?? s.tracking_status
													: s.tracking_number
														? "Menunggu pembaruan kurir"
														: "—"}
											</dd>
										</div>
										{/* One time per state: no "Resi terbit: —" beside "Resi: Belum terbit". */}
										{(s.delivered_at || s.waybill_issued_at) && (
											<div>
												<dt className="text-muted-foreground">
													{s.delivered_at ? "Diterima" : "Resi terbit"}
												</dt>
												<dd>{formatWib(s.delivered_at ?? s.waybill_issued_at)}</dd>
											</div>
										)}
										{cod && s.cod_collect_amount !== undefined && (
											<div>
												<dt className="text-muted-foreground">Tagihan COD paket</dt>
												<dd className="tabular-nums">
													{rupiah(s.cod_collect_amount)}
													{s.cod_fee_amount ? ` (biaya COD ${rupiah(s.cod_fee_amount)})` : ""}
												</dd>
											</div>
										)}
										<div className="sm:col-span-2">
											<dt className="text-muted-foreground">Isi</dt>
											<dd>
												{[...new Set(s.items.map((i) => i.order_item_id))]
													.map((id) => {
														const count = s.items.filter((i) => i.order_item_id === id && !i.cancelled).length;
														return `${count}× ${itemName.get(id) ?? "Barang"}`;
													})
													.join("; ")}
											</dd>
										</div>
									</dl>
								</li>
							))}
						</ul>
					</DetailSection>

					<DetailSection id="order-history-heading" title="Riwayat">
						{timeline.length === 0 ? (
							<p className="text-sm text-muted-foreground">Belum ada riwayat.</p>
						) : (
							<ol className="flex flex-col gap-2 border-l pl-4" data-testid="order-history">
								{timeline.map((event) => (
									<li key={`${event.kind}:${event.id}`} className="flex flex-col">
										<span className="text-sm font-medium">
											{HISTORY_KIND[event.kind] ?? event.kind}
											{event.shipment_id && parcelById.has(event.shipment_id) && o.shipments.length > 1
												? ` ${parcelById.get(event.shipment_id)?.toLowerCase()}`
												: ""}
											: {historyStatus(event.kind, event.status)}
										</span>
										<span className="text-xs text-muted-foreground">
											{formatWib(event.occurred_at)}
										</span>
									</li>
								))}
							</ol>
						)}
						{historyCursor && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="self-start"
								disabled={historyState === "loading"}
								onClick={() => void olderHistory()}
							>
								{historyState === "loading" ? "Memuat…" : "Muat riwayat lebih lama"}
							</Button>
						)}
						{historyState === "error" && (
							<p role="alert" className="text-sm text-destructive">
								Riwayat lebih lama gagal dimuat. Coba lagi.
							</p>
						)}
					</DetailSection>
				</div>
			</div>
		</AdminPage>
	);
}
