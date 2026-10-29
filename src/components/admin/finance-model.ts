// S131 Finance workbench (spec 17 B16–B19): shared types, Indonesian labels, status tones,
// error messages, and role/permission gates. No "use client" so server pages and client
// components share the exact same access predicates.
import { rupiah } from "./format.ts";
import type { StatusTone } from "./status.ts";

export type FinanceAccess = {
	reconcileRead: boolean;
	reconcileWrite: boolean;
	payouts: boolean;
	refundRead: boolean;
	refundWrite: boolean;
	summaryRead: boolean;
};

export function financeAccess(
	roles: readonly string[],
	permissions: readonly string[],
): FinanceAccess {
	const owner = roles.includes("owner");
	const isFinance = roles.includes("finance");
	const has = (permission: string) =>
		owner || (isFinance && permissions.includes(permission));
	return {
		reconcileRead: has("finance.reconciliation.read"),
		reconcileWrite:
			has("finance.reconciliation.read") &&
			has("finance.reconciliation.write"),
		payouts: owner || isFinance,
		refundRead: has("finance.refunds.read"),
		refundWrite:
			has("finance.refunds.read") && has("finance.refunds.write"),
		summaryRead: has("finance.summary.read"),
	};
}
// ---- B16 Reconciliation -------------------------------------------------------------------------

export const RECONCILIATION_STATUSES = [
	"pending",
	"partial",
	"matched",
	"mismatched",
	"exception",
] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const RECONCILIATION_PROVIDERS = [
	"local.payment",
	"local.cod",
] as const;
export type ReconciliationProvider = (typeof RECONCILIATION_PROVIDERS)[number];

export const RECONCILIATION_STATUS: Record<
	ReconciliationStatus,
	[string, StatusTone]
> = {
	pending: ["Menunggu pencocokan", "open"],
	partial: ["Cocok sebagian", "open"],
	matched: ["Cocok", "success"],
	mismatched: ["Tidak cocok", "problem"],
	exception: ["Perlu tinjauan", "problem"],
};

export const RECONCILIATION_PROVIDER_LABEL: Record<
	ReconciliationProvider,
	string
> = {
	"local.payment": "Pembayaran prabayar",
	"local.cod": "Setoran COD",
};

export const RECONCILIATION_DIRECTION_LABEL: Record<string, string> = {
	credit: "Dana masuk (kredit)",
	debit: "Koreksi/keluar (debit)",
};

export const RECONCILIATION_EVENT_KIND: Record<string, string> = {
	observe: "Mutasi bank tercatat",
	statement: "Pernyataan sumber diperbarui",
	match: "Dicocokkan",
	unmatch: "Kecocokan dilepas",
	escalate: "Dieskalasi ke tinjauan",
};

export const RECONCILIATION_PROBLEM_LABEL: Record<string, string> = {
	SETTLEMENT_STATEMENT_INCOMPLETE:
		"Rincian nominal kotor atau biaya penyedia pada pernyataan belum lengkap.",
	SETTLEMENT_TOTAL_MISMATCH:
		"Total kotor tidak sama dengan dana bersih ditambah biaya kurir dan penyedia.",
	SETTLEMENT_FEE_CORRECTION_REQUIRED:
		"Biaya pernyataan berubah setelah pencocokan; perlu koreksi kecocokan.",
	SETTLEMENT_DEPENDENT_REVERSAL:
		"Mutasi ini memiliki koreksi debit turunan yang masih aktif.",
	SETTLEMENT_STATEMENT_CHANGED:
		"Pernyataan sumber berubah setelah mutasi dicocokkan.",
	SETTLEMENT_MANUAL_REVIEW_REQUIRED:
		"Kecocokan sebelumnya dilepas; perlu peninjauan manual.",
	SETTLEMENT_REFERENCES_UNKNOWN:
		"Pernyataan belum mencantumkan piutang pesanan yang dapat dicocokkan otomatis.",
	SETTLEMENT_FINANCE_REVIEW:
		"Mutasi dieskalasi untuk pemeriksaan tim keuangan.",
};

export type SettlementStatementTotals = {
	gross_amount: number | null;
	carrier_fee: number | null;
	provider_fee: number | null;
};

