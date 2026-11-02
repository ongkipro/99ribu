// Pure rows of the "Perlu tindakan" panel (DEC-027 (2), (3)). Kept apart from the component so the
// rule runs in a plain unit test.

export interface NeedsActionMetric {
	key: string;
	kind: string;
	count: number | null;
	complete: boolean;
	/** Rows of `count` waiting more than 24 hours (server-side FILTER over the same fragment). */
	stale_count?: number | null;
	/** Oldest unclaimed chat only: seconds waited. */
	age_seconds?: number | null;
	/** `event_period` rows are counted for the selected period only; `snapshot` rows are the live backlog. */
	basis?: string;
}

export interface NeedsActionItem {
	key: string;
	label: string;
	unit: string;
	/** A companion metric whose count is a subset needing attention first (a deadline passed). */
	overdueKey?: string;
	/** A companion metric that states the oldest waiting time. */
	ageKey?: string;
}

// Deadline risk, highest first (DEC-027 (3)). Complaints are not a separate record in 99ribu: they
// arrive as returns and chats. The COD row is the OPEN problems (a live backlog); the period rate
// stays its own card.
export const NEEDS_ACTION_ITEMS: NeedsActionItem[] = [
	{ key: "fulfillments_due", label: "Perlu dikirim", unit: "paket", overdueKey: "fulfillments_overdue" },
	{ key: "orders_pending", label: "Pesanan baru belum diproses", unit: "pesanan" },
	{ key: "cod_problems_open", label: "COD ditolak atau gagal, belum selesai", unit: "kasus" },
	{ key: "delivery_exceptions", label: "Kendala pengiriman", unit: "kasus" },
	{ key: "returns_pending", label: "Retur terbuka", unit: "retur" },
	{ key: "support_unassigned", label: "Chat belum diklaim", unit: "percakapan", ageKey: "oldest_unclaimed_chat_age" },
	{ key: "transfers_near_deadline", label: "Transfer hampir kedaluwarsa", unit: "transfer" },
	{ key: "autolaris_pending", label: "Menunggu bayar VA/QRIS", unit: "pesanan" },
	{ key: "stock_alerts", label: "Stok menipis", unit: "SKU" },
];

export interface NeedsActionRow<T extends NeedsActionMetric> {
	item: NeedsActionItem;
	m: T;
	/** Shown count: never below the overdue count, which is a subset of the same backlog. */
	count: number;
	overdue: T | null;
	age: T | undefined;
}

/**
 * A row exists when its backlog is not empty. The overdue chip is never dropped because the row's own
 * count is small: overdue parcels are part of the backlog by definition, so the row shows at least that
 * many (a server that scoped the backlog to a period could otherwise hide an old overdue parcel).
 */
export function needsActionRows<T extends NeedsActionMetric>(metrics: T[]): NeedsActionRow<T>[] {
	const byKey = new Map(metrics.map((m) => [m.key, m]));
	return NEEDS_ACTION_ITEMS.flatMap((item) => {
		const m = byKey.get(item.key);
		if (!m) return [];
		const overdueMetric = item.overdueKey ? byKey.get(item.overdueKey) : undefined;
		const overdue = overdueMetric?.complete && Number(overdueMetric.count) > 0 ? overdueMetric : null;
		const own = m.complete ? Number(m.count) || 0 : 0;
		const count = Math.max(own, overdue ? Number(overdue.count) : 0);
		if (count <= 0) return [];
		return [{ item, m, count, overdue, age: item.ageKey ? byKey.get(item.ageKey) : undefined }];
	});
}
