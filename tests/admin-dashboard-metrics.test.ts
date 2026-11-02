import assert from "node:assert/strict";
import test from "node:test";
import { describeDelta } from "../src/components/admin/dashboard/delta-text.ts";
import { formatRate, formatWait } from "../src/components/admin/dashboard/format.ts";
import { needsActionRows } from "../src/components/admin/dashboard/needs-action-model.ts";
import {
	averageOf,
	bucketCodAgeing,
	computeComparison,
	LOWER_IS_BETTER,
	MIN_RATE_SAMPLE,
	previousPeriod,
	rateOf,
	resolvePeriodPreset,
	seriesBuckets,
	startOfWibDay,
} from "../src/modules/reporting/metric-math.ts";
import { COMPARABLE_METRICS, SNAPSHOT_METRICS } from "../src/modules/reporting/shared.ts";

// DEC-027 (1): every period boundary is a WIB (UTC+7) boundary.
const at = (iso: string) => Date.parse(iso);

test("startOfWibDay: 16:59 UTC is still the same WIB day, 17:00 UTC starts the next", () => {
	// 2026-11-02 00:00 WIB = 2026-11-01 17:00 UTC
	assert.equal(new Date(startOfWibDay(at("2026-11-01T16:59:59.999Z"))).toISOString(), "2026-10-31T17:00:00.000Z");
	assert.equal(new Date(startOfWibDay(at("2026-11-01T17:00:00.000Z"))).toISOString(), "2026-11-01T17:00:00.000Z");
	assert.equal(new Date(startOfWibDay(at("2026-11-02T10:00:00.000Z"))).toISOString(), "2026-11-01T17:00:00.000Z");
});

test("presets around WIB midnight", () => {
	// 23:30 WIB on 2 Nov = 16:30 UTC; Hari ini still starts 2 Nov 00:00 WIB.
	const late = at("2026-11-02T16:30:00.000Z");
	assert.equal(resolvePeriodPreset("today", late).from, "2026-11-01T17:00:00.000Z");
	// 00:10 WIB on 3 Nov = 17:10 UTC on 2 Nov; Hari ini restarted, Kemarin is the whole of 2 Nov WIB.
	const early = at("2026-11-02T17:10:00.000Z");
	assert.equal(resolvePeriodPreset("today", early).from, "2026-11-02T17:00:00.000Z");
	const yesterday = resolvePeriodPreset("yesterday", early);
	assert.equal(yesterday.from, "2026-11-01T17:00:00.000Z");
	assert.equal(yesterday.to, "2026-11-02T16:59:59.999Z");
	assert.equal(yesterday.shiftMs, 86_400_000);
});

test("7 hari and 30 hari are WIB calendar days with today included", () => {
	const now = at("2026-11-02T03:00:00.000Z"); // 10:00 WIB on 2 Nov
	const seven = resolvePeriodPreset("7d", now);
	assert.equal(seven.from, "2026-10-26T17:00:00.000Z"); // 27 Oct 00:00 WIB: 27 Oct..2 Nov = 7 days with today
	assert.equal(Date.parse(seven.to) - now, 60_000);
	assert.equal(seven.shiftMs, 7 * 86_400_000);
	const thirty = resolvePeriodPreset("30d", now);
	assert.equal(thirty.from, "2026-10-03T17:00:00.000Z");
	assert.equal(thirty.shiftMs, 30 * 86_400_000);
});

test("the previous period has equal length and is shifted by whole days for a preset", () => {
	const now = at("2026-11-02T03:00:00.000Z");
	const today = resolvePeriodPreset("today", now);
	const prevToday = previousPeriod(today.from, today.to, today.shiftMs);
	assert.equal(prevToday.from, "2026-10-31T17:00:00.000Z"); // 1 Nov 00:00 WIB
	assert.equal(Date.parse(prevToday.to) - Date.parse(prevToday.from), Date.parse(today.to) - Date.parse(today.from));
	const week = resolvePeriodPreset("7d", now);
	const prevWeek = previousPeriod(week.from, week.to, week.shiftMs);
	assert.equal(prevWeek.to, new Date(Date.parse(week.to) - 7 * 86_400_000).toISOString());
	// A custom range shifts by its own length.
	const custom = previousPeriod("2026-10-10T00:00:00.000Z", "2026-10-20T00:00:00.000Z");
	assert.deepEqual(custom, { from: "2026-09-30T00:00:00.000Z", to: "2026-10-10T00:00:00.000Z" });
});