export type SettlementClaimInput = {
	receivable_transaction_id: string;
	gross_amount: number;
	reopens_allocation_id?: string | null;
};

export type ReconciliationItem = {
	id: string;
	/** Short admin handle: opens at `/admin/keuangan/rekonsiliasi/{admin_no}`. */
	admin_no: number;
	provider: ReconciliationProvider;
	environment: string;
	reference: string;
	direction: "credit" | "debit";
	amount: number;
	currency: "IDR";
	version: number;
	status: ReconciliationStatus;
	problem_code: string | null;
	explanation: string;
	source_id: string;
	source_reference: string;
	source_version: number;
	latest_source_reference: string;
	latest_source_version: number;
	source_processing_pending: boolean;
	current_match_id: string | null;
	last_match_id: string | null;
	cash_transaction_id: string | null;
	fee_transaction_id: string | null;
	statement_totals: SettlementStatementTotals;
	recorded_fees: {
		source_reference: string;
		carrier_fee: number;
		provider_fee: number;
	} | null;
	occurred_at: string;
	recorded_at: string;
};

export type SettlementStatement = {
	id: string;
	version: number;
	totals: SettlementStatementTotals;
	allocation_claims: SettlementClaimInput[] | null;
	reverses_reference: string | null;
	reported_at: string;
	recorded_at: string;
};

export type SettlementAmounts = {
	gross_amount: number;
	net_amount: number;
	carrier_fee: number;
	provider_fee: number;
};

export type SettlementAllocation = {
	id: string;
	receivable_transaction_id: string;
	order_id: string;
	order_admin_no: number;
	receipt_id: string | null;
	source_basis: string;
	gross_amount: number;
	net_amount: number;
	carrier_fee: number;
	provider_fee: number;
	reopens_allocation_id: string | null;
};

export type SettlementMatch = {
	id: string;
	statement_id: string;
	transaction_id: string;
	active: boolean;
	correction_of: string | null;
	reversal_transaction_id: string | null;
	reason: string;
	occurred_at: string;
	recorded_at: string;
	totals: SettlementAmounts;
	remaining: SettlementAmounts;
	allocations: SettlementAllocation[];
};

export type SettlementHistoryEvent = {
	id: string;
	version: number;
	kind: string;
	status: ReconciliationStatus;
	source_kind: string;
	source_id: string;
	actor_id: string | null;
	source_reference: string;
	match_id: string | null;
	fee_transaction_id: string | null;
	applied_fee_source_reference: string | null;
	problem_code: string | null;
	reason: string;
	occurred_at: string;
	recorded_at: string;
};

export type ReconciliationDetail = {
	item: ReconciliationItem;
	statement: SettlementStatement;
	match: SettlementMatch | null;
	history: SettlementHistoryEvent[];
	pagination: { next_cursor: string | null };
};

export type SettlementSourceDetail = {
	source: {
		id: string;
		provider: ReconciliationProvider;
		environment: string;
		reference: string;
		direction: "credit" | "debit";
		amount: number;
		currency: "IDR";
		occurred_at: string;
		recorded_at: string;
	};
	item: ReconciliationItem | null;
	statements: SettlementStatement[];
	pagination: { next_cursor: string | null };
	unregistered_deliveries: number;
};

// ---- B17 Affiliate Payouts ----------------------------------------------------------------------

