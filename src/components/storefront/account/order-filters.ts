import type { AccountOrder, OrderStage } from "../../../modules/accounts/order-summary.ts";

export type OrderFilter = "all" | OrderStage;
export const ORDER_FILTERS: { value: OrderFilter; label: string }[] = [
	{ value: "all", label: "Semua" },
	{ value: "unpaid", label: "Belum bayar" },
	{ value: "processing", label: "Diproses" },
	{ value: "shipped", label: "Dikirim" },
	{ value: "delivered", label: "Selesai" },
	{ value: "closed", label: "Ditutup" },
];

function normalizedNumber(value: string) {
	return value.trim().toUpperCase().replace(/^99\s*-\s*/, "");
}

export function filterAccountOrders(orders: AccountOrder[], filter: OrderFilter, query: string) {
	const search = normalizedNumber(query);
	return orders.filter((order) =>
		(filter === "all" || order.stage === filter) &&
		normalizedNumber(order.number).includes(search),
	);
}

export function countAccountOrders(orders: AccountOrder[]): Record<OrderFilter, number> {
	const counts = { all: orders.length, unpaid: 0, processing: 0, shipped: 0, delivered: 0, closed: 0 };
	for (const order of orders) counts[order.stage] += 1;
	return counts;
}

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "Asia/Jakarta",
});
export const accountOrderDate = (iso: string) => `${dateFormatter.format(new Date(iso))} WIB`;
