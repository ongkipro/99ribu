// S160 / spec 17 W4-8: an offer's available units are never typed. They are the minimum, over its
// components, of (component available in the chosen warehouse / quantity per offer), rounded down
// (the same rule as PR-2). This names the component that sets that minimum ("Terbatas oleh").

export type OfferContent = { stock_item_id: string; name: string; quantity: number };
/** The part of a stock position this math needs; one row per lot, so a component may repeat. */
export type StockPosition = { warehouse_id: string; stock_item_id: string; available: number };

export type Limiting = {
	stock_item_id: string;
	name: string;
	/** Available units of this component in the warehouse (all lots summed). */
	available: number;
	/** Quantity of this component in one offer. */
	per_offer: number;
};
export type OfferAvailability = { units: number; limiting: Limiting | null };

export function offerAvailability(
	contents: readonly OfferContent[],
	positions: readonly StockPosition[],
	warehouseId: string,
): OfferAvailability {
	const have = new Map<string, number>();
	for (const p of positions)
		if (p.warehouse_id === warehouseId)
			have.set(p.stock_item_id, (have.get(p.stock_item_id) ?? 0) + Math.max(0, p.available));
	let best: OfferAvailability = { units: 0, limiting: null };
	let bestRatio = Number.POSITIVE_INFINITY;
	for (const c of contents) {
		if (!(c.quantity >= 1)) continue;
		const available = have.get(c.stock_item_id) ?? 0;
		const ratio = available / c.quantity;
		// Strictly lower wins, so on a tie the first listed component is named.
		if (ratio < bestRatio) {
			bestRatio = ratio;
			best = {
				units: Math.floor(ratio),
				limiting: { stock_item_id: c.stock_item_id, name: c.name, available, per_offer: c.quantity },
			};
		}
	}
	return best;
}

/** "Terbatas oleh: Kopi 250 g (3)"; with more than one per offer the division is shown: "(7 ÷ 2)". */
export function limitingHint(limiting: Limiting): string {
	const n = limiting.per_offer > 1 ? `${limiting.available} ÷ ${limiting.per_offer}` : String(limiting.available);
	return `Terbatas oleh: ${limiting.name} (${n})`;
}