const both = { current: true, previous: true };

test("percent delta against a previous value", () => {
	assert.deepEqual(computeComparison("percent", 150, 100, both), { previous: 100, delta: 50, delta_kind: "percent", reason: null });
	assert.equal(computeComparison("percent", 50, 100, both).delta, -50);
	assert.equal(computeComparison("percent", 100, 100, both).delta, 0);
	assert.equal(computeComparison("percent", 1, 3, both).delta, -66.7);
});

test("a zero base gives no percent delta, never Infinity or 0", () => {
	const c = computeComparison("percent", 40, 0, both);
	assert.equal(c.delta, null);
	assert.equal(c.reason, "no_base");
});

test("an incomplete input on either side gives no delta", () => {
	assert.equal(computeComparison("percent", 100, 80, { current: false, previous: true }).reason, "incomplete");
	assert.equal(computeComparison("percent", null, 80, both).delta, null);
	const prevIncomplete = computeComparison("percent", 100, 80, { current: true, previous: false });
	assert.equal(prevIncomplete.delta, null);
	assert.equal(prevIncomplete.previous, null);
	assert.equal(prevIncomplete.reason, "incomplete");
	// A missing previous value is "no base", not incomplete.
	assert.equal(computeComparison("points", 0.2, null, both).reason, "no_base");
});

test("a rate compares in percentage points, and a zero previous rate is a real base", () => {
	assert.equal(computeComparison("points", 0.12, 0.1, both).delta, 2);
	assert.equal(computeComparison("points", 0.05, 0.1, both).delta, -5);
	const fromZero = computeComparison("points", 0.04, 0, both);
	assert.equal(fromZero.delta, 4);
	assert.equal(fromZero.reason, null);
});

test("rate and average formulas on fixture rows", () => {
	// COD parcels with an outcome in the period: 2 refused or failed of 8.
	const cod = [true, false, false, false, true, false, false, false].map((failed) => ({ failed }));
	assert.equal(rateOf(cod.filter((p) => p.failed).length, cod.length), 0.25);
	// Return cases opened over orders delivered: 3 / 12.
	assert.equal(rateOf(3, 12), 0.25);
	// No denominator is unavailable, not 0%.
	assert.equal(rateOf(0, 0), null);
	assert.equal(rateOf(5, 0), null);
	// A real zero rate stays 0.
	assert.equal(rateOf(0, 9), 0);
	// Net merchandise revenue 1,250,000 over 7 orders, whole rupiah.
	assert.equal(averageOf(1_250_000, 7), 178_571);
	assert.equal(averageOf(1_250_000, 0), null);
	assert.equal(averageOf(0, 4), 0);
});

test("delta chip wording: sign, unit, and inverted tone for lower-is-better metrics", () => {
	const up = computeComparison("percent", 120, 100, both);
	const revenue = describeDelta(up, false);
	assert.equal(revenue.text, "+20%");
	assert.equal(revenue.tone, "good");
	assert.equal(revenue.direction, "up");
	assert.equal(revenue.cue, null);
	// The same rise on a lower-is-better metric is bad news, in words as well as tone.
	const overdue = describeDelta(up, true);
	assert.equal(overdue.tone, "bad");
	assert.equal(overdue.cue, "memburuk");
	assert.match(overdue.srText, /makin rendah makin baik/);
	assert.equal(describeDelta(computeComparison("points", 0.05, 0.1, both), true).tone, "good");
	assert.equal(describeDelta(computeComparison("points", 0.12, 0.1, both), true).text, "+2,0 poin");
	assert.equal(describeDelta(computeComparison("percent", 100, 100, both), false).tone, "neutral");
	// No delta: a dash with a spoken reason, never colour.
	const none = describeDelta(computeComparison("percent", 5, 0, both), false);
	assert.equal(none.text, "—");
	assert.equal(none.direction, "none");
	assert.match(none.srText, /Tidak ada pembanding/);
	assert.match(describeDelta(computeComparison("percent", 5, 4, { current: false, previous: true }), false).srText, /belum lengkap/);
});

