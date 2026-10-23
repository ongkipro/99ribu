// One formatter set for the console's order and shipping screens: IDR through the
// storefront's `rupiah`, times always in WIB with the zone written out.
export { rupiah } from "@/modules/storefront/format";

const wib = new Intl.DateTimeFormat("id-ID", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "Asia/Jakarta",
});
export const formatWib = (value: string | null | undefined) =>
	value ? `${wib.format(new Date(value))} WIB` : "—";

const decimal = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });
export const formatKg = (grams: number) => `${decimal.format(grams / 1000)} kg`;
export const formatCm = (mm: number) => decimal.format(mm / 10);
