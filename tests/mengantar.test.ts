import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { productionShipping } from "../src/config/runtime.ts";
import shippingLocal from "../docs/spec/fixtures/shipping-local.json" with { type: "json" };
import { MENGANTAR_RATE_VERSION, parseEstimate } from "../src/modules/shipping/mengantar.ts";
import { PACKAGE_POLICY } from "../src/modules/shipping/rates.ts";

const key = { origin: "5fc6474ff8f44b34aa4cdea5", destination: "5fc62f62f8f44b34aa4c0dfd", grams: 1000 };
// Shape observed read-only on 2026-10-30 (GET /order/estimate, courier=all), values trimmed.
const observed = {
	success: true,
	data: {
		JNE: { price: 11000, codFee: 0, estimate_delivery: "2 - 3 Days", estimatedSpecialPrice: 9900 },
		JNECargo: { price: 70000 },
		SiCepat: { price: 8500, unsupported_cod: false },
		SapCargo: { price: 42500, unsupported_cod: true },
		SAP: { price: 9000, unsupported_cod: true },
		JT: { price: 14000, coverage_cod: false, estimate_delivery: "-" },
		spx: { price: 13700, unsupportedOriginSpx: true },
		anteraja: { price: 9000, unsupported: true },
		pos: { price: 0 },
		lion: { price: "17980" },
		unknownCourier: { price: 5000 },
	},
};

test("Mengantar estimate: offers every quoted courier (cargo and unnamed keys too), drops unsupported or unpriced ones, offers COD only on an explicit unsupported_cod:false", () => {
	const rates = parseEstimate(observed, key);
	assert.deepEqual(rates.map((r) => [r.service_id, r.shipping_amount, r.supports_cod]), [
		["JNE", 11000, false], ["JNECargo", 70000, false], ["SiCepat", 8500, true], ["SapCargo", 42500, false], ["SAP", 9000, false], ["JT", 14000, false], ["lion", 17980, false], ["unknownCourier", 5000, false],
	]);
	// spx (origin unsupported), anteraja (unsupported) and pos (price 0) stay out; the digit-string price counts.
	assert.deepEqual(rates.map((r) => r.courier_name), ["JNE", "JNE Cargo", "SiCepat", "SAP Cargo", "SAP Express", "J&T Express", "Lion Parcel", "Unknown Courier"]);
	assert.equal(rates[1].service_name, "Kargo", "cargo services are labelled");
	assert.deepEqual(parseEstimate({ success: true, data: { "<b>x</b>": { price: 9000 }, JNE: { price: "9.000" } } }, key), [], "odd keys and formatted strings are refused");
	const inherited = parseEstimate({ success: true, data: JSON.parse('{"__proto__":{"price":7000},"constructor":{"price":8000},"toString":{"price":9000}}') }, key);
	assert.deepEqual(inherited.map((r) => [r.service_id, typeof r.courier_name, r.courier_name]), [["__proto__", "string", "__proto__"], ["constructor", "string", "Constructor"], ["toString", "string", "To String"]], "prototype names never read Object.prototype");
	const jne = rates[0];
	assert.equal(jne.service_name, "Reguler, 2-3 hari");
	assert.equal(jne.source, "mengantar");
	assert.equal(jne.version, MENGANTAR_RATE_VERSION);
	assert.match(jne.id, /^mg_[0-9a-f]{64}$/);
	assert.notEqual(parseEstimate(observed, { ...key, grams: 2000 })[0].id, jne.id, "the id binds the weight");
	assert.equal(rates[2].service_name, "Reguler", "no ETA without estimate_delivery");
	assert.equal(rates[5].service_name, "Reguler", "\"-\" is no ETA");
	for (const [raw, shown] of [["1 - 2 Hari", "1-2"], ["1-2 Day", "1-2"], ["4 HARI", "4"], ["2 - 2 days", "2"]]) {
		assert.equal(parseEstimate({ success: true, data: { JNE: { price: 9000, estimate_delivery: raw } } }, key)[0].service_name, `Reguler, ${shown} hari`, raw);
	}
});

test("Mengantar estimate: a non-success or malformed envelope is refused, not read as zero couriers", () => {
	for (const body of [{ success: false, data: {} }, { success: true, data: [] }, { success: true }, null, "html"]) {
		assert.throws(() => parseEstimate(body, key), /malformed/);
	}
	assert.deepEqual(parseEstimate({ success: true, data: {} }, key), []);
});