test("rate and wait formatting: an undefined rate is a dash, not 0%", () => {
	assert.equal(formatRate(null), "—");
	assert.equal(formatRate(0), "0%");
	assert.equal(formatRate(0.125), "12,5%");
	assert.equal(formatWait(10), "1 menit");
	assert.equal(formatWait(25 * 60), "25 menit");
	assert.equal(formatWait(7 * 3600), "7 jam");
	assert.equal(formatWait(47 * 3600), "47 jam");
	assert.equal(formatWait(72 * 3600), "3 hari");
});

test("chart buckets: hourly up to two days, WIB days beyond, none in the future", () => {
	const now = at("2026-11-02T03:30:00.000Z"); // 10:30 WIB
	const today = resolvePeriodPreset("today", now);
	const hours = seriesBuckets(Date.parse(today.from), Math.min(Date.parse(today.to), now));
	assert.equal(hours.unit, "hour");
	assert.equal(hours.starts.length, 11); // 00:00 to 10:00 WIB
	assert.equal(new Date(hours.starts[0]).toISOString(), "2026-11-01T17:00:00.000Z");
	const week = resolvePeriodPreset("7d", now);
	const days = seriesBuckets(Date.parse(week.from), Math.min(Date.parse(week.to), now));
	assert.equal(days.unit, "day");
	assert.equal(days.starts.length, 7);
	assert.ok(days.starts.every((t) => (t + 7 * 3_600_000) % 86_400_000 === 0), "day buckets start at 00:00 WIB");
	const yesterday = resolvePeriodPreset("yesterday", now);
	assert.equal(seriesBuckets(Date.parse(yesterday.from), Date.parse(yesterday.to)).starts.length, 24);
});

test("COD ageing buckets add up to the receivable and keep every bucket", () => {
	const rows = [
		{ age_days: 0, amount: 50_000, parcels: 2 },
		{ age_days: 2, amount: 20_000, parcels: 1 },
		{ age_days: 3, amount: 99_000, parcels: 1 },
		{ age_days: 13, amount: 30_000, parcels: 1 },
		{ age_days: 40, amount: 10_000, parcels: 1 },
		{ age_days: -1, amount: 5_000, parcels: 1 }, // clock skew counts as new, never dropped
	];
	const buckets = bucketCodAgeing(rows);
	assert.deepEqual(buckets.map((b) => b.label), ["0–2 hari", "3–6 hari", "7–13 hari", "14+ hari"]);
	assert.deepEqual(buckets.map((b) => b.amount), [75_000, 99_000, 30_000, 10_000]);
	assert.deepEqual(buckets.map((b) => b.parcels), [4, 1, 1, 1]);
	assert.equal(buckets.reduce((n, b) => n + b.amount, 0), rows.reduce((n, r) => n + r.amount, 0));
	assert.equal(bucketCodAgeing([]).every((b) => b.amount === 0 && b.parcels === 0), true);
});

test("snapshot metrics are never comparable; lower-is-better metrics are the three named in DEC-027", () => {
	for (const key of SNAPSHOT_METRICS) assert.equal(COMPARABLE_METRICS.has(key), false, key);
	for (const key of ["fulfillments_overdue", "cod_failed_rate", "return_rate"]) assert.ok(LOWER_IS_BETTER.has(key));
	assert.equal(LOWER_IS_BETTER.has("net_merchandise_revenue"), false);
	// New snapshot metrics are registered as snapshots.
	assert.ok(SNAPSHOT_METRICS.has("fulfillments_overdue"));
	assert.ok(SNAPSHOT_METRICS.has("oldest_unclaimed_chat_age"));
	// Work counts are live (DEC-027 (2)): the backlog an overdue chip belongs to is a snapshot too.
	assert.ok(SNAPSHOT_METRICS.has("fulfillments_due"));
	assert.ok(SNAPSHOT_METRICS.has("cod_problems_open"));
});

