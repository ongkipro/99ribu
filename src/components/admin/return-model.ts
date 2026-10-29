// S101: staff return/refund/replacement vocabulary and wire types (GET /api/v1/admin/returns,
// /api/v1/admin/returns/{id}, /api/v1/admin/refunds/{id}, /api/v1/admin/replacements/{id}). Display only; every
// action is re-authorized by the API. No "use client": the server pages read the role gates too.
import type { StatusTone } from "./status";

export type ReturnStatus =
	| "requested"
	| "reviewing"
	| "approved"
	| "rejected"
	| "awaiting_goods"
	| "inspecting"
	| "refunding"
	| "replacing"
	| "resolved";
export type ReturnItem = {
	id: string;
	warehouse_id: string;
	warehouse_name: string;
	product_name: string;
	variant_label: string | null;
	reason: string;
	details: string;
	claim_state: string;
	inspection_status: string;
	can_inspect: boolean;
	components?: { balance_id: string; name: string; quantity: number }[];
};
export type ReturnEvent = {
	version: number;
	kind: string;
	status: ReturnStatus;
	actor: "buyer" | "staff" | "system";
	actor_name: string | null;
	reason: string;
	occurred_at: string;
};
export type ReturnCase = {
	id: string;
	/** Short admin handles: this case at `/admin/pesanan/retur/{admin_no}`, its order at `/admin/pesanan/{order_admin_no}`. */
	admin_no: number;
	order_id: string;
	order_admin_no: number;
	order_number: string;
	version: number;
	status: ReturnStatus;
	requested_resolution: "refund" | "replacement";
	resolution: "refund" | "replacement" | null;
	requires_goods: boolean | null;
	created_at: string;
	items_complete: boolean;
	can_decide: boolean;
	refund_ids?: string[];
	items: ReturnItem[];
	replacement_ids?: string[];
	evidence?: { id: string; content_type: string; created_at: string }[];
	events?: ReturnEvent[];
};
export type Refund = {
	id: string;
	version: number;
	amount: number;
	status: string;
	created_at: string;
	explanation?: string;
};
export type Replacement = {
	id: string;
	version: number;
	warehouse_id: string;
	status: string;
	tracking_number: string | null;
	packing_due_at: string | null;
	handover_at: string | null;
	created_at: string;
	items: unknown[];
};

// Tones follow status.tsx: waiting = open, work under way = progress, uncertain = problem,
// failed = danger. "Needs my decision" is a waiting state, not a warning.
export const RETURN_STATUS: Record<ReturnStatus, [string, StatusTone]> = {
	requested: ["Menunggu keputusan", "open"],
	reviewing: ["Menunggu bukti pembeli", "open"],
	approved: ["Disetujui, siap refund", "open"],
	rejected: ["Ditolak", "closed"],
	awaiting_goods: ["Menunggu barang retur", "open"],
	inspecting: ["Diperiksa gudang", "progress"],
	refunding: ["Refund diproses", "progress"],
	replacing: ["Penggantian berjalan", "progress"],
	resolved: ["Selesai", "success"],
};
export const RESOLUTION: Record<string, string> = { refund: "Refund", replacement: "Ganti barang" };
export const REASON: Record<string, string> = {
	wrong_item: "Barang salah",
	damaged: "Rusak",
	defective: "Cacat atau tidak berfungsi",
	not_as_described: "Tidak sesuai deskripsi",
	incomplete: "Tidak lengkap",
	expired: "Kedaluwarsa",
	broken_mandatory_seal: "Segel wajib rusak",
};
export const INSPECTION: Record<string, [string, StatusTone]> = {
	pending: ["Belum diperiksa", "open"],
	waived: ["Tanpa pengembalian barang", "done"],
	accepted: ["Diterima gudang", "success"],
	rejected: ["Ditolak gudang", "danger"],
	needs_review: ["Perlu tinjauan", "problem"],
};
export const CLAIM: Record<string, string> = {
	held: "Ditahan",
	released: "Dilepas",
	refunded: "Direfund",
	replacing: "Sedang diganti",
	replaced: "Sudah diganti",
};
export const EVENT: Record<string, string> = {
	create: "Pembeli mengajukan retur",
	decision: "Keputusan klaim",
	inspection: "Inspeksi gudang",
	refund_queue: "Refund diajukan",
	refund_confirmed: "Refund berhasil",
	refund_failed: "Refund gagal",
	replacement_started: "Penggantian dibuat",
	replacement_received: "Penggantian diterima pembeli",
	replacement_cancelled: "Penggantian dibatalkan",
};
/** Event kinds whose reason a staff member typed (the others carry fixed system text). */
export const STAFF_REASON_KINDS = new Set(["decision", "inspection", "refund_queue", "replacement_started"]);
export const REFUND_STATUS: Record<string, [string, StatusTone]> = {
	awaiting_destination: ["Menunggu rekening pembeli", "open"],
	queued: ["Dalam antrean", "open"],
	processing: ["Diproses", "progress"],
	unknown: ["Hasil belum pasti", "problem"],
	succeeded: ["Berhasil", "success"],
	failed: ["Gagal", "danger"],
};
export const REPLACEMENT_STATUS: Record<string, [string, StatusTone]> = {
	awaiting_stock: ["Menunggu stok", "open"],
	ready: ["Stok siap", "open"],
	picking: ["Disiapkan gudang", "progress"],
	booking_pending: ["Menunggu resi", "progress"],
	booking_unknown: ["Pemesanan kurir belum pasti", "problem"],
	booking_failed: ["Pemesanan kurir gagal", "danger"],
	packed: ["Siap diserahkan", "open"],
	handed_over: ["Diserahkan ke kurir", "done"],
	partially_delivered: ["Sebagian diterima", "open"],
	delivered: ["Diterima pembeli", "success"],
	cancelled: ["Dibatalkan", "closed"],
};