export const PAYOUT_STATUSES = [
	"queued",
	"processing",
	"unknown",
	"succeeded",
	"failed",
	"funding_hold",
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_STATUS: Record<PayoutStatus, [string, StatusTone]> = {
	queued: ["Dalam antrean", "open"],
	processing: ["Sedang diproses", "progress"],
	unknown: ["Hasil belum pasti", "problem"],
	succeeded: ["Selesai", "success"],
	failed: ["Gagal", "danger"],
	funding_hold: ["Menunggu rekening", "problem"],
};

export type Payout = {
	id: string;
	/** Short admin handle: opens at `/admin/keuangan/komisi/{admin_no}`. */
	admin_no: number;
	amount: number;
	currency: "IDR";
	status: PayoutStatus;
	explanation?: string;
	created_at: string;
	completed_at?: string;
	version: number;
	transfer_mode: "manual";
	transfer_claim_id?: string;
};

export type BeneficiarySnapshot = {
	bank_code: string;
	account_number: string;
	account_holder_name: string;
};

export type ManualTransferClaim = {
	payout: Payout;
	beneficiary_snapshot: BeneficiarySnapshot;
};

export type EvidenceUploadGrant = {
	id: string;
	upload_url: string;
	expires_at: string;
	required_headers: {
		"content-type": string;
		"x-payout-id": string;
	};
};

export type UploadedEvidence = {
	id: string;
	file_name: string;
	media_type: string;
	size_bytes: number;
	sha256: string;
};

/**
 * `GET /api/v1/admin/payouts` pages ascending by `id > cursor`. Given a target `payoutId`,
 * returns the UUID immediately preceding it so a single bounded page starts at `payoutId`.
 */
export function cursorBefore(uuid: string): string | null {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
		return null;
	}
	const hex = uuid.replaceAll("-", "").toLowerCase();
	const value = BigInt(`0x${hex}`);
	if (value <= 0n) return null;
	const prev = (value - 1n).toString(16).padStart(32, "0");
	return `${prev.slice(0, 8)}-${prev.slice(8, 12)}-${prev.slice(12, 16)}-${prev.slice(16, 20)}-${prev.slice(20)}`;
}

// ---- B18 Refunds --------------------------------------------------------------------------------

export const ADMIN_REFUND_STATUSES = [
	"awaiting_destination",
	"queued",
	"processing",
	"unknown",
	"succeeded",
	"failed",
] as const;
export type AdminRefundStatus = (typeof ADMIN_REFUND_STATUSES)[number];

export const ADMIN_REFUND_STATUS: Record<
	AdminRefundStatus,
	[string, StatusTone]
> = {
	awaiting_destination: ["Menunggu rekening pembeli", "open"],
	queued: ["Dalam antrean", "open"],
	processing: ["Diproses", "progress"],
	unknown: ["Hasil belum pasti", "problem"],
	succeeded: ["Berhasil", "success"],
	failed: ["Gagal", "danger"],
};

export type AdminRefund = {
	id: string;
	/** Short admin handles of this refund, its return case and its order. */
	admin_no: number;
	return_admin_no: number;
	order_admin_no: number;
	order_id: string;
	return_case_id: string;
	version: number;
	amount: number;
	status: AdminRefundStatus;
	created_at: string;
	explanation?: string;
};

// ---- B19 Finance Summary ------------------------------------------------------------------------

export type FinancialStatementSection = {
	complete: boolean;
	amount: number | null;
	missing_inputs: string[];
};

export type FinanceSummaryResponse = {
	from: string;
	to: string;
	currency: "IDR";
	generated_at?: string;
	as_of?: string;
	cash: FinancialStatementSection;
	receivables: FinancialStatementSection;
	refund_liability: FinancialStatementSection;
	affiliate_liability: FinancialStatementSection;
	gross_merchandise: FinancialStatementSection;
	net_merchandise_revenue: FinancialStatementSection;
	recognized_hpp: FinancialStatementSection;
	gross_merchandise_profit: FinancialStatementSection;
	estimated_contribution: FinancialStatementSection;
	realized_contribution: FinancialStatementSection;
	operating_expenses: FinancialStatementSection;
	operating_result: FinancialStatementSection;
};

export type SummarySectionKey =
	| "cash"
	| "receivables"
	| "refund_liability"
	| "affiliate_liability"
	| "gross_merchandise"
	| "net_merchandise_revenue"
	| "recognized_hpp"
	| "gross_merchandise_profit"
	| "estimated_contribution"
	| "realized_contribution"
	| "operating_expenses"
	| "operating_result";

export const CLOSING_BALANCE_SECTIONS: readonly {
	key: SummarySectionKey;
	label: string;
	description: string;
}[] = [
	{
		key: "cash",
		label: "Kas perusahaan terekonsiliasi",
		description: "Saldo kas perusahaan dari mutasi yang sudah dicocokkan (di luar piutang belum cair).",
	},
	{
		key: "receivables",
		label: "Piutang penyedia & kurir",
		description: "Penerimaan pembayaran prabayar dan COD yang belum dicocokkan ke pencairan bank.",
	},
	{
		key: "refund_liability",
		label: "Kewajiban pengembalian dana",
		description: "Kewajiban refund retur dan pemulihan yang belum selesai dibayarkan.",
	},
	{
		key: "affiliate_liability",
		label: "Kewajiban komisi afiliasi",
		description: "Komisi afiliasi yang masih ditahan, tersedia, atau sedang dicairkan.",
	},
];