test("a negative base divides by its magnitude: -100 to -50 is an improvement", () => {
	const better = computeComparison("percent", -50, -100, both);
	assert.equal(better.delta, 50);
	assert.equal(better.reason, null);
	assert.equal(computeComparison("percent", -150, -100, both).delta, -50);
	assert.equal(computeComparison("percent", 20, -100, both).delta, 120);
	assert.equal(computeComparison("percent", -20, 100, both).delta, -120);
});

test("a missing current value (no denominator) is no_base, not incomplete", () => {
	const c = computeComparison("points", null, 0.1, both);
	assert.equal(c.delta, null);
	assert.equal(c.reason, "no_base");
	assert.equal(computeComparison("percent", null, 80, both).reason, "no_base");
	assert.equal(computeComparison("percent", 10, 80, { current: false, previous: true }).reason, "incomplete");
});

test("a rate below the minimum sample is unavailable, at the minimum it is a number, above 100% it is kept", () => {
	assert.equal(rateOf(1, MIN_RATE_SAMPLE - 1, MIN_RATE_SAMPLE), null);
	assert.equal(rateOf(1, MIN_RATE_SAMPLE, MIN_RATE_SAMPLE), 1 / MIN_RATE_SAMPLE);
	assert.equal(rateOf(15, MIN_RATE_SAMPLE, MIN_RATE_SAMPLE), 1.5);
	// Without a minimum the old rule holds: any non-empty denominator.
	assert.equal(rateOf(1, 2), 0.5);
});

const metricRow = (key: string, count: number | null, extra: Record<string, unknown> = {}) => ({
	key,
	kind: "count",
	count,
	complete: true,
	...extra,
});

test("Perlu tindakan: an old overdue parcel stays visible with its backlog even when the period count is 0", () => {
	// "Hari ini": nothing created today, but one parcel from last week is past its deadline.
	const hidden = needsActionRows([metricRow("fulfillments_due", 0), metricRow("fulfillments_overdue", 1)]);
	assert.equal(hidden.length, 1);
	assert.equal(hidden[0].item.key, "fulfillments_due");
	assert.equal(hidden[0].count, 1, "the row never shows fewer parcels than are overdue");
	assert.equal(hidden[0].overdue?.key, "fulfillments_overdue");
	// With a live backlog the chip is a subset of the row's own count.
	const live = needsActionRows([metricRow("fulfillments_due", 4), metricRow("fulfillments_overdue", 1)]);
	assert.equal(live[0].count, 4);
	assert.equal(live[0].overdue?.count, 1);
	// No backlog and nothing overdue: no row. An incomplete overdue metric adds no chip.
	assert.equal(needsActionRows([metricRow("fulfillments_due", 0), metricRow("fulfillments_overdue", 0)]).length, 0);
	const incomplete = needsActionRows([metricRow("fulfillments_due", 2), metricRow("fulfillments_overdue", 1, { complete: false })]);
	assert.equal(incomplete[0].overdue, null);
});

test("Perlu tindakan: the COD row is the open problems, not the period rate, and rows keep deadline-risk order", () => {
	const rows = needsActionRows([
		metricRow("cod_failed_rate", 3, { kind: "rate" }),
		metricRow("cod_problems_open", 0),
		metricRow("orders_pending", 2),
		metricRow("fulfillments_due", 1),
	]);
	assert.deepEqual(rows.map((r) => r.item.key), ["fulfillments_due", "orders_pending"]);
	const withCod = needsActionRows([metricRow("cod_problems_open", 2), metricRow("fulfillments_due", 1)]);
	assert.deepEqual(withCod.map((r) => r.item.key), ["fulfillments_due", "cod_problems_open"]);
});
