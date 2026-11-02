import type { Comparison } from "../../../modules/reporting/metric-math.ts";

// What a delta chip says and how it is toned. Pure, so the wording and the inverted colour of the
// lower-is-better metrics are covered by tests/admin-dashboard-metrics.test.ts.

export type DeltaTone = "good" | "bad" | "neutral";

export interface DeltaView {
	/** The visible chip text: sign and unit ("+12,5%", "-2,0 poin"), or "—" without a delta. */
	text: string;
	/** A visible word for lower-is-better metrics, where an up arrow is bad news ("memburuk"). */
	cue: string | null;
	/** Screen-reader sentence; colour is never the only carrier of the meaning. */
	srText: string;
	direction: "up" | "down" | "flat" | "none";
	tone: DeltaTone;
}

const number = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const points = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const NO_COMPARISON = {
	no_base: "salah satu periode tidak punya nilai dasar",
	incomplete: "ada data yang belum lengkap",
} as const;

export function describeDelta(comparison: Comparison, lowerIsBetter: boolean): DeltaView {
	const { delta, delta_kind: kind, reason } = comparison;
	if (delta === null) {
		return {
			text: "—",
			cue: null,
			srText: `Tidak ada pembanding: ${NO_COMPARISON[reason ?? "no_base"]}`,
			direction: "none",
			tone: "neutral",
		};
	}
	const abs = Math.abs(delta);
	const sign = delta > 0 ? "+" : delta < 0 ? "-" : "";
	const text = kind === "percent" ? `${sign}${number.format(abs)}%` : `${sign}${points.format(abs)} poin`;
	const unit = kind === "percent" ? "persen" : "poin persentase";
	if (delta === 0) {
		return {
			text,
			cue: null,
			srText: "Tidak berubah dibanding periode sebelumnya",
			direction: "flat",
			tone: "neutral",
		};
	}
	const up = delta > 0;
	const good = up !== lowerIsBetter;
	return {
		text,
		cue: lowerIsBetter ? (good ? "membaik" : "memburuk") : null,
		srText: `${up ? "Naik" : "Turun"} ${number.format(abs)} ${unit} dibanding periode sebelumnya${
			lowerIsBetter ? `; makin rendah makin baik, jadi ${good ? "membaik" : "memburuk"}` : ""
		}`,
		direction: up ? "up" : "down",
		tone: good ? "good" : "bad",
	};
}
