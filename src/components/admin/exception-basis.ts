// S133: pure physical basis of a parcel (pick rows, inventory balances) shared by the warehouse
// dialogs and their tests. No imports with side effects: node can load it directly.

export type PickItem = {
	fulfillment_item_id: string;
	order_item_id: string;
	sku: string;
	name: string;
	quantity: number;
	stock_item_id: string;
	lot_id?: string | null;
};
export type FulfillmentRead = {
	id: string;
	order_id: string;
	warehouse_id: string;
	status: string;
	version: number;
	handover_at: string | null;
	shipment_id: string;
	items: { order_item_id: string; fulfillment_item_id: string; quantity: number; cancelled?: boolean }[];
	pick_items: PickItem[];
};
export type Balance = {
	id: string;
	warehouse_id: string;
	stock_item_id: string;
	lot_id: string | null;
	lot_code: string | null;
	on_hand: number;
	reserved: number;
	quarantined: number;
	available: number;
	version: number;
};
export type Component = {
	key: string;
	stock_item_id: string;
	lot_id: string | null;
	name: string;
	sku: string;
	quantity: number;
	balance: Balance | null;
};
/** Pick rows of the chosen units merged per lot (what a count or an intake line addresses). */
export function componentsOf(pick: readonly PickItem[], unitIds: readonly string[], balances: readonly Balance[]): Component[] {
	const merged = new Map<string, Component>();
	for (const row of pick) {
		if (!unitIds.includes(row.fulfillment_item_id)) continue;
		const lot = row.lot_id ?? null;
		const key = `${row.stock_item_id}:${lot ?? "-"}`;
		const found = merged.get(key);
		if (found) found.quantity += row.quantity;
		else
			merged.set(key, {
				key,
				stock_item_id: row.stock_item_id,
				lot_id: lot,
				name: row.name,
				sku: row.sku,
				quantity: row.quantity,
				balance: balances.find((b) => b.stock_item_id === row.stock_item_id && (b.lot_id ?? null) === lot) ?? null,
			});
	}
	return [...merged.values()];
}
