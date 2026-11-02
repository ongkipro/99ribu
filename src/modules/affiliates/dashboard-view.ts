// Pure view model of the affiliate dashboard (S158). It takes rows already read for ONE affiliate and
// returns an allow-listed projection: nothing here can carry a buyer name, address, phone, bank data or
// cookie identifier, because the output type has no field for them and the builder copies fields by name.
import { rupiah, wibDate, wibDateTime } from "../storefront/format.ts";

export const WIB_ZONE_LABEL = "WIB (UTC+07:00)";
const WIB_MS = 7 * 3600_000;

export const PERIODS = [
	{ key: "7h", label: "7 hari" },
	{ key: "30h", label: "30 hari" },
	{ key: "bulan", label: "Bulan ini" },
	{ key: "semua", label: "Semua" },
] as const;
export type PeriodKey = (typeof PERIODS)[number]["key"];

export function parsePeriod(value: unknown): PeriodKey {
	return PERIODS.find((p) => p.key === value)?.key ?? "30h";
}

// [from, to) in UTC ISO. "Bulan ini" starts at 00:00 WIB on the 1st; "semua" has no lower bound.
export function periodRange(key: PeriodKey, now: Date) {
	const to = new Date(now.getTime() + 1000).toISOString();
	if (key === "semua") return { from: null, to };
	if (key === "bulan") {
		const wib = new Date(now.getTime() + WIB_MS);
		const start = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), 1) - WIB_MS;
		return { from: new Date(start).toISOString(), to };
	}
	const days = key === "7h" ? 7 : 30;
	return { from: new Date(now.getTime() - days * 86400_000).toISOString(), to };
}

export const COMMISSION_STATES = [
	"pending",
	"held",
	"eligible",
	"allocated",
	"paid",
	"void",
] as const;
export type CommissionState = (typeof COMMISSION_STATES)[number];

export const STATE_LABEL: Record<CommissionState, string> = {
	pending: "Menunggu matang",
	held: "Ditahan",
	eligible: "Siap cair",
	allocated: "Dalam antrean transfer",
	paid: "Sudah dibayar",
	void: "Dibatalkan",
};

export function parseState(value: unknown): CommissionState | null {
	return COMMISSION_STATES.find((s) => s === value) ?? null;
}

// What the data can tell apart for a cancelled unit. A refund row means a return was refunded; an
// exception_cancellation row carries the exception kind. "Klik di luar masa atribusi" never appears:
// such a click has no order, hence no commission row to cancel.
export type VoidBasis = "refund" | "cod_refusal" | "delivery_failure" | "other";

// Maps the facts the query reads about a unit's void to its basis. A refund row beats any exception; an
// exception kind only counts when the query tied it to this void; anything else is a plain cancellation.
export function classifyVoid(refund: boolean | null, exceptionKind: string | null): VoidBasis {
	if (refund) return "refund";
	if (exceptionKind === "cod_refusal" || exceptionKind === "delivery_failure") return exceptionKind;
	return "other";
}

export function reversalReason(basis: VoidBasis | null) {
	if (basis === "refund") return "Barang diretur dan dananya dikembalikan";
	if (basis === "cod_refusal") return "COD tidak diterima pembeli";
	if (basis === "delivery_failure") return "Pesanan tidak terkirim";
	return "Pesanan dibatalkan";
}

export type BalanceInput = {
	pending: number;
	held: number;
	eligible: number;
	allocated: number;
	paid: number;
	minimum_payout: number;
};

export type BalanceDetailInput = {
	pending_next_at: string | null;
	pending_awaiting_receipt: number;
	held_reasons: string[];
	paid_last_at: string | null;
};

export type CommissionRowInput = {
	id: string;
	product_name: string;
	basis_points: number;
	amount_idr: number;
	status: CommissionState;
	hold_reason: string | null;
	receipt_anchor: string | null;
	available_at: string | null;
	replacement: boolean;
	void_basis: VoidBasis | null;
	created_at: string;
};

export type PayoutRowInput = {
	id: string;
	amount: number;
	status: string;
	explanation: string;
	created_at: string;
	completed_at?: string;
};

export type SummaryInput = {
	clicks: number;
	orders: number;
	units: number;
	estimate_idr: number;
	paid_idr: number;
	reversed_units: number;
};

