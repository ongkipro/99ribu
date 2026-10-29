// S133: staff vocabulary and wire types of the commerce exception workbench (GET
// /admin/commerce-exceptions[/{id}[/refunds]]). Display only; every action is re-authorized by
// the API. No "use client": the server pages read the same gates.
import type { StatusTone } from "./status";

export type ExceptionKind =
	| "late_collection"
	| "unallocated_collection"
	| "stock_discrepancy"
	| "cod_refusal"
	| "delivery_failure"
	| "replacement_stock"
	| "waybill_uncertain";
export type ExceptionStatus =
	| "open"
	| "awaiting_source"
	| "awaiting_buyer"
	| "awaiting_stock"
	| "awaiting_return"
	| "ready_for_refund"
	| "refunding"
	| "unknown"
	| "resolved"
	| "escalated";
export type PhysicalState = "unhanded" | "handed_over" | "received" | "return_expected" | "quarantined" | "cancelled";
export type ProposalAction = "cancel_affected_units" | "refund_original_entitlement" | "continue_waiting";

export type ExceptionUnit = {
	id: string;
	order_item_id: string;
	unit_ordinal: number;
	shipment_id: string;
	fulfillment_item_id: string;
	replacement_link_id: string | null;
	warehouse_id: string;
	physical_state: PhysicalState;
	product_name?: string | null;
	variant_label?: string | null;
	warehouse_name?: string | null;
};
export type ExceptionProposal = {
	id: string;
	action: ProposalAction;
	unit_ids: string[];
	explanation: string;
	created_at: string;
};
export type CommerceException = {
	id: string;
	order_id: string;
	order_number?: string;
	/** Staff GET list/detail and the report response only (never in a sealed mutation projection): the console's handles. */
	admin_no?: number;
	order_admin_no?: number | null;
	kind: ExceptionKind;
	status: ExceptionStatus;
	version: number;
	source_kind: string;
	source_id: string;
	occurred_at: string;
	created_at: string;
	units: ExceptionUnit[];
	proposal: ExceptionProposal | null;
	explanation: string;
};
/** A row of the staff list: always numbered. */
export type ExceptionRow = CommerceException & { admin_no: number };
export type RecoveryRefundStatus = "awaiting_destination" | "queued" | "processing" | "unknown" | "succeeded" | "failed";
export type RecoveryRefund = {
	id: string;
	exception_id: string;
	order_id: string;
	version: number;
	status: RecoveryRefundStatus;
	amount: number;
	source_kind: string;
	source_id: string;
	source_transaction_id: string;
	receipt_id: string | null;
	obligation_transaction_id: string;
	cash_transaction_id: string | null;
	remaining_capacity: number;
	created_at: string;
	explanation: string;
};
export type RecoveryRefundList = { exception_id: string; version: number; refunds: RecoveryRefund[] };

export const KIND: Record<ExceptionKind, string> = {
	late_collection: "Pembayaran terlambat",
	unallocated_collection: "Dana tanpa pesanan aktif",
	stock_discrepancy: "Selisih stok",
	cod_refusal: "COD ditolak",
	delivery_failure: "Pengiriman gagal",
	replacement_stock: "Stok pengganti",
	waybill_uncertain: "Resi belum pasti",
};
export const KIND_HINT: Record<ExceptionKind, string> = {
	late_collection: "Pembayaran diterima setelah pesanan kedaluwarsa dan stoknya sudah dilepas.",
	unallocated_collection: "Dana masuk dari sumber asli yang tidak bisa dipasangkan ke unit barang mana pun.",
	stock_discrepancy: "Hitungan fisik gudang lebih sedikit dari stok yang sudah dipesan untuk paket ini.",
	cod_refusal: "Pembeli menolak paket COD; kurir mengembalikannya ke gudang.",
	delivery_failure: "Paket gagal diantar dan dikembalikan ke gudang.",
	replacement_stock: "Stok untuk paket pengganti belum tersedia.",
	waybill_uncertain: "Status resi di kurir belum bisa dipastikan.",
};
export const SOURCE_KIND: Record<string, string> = {
	payment_event: "Pembayaran prabayar",
	cod_event: "Setoran COD",
	stock_report: "Laporan hitung stok",
	parcel_outcome: "Hasil dari kurir",
	replacement: "Paket pengganti",
	booking: "Pemesanan resi",
};
export const KINDS = Object.keys(KIND) as ExceptionKind[];

