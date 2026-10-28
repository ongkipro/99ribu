"use client";

import { cn } from "cn";
import { CircleAlert, Download, Info, Printer, X } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useIsMobile } from "@/components/ui/use-mobile";
import { rupiah, wibDateTime } from "@/modules/storefront/format";
import { describeFailure, failureText, readFailure } from "./admin-errors";
import type { ConsoleAccess } from "./console-access";
import { CardActions, CardMeta, CardStatus, CardTitle, DataTable } from "./data-table";
import { nativeSelectClass, SegmentedControl } from "./form";
import { KpiCard, KpiGrid } from "./kpi-card";
import { AdminPage, Disclosure, PageHeader } from "./page-blocks";
import { ErrorState, LoadingState } from "./states";
import { Deadline, StatusBadge } from "./status";
import { adminPath } from "@/modules/access/admin-paths";

export type CanonicalWorkspace =
	| "owner"
	| "ecommerce_admin"
	| "warehouse"
	| "customer_service"
	| "finance";
type QueueKey =
	| "orders"
	| "fulfillments"
	| "delivery_exceptions"
	| "returns"
	| "inventory"
	| "support"
	| "reconciliation";

interface DashboardMetric {
	key: string;
	count: number | null;
	basis: "snapshot" | "event_period";
	complete: boolean;
	queue_key: QueueKey;
	kind: "count" | "money";
	amount: number | null;
	currency: "IDR" | null;
	financial_basis:
		| "actual"
		| "estimated"
		| "mixed"
		| "unknown"
		| "not_applicable";
	definition: string;
	as_of: string;
	queue_filter_token: string;
	filter_version: number;
	filter_expires_at: string;
	/** Existing console screen where staff act on the number. */
	action_href?: string | null;
	breakdown?: { key: string; label: string; count: number }[] | null;
}

interface DashboardSnapshot {
	workspace: CanonicalWorkspace;
	warehouse_ids: string[];
	from: string;
	to: string;
	timezone: string;
	as_of: string;
	metrics: DashboardMetric[];
}

interface WorkQueueItem {
	id: string;
	resource_kind: string;
	state: string;
	due_at: string | null;
	due_at_kind: DueAtKind | null;
	warehouse_id: string | null;
	version: number;
	reference: string | null;
	order_id: string | null;
	/** `admin_no` of `order_id`: the console opens the order at `/admin/orders/{admin_no}`. */
	order_admin_no: number | null;
	/** Reconciliation rows: net settlement amount and feed. */
	amount_idr?: number | null;
	settlement_source?: "payment" | "cod" | null;
}

type DueAtKind =
	| "payment_deadline"
	| "packing_deadline"
	| "handover_deadline"
	| "created"
	| "occurred"
	| "updated";

const WORKSPACE_LABELS: Record<
	CanonicalWorkspace,
	{ title: string; subtitle: string }
> = {
	owner: {
		title: "Ruang Kerja Super Admin",
		subtitle: "Antrean lintas fungsi dan posisi keuangan.",
	},
	ecommerce_admin: {
		title: "Ruang Kerja Admin E-Commerce",
		subtitle: "Pesanan, pemenuhan gudang, kendala pengiriman, retur, dan stok.",
	},
	warehouse: {
		title: "Ruang Kerja Gudang",
		subtitle:
			"Paket di gudang Anda: kemas, cetak label, serah terima kurir, retur, dan stok.",
	},
	customer_service: {
		title: "Ruang Kerja Layanan Pelanggan",
		subtitle: "Percakapan pembeli, kendala pengiriman, dan pengajuan retur.",
	},
	finance: {
		title: "Ruang Kerja Keuangan",
		subtitle:
			"Rekonsiliasi pembayaran dan COD, pengembalian dana, dan komisi afiliasi.",
	},
};

// Each count is the exact filtered queue behind it (S103); the API's
// definition text says which states are left out.
const METRIC_LABELS: Record<string, string> = {
	orders_pending: "Pesanan aktif",
	orders_by_payment_method: "Pesanan per metode bayar",
	fulfillments_due: "Paket belum diserahkan",
	manual_booking_pending: "Perlu dipesan kurir",
	delivery_exceptions: "Kendala pengiriman terbuka",
	returns_pending: "Retur terbuka",
	stock_alerts: "Stok rendah",
	support_unassigned: "Percakapan belum diklaim",
	finance_unmatched: "Mutasi belum cocok",
	transfers_near_deadline: "Transfer mendekati batas",
	autolaris_pending: "AutoLaris menunggu bayar",
	cod_receivable: "COD belum disetor",
	cod_remitted: "COD sudah disetor",
	refund_liability: "Kewajiban pengembalian dana",
	affiliate_liability: "Kewajiban komisi afiliasi",
	estimated_contribution: "Estimasi kontribusi margin",
	realized_contribution: "Kontribusi margin terealisasi",
	net_merchandise_revenue: "Pendapatan bersih barang",
};

const METRIC_UNITS: Record<string, string> = {
	orders_pending: "pesanan",
	fulfillments_due: "paket",
	delivery_exceptions: "kasus",
	returns_pending: "retur",
	stock_alerts: "SKU",
	support_unassigned: "percakapan",
	finance_unmatched: "mutasi",
	orders_by_payment_method: "pesanan",
	manual_booking_pending: "paket",
	transfers_near_deadline: "transfer",
	autolaris_pending: "pesanan",
};

const EXPORT_DENIED =
	"Ekspor CSV memerlukan izin unduh ekspor. Minta Super Admin menambahkan izin ini.";
// Screens the API may point a metric at (existing console routes only).
const ACTION_LABELS: Record<string, string> = {
	"/admin/fulfillment": "Buka Pengiriman Manual",
	"/admin/payments": "Buka Pembayaran",
	"/admin/cod-settlements": "Buka Setoran COD",
	"/admin/support": "Buka Kotak Masuk",
};
// Phones show the first rows of the dashboard queue; "Lihat semua" opens the full queue page.
const PHONE_QUEUE_ROWS = 5;
// Low stock per warehouse shows the largest few; payment methods show all.
const BREAKDOWN_SHOWN = 3;
// Counts that are work someone must clear; a non-zero one leads the grid in the warning tone.
// The others (all active orders, the payment-method split) are context, not a to-do.
const ACTION_METRICS = new Set([
	"fulfillments_due",
	"manual_booking_pending",
	"delivery_exceptions",
	"returns_pending",
	"stock_alerts",
	"support_unassigned",
	"finance_unmatched",
	"transfers_near_deadline",
	"autolaris_pending",
]);
const kpiTone = (m: DashboardMetric) =>
	!m.complete ? "neutral" : (m.count ?? 0) === 0 ? "idle" : ACTION_METRICS.has(m.key) ? "attention" : "neutral";
const TONE_RANK = { attention: 0, neutral: 1, idle: 2 } as const;
// Deadlines a row can miss; creation/update times are never "late".
const DEADLINE_KINDS = new Set<DueAtKind>(["payment_deadline", "packing_deadline", "handover_deadline"]);
const SETTLEMENT_SOURCE_LABELS = { payment: "Pembayaran", cod: "Setoran COD" } as const;

const BASIS_LABELS: Record<DashboardMetric["financial_basis"], string> = {
	actual: "Aktual",
	estimated: "Estimasi",
	mixed: "Aktual + estimasi",
	unknown: "Belum diketahui",
	not_applicable: "",
};

