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
 * URL query for a search (page address and the detail page's `dari`). A phone suffix is personal
 * data: it never enters a URL (history, logs, Referer); only `jenis=hp` survives, the digits stay
 * in component state.
 */
export function searchQuery(kind: "nomor" | "resi" | "hp", term: string) {
	const params = new URLSearchParams();
	if (!term) return params;
	params.set("jenis", kind);
	if (kind !== "hp") params.set("cari", term);
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
export const historyStatus = (status: string) => HISTORY_STATUS[status] ?? status;

// Tones for StatusBadge (status.tsx); unknown values fall back to "open".
export const ORDER_TONE: Record<string, "open" | "done" | "closed"> = {
	partially_completed: "done",
	cancelled: "closed",
};
export const PAYMENT_TONE: Record<string, "open" | "problem" | "success" | "closed" | "done"> = {
	confirmed: "success",
	expired: "closed",
	failed: "problem",
	partially_refunded: "done",
	refunded: "done",
};
export const SHIPMENT_TONE: Record<string, "open" | "problem" | "success" | "closed"> = {
	booking_failed: "problem",
	booking_unknown: "problem",
	booking_cancelled: "closed",
	delivered: "success",
	cancelled: "closed",
};
/** "COD · Lunas", "Prabayar · Menunggu pembayaran"; COD-only states already say COD. */
export function paymentText(method: string, status: string) {
	const label = PAYMENT_STATUS[status] ?? status;
	if (method === "cod") return label.startsWith("COD") ? label : `COD · ${label}`;
	return `Prabayar · ${label}`;
}
