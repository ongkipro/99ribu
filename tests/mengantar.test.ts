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

test("Mengantar estimate: bills `price`, drops cargo/unsupported/unknown couriers, offers COD only on an explicit unsupported_cod:false", () => {
	const rates = parseEstimate(observed, key);
	assert.deepEqual(rates.map((r) => [r.service_id, r.shipping_amount, r.supports_cod]), [
		["JNE", 11000, false], ["SiCepat", 8500, true], ["SAP", 9000, false], ["JT", 14000, false],
	]);
	const jne = rates[0];
	assert.equal(jne.service_name, "Reguler, 2-3 hari");
	assert.equal(jne.source, "mengantar");
	assert.equal(jne.version, MENGANTAR_RATE_VERSION);
	assert.match(jne.id, /^mg_[0-9a-f]{64}$/);
	assert.notEqual(parseEstimate(observed, { ...key, grams: 2000 })[0].id, jne.id, "the id binds the weight");
	assert.equal(rates[1].service_name, "Reguler", "no ETA without estimate_delivery");
	assert.equal(rates[3].service_name, "Reguler", "\"-\" is no ETA");
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

test("production checkout offers only manual bank transfer and COD; the simulator and AutoLaris are refused there", async () => {
	const { offeredChannels, paymentChannel } = await import("../src/modules/payments/methods.ts");
	const saved = process.env;
	process.env = { NODE_ENV: "test", APP_ENV: "production", APP_ORIGIN: "https://99ribu.com", BETTER_AUTH_URL: "https://99ribu.com", BETTER_AUTH_SECRET: randomBytes(48).toString("base64"),
		PAYMENT_ADAPTER: "disabled", SHIPPING_ADAPTER: "disabled", ADS_ADAPTER: "disabled", NOTIFICATION_ADAPTER: "disabled", PAYOUT_ADAPTER: "disabled", EXTERNAL_DISPATCH: "disabled",
		DATABASE_HOST: "synthetic-host", DATABASE_APP_PASSWORD: "synthetic-app-password-0123456789", CLIENT_IP_HEADER: "x-real-ip" };
	try {
		assert.deepEqual(offeredChannels(), ["manual-bank", "cod"]);
		assert.equal(paymentChannel("prepaid", "manual-bank"), "manual-bank");
		assert.equal(paymentChannel("cod", undefined), "cod");
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