export const STATUS: Record<ExceptionStatus, [string, StatusTone]> = {
	open: ["Perlu ditinjau", "problem"],
	awaiting_source: ["Menunggu pemeriksaan", "open"],
	awaiting_buyer: ["Menunggu pilihan pembeli", "open"],
	awaiting_stock: ["Menunggu stok", "open"],
	awaiting_return: ["Menunggu barang kembali", "open"],
	ready_for_refund: ["Siap dikembalikan dananya", "problem"],
	refunding: ["Refund berjalan", "open"],
	unknown: ["Hasil belum pasti", "problem"],
	resolved: ["Selesai", "success"],
	escalated: ["Perlu tindak lanjut", "danger"],
};
export const STATUSES = Object.keys(STATUS) as ExceptionStatus[];

export const PHYSICAL: Record<PhysicalState, [string, StatusTone]> = {
	unhanded: ["Belum diserahkan ke kurir", "open"],
	handed_over: ["Sudah diserahkan ke kurir", "done"],
	received: ["Diterima pembeli", "done"],
	return_expected: ["Menunggu barang kembali", "problem"],
	quarantined: ["Di karantina gudang", "success"],
	cancelled: ["Dibatalkan", "closed"],
};

export const PROPOSAL: Record<ProposalAction, string> = {
	cancel_affected_units: "Batalkan unit terdampak",
	refund_original_entitlement: "Refund dari pembayaran asal",
	continue_waiting: "Tunggu dulu",
};

export const REFUND_STATUS: Record<RecoveryRefundStatus, [string, StatusTone]> = {
	awaiting_destination: ["Menunggu rekening pembeli", "open"],
	queued: ["Dalam antrean", "open"],
	processing: ["Diproses bank", "progress"],
	unknown: ["Hasil belum pasti", "problem"],
	succeeded: ["Dana terkirim", "success"],
	failed: ["Gagal, dana belum keluar", "danger"],
};

/** Who may open the exception screens: the same authority as returns (returns/authority.ts). */
export type { ReturnAccess as ExceptionAccess } from "./return-model";

/** Statuses a case can still be decided in (exceptionProposalPlan refuses the rest). */
const DECIDABLE: readonly ExceptionStatus[] = [
	"open",
	"awaiting_source",
	"awaiting_buyer",
	"awaiting_stock",
	"awaiting_return",
	"unknown",
	"escalated",
];
export const canDecide = (status: ExceptionStatus) => DECIDABLE.includes(status);

export type Decision = "propose_cancellation" | "propose_refund" | "keep_waiting" | "escalate";
/** The decisions the domain allows for a kind (proposals.ts exceptionProposalPlan). */
export function decisionsFor(kind: ExceptionKind): Decision[] {
	const out: Decision[] = [];
	if (["stock_discrepancy", "cod_refusal", "delivery_failure", "replacement_stock"].includes(kind)) out.push("propose_cancellation");
	if (kind !== "waybill_uncertain") out.push("propose_refund");
	out.push("keep_waiting", "escalate");
	return out;
}
export const DECISION: Record<Decision, { label: string; hint: string }> = {
	propose_cancellation: {
		label: "Usulkan pembatalan unit",
		hint: "Pembeli diminta menyetujui pembatalan unit terdampak. Belum ada stok atau dana yang berubah.",
	},
	propose_refund: {
		label: "Usulkan refund",
		hint: "Pembeli diminta menyetujui refund dari pembayaran asal. Server memeriksa sisa dana asli; belum ada dana yang keluar.",
	},
	keep_waiting: {
		label: "Tunggu dulu",
		hint: "Pembeli diminta menyetujui menunggu stok atau barang kembali; kasus tetap terbuka.",
	},
	escalate: {
		label: "Eskalasi",
		hint: "Kasus ditandai perlu tindak lanjut tim. Tidak ada usulan ke pembeli.",
	},
};