export const PERIOD_FLOW_SECTIONS: readonly {
	key: SummarySectionKey;
	label: string;
	description: string;
}[] = [
	{
		key: "gross_merchandise",
		label: "Penjualan kotor barang dagangan",
		description: "Nilai barang dagangan dari penerimaan ekonomis pada periode ini sebelum dikurangi retur.",
	},
	{
		key: "net_merchandise_revenue",
		label: "Pendapatan bersih barang dagangan",
		description: "Penjualan barang dagangan setelah dikurangi alokasi refund dan pemulihan pada periode ini.",
	},
	{
		key: "recognized_hpp",
		label: "HPP diakui",
		description: "Harga pokok penjualan komponen fisik untuk unit yang bertahan pada periode ini.",
	},
	{
		key: "gross_merchandise_profit",
		label: "Laba kotor barang dagangan",
		description: "Pendapatan bersih barang dagangan dikurangi HPP diakui.",
	},
	{
		key: "estimated_contribution",
		label: "Estimasi kontribusi margin",
		description: "Estimasi margin menggunakan HPP, asumsi biaya penawaran, dan kebijakan komersial saat pesanan dibuat.",
	},
	{
		key: "realized_contribution",
		label: "Kontribusi margin terealisasi",
		description: "Margin aktual setelah HPP, biaya kurir/penyedia terekonsiliasi, subsidi ongkir, kemasan, selisih stok, dan komisi afiliasi.",
	},
	{
		key: "operating_expenses",
		label: "Beban operasional tercatat",
		description: "Beban operasional perusahaan yang telah diposting pada periode ini.",
	},
	{
		key: "operating_result",
		label: "Hasil operasional",
		description: "Kontribusi margin terealisasi dikurangi beban operasional tercatat (sebelum pajak/biaya di luar catatan).",
	},
];

export function missingInputLabel(raw: string): string {
	const [kind, ref] = raw.split(":");
	const short = ref ? ` (${ref.slice(0, 8)})` : "";
	if (kind === "hpp") return `HPP komponen fisik belum lengkap${short}`;
	if (kind === "assumption") return `Asumsi biaya penawaran belum lengkap${short}`;
	if (kind === "policy") return `Kebijakan komersial belum lengkap${short}`;
	if (kind === "settlement") return `Pencairan pembayaran/COD belum direkonsiliasi${short}`;
	if (kind === "source") return `Sumber biaya pesanan belum lengkap${short}`;
	return `Data sumber belum lengkap: ${raw}`;
}
export function formatStatementAmount(
	section: FinancialStatementSection,
): string {
	if (!section.complete || section.amount === null) return "Belum lengkap";
	return rupiah(section.amount);
}

export function formatDashboardMoney(metric: {
	complete: boolean;
	amount: number | null;
}): string {
	if (!metric.complete || metric.amount === null) return "Belum lengkap";
	return rupiah(metric.amount);
}


// ---- Error messages across B16–B19 --------------------------------------------------------------

