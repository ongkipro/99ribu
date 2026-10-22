import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { runOneJob } from "../../src/jobs/worker.ts";
import { challengeVerificationCode, handleAccounts } from "../../src/modules/accounts/service.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAuth } from "../../src/modules/access/handler.ts";
import { readOrderReceipt } from "../../src/modules/orders/receipt.ts";
import { cleanup } from "../contract/access-fixture.ts";
import { fulfillmentFixture } from "./fulfillment-fixture.ts";

// Opt-in second origin: the owner's Tailscale IP, raw-TCP-forwarded to the loopback listener.
// Every request below is shaped like Next delivers it: request.url is the loopback listener
// (NextURL-normalized to localhost) and Host/Origin are what the browser sent.
const loopback = "http://127.0.0.1:3099";
const tailnet = "http://100.127.67.86:3099";
const tailnetHost = "100.127.67.86:3099";
process.env.LOCAL_TAILNET_ORIGIN = tailnet;

function browser(host: string, origin: string | null, path: string, body?: unknown, cookie = "") {
	const headers: Record<string, string> = { host, "content-type": "application/json", "idempotency-key": randomUUID() };
	if (origin !== null) headers.origin = origin;
	if (cookie) headers.cookie = cookie;
	return new NextRequest(`${loopback}${path}`, { method: body === undefined ? "GET" : "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
}
const pair = (setCookie: string) => setCookie.split(";")[0];

test("tailnet origin: Better Auth sign-up, verification, sign-in and session work only for the exact configured origin", async () => {
	const identity = createLocalAuth("test");
	const email = `tailnet-${randomUUID()}@example.invalid`;
	const password = randomBytes(24).toString("base64url");
	const paths = ["/sign-up/email", "/sign-in/email", "/get-session", "/verify-email", "/sign-out"];
	await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(paths.map((path) => `127.0.0.1|${path}`))}`;
	let userId = "";
	try {
		assert.equal((await handleAuth(browser(tailnetHost, tailnet, "/api/auth/sign-up/email", { name: "Synthetic Tailnet", email, password }), identity)).status, 200);
		[{ id: userId }] = await identity.sql`select id from app.auth_user where email=${email}`;

		// Links follow the validated request origin, and the worker's destination check accepts it.
		const jobs = await identity.sql`select j.id from app.outbox_job j join app.local_delivery d on d.id::text=j.payload->>'deliveryId'
			where j.kind='local.notification' and j.status='pending' and d.recipient=${email}`;
		for (const job of jobs) assert.equal(await runOneJob(identity.sql, {}, job.id), true);
		const [message] = await identity.sql`select url, delivered_at from app.local_delivery where recipient=${email} and kind='verification'`;
		assert.ok(message.delivered_at, "tailnet verification link passes the local delivery destination check");
		const link = new URL(message.url);
		assert.equal(link.origin, tailnet);
		const verified = await handleAuth(browser(tailnetHost, null, link.pathname + link.search), identity);
		assert.ok([200, 302].includes(verified.status));
		const location = verified.headers.get("location");
		if (location) assert.ok(!location.startsWith(loopback), "a tailnet browser is never redirected to its own loopback");

		const credentials = { email, password };
		for (const [host, origin] of [
			[tailnetHost, "http://100.127.67.87:3099"], [tailnetHost, "https://100.127.67.86:3099"], [tailnetHost, loopback],
			[tailnetHost, "http://100.127.67.86:3000"], ["127.0.0.1:3099", tailnet], ["100.127.67.87:3099", "http://100.127.67.87:3099"],
			["100.127.67.87:3099", tailnet], ["rich.tail915080.ts.net:3099", "http://rich.tail915080.ts.net:3099"], ["evil.invalid:3099", "http://evil.invalid:3099"],
		] as const) {
			const refused = await handleAuth(browser(host, origin, "/api/auth/sign-in/email", credentials), identity);
			assert.equal(refused.status, 403, `${host} / ${origin}`);
			assert.equal(refused.headers.getSetCookie().length, 0);
		}

		const signedIn = await handleAuth(browser(tailnetHost, tailnet, "/api/auth/sign-in/email", credentials), identity);
		assert.equal(signedIn.status, 200);
		const session = signedIn.headers.getSetCookie().find((value) => value.startsWith("99ribu-test.session_token="));
		assert.ok(session, "session cookie is issued over the tailnet origin");
		assert.match(session, /HttpOnly/i);
		assert.match(session, /SameSite=Lax/i);
		assert.doesNotMatch(session, /;\s*Secure/i, "plain-http tailnet IP: a Secure cookie would be dropped by the browser");
		assert.doesNotMatch(session, /Domain=/i);
		const current = await handleAuth(browser(tailnetHost, null, "/api/auth/get-session", undefined, pair(session)), identity);
		assert.equal(current.status, 200);
		assert.equal((await current.json())?.user?.email, email);

		// Loopback keeps working beside it.
		const local = await handleAuth(browser("127.0.0.1:3099", loopback, "/api/auth/sign-in/email", credentials), identity);
		assert.equal(local.status, 200);

		// Without the opt-in the very same tailnet request is refused before Better Auth runs.
		delete process.env.LOCAL_TAILNET_ORIGIN;
		try {
			assert.equal((await handleAuth(browser(tailnetHost, tailnet, "/api/auth/sign-in/email", credentials), identity)).status, 403);
			assert.equal((await handleAuth(browser(tailnetHost, null, "/api/auth/get-session", undefined, pair(session)), identity)).status, 403);
		} finally {
			process.env.LOCAL_TAILNET_ORIGIN = tailnet;
		}
	} finally {
		if (userId) await identity.sql`delete from app.auth_session where user_id=${userId}`;
		await cleanup(identity, userId ? [{ id: userId, email }] : []);
		await identity.sql.end();
	}
});

test("tailnet origin: guest order access mutation issues a non-prefixed capability cookie that opens the receipt", async () => {
	const f = await fulfillmentFixture("prepaid");
	const { identity } = f;
	try {
		const [contact] = await identity.sql<{ phone: string }[]>`select q.document->'contact'->>'phone' as phone
			from app.commerce_order o join app.checkout_quote q on q.id=o.quote_id where o.id=${f.order.id}`;
		const post = (path: string, body: Record<string, unknown>, origin = tailnet, host = tailnetHost) => handleAccounts(browser(host, origin, path, body), identity);

		// Cross-origin mutations on the tailnet host are refused before any challenge is created.
		for (const origin of ["http://100.127.67.87:3099", "https://100.127.67.86:3099", loopback]) {
			assert.equal((await post("/api/v1/guest-order-access/challenges", { order_id: f.order.id, contact: contact.phone }, origin)).status, 403);
		}
		assert.equal((await post("/api/v1/guest-order-access/challenges", { order_id: f.order.id, contact: contact.phone }, "http://100.127.67.87:3099", "100.127.67.87:3099")).status, 403);

		const challenge = await post("/api/v1/guest-order-access/challenges", { order_id: f.order.id, contact: contact.phone });
		assert.equal(challenge.status, 202);
		const { challenge_id } = await challenge.json();
		const verified = await post("/api/v1/guest-order-access/verifications", { challenge_id, code: await challengeVerificationCode(identity, challenge_id) });
		assert.equal(verified.status, 201);
		const issued = verified.headers.getSetCookie();
		assert.ok(!issued.some((value) => value.startsWith("__Host-")), "__Host- cannot be set over plain http on a non-loopback IP");
		const cookie = issued.find((value) => value.startsWith("99ribu-test.guest_order_access="));
		assert.ok(cookie);
		assert.match(cookie, /; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800$/);

		const receipt = await readOrderReceipt(browser(tailnetHost, null, `/orders/${f.order.id}`, undefined, pair(cookie)), identity, f.order.id);
		assert.equal(receipt.kind, "ready");
		assert.equal(receipt.receipt?.order.id, f.order.id);
		const anonymous = await readOrderReceipt(browser(tailnetHost, null, `/orders/${f.order.id}`), identity, f.order.id);
		assert.equal(anonymous.kind, "denied");
	} finally {
		await identity.sql`delete from app.auth_rate_limit where key like ${`rl:%:${f.order.id}`}`;
		await f.close();
	}
});