/** A buyer-accepted cancellation/refund proposal is applied by staff (decisions with proposal_id). */
export function canApply(c: Pick<CommerceException, "status" | "proposal">) {
	return (
		(c.status === "awaiting_source" || c.status === "escalated") &&
		c.proposal !== null &&
		(c.proposal.action === "cancel_affected_units" || c.proposal.action === "refund_original_entitlement")
	);
}

/** Returned-to-sender intake (recordExceptionIntake): a signed parcel outcome names the case. */
export function canIntake(c: Pick<CommerceException, "kind" | "status" | "source_kind" | "units">) {
	return (
		c.source_kind === "parcel_outcome" &&
		c.kind !== "unallocated_collection" &&
		c.status !== "resolved" &&
		intakeUnits(c).length > 0
	);
}
/** Original units whose returned components are not all in quarantine yet. */
export const intakeUnits = (c: Pick<CommerceException, "units">) =>
	c.units.filter((u) => u.replacement_link_id === null && u.physical_state !== "quarantined");

/** A fresh count of the same units (reportStockDiscrepancy with reinspection). */
export function canReinspect(c: Pick<CommerceException, "kind" | "status" | "units">) {
	return (
		c.kind === "stock_discrepancy" &&
		["open", "awaiting_stock", "awaiting_buyer", "awaiting_source", "escalated", "unknown"].includes(c.status) &&
		c.units.length > 0 &&
		c.units.every((u) => u.replacement_link_id === null)
	);
}

export const REFUND_NEXT: Record<ExceptionStatus, string> = {
	open: "Tinjau unit terdampak lalu putuskan penanganan.",
	awaiting_source: "Menunggu pemeriksaan sumber. Bila pembeli sudah menyetujui, terapkan persetujuannya.",
	awaiting_buyer: "Usulan sudah dikirim. Pembeli memilih di halaman pesanannya; staf menunggu.",
	awaiting_stock: "Gudang menunggu stok lengkap. Hitung ulang setelah stok berubah, atau putuskan penanganan lain.",
	awaiting_return: "Menunggu barang kembali ke gudang. Catat barang yang tiba untuk menutup kasus.",
	ready_for_refund: "Penanganan sudah diterapkan. Keuangan mengajukan refund dari pembayaran asal.",
	refunding: "Refund berjalan. Pantau statusnya di kartu refund; hasil yang belum pasti hanya direkonsiliasi.",
	unknown: "Hasil proses belum pasti. Riwayat sebelumnya tetap tersimpan; periksa lalu putuskan.",
	resolved: "Kasus selesai. Tidak ada tindakan lagi.",
	escalated: "Kasus perlu tindak lanjut tim. Putuskan penanganan atau terapkan persetujuan pembeli yang tersimpan.",
};

