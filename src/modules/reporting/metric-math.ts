// Pure dashboard arithmetic (DEC-027): WIB period boundaries, the previous-period shift, the
// comparison delta and the rate formulas. No imports, so it runs in the console bundle and in a plain
// unit test; the SQL that feeds it lives in sources.ts and dashboard.ts.

/** Asia/Jakarta is UTC+7 all year (no daylight saving), so a day is always 86,400,000 ms. */
export const WIB_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** The period presets (DEC-027 (1)). Days are WIB calendar days, today included. */
export const PERIOD_PRESET_DAYS = { today: 1, yesterday: 1, "7d": 7, "30d": 30 } as const;
export type PeriodPreset = keyof typeof PERIOD_PRESET_DAYS;

export function isPeriodPreset(value: string): value is PeriodPreset {
	return Object.hasOwn(PERIOD_PRESET_DAYS, value);
}

/** Epoch ms of 00:00 WIB of the day containing `ms`. */
export function startOfWibDay(ms: number): number {
	return Math.floor((ms + WIB_OFFSET_MS) / DAY_MS) * DAY_MS - WIB_OFFSET_MS;
}

export interface ResolvedPeriod {
	from: string;
	to: string;
	/** How far the previous period of equal length lies back, in ms. */
	shiftMs: number;
}

/**
 * Hari ini / Kemarin / 7 hari / 30 hari at `nowMs`. Queries use `<= to`, so a finished day ends one
 * millisecond before the next WIB midnight; a running period ends one minute after now (the same
 * slack the rolling windows have always had).
 */
export function resolvePeriodPreset(preset: PeriodPreset, nowMs: number): ResolvedPeriod {
	const today = startOfWibDay(nowMs);
	const days = PERIOD_PRESET_DAYS[preset];
	if (preset === "yesterday") {
		return {
			from: new Date(today - DAY_MS).toISOString(),
			to: new Date(today - 1).toISOString(),
			shiftMs: DAY_MS,
		};
	}
	return {
		from: new Date(today - (days - 1) * DAY_MS).toISOString(),
		to: new Date(nowMs + MINUTE_MS).toISOString(),
		shiftMs: days * DAY_MS,
	};
}

/**
 * The previous period of equal length: the same range shifted back by `shiftMs`. A preset shifts by
 * whole WIB days (so "hari ini" is compared with the same elapsed hours of yesterday); any other range
 * shifts by its own length.
 */
export function previousPeriod(
	from: string,
	to: string,
	shiftMs?: number,
): { from: string; to: string } {
	const fromMs = Date.parse(from);
	const toMs = Date.parse(to);
	const shift = shiftMs ?? toMs - fromMs;
	return {
		from: new Date(fromMs - shift).toISOString(),
		to: new Date(toMs - shift).toISOString(),
	};
}

export type DeltaKind = "percent" | "points";

