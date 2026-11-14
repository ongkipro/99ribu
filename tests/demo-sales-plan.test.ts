import assert from "node:assert/strict";
import test from "node:test";
import { planDay } from "../src/modules/local/demo-sales.ts";

// The demo sales plan is deterministic and keeps open work only on recent days.
test("demo sales plan: deterministic per day, open work only in the last two days, finished orders before", () => {
	assert.deepEqual(planDay("2026-11-07", 7), planDay("2026-11-07", 7));
	const old = planDay("2026-11-05", 9), recent = planDay("2026-11-14", 0);
	assert.ok(old.length >= 3 && recent.length >= 3);
	assert.ok(old.every((o) => !["awaiting_shipment", "in_transit"].includes(o.outcome)), "an old day has no open shipments");
	assert.ok(recent.every((o) => !["delivered", "cod_delivered", "returned", "cod_refused"].includes(o.outcome)), "today has nothing finished yet");
	assert.ok([...old, ...recent].every((o) => o.hour >= 8 && o.hour <= 20 && [1, 2].includes(o.quantity)));
});