/** List tabs: the API's `state` groups, plus all. */
export const RETURN_TABS = [
	["decide", "Perlu keputusan"],
	["goods", "Menunggu barang"],
	["progress", "Refund & penggantian"],
	["done", "Selesai"],
	["all", "Semua"],
] as const;
export type ReturnTab = (typeof RETURN_TABS)[number][0];
export const isReturnTab = (value: unknown): value is ReturnTab =>
	RETURN_TABS.some(([key]) => key === value);

/** Who may open the returns screens (mirrors returns/authority.ts:returnAuthority). */
export function returnAccess(roles: readonly string[], permissions: readonly string[]) {
	const owner = roles.includes("owner");
	const refundRead = owner || (roles.includes("finance") && permissions.includes("finance.refunds.read"));
	return {
		read: owner || refundRead || roles.includes("customer_service") || roles.includes("warehouse"),
		/** Decide, create and restock replacements (owner, customer service). */
		review: owner || roles.includes("customer_service"),
		/** Inspect and ship replacements (owner, warehouse). */
		warehouse: owner || roles.includes("warehouse"),
		refundRead,
		refundWrite: refundRead && (owner || permissions.includes("finance.refunds.write")),
	};
}
export type ReturnAccess = ReturnType<typeof returnAccess>;

/** First screen of a role: what it acts on. */
export function defaultTab(roles: readonly string[]): ReturnTab {
	if (roles.includes("owner") || roles.includes("customer_service")) return "decide";
	if (roles.includes("warehouse")) return "goods";
	return "progress";
}

export const ERROR_MESSAGES: Record<string, string> = {
	RETURN_DECISION_NOT_CURRENT: "Klaim ini tidak lagi menunggu keputusan.",
	RETURN_RESOLUTION_CHANGED: "Penyelesaian berbeda dari permintaan pembeli. Setujui sesuai permintaan atau tolak.",
	RETURN_FINANCE_REVIEW_REQUIRED: "Hasil inspeksi tidak bisa diubah setelah refund atau penggantian berjalan.",
	RETURN_GOODS_NOT_RECEIVED: "Catat komponen yang diterima sebelum menerima barang retur.",
	RETURN_GOODS_REQUIRED: "Isi jumlah komponen yang diterima.",
	RETURN_COMPONENT_ALREADY_RECEIVED: "Jumlah komponen melebihi yang dikirim atau sudah tercatat.",
	REFUND_CASE_NOT_APPROVED: "Refund hanya untuk klaim refund yang sudah disetujui dan barangnya selesai diperiksa.",
	REFUND_QUANTITY_ALREADY_ALLOCATED: "Barang ini sudah punya refund.",
	REPLACEMENT_QUANTITY_NOT_READY: "Barang yang dipilih belum siap diganti.",
	RETURN_REPLACEMENT_NOT_APPROVED: "Klaim ini belum disetujui untuk ganti barang.",
	ORIGINAL_QUANTITY_REFUND_OBLIGATED: "Barang ini sudah masuk refund.",
	REPLACEMENT_STOCK_NOT_WAITING: "Stok penggantian sudah dipesan.",
	REPLACEMENT_NOT_READY: "Penggantian belum siap disiapkan (stok atau jadwal gudang belum ada).",
	REPLACEMENT_NOT_PREPARED: "Siapkan barang dulu sebelum memesan kurir.",
	REPLACEMENT_BOOKING_ACTIVE: "Pemesanan kurir sebelumnya masih berjalan.",
	REPLACEMENT_NOT_PACKED: "Paket penggantian belum punya resi.",
	REPLACEMENT_ORIGIN_INACTIVE: "Gudang penggantian sudah tidak aktif.",
	REAUTHENTICATION_REQUIRED: "Konfirmasi kata sandi gagal atau kedaluwarsa.",
	FRESH_MFA_REQUIRED: "Verifikasi dua langkah harus diulang: keluar, masuk lagi dengan kode autentikator, lalu coba lagi.",
	RATE_LIMITED: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
};