const QUEUE_LABELS: Record<QueueKey, string> = {
	orders: "Pesanan",
	fulfillments: "Pemenuhan gudang",
	delivery_exceptions: "Kendala pengiriman",
	returns: "Retur",
	inventory: "Stok",
	support: "Percakapan",
	reconciliation: "Rekonsiliasi",
};

// Column heading per queue; each row's `due_at_kind` names its own time when
// it differs. Orders mix payment deadlines and creation times, so their heading is neutral.
const TIME_LABELS: Record<QueueKey, string | null> = {
	orders: "Waktu",
	// Fulfillment rows carry packing deadlines and creation times: a neutral heading, like orders.
	fulfillments: "Waktu",
	delivery_exceptions: "Waktu kejadian",
	returns: "Dibuat",
	inventory: null,
	support: "Diperbarui",
	reconciliation: "Dibuat",
};

const DUE_AT_KIND_LABELS: Record<DueAtKind, string> = {
	payment_deadline: "Batas bayar",
	packing_deadline: "Batas kemas",
	handover_deadline: "Batas serah kurir",
	created: "Dibuat",
	occurred: "Waktu kejadian",
	updated: "Diperbarui",
};

const WINDOW_LABELS: Record<string, string> = {
	"7d": "7 hari terakhir",
	"30d": "30 hari terakhir",
	"90d": "90 hari terakhir",
};

const KIND_LABELS: Record<string, string> = {
	order: "Pesanan",
	fulfillment: "Pemenuhan",
	shipment: "Kendala kirim",
	return: "Retur",
	stock_item: "Stok",
	conversation: "Percakapan",
	reconciliation: "Mutasi",
};

// Tones of StatusBadge (status.tsx); "closed" is terminal without success.
type Tone = "open" | "problem" | "done" | "closed";

// [label, tone] per state; per-kind entries override the shared ones.
const SHARED_STATES: Record<string, [string, Tone]> = {
	preparing: ["Disiapkan", "open"],
	pending: ["Menunggu", "open"],
	exception: ["Bermasalah", "problem"],
	unknown: ["Status tidak diketahui", "problem"],
	resolved: ["Selesai", "done"],
	refunding: ["Pengembalian dana berjalan", "open"],
};
const KIND_STATES: Record<string, Record<string, [string, Tone]>> = {
	order: {
		processing: ["Diproses", "open"],
		partially_completed: ["Selesai sebagian", "open"],
		cancelled: ["Dibatalkan", "closed"],
	},
	fulfillment: {
		ready: ["Siap diambil", "open"],
		picking: ["Diambil dari rak", "open"],
		packed: ["Dikemas", "open"],
		handover_pending: ["Menunggu serah terima", "open"],
		handed_over: ["Diserahkan ke kurir", "done"],
	},
	shipment: {
		open: ["Terbuka", "problem"],
		awaiting_source: ["Menunggu data sumber", "open"],
		awaiting_buyer: ["Menunggu pembeli", "open"],
		awaiting_stock: ["Menunggu stok", "open"],
		awaiting_return: ["Menunggu barang kembali", "open"],
		ready_for_refund: ["Siap dikembalikan dananya", "open"],
		escalated: ["Dieskalasi", "problem"],
	},
	return: {
		requested: ["Diajukan", "open"],
		reviewing: ["Ditinjau", "open"],
		approved: ["Disetujui", "open"],
		rejected: ["Ditolak", "closed"],
		awaiting_goods: ["Menunggu barang", "open"],
		inspecting: ["Diperiksa", "open"],
		replacing: ["Penggantian berjalan", "open"],
	},
	stock_item: {
		in_stock: ["Tersedia", "done"],
		low_stock: ["Stok rendah", "problem"],
		out_of_stock: ["Habis", "problem"],
	},
	conversation: {
		// Same words as the support inbox (StaffInboxView).
		unassigned: ["Belum diklaim", "problem"],
		open: ["Terbuka", "open"],
		waiting_customer: ["Menunggu pelanggan", "open"],
		closed: ["Ditutup", "done"],
	},
	reconciliation: {
		partial: ["Cocok sebagian", "open"],
		matched: ["Cocok", "done"],
		mismatched: ["Tidak cocok", "problem"],
	},
};

function describeState(kind: string, state: string): [string, Tone] {
	return KIND_STATES[kind]?.[state] ?? SHARED_STATES[state] ?? [state, "open"];
}

const WORKSPACE_DEFAULT_QUEUE: Record<CanonicalWorkspace, QueueKey> = {
	owner: "orders",
	ecommerce_admin: "orders",
	warehouse: "fulfillments",
	customer_service: "support",
	finance: "reconciliation",
};

const WORKSPACE_ALLOWED_QUEUES: Record<CanonicalWorkspace, QueueKey[]> = {
	owner: [
		"orders",
		"fulfillments",
		"delivery_exceptions",
		"returns",
		"inventory",
		"support",
		"reconciliation",
	],
	ecommerce_admin: [
		"orders",
		"fulfillments",
		"delivery_exceptions",
		"returns",
		"inventory",
	],
	warehouse: ["fulfillments", "delivery_exceptions", "returns", "inventory"],
	customer_service: ["orders", "delivery_exceptions", "returns", "support"],
	finance: ["reconciliation", "orders", "returns"],
};

const QUEUE_EXPORT_CONFIG: Partial<
	Record<QueueKey, { resource: string; columnSet: string }>
> = {
	orders: { resource: "orders", columnSet: "order_service" },
	fulfillments: { resource: "fulfillments", columnSet: "warehouse_operations" },
	inventory: { resource: "inventory", columnSet: "inventory_operations" },
	returns: { resource: "returns", columnSet: "return_service" },
	reconciliation: {
		resource: "reconciliation",
		columnSet: "finance_reconciliation",
	},
};

