import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { challengeVerificationCode, handleAccounts } from "../../src/modules/accounts/service.ts";
import { digest } from "../../src/modules/checkout/access.ts";
import { normalizePhone } from "../../src/modules/shipping/address.ts";
import { handleManualFulfillment } from "../../src/modules/fulfillment/manual-routes.ts";
import { fulfillmentFixture } from "./fulfillment-fixture.ts";

// S118: a guest who holds only the printed order number recovers access, and the reply never tells
// a known number (or a matching contact) apart from an unknown one.
const origin = "http://127.0.0.1:3099";
const post = (path: string, body: unknown) =>
	new Request(`${origin}${path}`, {
		method: "POST",
		headers: { origin, "content-type": "application/json", "idempotency-key": randomUUID() },
		body: JSON.stringify(body),
	});

test("guest order access by order number: matched recovers, unknown and mismatched are indistinguishable", async () => {
	const f = await fulfillmentFixture("prepaid");
	const { identity } = f;
	const unknown = `99-${randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`;
	const [order] = await identity.sql<{ number: string; phone: string }[]>`
		select o.number, q.document->'contact'->>'phone' as phone
		from app.commerce_order o join app.checkout_quote q on q.id = o.quote_id where o.id = ${f.order.id}`;
	const challenge = async (body: unknown) => {
		const res = await handleAccounts(post("/api/v1/guest-order-access/challenges", body), identity);
		return { status: res.status, body: await res.json() };
	};
	const verify = async (challenge_id: string, code: string) => {
		const res = await handleAccounts(post("/api/v1/guest-order-access/verifications", { challenge_id, code }), identity);
		// request_id is per request; everything else must match.
		const { request_id: _, ...body } = await res.json();
		return { status: res.status, body };
	};
	try {
		// Exactly one order reference, and the number must have the printed shape.
		for (const body of [
			{ order_number: order.number, order_id: f.order.id, contact: order.phone },
			{ contact: order.phone },
			{ order_number: "99-SHORT", contact: order.phone },
		]) {
			assert.equal((await challenge(body)).status, 400);
		}

		const known = await challenge({ order_number: order.number.toLowerCase(), contact: order.phone });
		const unknownOrder = await challenge({ order_number: unknown, contact: order.phone });
		const wrongContact = await challenge({ order_number: order.number, contact: "081299990000" });
		for (const reply of [known, unknownOrder, wrongContact]) {
			assert.equal(reply.status, 202);
			assert.deepEqual(Object.keys(reply.body).sort(), ["challenge_id", "expires_at"]);
		}

		// A decoy answers every code exactly like a wrong code on a real challenge.
		const realWrong = await verify(known.body.challenge_id, "000000");
		for (const decoy of [unknownOrder, wrongContact]) {
			const guessed = await verify(decoy.body.challenge_id, await challengeVerificationCode(identity, decoy.body.challenge_id));
			assert.deepEqual(guessed, realWrong);
		}
		assert.equal(realWrong.status, 403);
		assert.equal(realWrong.body.code, "INVALID_CHALLENGE_CODE");

		const ok = await verify(known.body.challenge_id, await challengeVerificationCode(identity, known.body.challenge_id));
		assert.equal(ok.status, 201);
		assert.equal(ok.body.order_id, f.order.id);
		assert.match(ok.body.order_access_token, /^ord_/);

		// Review R4 finding: a decoy and a real challenge for one number share the verify bucket, so
		// exhausting it through a decoy cannot tell whether a contact matches.
		const junk = await challenge({ order_number: order.number, contact: "081299990000" });
		const real = await challenge({ order_number: order.number, contact: order.phone });
		let spent = await verify(junk.body.challenge_id, "000000");
		for (let i = 0; i < 25 && spent.status !== 429; i++) spent = await verify(junk.body.challenge_id, "000000");
		assert.equal(spent.status, 429);
		assert.equal((await verify(real.body.challenge_id, "000000")).status, 429);
	} finally {
		const refs = [f.order.id, `n:${digest(order.number)}`, `n:${digest(unknown)}`];
		const keys = refs.flatMap((r) => [`rl:guest-access-challenge-order:${r}`, `rl:guest-access-verify-order:${r}`]);
		for (const phone of [order.phone, "081299990000"]) keys.push(`rl:guest-access-challenge-contact:${digest(`phone:${normalizePhone(phone)}`)}`);
		await identity.sql`delete from app.auth_rate_limit where key = any(${keys})`;
		await identity.sql`delete from app.support_challenge where kind = 'guest_order_access' and (order_id = ${f.order.id} or target_reference = any(${refs}))`;
		await f.close();
	}
});