export interface Comparison {
	/** The previous period's value in the metric's own unit (count, rupiah, or a 0..1 rate). */
	previous: number | null;
	/** Percent change, or percentage points for a rate; null when there is nothing honest to show. */
	delta: number | null;
	delta_kind: DeltaKind;
	/** Why `delta` is null: no usable base in the previous period, or an input of either side is incomplete. */
	reason: "no_base" | "incomplete" | null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Delta against the previous period. Percent needs a non-zero base and divides by its magnitude, so a
 * contribution going from -100 to -50 reads as an improvement (+50%); points (rates) need a rate on
 * both sides (a zero rate is a real base, an undefined one is not). An input flagged incomplete on
 * either side gives no delta ("incomplete"); a value that is simply absent (no orders, no
 * denominator) is "no_base".
 */
export function computeComparison(
	kind: DeltaKind,
	current: number | null,
	previous: number | null,
	complete: { current: boolean; previous: boolean },
): Comparison {
	if (!complete.current || !complete.previous) {
		return { previous: complete.previous ? previous : null, delta: null, delta_kind: kind, reason: "incomplete" };
	}
	if (current === null || previous === null || (kind === "percent" && previous === 0)) {
		return { previous, delta: null, delta_kind: kind, reason: "no_base" };
	}
	const delta = kind === "percent" ? ((current - previous) / Math.abs(previous)) * 100 : (current - previous) * 100;
	return { previous, delta: round1(delta), delta_kind: kind, reason: null };
}

/**
 * A rate shown as a percentage needs at least this many in its denominator (return_rate); below it
 * the tile shows the count and the denominator with a dash. Setting candidate: a constant for now,
 * like STALE_AFTER_HOURS (DEC-027 (4): thresholds are settings once a settings surface exists).
 */
export const MIN_RATE_SAMPLE = 10;

/**
 * numerator / denominator as a 0..1 fraction; null when nothing was in the denominator (never 0) or
 * when it is smaller than `minSample` (a percentage of two parcels is noise).
 */
export function rateOf(numerator: number, denominator: number, minSample = 1): number | null {
	return denominator > 0 && denominator >= minSample ? numerator / denominator : null;
}

/** Whole-rupiah average (net revenue / orders); null with no orders. */
export function averageOf(total: number, count: number): number | null {
	return count > 0 ? Math.round(total / count) : null;
}

/** For these metrics a rise is bad: the chip colours invert and the text says so (DEC-027, spec 17 W4-2). */
export const LOWER_IS_BETTER = new Set(["fulfillments_overdue", "cod_failed_rate", "return_rate"]);

const HOUR_MS = 3_600_000;
/** Series stay readable and cheap: never more buckets than this (a 365-day window is 365 days). */
const SERIES_MAX_BUCKETS = 400;

export interface SeriesBuckets {
	unit: "hour" | "day";
	stepMs: number;
	/** Epoch ms of each bucket start; hours on the hour, days at 00:00 WIB. */
	starts: number[];
}

/**
 * Chart buckets for [fromMs, toMs]: hourly up to two days, otherwise WIB days (spec 17 W4-2).
 * Pass the earlier of `to` and "now" so a future bucket is never drawn.
 */
export function seriesBuckets(fromMs: number, toMs: number): SeriesBuckets {
	const unit = toMs - fromMs <= 2 * DAY_MS ? "hour" : "day";
	const stepMs = unit === "hour" ? HOUR_MS : DAY_MS;
	const first = unit === "hour" ? Math.floor(fromMs / HOUR_MS) * HOUR_MS : startOfWibDay(fromMs);
	const starts: number[] = [];
	for (let t = first; t <= toMs && starts.length < SERIES_MAX_BUCKETS; t += stepMs) starts.push(t);
	return { unit, stepMs, starts };
}

/**
 * Where the COD receivable ageing buckets start, in whole days since the parcel was handed to the
 * courier. These edges are a display choice, not a policy: nothing in the system reads them.
 */
export const COD_AGEING_EDGES_DAYS = [0, 3, 7, 14] as const;

export interface AgeingBucket {
	label: string;
	from_days: number;
	/** Last whole day in the bucket; null for the open-ended last bucket. */
	to_days: number | null;
	parcels: number;
	amount: number;
}

/** Sums per-age rows into the display buckets; every bucket is present, empty ones with 0 parcels. */
export function bucketCodAgeing(
	rows: { age_days: number; amount: number; parcels: number }[],
	edges: readonly number[] = COD_AGEING_EDGES_DAYS,
): AgeingBucket[] {
	const buckets: AgeingBucket[] = edges.map((from_days, i) => {
		const to_days = i + 1 < edges.length ? edges[i + 1] - 1 : null;
		return {
			label: to_days === null ? `${from_days}+ hari` : `${from_days}–${to_days} hari`,
			from_days,
			to_days,
			parcels: 0,
			amount: 0,
		};
	});
	for (const row of rows) {
		const age = Math.max(0, row.age_days);
		let target = buckets[0];
		for (const b of buckets) if (age >= b.from_days) target = b;
		target.parcels += row.parcels;
		target.amount += row.amount;
	}
	return buckets;
}
