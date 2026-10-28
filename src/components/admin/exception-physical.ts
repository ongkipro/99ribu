"use client";

import { type ApiFailure, getJson } from "./admin-errors";
import type { Balance, FulfillmentRead } from "./exception-basis";

export type { Balance, Component, FulfillmentRead, PickItem } from "./exception-basis";
export { componentsOf } from "./exception-basis";

// S133: the warehouse dialogs (stock count, returned goods) need the physical basis of a parcel:
// its pick rows (component, lot, quantity per complete unit) and the current balance ids and
// versions of those lots. Both exist in the fulfillment and inventory APIs already; the screen
// only joins them. The domain re-verifies every id, version and quantity on submit.

type Read<T> = { ok: true; data: T } | { ok: false; failure: ApiFailure };

export async function readFulfillment(fulfillmentId: string): Promise<Read<FulfillmentRead>> {
	return getJson<FulfillmentRead>(`/api/v1/admin/fulfillments/${encodeURIComponent(fulfillmentId)}`);
}

/** The original parcel's fulfillment: the exception unit only carries the shipment id. */
export async function readFulfillmentOfShipment(shipmentId: string): Promise<Read<FulfillmentRead>> {
	const parcel = await getJson<{ fulfillment_id: string }>(`/api/v1/admin/shipments/${encodeURIComponent(shipmentId)}`);
	if (!parcel.ok) return parcel;
	return readFulfillment(parcel.data.fulfillment_id);
}

/** Current balances (id, version, quantities) of the lots of these physical items in one warehouse. */
export async function readBalances(warehouseId: string, stockItemIds: readonly string[]): Promise<Read<Balance[]>> {
	const out: Balance[] = [];
	for (const stockItemId of new Set(stockItemIds)) {
		let cursor: string | null = null;
		for (let page = 0; page < 5; page++) {
			const params = new URLSearchParams({ warehouse_id: warehouseId, stock_item_id: stockItemId, limit: "100" });
			if (cursor) params.set("cursor", cursor);
			const read: Read<{ data: Balance[]; pagination?: { next_cursor: string | null } }> = await getJson(
				`/api/v1/admin/inventory?${params}`,
			);
			if (!read.ok) return read;
			out.push(...read.data.data);
			cursor = read.data.pagination?.next_cursor ?? null;
			if (!cursor) break;
		}
	}
	return { ok: true, data: out };
}