// Owner 2026-10-30: the guest lookup also takes a parcel's resi. The contact must still match the order, and an
// unknown resi or a mismatched contact gets the same decoy 202 as an unknown order number.
test("guest order access by resi: matched recovers its order, unknown and mismatched are indistinguishable", async () => {
	const f = await fulfillmentFixture("prepaid");
	const { identity } = f;
	// Staff record the courier's resi on a manually shipped parcel (the same path as admin-orders and cod-remittance).
	const resi = `JP${String(Date.now()).slice(-8)}${randomUUID().slice(0, 4).toUpperCase()}`;
	const parcel = f.parcels[0];
	const ship = f.owner.browser.request(`/api/v1/admin/fulfillments/${parcel.id}/manual-shipment`, { expected_version: parcel.revision, courier: "jne", tracking_number: resi });
	ship.headers.set("idempotency-key", randomUUID());
	const shipped = await handleManualFulfillment(ship, identity);
	assert.equal(shipped.status, 201, JSON.stringify(await shipped.clone().json()));
	const unknown = `ZZ${randomUUID().replaceAll("-", "").slice(0, 14).toUpperCase()}`;
	const [order] = await identity.sql<{ phone: string }[]>`
		select q.document->'contact'->>'phone' as phone
		from app.commerce_order o join app.checkout_quote q on q.id = o.quote_id where o.id = ${f.order.id}`;
	const challenge = async (body: unknown) => {
		const res = await handleAccounts(post("/api/v1/guest-order-access/challenges", body), identity);
		return { status: res.status, body: await res.json() };
	};
	const verify = async (challenge_id: string, code: string) => {
		const res = await handleAccounts(post("/api/v1/guest-order-access/verifications", { challenge_id, code }), identity);
		const { request_id: _, ...body } = await res.json();
		return { status: res.status, body };
	};
	try {
		for (const body of [
			{ tracking_number: resi, order_id: f.order.id, contact: order.phone },
			{ tracking_number: "AB", contact: order.phone },
			{ tracking_number: "!!INVALID!!", contact: order.phone },
		]) {
			assert.equal((await challenge(body)).status, 400);
		}
		// Spaces and lower case are forgiven, as a buyer copies a resi from a courier message.
		const typed = `${resi.slice(0, 4)} ${resi.slice(4)}`.toLowerCase();
		const known = await challenge({ tracking_number: typed, contact: order.phone });
		const unknownResi = await challenge({ tracking_number: unknown, contact: order.phone });
		const wrongContact = await challenge({ tracking_number: resi, contact: "081299990000" });
		for (const reply of [known, unknownResi, wrongContact]) {
			assert.equal(reply.status, 202);
			assert.deepEqual(Object.keys(reply.body).sort(), ["challenge_id", "expires_at"]);
		}
		const realWrong = await verify(known.body.challenge_id, "000000");
		for (const decoy of [unknownResi, wrongContact]) {
			const guessed = await verify(decoy.body.challenge_id, await challengeVerificationCode(identity, decoy.body.challenge_id));
			assert.deepEqual(guessed, realWrong);
		}
		const ok = await verify(known.body.challenge_id, await challengeVerificationCode(identity, known.body.challenge_id));
		assert.equal(ok.status, 201);
		assert.equal(ok.body.order_id, f.order.id);
	} finally {
		const refs = [f.order.id, `t:${digest(resi.toUpperCase())}`, `t:${digest(unknown)}`];
		const keys = refs.flatMap((r) => [`rl:guest-access-challenge-order:${r}`, `rl:guest-access-verify-order:${r}`]);
		for (const phone of [order.phone, "081299990000"]) keys.push(`rl:guest-access-challenge-contact:${digest(`phone:${normalizePhone(phone)}`)}`);
		await identity.sql`delete from app.auth_rate_limit where key = any(${keys})`;
		await identity.sql`delete from app.support_challenge where kind = 'guest_order_access' and (order_id = ${f.order.id} or target_reference = any(${refs}))`;
		await f.close();
	}
});