export const ERROR_MESSAGES: Record<string, string> = {
	EXCEPTION_CONFLICT: "Kasus sedang diubah oleh proses lain. Muat ulang lalu coba lagi.",
	EXCEPTION_DECISION_NOT_CURRENT: "Kasus ini tidak lagi bisa diputuskan pada tahap sekarang.",
	EXCEPTION_REMEDY_NOT_ELIGIBLE: "Penanganan ini tidak berlaku untuk jenis kasus ini.",
	EXCEPTION_APPLICATION_IN_PROGRESS: "Penerapan atau pembatalan resi untuk kasus ini sedang berjalan.",
	EXCEPTION_FINANCE_IN_PROGRESS: "Refund untuk kasus ini sudah diajukan; keputusan tidak bisa diubah lagi.",
	EXCEPTION_COMPONENT_SCOPE_MISMATCH: "Komponen yang dihitung tidak cocok dengan unit kasus. Muat ulang lalu hitung lagi.",
	RECOVERY_COLLECTION_NOT_QUALIFIED: "Pembayaran asal belum memenuhi syarat untuk dikembalikan.",
	RECOVERY_COLLECTION_CAPACITY_EXCEEDED: "Dana asal tidak cukup untuk refund ini; sebagian sudah dikembalikan.",
	RECOVERY_QUANTITY_ALREADY_ALLOCATED: "Unit ini sudah punya refund.",
	RECOVERY_PROPOSAL_NOT_CURRENT: "Usulan sudah berganti. Muat ulang lalu periksa lagi.",
	RECOVERY_ACCEPTANCE_NOT_CURRENT: "Belum ada persetujuan pembeli untuk usulan ini, atau sudah berganti.",
	RECOVERY_REFUND_NOT_READY: "Kasus belum siap dikembalikan dananya, atau refund kasus ini sudah diajukan.",
	RECOVERY_OUTCOME_STILL_AMBIGUOUS: "Hasil pengiriman dana belum pasti atau sudah selesai, jadi tidak boleh dikirim ulang. Gunakan rekonsiliasi.",
	RECOVERY_ATTEMPTS_EXHAUSTED: "Percobaan refund sudah habis.",
	RECOVERY_SOURCE_LIMIT: "Terlalu banyak sumber untuk diterapkan sekaligus.",
	EXCEPTION_INTAKE_NOT_ELIGIBLE: "Kasus ini tidak menerima pencatatan barang kembali.",
	EXCEPTION_INTAKE_OUTCOME_INVALID: "Hasil kurir bukan paket kembali ke pengirim yang mencakup kasus ini.",
	EXCEPTION_INTAKE_SCOPE_INVALID: "Unit tidak termasuk paket yang dikembalikan kurir.",
	EXCEPTION_INTAKE_COMPONENT_INVALID: "Komponen atau lot tidak cocok dengan yang dikirim untuk unit ini.",
	EXCEPTION_INTAKE_QUANTITY_EXCEEDED: "Jumlah melebihi yang dikirim atau yang sudah tercatat diterima.",
	EXCEPTION_INTAKE_TIME_INVALID: "Waktu hasil kurir lebih baru dari waktu sistem. Coba lagi sebentar lagi.",
	DUPLICATE_EXCEPTION_GOODS: "Komponen yang sama dicatat dua kali untuk satu unit.",
	DUPLICATE_EXCEPTION_QUANTITY: "Unit yang sama dipilih dua kali.",
	DUPLICATE_STOCK_OBSERVATION: "Lot yang sama dihitung dua kali.",
	EXCEPTION_PHYSICAL_SCOPE_NOT_ELIGIBLE: "Paket sudah diserahkan ke kurir, unit sudah dibatalkan, atau pesanan tidak aktif lagi.",
	EXCEPTION_REINSPECTION_REQUIRED: "Unit ini sudah punya kasus selisih stok. Hitung ulang dari kasus tersebut.",
	EXCEPTION_REINSPECTION_NOT_ELIGIBLE: "Kasus ini tidak bisa dihitung ulang pada tahap sekarang.",
	EXCEPTION_SHORTAGE_REQUIRED: "Laporan pertama harus mencatat minimal satu komponen yang kurang.",
	EXCEPTION_SHORTAGE_EXCEEDS_SCOPE: "Jumlah kurang melebihi yang dipesan atau yang ada di stok fisik.",
	STOCK_VERSION_CONFLICT: "Stok lot ini berubah sejak dibaca. Muat ulang angka stok lalu hitung lagi.",
	FULFILLMENT_STOCK_INVALID: "Stok pesanan ini tidak lagi dipesan untuk paket tersebut.",
	REAUTHENTICATION_REQUIRED: "Konfirmasi kata sandi gagal atau kedaluwarsa.",
	FRESH_MFA_REQUIRED: "Verifikasi dua langkah harus diulang: keluar, masuk lagi dengan kode autentikator, lalu coba lagi.",
	RATE_LIMITED: "Terlalu banyak percobaan. Tunggu sebentar lalu coba lagi.",
	INVALID_IDEMPOTENCY_KEY: "Kunci permintaan tidak valid. Tutup dialog lalu coba lagi.",
};