test("production shipping gate admits only SHIPPING_ADAPTER=mengantar with the official origin and a well-formed key", () => {
	const apiKey = "synthetic_KEY-0123456789";
	assert.equal(productionShipping({ SHIPPING_ADAPTER: "disabled" }), null);
	assert.deepEqual(productionShipping({ SHIPPING_ADAPTER: "mengantar", MENGANTAR_BASE_URL: "https://api-public.mengantar.com", MENGANTAR_API_KEY: apiKey }),
		{ provider: "mengantar", baseUrl: "https://api-public.mengantar.com", apiKey });
	for (const env of [
		{ SHIPPING_ADAPTER: "live" },
		{ SHIPPING_ADAPTER: "mengantar", MENGANTAR_BASE_URL: "https://evil.invalid", MENGANTAR_API_KEY: apiKey },
		{ SHIPPING_ADAPTER: "mengantar", MENGANTAR_BASE_URL: "https://api-public.mengantar.com/", MENGANTAR_API_KEY: apiKey },
		{ SHIPPING_ADAPTER: "mengantar", MENGANTAR_BASE_URL: "https://api-public.mengantar.com", MENGANTAR_API_KEY: "short" },
		{ SHIPPING_ADAPTER: "mengantar", MENGANTAR_BASE_URL: "https://api-public.mengantar.com", MENGANTAR_API_KEY: "has/slash-0123456789" },
	]) {
		assert.throws(() => productionShipping(env), (error: Error) => !error.message.includes(apiKey));
	}
});

test("the parcel policy constant equals the fixture copy", () => {
	assert.deepEqual(PACKAGE_POLICY, shippingLocal.package_policy);
});

test("production checkout offers a channel only while its money capability is listed; the simulator is never offered (S181 step 3a)", async () => {
	const { offeredChannels, paymentChannel } = await import("../src/modules/payments/methods.ts");
	const saved = process.env;
	process.env = { NODE_ENV: "test", APP_ENV: "production", APP_ORIGIN: "https://99ribu.com", BETTER_AUTH_URL: "https://99ribu.com", BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
		PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled", EXTERNAL_DISPATCH: "disabled",
		DATABASE_HOST: "synthetic-host", DATABASE_APP_PASSWORD: "synthetic-app-password-0123456789", CLIENT_IP_HEADER: "x-real-ip" };
	try {
		// Before S181 the list was fixed ("manual-bank","cod") while every order answered CHECKOUT_CLOSED. Now nothing is offered
		// until a capability is listed (the default), so the list and order entry can never disagree.
		assert.deepEqual(offeredChannels(), []);
		for (const [method, channel] of [["prepaid", "manual-bank"], ["cod", undefined], ["prepaid", undefined], ["prepaid", "local-prepaid"], ["prepaid", "autolaris"]] as const) {
			assert.throws(() => paymentChannel(method, channel), { code: "PAYMENT_CHANNEL_UNAVAILABLE" }, `${method}/${channel}`);
		}
		process.env = { ...process.env, MONEY_CAPABILITIES: "manual_bank" } as NodeJS.ProcessEnv;
		assert.deepEqual(offeredChannels(), ["manual-bank"]);
		assert.equal(paymentChannel("prepaid", "manual-bank"), "manual-bank");
		assert.throws(() => paymentChannel("cod", undefined), { code: "PAYMENT_CHANNEL_UNAVAILABLE" }, "cod cannot be listed yet");
		for (const [method, channel] of [["prepaid", undefined], ["prepaid", "local-prepaid"], ["prepaid", "autolaris"]] as const) {
			assert.throws(() => paymentChannel(method, channel), { code: "PAYMENT_CHANNEL_UNAVAILABLE" });
		}
	} finally { process.env = saved; }
});