export const FINANCE_ERROR_MESSAGES: Record<string, string> = {
	VERSION_CONFLICT:
		"Data sudah berubah sejak dialog dibuka. Halaman dimuat ulang; tutup dialog, periksa perubahan terbaru, lalu coba lagi.",
	IDEMPOTENCY_CONFLICT:
		"Kunci permintaan yang sama dikirim dengan isi berbeda. Tutup dialog lalu ulangi tindakan.",
	REAUTHENTICATION_REQUIRED:
		"Konfirmasi kata sandi salah, sudah dipakai, atau kedaluwarsa. Masukkan kembali kata sandi Anda.",
	FRESH_MFA_REQUIRED:
		"Verifikasi dua langkah harus berumur kurang dari 5 menit. Keluar lalu masuk kembali dengan kode autentikator.",
	SETTLEMENT_SOURCE_CHANGED:
		"Pernyataan sumber mutasi ini sudah diperbarui. Halaman dimuat ulang; periksa pernyataan terbaru sebelum mengambil keputusan.",
	SETTLEMENT_SOURCE_PROCESSING_PENDING:
		"Pernyataan sumber terbaru masih diproses sistem. Tunggu sampai selesai lalu muat ulang.",
	SETTLEMENT_STATEMENT_INCOMPLETE:
		"Pernyataan sumber belum memiliki rincian nominal kotor dan biaya yang lengkap.",
	SETTLEMENT_TOTAL_MISMATCH:
		"Nominal kotor pernyataan tidak seimbang dengan dana bersih ditambah biaya kurir dan penyedia.",
	SETTLEMENT_GROSS_EXCEEDED:
		"Total alokasi piutang melebihi nominal kotor pernyataan.",
	DUPLICATE_SETTLEMENT_ALLOCATION:
		"Piutang yang sama tidak boleh dimasukkan dua kali dalam satu pencocokan.",
	SETTLEMENT_RECEIVABLE_UNVERIFIED:
		"Transaksi piutang tidak ditemukan atau bukan piutang yang sah untuk sumber ini.",
	SETTLEMENT_RECEIVABLE_EXCEEDED:
		"Nominal alokasi melebihi sisa piutang yang belum dicocokkan.",
	SETTLEMENT_MATCH_NOT_ACTIVE:
		"Kecocokan ini sudah dilepas atau tidak lagi aktif.",
	SETTLEMENT_DEPENDENT_REVERSAL:
		"Kecocokan tidak dapat dilepas karena memiliki koreksi debit yang masih aktif.",
	PAYOUT_ALREADY_CLAIMED:
		"Pencairan komisi ini sudah diklaim atau sedang diproses.",
	ACTIVE_CLAIM_HOLDER_REQUIRED:
		"Hanya pemegang klaim aktif yang dapat mengunggah bukti atau memverifikasi transfer ini.",
	PAYOUT_CLAIM_EXPIRED:
		"Batas waktu klaim transfer 30 menit sudah habis. Muat ulang halaman.",
	PAYOUT_CLAIM_MISMATCH:
		"ID klaim transfer tidak sesuai dengan klaim aktif saat ini.",
	PAYOUT_EVIDENCE_ALREADY_UPLOADED:
		"Slot bukti ini sudah berisi berkas dengan isi berbeda. Buat slot unggah baru.",
	PAYOUT_EVIDENCE_UPLOAD_EXPIRED:
		"Slot unggah bukti sudah kedaluwarsa (15 menit). Unggah ulang bukti transfer.",
	INVALID_PAYOUT_EVIDENCE_CONTENT:
		"Berkas bukti harus berupa PNG, JPEG, atau PDF yang valid dan sesuai ukuran.",
	UNVERIFIABLE_PAYOUT_EVIDENCE:
		"ID bukti transfer tidak sesuai dengan bukti terakhir pada pencairan ini.",
	PAYOUT_EVIDENCE_NOT_UPLOADED:
		"Berkas bukti transfer belum selesai disimpan. Unggah bukti terlebih dahulu.",
	EVIDENCE_REUSE_FORBIDDEN:
		"Bukti transfer tidak boleh dipakai ulang untuk pencairan lain.",
	DUPLICATE_BANK_TRANSFER_REFERENCE:
		"Referensi transfer bank ini sudah pernah dipakai pada pencairan komisi lain.",
	PAYOUT_ALREADY_SUCCEEDED:
		"Pencairan komisi ini sudah selesai diverifikasi.",
	REFUND_OUTCOME_STILL_AMBIGUOUS:
		"Hasil pengiriman dana masih belum pasti. Jangan kirim ulang; gunakan Rekonsiliasi untuk memeriksa hasil bank.",
	REFUND_ATTEMPTS_EXHAUSTED:
		"Batas jumlah percobaan pengiriman refund telah tercapai.",
	REFUND_SOURCE_MISSING:
		"Data sumber pengembalian dana tidak ditemukan.",
	WINDOW_TOO_WIDE:
		"Rentang waktu laporan tidak boleh melebihi 366 hari.",
};
