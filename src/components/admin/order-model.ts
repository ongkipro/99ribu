// S100 staff order history: navigation gate and Indonesian labels. The API re-checks the grant,
// MFA and whole-order warehouse scope on every read (spec 07: owner company-wide; other staff only
// orders whose every parcel sits in their assigned warehouses; warehouse role never).

/** Mirrors hasPermission(principal, "orders.history.read"); hides dead ends only. */
export function canReadOrders(roles: readonly string[], permissions: readonly string[]) {
	return (
		roles.includes("owner") ||
		(permissions.includes("orders.history.read") &&
			roles.some((r) => ["ecommerce_admin", "customer_service", "finance"].includes(r)))
	);
}

/**
 * URL query for a search and its filters (page address and the detail page's `dari`). A phone
 * suffix is personal data: it never enters a URL (history, logs, Referer); only `jenis=hp`
 * survives, the digits stay in component state. Filters are fixed status keys (no personal data).
 */
export function searchQuery(kind: "nomor" | "resi" | "hp", term: string, filters: OrderFilters = {}) {
	const params = new URLSearchParams();
	if (term) {
		params.set("jenis", kind);
		if (kind !== "hp") params.set("cari", term);
	}
	for (const key of ORDER_FILTER_KEYS) {
		const value = filters[key];
		if (value) params.set(key, value);
	}
	return params;
}

export const ORDER_STATUS: Record<string, string> = {
	preparing: "Disiapkan",
	pending: "Menunggu",
	processing: "Diproses",
	partially_completed: "Sebagian selesai",
	cancelled: "Dibatalkan",
};
export const PAYMENT_STATUS: Record<string, string> = {
	pending: "Menunggu pembayaran",
	cod_due: "COD belum tertagih",
	partially_collected: "COD sebagian tertagih",
	confirmed: "Lunas",
	expired: "Kedaluwarsa",
	failed: "Gagal",
	partially_refunded: "Sebagian dikembalikan",
	refunded: "Dikembalikan",
};
export const SHIPMENT_STATUS: Record<string, string> = {
	unbooked: "Belum dipesan kurir",
	booking_pending: "Pemesanan kurir diproses",
	booked: "Kurir dipesan",
	booking_failed: "Pemesanan kurir gagal",
	booking_unknown: "Pemesanan kurir belum pasti",
	booking_cancellation_pending: "Pembatalan kurir diproses",
	booking_cancelled: "Pemesanan kurir dibatalkan",
	packed: "Resi terbit",
	handed_over: "Dikirim",
	partially_delivered: "Sebagian diterima",
	delivered: "Diterima pembeli",
	cancelled: "Dibatalkan",
};
/** Fulfillment states of the parcels (one order can hold parcels in several states). */
export const FULFILLMENT_STATUS: Record<string, string> = {
	ready: "Siap dikemas",
	picking: "Dikemas",
	packed: "Resi terbit",
	handover_pending: "Menunggu serah kurir",
	handed_over: "Diserahkan ke kurir",
	exception: "Perlu tindakan",
};
export const RETURN_CASE_STATUS: Record<string, string> = {
	requested: "Retur diajukan",
	reviewing: "Retur ditinjau",
	approved: "Retur disetujui",
	rejected: "Retur ditolak",
	awaiting_goods: "Menunggu barang retur",
	inspecting: "Barang retur diperiksa",
	refunding: "Pengembalian dana diproses",
	replacing: "Penggantian diproses",
	resolved: "Retur selesai",
};

/**
 * The order list filters, one per status axis the API filters on (GET /api/v1/admin/orders): the URL
 * key, its label and the accepted values. Order states exclude "preparing" (never listed).
 */
