import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { challengeVerificationCode, handleAccounts } from "../../src/modules/accounts/service.ts";
import { digest } from "../../src/modules/checkout/access.ts";
import { normalizePhone } from "../../src/modules/shipping/address.ts";
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
	} finally {
		const refs = [f.order.id, `n:${digest(order.number)}`, `n:${digest(unknown)}`];
		const keys = refs.flatMap((r) => [`rl:guest-access-challenge-order:${r}`, `rl:guest-access-verify-order:${r}`]);
		for (const phone of [order.phone, "081299990000"]) keys.push(`rl:guest-access-challenge-contact:${digest(`phone:${normalizePhone(phone)}`)}`);
		await identity.sql`delete from app.auth_rate_limit where key = any(${keys})`;
		await f.close();
	}
});