test("Mengantar adapter: one fetch per route for 5 minutes, every cached price keeps at least 5 minutes, budget refuses", async (t) => {
	const { mengantarRateAdapter, resetMengantarRates } = await import("../src/modules/shipping/mengantar.ts");
	const saved = process.env;
	process.env = { NODE_ENV: "test", APP_ENV: "production", APP_ORIGIN: "https://99ribu.com", BETTER_AUTH_URL: "https://99ribu.com", BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
		PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "mengantar", MENGANTAR_BASE_URL: "https://api-public.mengantar.com", MENGANTAR_API_KEY: "synthetic_key_0123456789",
		ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled", EXTERNAL_DISPATCH: "disabled",
		DATABASE_HOST: "synthetic-host", DATABASE_APP_PASSWORD: "synthetic-app-password-0123456789", CLIENT_IP_HEADER: "x-real-ip" };
	let fetches = 0;
	t.mock.method(globalThis, "fetch", async (url: string) => {
		fetches++;
		assert.ok(String(url).startsWith("https://api-public.mengantar.com/api/public/synthetic_key_0123456789/order/estimate?"));
		return new Response(JSON.stringify({ success: true, data: { SiCepat: { price: 8500, unsupported_cod: false } } }), { status: 200 });
	});
	t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-31T00:00:00.000Z") });
	try {
		resetMengantarRates();
		const request = (destination: string) => ({ warehouse_id: "w", origin: { province: null, city: "x", district: null }, origin_area_id: key.origin, destination_id: destination,
			measures: { weight_grams: 1000, length_mm: 100, width_mm: 100, height_mm: 100 }, now: new Date().toISOString() });
		const signal = new AbortController().signal;
		const first = await mengantarRateAdapter.estimate(request(key.destination), signal);
		assert.equal(first[0].expires_at, "2026-10-31T00:10:00.000Z");
		t.mock.timers.tick(299_000);
		const cached = await mengantarRateAdapter.estimate(request(key.destination), signal);
		assert.equal(fetches, 1, "reused within 5 minutes");
		assert.ok(Date.parse(cached[0].expires_at) - Date.now() >= 300_000, "a cached price still has at least 5 minutes");
		t.mock.timers.tick(2_000);
		await mengantarRateAdapter.estimate(request(key.destination), signal);
		assert.equal(fetches, 2, "refetched after 5 minutes");
		assert.deepEqual(await mengantarRateAdapter.estimate({ ...request(key.destination), origin_area_id: null }, signal), [], "no origin area, no live rate");
		resetMengantarRates();
		for (let i = 0; i < 300; i++) await mengantarRateAdapter.estimate(request(`${i}`.padStart(24, "a")), signal);
		await assert.rejects(mengantarRateAdapter.estimate(request("b".repeat(24)), signal), /budget/);
	} finally { process.env = saved; resetMengantarRates(); }
});

// Live answer 2026-11-12 (GET /order/estimate, Surabaya Genteng -> Surabaya Airlangga, 0,3 kg), prices and ETA as returned.
const surabaya = {
	success: true,
	data: {
		JNE: { price: 9000, estimate_delivery: "2 - 3 days" }, JNECargo: { price: 40000, estimate_delivery: "2 - 3 days" },
		JT: { price: 6000, estimate_delivery: "-", unsupported_cod: false }, SAP: { price: 7000, estimate_delivery: "1 - 2 days", unsupported_cod: false },
		SAPLite: { price: 10000, estimate_delivery: "1 - 2 days", unsupported_cod: false }, SapCargo: { price: 22500, estimate_delivery: "1 - 2 days" },
		SiCepat: { price: 6000, estimate_delivery: "1 - 2 Days" }, SiCepatCargo: { price: 30000, estimate_delivery: "1 - 2 Days" },
		anteraja: { price: 7300, estimate_delivery: "1-2 Day", unsupported_cod: false }, iDexpress: { price: 5200, estimate_delivery: "-", unsupported_cod: false },
		iDexpressCargo: { price: 30000, estimate_delivery: "-", unsupported_cod: false }, iDlite: { price: 5200, estimate_delivery: "-", unsupported_cod: false },
		lion: { price: 8680, estimate_delivery: "1 - 2 Hari", unsupported_cod: false }, pos: { price: 8000, estimate_delivery: "4 HARI", unsupported_cod: false },
		spx: { price: 5700, estimate_delivery: "2 - 1 days", unsupported_cod: false },
	},
};

test("DEC-034 every courier key Mengantar answers has a proper name; a reversed day range reads low-high", async () => {
	const { COURIERS } = await import("../src/modules/shipping/mengantar.ts");
	const rates = parseEstimate(surabaya, { ...key, grams: 300 });
	for (const courier of Object.keys(surabaya.data)) assert.ok(Object.hasOwn(COURIERS, courier), `${courier} has a buyer-facing name`);
	const name = (id: string) => rates.find((r) => r.service_id === id);
	assert.deepEqual([name("iDlite")?.courier_name, name("iDexpressCargo")?.courier_name, name("SiCepatCargo")?.courier_name], ["ID Lite", "ID Express Cargo", "SiCepat Cargo"]);
	assert.equal(name("spx")?.service_name, "Reguler, 1-2 hari", "\"2 - 1 days\" is shown as 1-2");
	assert.equal(name("JT")?.service_name, "Reguler", "no ETA from the provider: none shown");
	assert.equal(name("iDexpressCargo")?.service_name, "Kargo");
});

test("DEC-034 cargo services are offered only from 5 kg chargeable weight", async () => {
	const { offeredForWeight, CARGO_MIN_GRAMS } = await import("../src/modules/shipping/mengantar.ts");
	assert.equal(CARGO_MIN_GRAMS, 5000);
	const rates = parseEstimate(surabaya, { ...key, grams: 300 });
	for (const [grams, cargo] of [[300, 0], [4999, 0], [5000, 4], [6000, 4]] as const) {
		const offered = offeredForWeight(rates, grams);
		assert.equal(offered.filter((r) => /cargo/i.test(r.service_id)).length, cargo, `${grams} g`);
		assert.equal(offered.length, rates.length - 4 + cargo, "only cargo is removed");
	}
});
