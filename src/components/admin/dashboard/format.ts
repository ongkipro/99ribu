// Small display formatters of the dashboard (pure; covered by tests/admin-dashboard-metrics.test.ts).

const percentFormat = new Intl.NumberFormat("id-ID", { style: "percent", minimumFractionDigits: 0, maximumFractionDigits: 1 });

/** A 0..1 rate as "12,5%"; null (no denominator) is an em dash, never "0%". */
export function formatRate(rate: number | null): string {
	return rate === null ? "—" : percentFormat.format(rate);
}

/** How long something has waited: "25 menit", "7 jam", "3 hari". */
export function formatWait(seconds: number): string {
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${Math.max(1, minutes)} menit`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours} jam`;
	return `${Math.floor(hours / 24)} hari`;
}