export type DashboardInput = {
	balance: BalanceInput;
	detail: BalanceDetailInput;
	beneficiaryVerified: boolean;
	summary: SummaryInput;
	commissions: CommissionRowInput[];
	payouts: PayoutRowInput[];
};

export function balanceNotes(
	balance: BalanceInput,
	detail: BalanceDetailInput,
	beneficiaryVerified: boolean,
): Record<Exclude<CommissionState, "void">, string> {
	const pending: string[] = [];
	if (detail.pending_next_at)
		pending.push(`Paling cepat matang ${wibDate(detail.pending_next_at)}`);
	if (detail.pending_awaiting_receipt > 0)
		pending.push(
			`${detail.pending_awaiting_receipt} unit menunggu paket diterima pembeli`,
		);
	let eligible = "Belum ada komisi siap cair.";
	if (balance.eligible > 0) {
		if (!beneficiaryVerified)
			eligible = "Menunggu rekening tujuan terverifikasi sebelum masuk antrean.";
		else if (balance.eligible < balance.minimum_payout)
			eligible = `Kurang ${rupiah(balance.minimum_payout - balance.eligible)} dari batas minimum ${rupiah(balance.minimum_payout)}.`;
		else eligible = "Masuk antrean transfer otomatis; keuangan yang mentransfer.";
	}
	return {
		pending: pending.length ? `${pending.join(". ")}.` : "Tidak ada komisi yang menunggu.",
		held: detail.held_reasons.length
			? `${detail.held_reasons.join("; ")}.`
			: "Tidak ada komisi yang ditahan.",
		eligible,
		allocated:
			balance.allocated > 0
				? "Menunggu transfer manual oleh keuangan."
				: "Tidak ada transfer dalam antrean.",
		paid: detail.paid_last_at
			? `Transfer terakhir selesai ${wibDate(detail.paid_last_at)}.`
			: "Belum ada transfer.",
	};
}

export function commissionNote(row: CommissionRowInput) {
	if (row.status === "void") return reversalReason(row.void_basis);
	if (row.status === "held")
		return row.hold_reason ?? "Ditahan sementara.";
	if (row.status === "pending")
		return row.available_at
			? `Matang ${wibDate(row.available_at)}, 10 hari setelah ${row.replacement ? "unit pengganti" : "paket"} diterima.`
			: "Menunggu paket diterima pembeli.";
	if (row.status === "eligible") return "Matang dan siap masuk antrean transfer.";
	if (row.status === "allocated") return "Dalam antrean transfer manual.";
	return "Sudah ditransfer.";
}

export function buildDashboardView(input: DashboardInput) {
	const notes = balanceNotes(input.balance, input.detail, input.beneficiaryVerified);
	const states = (
		["pending", "held", "eligible", "allocated", "paid"] as const
	).map((key) => ({
		key,
		label: STATE_LABEL[key],
		amount: rupiah(input.balance[key]),
		note: notes[key],
	}));
	return {
		summary: {
			clicks: input.summary.clicks,
			orders: input.summary.orders,
			units: input.summary.units,
			reversedUnits: input.summary.reversed_units,
			estimate: rupiah(input.summary.estimate_idr),
			paid: rupiah(input.summary.paid_idr),
		},
		states,
		commissions: input.commissions.map((row) => ({
			id: row.id,
			reference: `SALE-${row.id.replace(/-/g, "").slice(0, 10).toUpperCase()}`,
			product: row.product_name,
			amount: rupiah(row.amount_idr),
			rate: `${(row.basis_points / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`,
			status: row.status,
			statusLabel: STATE_LABEL[row.status],
			note: commissionNote(row),
			soldAt: wibDateTime(row.created_at),
			receivedAt: row.receipt_anchor ? wibDateTime(row.receipt_anchor) : null,
		})),
		payouts: input.payouts.map((row) => ({
			id: row.id,
			amount: rupiah(row.amount),
			status: row.status,
			explanation: row.explanation,
			createdAt: wibDateTime(row.created_at),
			completedAt: row.completed_at ? wibDateTime(row.completed_at) : null,
		})),
	};
}

export type DashboardView = ReturnType<typeof buildDashboardView>;