const PREVIEW_METRICS: Record<CanonicalWorkspace, DashboardMetric[]> = {
	owner: [
		{
			key: "orders_pending",
			count: 4,
			basis: "snapshot",
			complete: true,
			queue_key: "orders",
			kind: "count",
			amount: null,
			currency: null,
			financial_basis: "not_applicable",
			definition:
				"Pesanan aktif yang menunggu pembayaran atau alokasi pemenuhan gudang.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-owner-orders",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
		{
			key: "fulfillments_due",
			count: 3,
			basis: "snapshot",
			complete: true,
			queue_key: "fulfillments",
			kind: "count",
			amount: null,
			currency: null,
			financial_basis: "not_applicable",
			definition:
				"Paket gudang siap dikemas atau menunggu serah terima kurir terjadwal.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-owner-fulfillments",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
		{
			key: "net_merchandise_revenue",
			count: null,
			basis: "event_period",
			complete: true,
			queue_key: "reconciliation",
			kind: "money",
			amount: 1782000,
			currency: "IDR",
			financial_basis: "actual",
			definition:
				"Pendapatan bersih barang dagangan Rp99.000/unit setelah pengembalian dana selesai.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-owner-revenue",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
		{
			key: "realized_contribution",
			count: null,
			basis: "event_period",
			complete: true,
			queue_key: "reconciliation",
			kind: "money",
			amount: 486000,
			currency: "IDR",
			financial_basis: "actual",
			definition:
				"Kontribusi margin terealisasi dari pesanan dengan seluruh komponen biaya diketahui.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-owner-contribution",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
	],
	ecommerce_admin: [
		{
			key: "orders_pending",
			count: 4,
			basis: "snapshot",
			complete: true,
			queue_key: "orders",
			kind: "count",
			amount: null,
			currency: null,
			financial_basis: "not_applicable",
			definition:
				"Pesanan aktif yang menunggu verifikasi atau pemenuhan gudang.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-ecom-orders",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
		{
			key: "stock_alerts",
			count: 1,
			basis: "snapshot",
			complete: true,
			queue_key: "inventory",
			kind: "count",
			amount: null,
			currency: null,
			financial_basis: "not_applicable",
			definition:
				"SKU fisik yang mendekati ambang batas stok rendah atau memiliki stok karantina.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-ecom-inventory",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
	],
	warehouse: [
		{
			key: "fulfillments_due",
			count: 3,
			basis: "event_period",
			complete: true,
			queue_key: "fulfillments",
			kind: "count",
			amount: null,
			currency: null,
			financial_basis: "not_applicable",
			definition:
				"Pemenuhan gudang yang siap dikemas atau diserahkan ke kurir.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-warehouse-fulfillments",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
		{
			key: "stock_alerts",
			count: 1,
			basis: "snapshot",
			complete: true,
			queue_key: "inventory",
			kind: "count",
			amount: null,
			currency: null,
			financial_basis: "not_applicable",
			definition:
				"Saldo stok gudang yang mencapai batas stok rendah atau dikarantina.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-warehouse-inventory",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
	],
	customer_service: [
		{
			key: "support_unassigned",
			count: 2,
			basis: "snapshot",
			complete: true,
			queue_key: "support",
			kind: "count",
			amount: null,
			currency: null,
			financial_basis: "not_applicable",
			definition:
				"Percakapan bantuan pembeli yang menunggu penugasan staf layanan pelanggan.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-cs-support",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
		{
			key: "delivery_exceptions",
			count: 1,
			basis: "snapshot",
			complete: true,
			queue_key: "delivery_exceptions",
			kind: "count",
			amount: null,
			currency: null,
			financial_basis: "not_applicable",
			definition:
				"Paket dengan kendala kurir aktif yang membutuhkan konfirmasi alamat pembeli.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-cs-exceptions",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
	],
	finance: [
		{
			key: "finance_unmatched",
			count: 1,
			basis: "snapshot",
			complete: true,
			queue_key: "reconciliation",
			kind: "count",
			amount: null,
			currency: null,
			financial_basis: "not_applicable",
			definition:
				"Baris mutasi penyedia pembayaran atau laporan pencairan COD yang belum dicocokkan.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-finance-unmatched",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
		{
			key: "cod_receivable",
			count: null,
			basis: "snapshot",
			complete: true,
			queue_key: "reconciliation",
			kind: "money",
			amount: 215000,
			currency: "IDR",
			financial_basis: "actual",
			definition:
				"Piutang COD berjalan atas paket yang telah diserahkan ke kurir.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-finance-cod",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
			action_href: "/admin/cod-settlements",
		},
		{
			key: "cod_remitted",
			count: null,
			basis: "event_period",
			complete: true,
			queue_key: "reconciliation",
			kind: "money",
			amount: 432000,
			currency: "IDR",
			financial_basis: "actual",
			definition:
				"COD per paket pada laporan setoran Mengantar dalam periode, sebelum potongan ongkir dan biaya COD.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-finance-cod-remitted",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
			action_href: "/admin/cod-settlements",
		},
		{
			key: "affiliate_liability",
			count: null,
			basis: "snapshot",
			complete: true,
			queue_key: "reconciliation",
			kind: "money",
			amount: 99000,
			currency: "IDR",
			financial_basis: "actual",
			definition:
				"Kewajiban komisi mitra afiliasi siap cair dan dalam antrean transfer manual.",
			as_of: "2026-10-21T12:00:00.000Z",
			queue_filter_token: "preview-token-finance-affiliate",
			filter_version: 1,
			filter_expires_at: "2026-10-21T12:30:00.000Z",
		},
	],
};
/** Full metric definitions; cards show at most two lines (none below md). */
function Definitions({ metrics }: { metrics: DashboardMetric[] }) {
	if (metrics.length === 0) return null;
	return (
		<details className="text-xs text-muted-foreground">
			<summary className="cursor-pointer py-1.5 font-medium select-none pointer-coarse:py-3">
				Arti setiap angka
			</summary>
			<dl className="mt-2 grid gap-1.5">
				{metrics.map((m) => (
					<div key={m.key}>
						<dt className="inline font-medium text-foreground">
							{METRIC_LABELS[m.key] ?? m.key}:{" "}
						</dt>
						<dd className="inline">{m.definition}</dd>
					</div>
				))}
			</dl>
		</details>
	);
}

function normalizeWorkspaceParam(
	raw: string | null,
): CanonicalWorkspace | null {
	if (!raw) return null;
	const map: Record<string, CanonicalWorkspace> = {
		owner: "owner",
		ecommerce_admin: "ecommerce_admin",
		warehouse: "warehouse",
		warehouse_staff: "warehouse",
		customer_service: "customer_service",
		cs_staff: "customer_service",
		finance: "finance",
		finance_staff: "finance",
	};
	return map[raw] ?? null;
}

type LoadState = "loading" | "ready" | "error" | "preview" | "denied";
type Notice = { kind: "info" | "error"; message: string };
type ExportResult = {
	rowCount: number;
	filterVersion: number | null;
	asOf: string;
	fileName: string;
	csv: string;
	url: string;
};

function queueQuery(
	ws: CanonicalWorkspace,
	whId: string,
	win: string,
	queue: QueueKey,
	token: string | null,
	cursor: string | null,
) {
	const q = new URLSearchParams({ workspace: ws, queue, window: win });
	if (whId) q.set("warehouse_id", whId);
	if (token) q.set("filter_token", token);
	if (cursor) q.set("cursor", cursor);
	return `/api/v1/admin/work-queues?${q.toString()}`;
}

export function AdminWorkspacesClient({
	initialAuthenticated,
	initialStaffRoles,
	canOrders: canOrdersGrant,
	access,
	requestedWorkspace,
	requestedWarehouseId,
	view = "dashboard",
	requestedQueue = null,
	requestedMetric = null,
	requestedWindow = null,
}: {
	/** "queue": the full work-queue page (/admin/queue) behind the dashboard's "Lihat semua". */
	view?: "dashboard" | "queue";
	requestedQueue?: string | null;
	/** Metric key whose signed filter the full queue page re-reads from the dashboard API. */
	requestedMetric?: string | null;
	requestedWindow?: string | null;
	initialAuthenticated: boolean;
	initialStaffRoles: CanonicalWorkspace[];
	/** orders.history.read grant (canReadOrders), not merely the active workspace. */
	canOrders: boolean;
	/** Server-computed grants (consoleAccess); a workspace lens never widens them. */
	access: ConsoleAccess;
	requestedWorkspace: string | null;
	requestedWarehouseId: string;
}) {
	const preview = !initialAuthenticated;
	const [workspace, setWorkspace] = useState<CanonicalWorkspace>(
		normalizeWorkspaceParam(requestedWorkspace) ??
			initialStaffRoles[0] ??
			"owner",
	);
	const [warehouseId, setWarehouseId] = useState(requestedWarehouseId);
	const initialWindow = requestedWindow && requestedWindow in WINDOW_LABELS ? requestedWindow : "30d";
	const [windowRange, setWindowRange] = useState(initialWindow);

	const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
	const [dashState, setDashState] = useState<LoadState>(
		preview ? "preview" : "loading",
	);
	const [dashError, setDashError] = useState<string | null>(null);

	const [queue, setQueue] = useState<QueueKey>(
		WORKSPACE_DEFAULT_QUEUE[workspace],
	);
	const [filterToken, setFilterToken] = useState<string | null>(null);
	const [metricKey, setMetricKey] = useState<string | null>(null);
	const [rows, setRows] = useState<WorkQueueItem[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [queueState, setQueueState] = useState<LoadState>(
		preview ? "preview" : "loading",
	);
	const [queueError, setQueueError] = useState<string | null>(null);
	const [loadingMore, setLoadingMore] = useState(false);
	const [selectedIds, setSelectedIds] = useState<string[]>([]);

	const [exportMode, setExportMode] = useState<"filter" | "selection" | null>(
		null,
	);
	const [exportReason, setExportReason] = useState("");
	const [exportPending, setExportPending] = useState(false);
	const [exportError, setExportError] = useState<string | null>(null);
	const [exportReasonError, setExportReasonError] = useState<string | null>(
		null,
	);
	const exportReasonRef = useRef<HTMLTextAreaElement>(null);
	const [exportResult, setExportResult] = useState<ExportResult | null>(null);

	const [notice, setNotice] = useState<Notice | null>(null);
	const queueHeadingRef = useRef<HTMLHeadingElement>(null);
	// Controlled dialogs have no DialogTrigger, so return focus to the opener ourselves.
	const exportOpenerRef = useRef<HTMLElement | null>(null);

	const loadDashboard = useCallback(
		async (ws: CanonicalWorkspace, whId: string, win: string) => {
			if (preview) {
				setDashboard(null);
				setDashState("preview");
				return;
			}
			setDashState("loading");
			setDashError(null);
			try {
				const q = new URLSearchParams({ workspace: ws, window: win });
				if (whId) q.set("warehouse_id", whId);
				const res = await fetch(`/api/v1/admin/dashboard?${q.toString()}`, {
					credentials: "include",
					cache: "no-store",
				});
				if (!res.ok) {
					setDashboard(null);
					setDashError(failureText(await readFailure(res)));
					setDashState("error");
				} else {
					const snapshot = (await res.json()) as DashboardSnapshot;
					setDashboard(snapshot);
					setDashState("ready");
					return snapshot;
				}
			} catch {
				setDashboard(null);
				setDashError(failureText(describeFailure(0)));
				setDashState("error");
			}
		},
		[preview],
	);
	const loadQueue = useCallback(
		async (
			ws: CanonicalWorkspace,
			whId: string,
			win: string,
			q: QueueKey,
			token: string | null,
		) => {
			setSelectedIds([]);
			setNextCursor(null);
			if (preview) {
				setRows([]);
				setQueueState("preview");
				return;
			}
			setQueueState("loading");
			setQueueError(null);
			try {
				const res = await fetch(queueQuery(ws, whId, win, q, token, null), {
					credentials: "include",
					cache: "no-store",
				});
				if (!res.ok) {
					setRows([]);
					// A refused grant is a denied state (who can grant it), not a retryable error.
					setQueueError(failureText(await readFailure(res)));
					setQueueState(res.status === 403 ? "denied" : "error");
					return;
				}
				const data = (await res.json()) as {
					data?: WorkQueueItem[];
					pagination?: { next_cursor: string | null };
				};
				setRows(data.data ?? []);
				setNextCursor(data.pagination?.next_cursor ?? null);
				setQueueState("ready");
			} catch {
				setRows([]);
				setQueueError(failureText(describeFailure(0)));
				setQueueState("error");
			}
		},
		[preview],
	);

	const loadMore = async () => {
		if (!nextCursor) return;
		setLoadingMore(true);
		try {
			const res = await fetch(
				queueQuery(
					workspace,
					warehouseId,
					windowRange,
					queue,
					filterToken,
					nextCursor,
				),
				{ credentials: "include", cache: "no-store" },
			);
			if (!res.ok) {
				setNotice({
					kind: "error",
					message: failureText(await readFailure(res)),
				});
				return;
			}
			const data = (await res.json()) as {
				data?: WorkQueueItem[];
				pagination?: { next_cursor: string | null };
			};
			setRows((prev) => [...prev, ...(data.data ?? [])]);
			setNextCursor(data.pagination?.next_cursor ?? null);
		} catch {
			setNotice({ kind: "error", message: failureText(describeFailure(0)) });
		} finally {
			setLoadingMore(false);
		}
	};

	useEffect(() => {
		let mounted = true;
		(async () => {
			const requestedWs = normalizeWorkspaceParam(requestedWorkspace);
			let resolvedWs: CanonicalWorkspace =
				requestedWs ?? initialStaffRoles[0] ?? "owner";
			if (!preview) {
				try {
					const meRes = await fetch("/api/v1/me", {
						credentials: "include",
						cache: "no-store",
					});
					if (meRes.ok) {
						const me = (await meRes.json()) as { roles?: string[] };
						const staffRoles = (me.roles ?? []).filter(
							(r): r is CanonicalWorkspace => r in WORKSPACE_DEFAULT_QUEUE,
						);
						if (
							staffRoles.length > 0 &&
							(!requestedWs ||
								(!staffRoles.includes(requestedWs) &&
									!staffRoles.includes("owner")))
						) {
							resolvedWs = staffRoles[0];
						}
					}
				} catch {
					// Server-resolved roles remain authoritative for every API call.
				}
			}
			if (!mounted) return;
			if (requestedWorkspace !== resolvedWs) {
				// Keep the URL (and the sidebar's active link) on the workspace actually shown.
				const url = new URL(window.location.href);
				url.searchParams.set("workspace", resolvedWs);
				window.history.replaceState(null, "", url);
			}
			// The full queue page opens the requested queue (one the workspace offers) and window.
			const askedQueue = WORKSPACE_ALLOWED_QUEUES[resolvedWs].find((q) => q === requestedQueue);
			const defaultQueue = askedQueue ?? WORKSPACE_DEFAULT_QUEUE[resolvedWs];
			setWorkspace(resolvedWs);
			setWarehouseId(requestedWarehouseId);
			setQueue(defaultQueue);
			if (view === "queue" && requestedMetric) {
				// A card's filter token is signed per request: read it fresh from the dashboard.
				const snapshot = await loadDashboard(resolvedWs, requestedWarehouseId, initialWindow);
				const metric = snapshot?.metrics.find((m) => m.key === requestedMetric && m.queue_key === defaultQueue);
				if (!mounted) return;
				setFilterToken(metric?.queue_filter_token ?? null);
				setMetricKey(metric?.key ?? null);
				await loadQueue(resolvedWs, requestedWarehouseId, initialWindow, defaultQueue, metric?.queue_filter_token ?? null);
				return;
			}
			await Promise.all([
				loadDashboard(resolvedWs, requestedWarehouseId, initialWindow),
				loadQueue(resolvedWs, requestedWarehouseId, initialWindow, defaultQueue, null),
			]);
		})();
		return () => {
			mounted = false;
		};
	}, [
		preview,
		initialStaffRoles,
		requestedWorkspace,
		requestedWarehouseId,
		loadDashboard,
		loadQueue,
		view,
		requestedQueue,
		requestedMetric,
		initialWindow,
	]);

	const focusQueue = () => {
		const heading = queueHeadingRef.current;
		if (!heading) return;
		heading.focus({ preventScroll: true });
		heading.scrollIntoView({ block: "start" });
	};

	const openQueue = (q: QueueKey, metric: DashboardMetric | null) => {
		setQueue(q);
		setFilterToken(metric?.queue_filter_token ?? null);
		setMetricKey(metric?.key ?? null);
		void loadQueue(
			workspace,
			warehouseId,
			windowRange,
			q,
			metric?.queue_filter_token ?? null,
		);
	};

	const metrics =
		dashState === "preview"
			? (PREVIEW_METRICS[workspace] ?? [])
			: (dashboard?.metrics ?? []);
	const canSeeMoney = workspace === "owner" || workspace === "finance";
	// Work first (non-zero action counts), then context, then zero queues; stable within a group.
	const countMetrics = metrics
		.filter((m) => m.kind === "count")
		.map((m, i) => ({ m, i }))
		.sort((a, b) => TONE_RANK[kpiTone(a.m)] - TONE_RANK[kpiTone(b.m)] || a.i - b.i)
		.map(({ m }) => m);
	const moneyMetrics = canSeeMoney
		? metrics.filter((m) => m.kind === "money")
		: [];
	const activeMetric = metrics.find((m) => m.key === metricKey) ?? null;
	// A count metric's number is the exact row total of its filtered drilldown.
	const queueTotal =
		activeMetric?.kind === "count" && activeMetric.queue_key === queue
			? activeMetric.count
			: null;
	const exportConfig = QUEUE_EXPORT_CONFIG[queue];
	// Preview (signed out) offers no actions: every grant below is false without a staff session.
	const canPrint =
		!preview &&
		access.print &&
		["owner", "warehouse", "ecommerce_admin"].includes(workspace);
	const canSupport =
		!preview &&
		access.support &&
		(workspace === "owner" || workspace === "customer_service");
	const canExport = !preview && access.exportDownload;
	// KPI shortcuts only to screens this principal can open (same gates as the sidebar).
	const actionAllowed: Record<string, boolean> = {
		"/admin/fulfillment": !preview && access.ship,
		"/admin/payments": !preview && access.reconcileRead,
		"/admin/cod-settlements": !preview && access.reconcileRead,
		"/admin/support": !preview && access.support,
	};
	const actionLabel = (href: string | null | undefined) =>
		href && actionAllowed[href] ? ACTION_LABELS[href] : null;
	// S100: whole-order detail; the page and API re-check permission and warehouse scope.
	const canOrders = !preview && canOrdersGrant;
	// The API reports Asia/Jakarta; every time below is shown and labeled as WIB.
	const formatTime = (iso: string | null) => (iso ? wibDateTime(iso) : "—");
	// Phones: the dashboard is a task list, so its queue shows the first rows and links on.
	const isMobile = useIsMobile();
	const compactQueue = isMobile && view === "dashboard";
	const shownRows = compactQueue ? rows.slice(0, PHONE_QUEUE_ROWS) : rows;
	const queuePageHref = `/admin/queue?${new URLSearchParams({
		workspace,
		queue,
		window: windowRange,
		...(metricKey && activeMetric?.queue_key === queue ? { metric: metricKey } : {}),
		...(warehouseId ? { warehouse_id: warehouseId } : {}),
	})}`;
	const queueCount = queueTotal ?? (nextCursor ? `${rows.length}+` : String(rows.length));
	const openExport = (mode: "filter" | "selection") => {
		exportOpenerRef.current = document.activeElement as HTMLElement | null;
		setExportMode(mode);
		setExportReason("");
		setExportError(null);
		setExportReasonError(null);
	};

	const runExport = async () => {
		if (!exportConfig || !exportMode) return;
		const reason = exportReason.trim();
		if (!reason) {
			setExportReasonError("Alasan ekspor wajib diisi untuk jejak audit.");
			exportReasonRef.current?.focus();
			return;
		}
		setExportReasonError(null);
		if (!canExport) {
			setExportError(EXPORT_DENIED);
			return;
		}
		if (exportPending) return;
		setExportPending(true);
		setExportError(null);
		try {
			let selection: Record<string, unknown>;
			let rowCount = selectedIds.length;
			let filterVersion: number | null = null;
			let asOf = new Date().toISOString();
			if (exportMode === "filter") {
				const now = Date.now();
				const freeze = await fetch("/api/v1/admin/export-selections", {
					method: "POST",
					credentials: "include",
					headers: {
						"Content-Type": "application/json",
						"Idempotency-Key": crypto.randomUUID(),
					},
					body: JSON.stringify({
						resource: exportConfig.resource,
						warehouse_id: warehouseId || null,
						from:
							dashboard?.from ?? new Date(now - 30 * 86400_000).toISOString(),
						to: dashboard?.to ?? new Date(now + 60_000).toISOString(),
						statuses: [],
						max_rows: 1000,
					}),
				});
				if (!freeze.ok) {
					setExportError(failureText(await readFailure(freeze)));
					return;
				}
				const snap = (await freeze.json()) as {
					filter_token: string;
					filter_version: number;
					row_count: number;
					as_of: string;
				};
				selection = {
					mode: "filtered_snapshot",
					filter_token: snap.filter_token,
					filter_version: snap.filter_version,
				};
				rowCount = snap.row_count;
				filterVersion = snap.filter_version;
				asOf = snap.as_of;
			} else {
				selection = { mode: "explicit_page", resource_ids: selectedIds };
			}
			const res = await fetch("/api/v1/admin/exports", {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					"Idempotency-Key": crypto.randomUUID(),
				},
				body: JSON.stringify({
					resource: exportConfig.resource,
					column_set: exportConfig.columnSet,
					reason,
					selection,
				}),
			});
			if (!res.ok) {
				setExportError(failureText(await readFailure(res)));
				return;
			}
			const csv = await res.text();
			if (exportResult) URL.revokeObjectURL(exportResult.url);
			setExportResult({
				rowCount,
				filterVersion,
				asOf,
				fileName: `${exportConfig.resource}-${asOf.slice(0, 10)}.csv`,
				csv,
				url: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
			});
			setExportMode(null);
		} catch {
			setExportError(failureText(describeFailure(0)));
		} finally {
			setExportPending(false);
		}
	};

	const rowActionFor = (item: WorkQueueItem) =>
		(item.resource_kind === "fulfillment" && canPrint) ||
		(item.resource_kind === "conversation" && canSupport);
	const hasRowActions = rows.some(rowActionFor);
	const timeLabel = TIME_LABELS[queue];

	const rowAction = (item: WorkQueueItem) => {
		if (item.resource_kind === "fulfillment" && canPrint)
			return (
				<Button asChild variant="outline" size="sm">
					<Link href="/admin/print-center">
						<Printer data-icon="inline-start" aria-hidden="true" />
						Cetak label
					</Link>
				</Button>
			);
		if (item.resource_kind === "conversation" && canSupport)
			return (
				<Button asChild variant="outline" size="sm">
					<Link href="/admin/support">Buka Kotak Masuk</Link>
				</Button>
			);
		return null;
	};

	// Human reference from the API (order number, resi, SKU, mutation reference); never a row id.
	const referenceText = (item: WorkQueueItem) =>
		item.reference ??
		(item.resource_kind === "conversation" ? "Percakapan tanpa pesanan" : "Tanpa nomor pesanan");
	// Each row opens its order, or for an unmatched settlement the screen that records it.
	const settlementHref = (item: WorkQueueItem) =>
		item.resource_kind === "reconciliation" && !item.order_id && access.reconcileRead && !preview
			? item.settlement_source === "cod"
				? "/admin/cod-settlements"
				: "/admin/payments"
			: null;
	const rowHref = (item: WorkQueueItem) =>
		canOrders && item.order_admin_no != null
			? adminPath("order", item.order_admin_no)
			: settlementHref(item);
	const kindText = (item: WorkQueueItem) => (
		<>
			{item.resource_kind === "reconciliation" && item.settlement_source
				? SETTLEMENT_SOURCE_LABELS[item.settlement_source]
				: (KIND_LABELS[item.resource_kind] ?? item.resource_kind)}
			{item.resource_kind === "reconciliation" && item.amount_idr != null && (
				<span className="tabular-nums"> · {rupiah(item.amount_idr)}</span>
			)}
		</>
	);
	// The row's link (or plain reference); `card` drops the md–xl time line.
	const reference = (item: WorkQueueItem, card = false) => {
		const href = rowHref(item);
		const mono = item.reference !== null;
		return (
			<div className="flex min-w-0 flex-col">
				{!card && <span className="text-xs font-normal text-muted-foreground">{kindText(item)}</span>}
				{href ? (
					<Link
						href={href}
						className={cn(
							"text-sm font-medium break-words text-primary underline-offset-4 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center",
							mono && "font-mono break-all",
						)}
						aria-label={
							item.order_id
								? `Buka detail pesanan ${referenceText(item)}`
								: `Buka ${SETTLEMENT_SOURCE_LABELS[item.settlement_source ?? "payment"]} untuk ${referenceText(item)}`
						}
					>
						{referenceText(item)}
					</Link>
				) : (
					<span className={cn("text-sm font-medium break-words", mono && "font-mono break-all")}>
						{referenceText(item)}
					</span>
				)}
				{/* md–xl: queues with a row action move the time here so the pinned action never covers it. */}
				{!card && timeLabel && hasRowActions && (
					<span className="hidden text-xs font-normal text-muted-foreground tabular-nums md:block xl:hidden">
						{rowTimeLabel(item)} {time(item)}
					</span>
				)}
			</div>
		);
	};
	const rowTimeLabel = (item: WorkQueueItem) =>
		item.due_at_kind ? DUE_AT_KIND_LABELS[item.due_at_kind] : timeLabel;

	const status = (item: WorkQueueItem) => {
		const [label, tone] = describeState(item.resource_kind, item.state);
		return <StatusBadge tone={tone}>{label}</StatusBadge>;
	};
	// The row's time; a passed deadline of a row still open carries "Lewat batas" right after it.
	const time = (item: WorkQueueItem) => {
		const [, tone] = describeState(item.resource_kind, item.state);
		const deadline =
			(tone === "open" || tone === "problem") && item.due_at_kind !== null && DEADLINE_KINDS.has(item.due_at_kind);
		return item.due_at && deadline ? <Deadline iso={item.due_at} /> : formatTime(item.due_at);
	};

	return (
		<AdminPage testId="admin-workspaces-root">
			<PageHeader
				titleTestId="workspace-heading"
				title={view === "queue" ? `Antrean ${QUEUE_LABELS[queue]}` : WORKSPACE_LABELS[workspace].title}
				back={
					view === "queue"
						? { href: `/admin?workspace=${workspace}`, label: `Kembali ke ${WORKSPACE_LABELS[workspace].title}` }
						: undefined
				}
				badge={
					preview && (
						<Badge variant="warning" className="self-start">
							Mode pratinjau: contoh data, bukan data nyata
						</Badge>
					)
				}
				// The workspace summary is orientation, not a task: phones skip it (the queue leads).
				description={
					view === "dashboard" ? <span className="max-md:hidden">{WORKSPACE_LABELS[workspace].subtitle}</span> : undefined
				}
				meta={
					<p>
						Waktu dalam WIB (Asia/Jakarta)
						{dashboard?.warehouse_ids?.length
							? ` · ${dashboard.warehouse_ids.length} gudang dalam cakupan`
							: ""}
						{dashboard?.as_of && ` · Data per ${formatTime(dashboard.as_of)}`}
					</p>
				}
				actions={
					<label className="flex items-center gap-2 text-sm font-medium">
						<span>Periode</span>
						<select
							data-testid="window-select"
							value={windowRange}
							onChange={(e) => {
								const win = e.target.value;
								setWindowRange(win);
								setFilterToken(null);
								setMetricKey(null);
								void loadDashboard(workspace, warehouseId, win);
								void loadQueue(workspace, warehouseId, win, queue, null);
							}}
							className={cn(nativeSelectClass, "max-md:flex-1")}
						>
							{Object.entries(WINDOW_LABELS).map(([value, label]) => (
								<option key={value} value={value}>
									{label}
								</option>
							))}
						</select>
					</label>
				}
			/>

			{notice && (
				<Alert
					role="status"
					data-testid="workspace-status-banner"
					variant={notice.kind === "error" ? "destructive" : "default"}
					className={
						notice.kind === "error"
							? "border-destructive/40 bg-destructive-surface pr-12"
							: "border-primary/30 bg-secondary pr-12"
					}
				>
					{notice.kind === "error" ? (
						<CircleAlert aria-hidden="true" />
					) : (
						<Info aria-hidden="true" />
					)}
					<AlertDescription className="text-foreground">
						{notice.message}
					</AlertDescription>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="absolute top-2 right-2"
						onClick={() => setNotice(null)}
					>
						<X aria-hidden="true" />
						<span className="sr-only">Tutup pesan</span>
					</Button>
				</Alert>
			)}

			{/* Work counts: each opens the exact queue behind the number */}
			{view === "dashboard" && (
			<section
				aria-labelledby="kpi-section-heading"
				className="flex flex-col gap-2"
			>
				<h2 id="kpi-section-heading" className="text-sm font-semibold max-md:sr-only">
					Antrean kerja · {WINDOW_LABELS[windowRange]}
				</h2>
				{dashState === "loading" ? (
					<LoadingState label="Memuat ringkasan…" className="h-14 w-full max-w-md" />
				) : dashState === "error" ? (
					<ErrorState
						message={`Ringkasan gagal dimuat. ${dashError ?? ""}`}
						onRetry={() =>
							void loadDashboard(workspace, warehouseId, windowRange)
						}
					/>
				) : (
					<>
						<KpiGrid testId="kpi-cards-grid">
							{countMetrics.map((m) => {
								const shown =
									m.breakdown?.slice(
										0,
										m.key === "stock_alerts" ? BREAKDOWN_SHOWN : undefined,
									) ?? [];
								const hidden = (m.breakdown?.length ?? 0) - shown.length;
								const action = actionLabel(m.action_href);
								return (
									<KpiCard
										key={m.key}
										metricKey={m.key}
										label={`${METRIC_LABELS[m.key] ?? m.key}${m.complete ? "" : " · belum lengkap"}`}
										value={m.complete ? (m.count ?? 0) : "—"}
										unit={METRIC_UNITS[m.key]}
										breakdown={
											shown.length > 0
												? `${shown.map((b) => `${b.label} ${b.count}`).join(" · ")}${hidden > 0 ? ` · +${hidden} gudang lain` : ""}`
												: null
										}
										active={metricKey === m.key}
										tone={kpiTone(m)}
										reserveAction={countMetrics.some((x) => actionLabel(x.action_href))}
										drilldownLabel="Lihat baris"
										onDrilldown={() => {
											openQueue(m.queue_key, m);
											focusQueue();
										}}
										action={m.action_href && action ? { href: m.action_href, label: action } : null}
									/>
								);
							})}
						</KpiGrid>
						{countMetrics.some((m) => kpiTone(m) === "idle") && (
							<p className="text-xs text-muted-foreground md:hidden">
								Kosong:{" "}
								{countMetrics
									.filter((m) => kpiTone(m) === "idle")
									.map((m) => METRIC_LABELS[m.key] ?? m.key)
									.join(", ")}
							</p>
						)}
						<Definitions metrics={countMetrics} />
					</>
				)}
			</section>
			)}

			{/* Daily queue */}
			<section
				aria-labelledby="work-queue-heading"
				data-testid="work-queue-section"
				className="flex flex-col gap-4 md:rounded-lg md:border md:bg-card md:p-5"
			>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex min-w-0 flex-col gap-1">
						<h2
							id="work-queue-heading"
							ref={queueHeadingRef}
							tabIndex={-1}
							// The full queue page already titles itself "Antrean …": the section heading stays for focus and readers.
							className={cn(
								"scroll-mt-16 text-base font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
								view === "queue" && "sr-only",
							)}
						>
							Antrean {QUEUE_LABELS[queue]}
						</h2>
						<p className="text-xs text-muted-foreground">
							{[
								queueState === "ready"
									? compactQueue && shownRows.length < rows.length
										? `${shownRows.length} dari ${queueCount} baris`
										: queueTotal !== null
											? `${rows.length} dari ${queueTotal} baris`
											: `${rows.length} baris${nextCursor ? ", masih ada berikutnya" : ""}`
									: null,
								activeMetric?.kind === "count"
									? `filter ${(METRIC_LABELS[activeMetric.key] ?? activeMetric.key).toLowerCase()}`
									: "semua status dalam periode",
								// The page header already states WIB on phones.
								compactQueue ? null : "waktu dalam WIB",
							]
								.filter(Boolean)
								.join(" · ")}
						</p>
					</div>
					<div className="flex flex-wrap gap-2">
						{queue === "fulfillments" && canPrint && (
							<Button asChild variant="outline" size="sm">
								<Link href="/admin/print-center">
									<Printer data-icon="inline-start" aria-hidden="true" />
									Pusat Cetak Label
								</Link>
							</Button>
						)}
						{exportConfig && !preview && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								data-testid="freeze-export-selection-btn"
								disabled={
									!canExport || queueState !== "ready" || rows.length === 0
								}
								aria-describedby={canExport ? undefined : "export-denied-reason"}
								onClick={() => openExport("filter")}
							>
								<Download data-icon="inline-start" aria-hidden="true" />
								{/* The period export does not carry a KPI card's filter; say so. */}
								{activeMetric?.kind === "count"
									? "Ekspor semua baris periode"
									: "Ekspor hasil filter"}
							</Button>
						)}
					</div>
				</div>
				{exportConfig && !preview && !canExport && (
					<p
						id="export-denied-reason"
						data-testid="export-denied-reason"
						className="text-xs text-muted-foreground"
					>
						{EXPORT_DENIED}
					</p>
				)}

				<SegmentedControl
					legend="Pilih antrean"
					value={queue}
					options={WORKSPACE_ALLOWED_QUEUES[workspace].map((q) => [q, QUEUE_LABELS[q]] as const)}
					onChange={(q) => openQueue(q, null)}
					testId={(q) => `queue-tab-${q}`}
				/>

				{activeMetric && (
					<div className="flex flex-wrap items-center gap-2">
						<Badge data-testid="active-drilldown-badge" variant="secondary">
							Filter: {METRIC_LABELS[activeMetric.key] ?? activeMetric.key}
						</Badge>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => openQueue(queue, null)}
						>
							Hapus filter
						</Button>
					</div>
				)}

				{exportResult && (
					<div
						data-testid="frozen-selection-preview"
						className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm"
					>
						<div className="flex flex-wrap items-center justify-between gap-2">
							<span>
								CSV siap:{" "}
								<strong className="tabular-nums">
									{exportResult.rowCount} baris
								</strong>
								{exportResult.filterVersion !== null &&
									` · versi filter ${exportResult.filterVersion}`}{" "}
								· per {formatTime(exportResult.asOf)}
							</span>
							<Button asChild size="sm">
								<a href={exportResult.url} download={exportResult.fileName}>
									<Download data-icon="inline-start" aria-hidden="true" />
									Unduh {exportResult.fileName}
								</a>
							</Button>
						</div>
						<details>
							<summary className="cursor-pointer text-xs text-muted-foreground">
								Lihat isi CSV
							</summary>
							<pre
								data-testid="csv-export-preview"
								className="mt-2 max-h-64 max-w-full overflow-auto rounded-md border bg-muted p-3 font-mono text-xs"
							>
								{exportResult.csv}
							</pre>
						</details>
					</div>
				)}

				<DataTable
					rows={shownRows}
					rowKey={(item) => item.id}
					status={
						queueState === "loading"
							? { kind: "loading" }
							: queueState === "error"
								? {
										kind: "error",
										message: `Antrean gagal dimuat. ${queueError ?? ""}`,
										onRetry: () =>
											void loadQueue(
												workspace,
												warehouseId,
												windowRange,
												queue,
												filterToken,
											),
									}
								: queueState === "preview"
									? {
											kind: "denied",
											message:
												"Antrean hanya tampil untuk staf yang masuk dengan MFA aktif.",
										}
									: queueState === "denied"
										? {
												kind: "denied",
												message: `Peran Anda tidak membuka antrean ${QUEUE_LABELS[queue].toLowerCase()}. Minta Super Admin menambahkan izinnya.`,
											}
										: { kind: "ready" }
					}
					loadingLabel="Memuat antrean…"
					emptyTestId="empty-queue-message"
					empty={
						filterToken
							? "Tidak ada baris untuk filter ini."
							: `Belum ada ${QUEUE_LABELS[queue].toLowerCase()} pada ${WINDOW_LABELS[windowRange]} dalam cakupan Anda.`
					}
					caption={`Antrean ${QUEUE_LABELS[queue]}`}
					rowTestId={(item) => `queue-row-${item.id}`}
					rowClassName="h-12"
					selection={{
						selected: selectedIds,
						onChange: setSelectedIds,
						label: (item) =>
							`Pilih ${KIND_LABELS[item.resource_kind] ?? item.resource_kind} ${referenceText(item)}`,
						allLabel: "Pilih semua baris di halaman ini",
						summary: (n) => `${n} baris dipilih di halaman ini`,
						barTestId: "export-controls-bar",
						actions: exportConfig && (
							<Button
								type="button"
								size="sm"
								disabled={!canExport}
								aria-describedby={canExport ? undefined : "export-denied-reason"}
								onClick={() => openExport("selection")}
							>
								<Download data-icon="inline-start" aria-hidden="true" />
								Ekspor pilihan
							</Button>
						),
					}}
					columns={[
						{ id: "reference", header: "Referensi", cell: (item) => reference(item) },
						{ id: "status", header: "Status", cell: status },
						...(timeLabel
							? [
									{
										id: "time",
										header: timeLabel,
										className: hasRowActions ? "hidden tabular-nums xl:table-cell" : "tabular-nums",
										cell: (item: WorkQueueItem) => (
											<>
												{rowTimeLabel(item) !== timeLabel && (
													<span className="block text-xs text-muted-foreground">
														{rowTimeLabel(item)}
													</span>
												)}
												{time(item)}
											</>
										),
									},
								]
							: []),
						...(hasRowActions
							? [
									{
										id: "actions",
										header: <span className="sr-only">Tindakan</span>,
										className: "text-right",
										cell: rowAction,
									},
								]
							: []),
					]}
					cardTestId={(item) => `queue-card-${item.id}`}
					card={(item) => (
						<>
							{/* Top right: the amount (finance rows), else the status badge. */}
							<CardTitle
								title={reference(item, true)}
								aside={item.amount_idr != null ? rupiah(item.amount_idr) : status(item)}
							/>
							<CardMeta>
								{item.resource_kind === "reconciliation" && item.settlement_source
									? SETTLEMENT_SOURCE_LABELS[item.settlement_source]
									: (KIND_LABELS[item.resource_kind] ?? item.resource_kind)}
								{timeLabel && (
									<>
										{" · "}
										{rowTimeLabel(item)}{" "}
										<span className="font-medium text-foreground">{time(item)}</span>
									</>
								)}
							</CardMeta>
							{item.amount_idr != null && <CardStatus>{status(item)}</CardStatus>}
							{rowActionFor(item) && <CardActions>{rowAction(item)}</CardActions>}
						</>
					)}
					paging={
						compactQueue
							? undefined
							: {
									hasMore: nextCursor !== null,
									loading: loadingMore,
									onMore: () => void loadMore(),
								}
					}
					footer={
						<>
							{compactQueue && (rows.length > PHONE_QUEUE_ROWS || nextCursor) && (
								<Button asChild variant="outline" className="w-full">
									<Link href={queuePageHref} data-testid="queue-see-all">
										Lihat semua ({queueCount})
										<span className="sr-only"> baris antrean {QUEUE_LABELS[queue].toLowerCase()}</span>
									</Link>
								</Button>
							)}
							{/* Rows that link to an order or settlement screen need no "no detail page" note. */}
							{!hasRowActions && !rows.some((r) => rowHref(r)) && (
								<p className="text-xs text-muted-foreground">
									Halaman detail untuk {QUEUE_LABELS[queue].toLowerCase()} belum
									tersedia di konsol
									{exportConfig ? "; gunakan ekspor CSV untuk rincian." : "."}
								</p>
							)}
						</>
					}
				/>
			</section>

			{/* Finance position: owner and finance only, below the daily queue; one disclosure,
			    open from md and collapsed on phones (the queue is the phone's task). */}
			{view === "dashboard" && moneyMetrics.length > 0 && (
				<Disclosure
					key={isMobile ? "phone" : "wide"}
					id="finance-heading"
					testId="finance-section"
					open={!isMobile}
					title={`Keuangan · ${moneyMetrics.length} angka`}
					description={`${WINDOW_LABELS[windowRange]}${dashboard?.as_of ? ` · data per ${formatTime(dashboard.as_of)}` : ""} · nilai belum lengkap tidak dihitung sebagai Rp0`}
				>
					<p className="text-xs text-muted-foreground md:hidden">
						{WINDOW_LABELS[windowRange]} · nilai belum lengkap tidak dihitung sebagai Rp0
					</p>
					<KpiGrid money>
						{moneyMetrics.map((m) => {
							const action = actionLabel(m.action_href);
							return (
								<KpiCard
									key={m.key}
									metricKey={m.key}
									money
									label={METRIC_LABELS[m.key] ?? m.key}
									value={m.complete && m.amount !== null ? rupiah(m.amount) : "Belum lengkap"}
									muted={!m.complete}
									reserveAction={moneyMetrics.some((x) => actionLabel(x.action_href))}
									badge={
										m.complete && BASIS_LABELS[m.financial_basis] ? (
											<Badge variant="outline">{BASIS_LABELS[m.financial_basis]}</Badge>
										) : null
									}
									description={
										m.complete
											? m.definition
											: "Sebagian sumber biaya belum tercatat, jadi nilai belum dihitung."
									}
									active={metricKey === m.key}
									drilldownLabel={`Lihat antrean ${QUEUE_LABELS[m.queue_key].toLowerCase()}`}
									onDrilldown={() => {
										openQueue(m.queue_key, m);
										focusQueue();
									}}
									action={m.action_href && action ? { href: m.action_href, label: action } : null}
								/>
							);
						})}
					</KpiGrid>
					<Definitions metrics={moneyMetrics} />
				</Disclosure>
			)}

			<Dialog
				open={exportMode !== null}
				onOpenChange={(open) => {
					if (!open && !exportPending) setExportMode(null);
				}}
			>
				<DialogContent
					onCloseAutoFocus={(e) => {
						e.preventDefault();
						const opener = exportOpenerRef.current;
						(opener?.isConnected ? opener : queueHeadingRef.current)?.focus();
					}}
				>
					<form
						noValidate
						className="flex flex-col gap-4"
						onSubmit={(e) => {
							e.preventDefault();
							void runExport();
						}}
					>
						<DialogHeader>
							<DialogTitle>
								Ekspor CSV {QUEUE_LABELS[queue].toLowerCase()}
							</DialogTitle>
							<DialogDescription>
								{exportMode === "selection"
									? `${selectedIds.length} baris yang dipilih di halaman ini.`
									: `Semua baris ${QUEUE_LABELS[queue].toLowerCase()} pada ${WINDOW_LABELS[windowRange]} dalam cakupan Anda, maksimal 1.000 baris${activeMetric?.kind === "count" ? ", tanpa filter kartu" : ""}.`}{" "}
								Rumus spreadsheet dinetralkan dan ekspor tercatat di audit.
							</DialogDescription>
						</DialogHeader>
						<div className="flex flex-col gap-1.5">
							<label
								htmlFor="export-reason-input"
								className="text-sm font-medium"
							>
								Alasan ekspor (wajib)
							</label>
							<Textarea
								ref={exportReasonRef}
								id="export-reason-input"
								data-testid="export-reason-input"
								value={exportReason}
								onChange={(e) => setExportReason(e.target.value)}
								maxLength={500}
								required
								aria-invalid={exportReasonError ? true : undefined}
								aria-describedby={
									exportReasonError ? "export-reason-error" : undefined
								}
							/>
							{exportReasonError && (
								<p
									id="export-reason-error"
									className="text-sm text-destructive"
								>
									{exportReasonError}
								</p>
							)}
						</div>
						{exportError && (
							<p role="alert" className="text-sm text-destructive">
								{exportError}
							</p>
						)}
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								disabled={exportPending}
								onClick={() => setExportMode(null)}
							>
								Batal
							</Button>
							<Button
								type="submit"
								data-testid="download-csv-btn"
								disabled={exportPending}
							>
								{exportPending ? "Membuat CSV…" : "Buat CSV"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</AdminPage>
	);
}

