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