export const ORDER_FILTERS = {
	status: {
		label: "Status pesanan",
		api: "status",
		options: {
			pending: ORDER_STATUS.pending,
			processing: ORDER_STATUS.processing,
			partially_completed: ORDER_STATUS.partially_completed,
			cancelled: ORDER_STATUS.cancelled,
		} as Record<string, string>,
	},
	// A confirmed COD order is collected by the courier, not money received (see paymentLabel).
	bayar: {
		label: "Pembayaran",
		api: "payment_status",
		options: { ...PAYMENT_STATUS, confirmed: "Lunas atau COD tertagih kurir" } as Record<string, string>,
	},
	kirim: { label: "Pengiriman", api: "fulfillment_status", options: FULFILLMENT_STATUS },
	retur: { label: "Retur", api: "return_status", options: RETURN_CASE_STATUS },
} as const;
export type OrderFilterKey = keyof typeof ORDER_FILTERS;
export type OrderFilters = Partial<Record<OrderFilterKey, string>>;
export const ORDER_FILTER_KEYS = Object.keys(ORDER_FILTERS) as OrderFilterKey[];
/** Known filter values only; anything else in a hand-made URL is dropped. */
export function readOrderFilters(get: (key: string) => string | null | undefined): OrderFilters {
	const filters: OrderFilters = {};
	for (const key of ORDER_FILTER_KEYS) {
		const value = get(key);
		if (value && Object.hasOwn(ORDER_FILTERS[key].options, value)) filters[key] = value;
	}
	return filters;
}
/**
 * Payment label of one order. A confirmed COD order means the courier collected the money; it
 * reaches 99ribu only with the Mengantar remittance, so it never reads as "Lunas".
 */
export function paymentLabel(method: string, status: string) {
	if (method === "cod" && status === "confirmed") return "COD tertagih kurir";
	return PAYMENT_STATUS[status] ?? status;
}
export const TRACKING_STATUS: Record<string, string> = {
	picked_up: "Diambil kurir",
	in_transit: "Dalam perjalanan",
	delivered: "Terkirim",
	failed: "Gagal kirim, dicoba ulang",
};
export const HISTORY_KIND: Record<string, string> = {
	order: "Pesanan",
	payment: "Pembayaran",
	reconciliation: "Rekonsiliasi",
	fulfillment: "Pengiriman",
	return: "Retur",
	refund: "Pengembalian dana",
};
const HISTORY_STATUS: Record<string, string> = {
	...ORDER_STATUS,
	...PAYMENT_STATUS,
	collection_recorded: "Pembayaran tercatat",
	journal_reversed: "Jurnal dibalik",
	buyer_received: "Diterima pembeli",
	ready: "Siap dikemas",
	picking: "Dikemas",
	packed: "Resi terbit",
	handover_pending: "Menunggu serah kurir",
	handed_over: "Diserahkan ke kurir",
	exception: "Perlu tindakan",
	requested: "Retur diajukan",
	reviewing: "Retur ditinjau",
	approved: "Retur disetujui",
	rejected: "Retur ditolak",
	awaiting_goods: "Menunggu barang retur",
	inspecting: "Barang retur diperiksa",
	refunding: "Pengembalian dana diproses",
	replacing: "Penggantian diproses",
	resolved: "Retur selesai",
	awaiting_destination: "Menunggu rekening tujuan",
	queued: "Dalam antrean",
	unknown: "Hasil belum pasti",
	succeeded: "Berhasil",
};
// Order and payment states share keys (`pending`), so the event kind picks the vocabulary.
const KIND_STATUS: Record<string, Record<string, string>> = { order: ORDER_STATUS, payment: PAYMENT_STATUS };
export const historyStatus = (kind: string, status: string) =>
	KIND_STATUS[kind]?.[status] ?? HISTORY_STATUS[status] ?? status;

// Tones for StatusBadge (status.tsx); unknown values fall back to "open".
export const ORDER_TONE: Record<string, "open" | "progress" | "done" | "closed"> = {
	processing: "progress",
	partially_completed: "done",
	cancelled: "closed",
};
export const PAYMENT_TONE: Record<string, "open" | "problem" | "success" | "closed" | "done" | "danger"> = {
	confirmed: "success",
	expired: "closed",
	failed: "danger",
	partially_refunded: "done",
	refunded: "done",
};
export const SHIPMENT_TONE: Record<string, "open" | "problem" | "success" | "closed" | "danger"> = {
	booking_failed: "danger",
	booking_unknown: "problem",
	booking_cancelled: "closed",
	delivered: "success",
	cancelled: "closed",
};
/** Tone of one order's payment: a collected COD order is finished work (done), not money received. */
export const paymentTone = (method: string, status: string) =>
	method === "cod" && status === "confirmed" ? "done" : (PAYMENT_TONE[status] ?? "open");
/** "COD tertagih kurir", "Prabayar · Menunggu pembayaran"; COD-only states already say COD. */
export function paymentText(method: string, status: string) {
	const label = paymentLabel(method, status);
	if (method === "cod") return label.startsWith("COD") ? label : `COD · ${label}`;
	return `Prabayar · ${label}`;
}
