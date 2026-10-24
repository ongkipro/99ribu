// One formatter set for the console's order and shipping screens: IDR through the
// storefront's `rupiah`, times always in WIB with the zone written out.
import { wibDateTime } from "../../modules/storefront/format.ts";

export { rupiah } from "../../modules/storefront/format.ts";

export const formatWib = (value: string | null | undefined) =>
	value ? wibDateTime(value) : "—";

const decimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
export const formatKg = (grams: number) => `${decimal.format(grams / 1000)} kg`;
export const formatCm = (mm: number) => decimal.format(mm / 10);

// Payment terms keep the COD fee in basis points; staff read and type a percent.
export const bpsToPercent = (bps: number) =>
	(bps / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 });
/** "3,33" or "3.33" → 333; null unless 0–100 with at most two decimals. */
export function percentToBps(value: string) {
	const clean = value.trim().replace(",", ".");
	if (!/^\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
	const bps = Math.round(Number(clean) * 100);
	return bps <= 10_000 ? bps : null;
}
