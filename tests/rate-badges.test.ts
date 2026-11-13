import assert from "node:assert/strict";
import test from "node:test";
import { etaDays, rateBadges } from "../src/components/storefront/rate-badges.ts";

// Checkout courier badges (2026-11-06): options arrive sorted by price.
const o = (id: string, service_name: string) => ({ id, service_name });

test("Termurah marks the first (cheapest) option and Tercepat the unique quickest when every option has an ETA", () => {
	const badges = rateBadges([o("a", "Reguler, 2-3 hari"), o("b", "Reguler, 1-2 hari"), o("c", "Kargo, 4 hari")]);
	assert.deepEqual([...badges], [["a", ["Termurah"]], ["b", ["Tercepat"]]]);
	assert.deepEqual([...rateBadges([o("a", "Reguler, 1 hari"), o("b", "Reguler, 2 hari")])], [["a", ["Termurah", "Tercepat"]]], "one option can be both");
});

test("no Tercepat when an ETA is missing or the quickest is tied; no badges for a single option", () => {
	assert.deepEqual([...rateBadges([o("a", "Reguler"), o("b", "Reguler, 1-2 hari")])], [["a", ["Termurah"]]], "unknown ETA is not comparable");
	assert.deepEqual([...rateBadges([o("a", "Reguler, 1-2 hari"), o("b", "Reguler, 2 hari")])], [["a", ["Termurah"]]], "a tie on the upper bound picks none");
	assert.equal(rateBadges([o("a", "Reguler, 1 hari")]).size, 0);
	assert.equal(etaDays("Reguler, 2-3 hari"), 3);
	assert.equal(etaDays("Reguler"), Number.POSITIVE_INFINITY);
});

test("DEC-034 courier list: the five cheapest stay visible with the selected one; the rest are behind 'Lihat kurir lain'", async () => {
	const { splitCouriers, SHOWN_COURIERS } = await import("../src/components/storefront/rate-badges.ts");
	assert.equal(SHOWN_COURIERS, 5);
	const options = Array.from({ length: 11 }, (_, i) => ({ id: `r${i}` }));
	const cheapest = splitCouriers(options, "r0");
	assert.deepEqual(cheapest.shown.map((o) => o.id), ["r0", "r1", "r2", "r3", "r4"]);
	assert.deepEqual(cheapest.more.map((o) => o.id), ["r5", "r6", "r7", "r8", "r9", "r10"]);
	const picked = splitCouriers(options, "r8");
	assert.deepEqual(picked.shown.map((o) => o.id), ["r0", "r1", "r2", "r3", "r4", "r8"], "a chosen dearer courier stays visible, in price order");
	assert.ok(!picked.more.some((o) => o.id === "r8"));
	assert.deepEqual(splitCouriers(options.slice(0, 4), "r0").more, [], "a short list has nothing to hide");
	assert.deepEqual(splitCouriers(options, undefined).shown.length, 5);
});
