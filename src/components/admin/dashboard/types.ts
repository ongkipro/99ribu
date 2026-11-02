// Wire shapes of the dashboard additions (S153). The server side is src/modules/reporting/dashboard.ts;
// the contract is DashboardSnapshot in docs/spec/openapi.yaml.

import type { AgeingBucket } from "../../../modules/reporting/metric-math.ts";

export type { AgeingBucket, Comparison } from "../../../modules/reporting/metric-math.ts";

export interface SeriesPoint {
	/** ISO instant of the bucket start (an hour, or 00:00 WIB of a day). */
	start: string;
	/** Net merchandise revenue in whole rupiah (verified receipts minus completed refund allocations). */
	revenue: number;
	orders: number;
}

export interface DashboardSeries {
	bucket: "hour" | "day";
	points: SeriesPoint[];
	/** Same buckets shifted back by the comparison; null unless compare=previous. */
	previous: SeriesPoint[] | null;
}

export interface CodAgeingData {
	edges_are_display_choice: true;
	buckets: AgeingBucket[];
	total: number;
}
