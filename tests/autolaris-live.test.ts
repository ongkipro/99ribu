import assert from "node:assert/strict";
import test from "node:test";
import { AUTOLARIS_DEFAULT_BASE_URL, liveAutolaris, readAutolarisLiveConfig } from "../src/modules/payments/autolaris-live.ts";

const KEY = "SYNTHETIC-test-key-0001";

test("live config: no key means no live client; the base URL defaults to the documented https origin", () => {
	assert.equal(readAutolarisLiveConfig({}), null);
	assert.equal(readAutolarisLiveConfig({ AUTOLARIS_API_KEY: "  " }), null);
	assert.deepEqual(readAutolarisLiveConfig({ AUTOLARIS_API_KEY: KEY }), { baseUrl: AUTOLARIS_DEFAULT_BASE_URL, apiKey: KEY });
	for (const base of ["http://api-h2h.autolaris.com", "https://x.test/api", "https://u:p@x.test", "nope"]) {
		assert.throws(() => readAutolarisLiveConfig({ AUTOLARIS_API_KEY: KEY, AUTOLARIS_BASE_URL: base }), /https origin/);
	}
	assert.throws(() => readAutolarisLiveConfig({ AUTOLARIS_API_KEY: "short" }), /printable token/);
});

test("live client: documented paths, Bearer header, JSON bodies, GET list_payment without a body", async () => {
	const seen: { url: string; method: string; auth: string | null; body: string | null }[] = [];
	const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const headers = new Headers(init?.headers);
		seen.push({ url: String(input), method: String(init?.method), auth: headers.get("authorization"), body: (init?.body as string) ?? null });
		return Response.json({ rc: "00", ket: "Sukses", data: [] });
	}) as typeof fetch;
	const client = liveAutolaris({ baseUrl: AUTOLARIS_DEFAULT_BASE_URL, apiKey: KEY }, fake);
	await client.listPayment();
	await client.advice({ transaction_id: "986770" });
	assert.deepEqual(seen, [
		{ url: `${AUTOLARIS_DEFAULT_BASE_URL}/api/h2h/list_payment`, method: "GET", auth: `Bearer ${KEY}`, body: null },
		{ url: `${AUTOLARIS_DEFAULT_BASE_URL}/api/h2h/advice`, method: "POST", auth: `Bearer ${KEY}`, body: '{"transaction_id":"986770"}' },
	]);
});

test("live client: a failure is a sanitized error that never carries the key or the body", async () => {
	const answers: Response[] = [new Response(`secret ${KEY}`, { status: 500 }), new Response("<html>"), Response.json({ ket: "no rc" })];
	const client = liveAutolaris({ baseUrl: AUTOLARIS_DEFAULT_BASE_URL, apiKey: KEY }, (async () => answers.shift() as Response) as typeof fetch);
	for (const expected of [/HTTP 500/, /non-JSON/, /rc envelope/]) {
		await assert.rejects(client.listPayment(), (error: Error) => expected.test(error.message) && !error.message.includes(KEY));
	}
});
