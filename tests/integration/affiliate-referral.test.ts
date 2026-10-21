import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
	attributeOrderToAffiliate,
	handleAffiliateProfile,
	recordReferralTouch,
} from "../../src/modules/affiliates/profile.ts";
import {
	bootstrapGuest,
	capability,
	commerceActor,
	prefix,
	setCookie,
} from "../../src/modules/checkout/access.ts";
import { createCart } from "../../src/modules/checkout/carts.ts";
import { submitOrder } from "../../src/modules/checkout/orders.ts";
import { createQuote } from "../../src/modules/checkout/quotes.ts";
import { actor } from "../contract/access-fixture.ts";
import { CommerceClient } from "./checkout-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { shippingFixture } from "./shipping-fixture.ts";

test("PR-8: affiliate enrollment, beneficiary verification, sticky first-touch referral, expiry, and self-referral rejection", async () => {
	const f = await shippingFixture();
	const affiliateA = await actor(f.identity, "affiliate", []);
	const affiliateB = await actor(f.identity, "affiliate", []);
	const ordinaryBuyer = await actor(f.identity, "buyer", []);
	const sql = f.identity.sql;
	const identity = f.identity;

	try {
		assert.equal(
			(await sql`select current_user actor`)[0].actor,
			"99ribu_test_app",
		);

		// 1. Non-affiliate buyer cannot enroll or read affiliate profile
		const forbiddenReq = ordinaryBuyer.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
		});
		forbiddenReq.headers.set("idempotency-key", randomUUID());
		const forbiddenRes = await handleAffiliateProfile(forbiddenReq, identity);
		assert.equal(forbiddenRes.status, 403);

		// 2. Affiliate A & Affiliate B enroll idempotently
		const enrollKeyA = randomUUID();
		const enrollBodyA = {
			terms_version: "v1",
			referral_code: `AFFA-${randomUUID().slice(0, 8).toUpperCase()}`,
		};
		const enrollReqA = affiliateA.browser.request(
			"/api/v1/me/affiliate",
			enrollBodyA,
		);
		enrollReqA.headers.set("idempotency-key", enrollKeyA);
		const enrollResA = await handleAffiliateProfile(enrollReqA, identity);
		assert.equal(enrollResA.status, 201);
		const profileA = await enrollResA.json();
		assert.equal(profileA.status, "active");
		assert.equal(profileA.beneficiary_status, "missing");
		assert.ok(
			String(profileA.referral_url).includes(enrollBodyA.referral_code),
		);

		// Idempotent replay returns identical profile
		const replayReqA = affiliateA.browser.request(
			"/api/v1/me/affiliate",
			enrollBodyA,
		);
		replayReqA.headers.set("idempotency-key", enrollKeyA);
		const replayResA = await handleAffiliateProfile(replayReqA, identity);
		assert.equal(replayResA.status, 201);
		assert.deepEqual(await replayResA.json(), profileA);

		// GET /api/v1/me/affiliate returns own profile
		const getResA = await handleAffiliateProfile(
			affiliateA.browser.request("/api/v1/me/affiliate"),
			identity,
		);
		assert.equal(getResA.status, 200);
		assert.deepEqual(await getResA.json(), profileA);

		const enrollBodyB = {
			terms_version: "v1",
			referral_code: `AFFB-${randomUUID().slice(0, 8).toUpperCase()}`,
		};
		const enrollReqB = affiliateB.browser.request(
			"/api/v1/me/affiliate",
			enrollBodyB,
		);
		enrollReqB.headers.set("idempotency-key", randomUUID());
		const enrollResB = await handleAffiliateProfile(enrollReqB, identity);
		assert.equal(enrollResB.status, 201);
		const profileB = await enrollResB.json();
		assert.notEqual(profileA.id, profileB.id);

		// 3. Beneficiary change requires step-up proof and masks account number
		const badProofReq = affiliateA.browser.request(
			"/api/v1/me/affiliate/beneficiary-changes",
			{
				bank_code: "BCA",
				account_number: "1234567890",
				account_holder_name: "Mitra A",
				reauthentication_proof: "invalid-proof",
			},
		);
		badProofReq.headers.set("idempotency-key", randomUUID());
		const badProofRes = await handleAffiliateProfile(badProofReq, identity);
		assert.equal(badProofRes.status, 403);

		const validBenReq = affiliateA.browser.request(
			"/api/v1/me/affiliate/beneficiary-changes",
			{
				bank_code: "BCA",
				account_number: "1234567890",
				account_holder_name: "Mitra A",
				reauthentication_proof: `proof-${randomUUID()}`,
			},
		);
		validBenReq.headers.set("idempotency-key", randomUUID());
		const validBenRes = await handleAffiliateProfile(validBenReq, identity);
		assert.equal(validBenRes.status, 202);
		const benBody = await validBenRes.json();
		assert.equal(benBody.bank_name, "BCA");
		assert.equal(benBody.masked_account, "••••7890");
		assert.equal(benBody.status, "verified");

		// 4. Sticky first-touch attribution: Affiliate A touch is recorded; later Affiliate B touch is retained_existing
		const visitorId = randomUUID();
		const touchReq1 = ordinaryBuyer.browser.request(
			"/api/v1/referral-touches",
			{
				referral_code: enrollBodyA.referral_code,
			},
		);
		touchReq1.headers.set("idempotency-key", randomUUID());
		const touch1 = await recordReferralTouch(
			touchReq1,
			identity,
			{ referral_code: enrollBodyA.referral_code },
			{ visitorId, buyerUserId: ordinaryBuyer.id },
		);
		assert.equal(touch1.status, "recorded");
		assert.ok(touch1.expires_at);

		// Second touch with Affiliate B's code for the same visitor retains existing Affiliate A first touch
		const touchReq2 = ordinaryBuyer.browser.request(
			"/api/v1/referral-touches",
			{
				referral_code: enrollBodyB.referral_code,
			},
		);
		touchReq2.headers.set("idempotency-key", randomUUID());
		const touch2 = await recordReferralTouch(
			touchReq2,
			identity,
			{ referral_code: enrollBodyB.referral_code },
			{ visitorId, buyerUserId: ordinaryBuyer.id },
		);
		assert.equal(touch2.status, "retained_existing");
		assert.equal(touch2.expires_at, touch1.expires_at);

		// Unknown referral code is ignored
		const unknownTouchReq = ordinaryBuyer.browser.request(
			"/api/v1/referral-touches",
			{
				referral_code: "NONEXISTENT-CODE-999",
			},
		);
		unknownTouchReq.headers.set("idempotency-key", randomUUID());
		const unknownTouch = await recordReferralTouch(
			unknownTouchReq,
			identity,
			{ referral_code: "NONEXISTENT-CODE-999" },
			{ visitorId: randomUUID(), buyerUserId: null },
		);
		assert.equal(unknownTouch.status, "ignored");

		// 5. Self-referral is ignored on touch and rejected on order attribution
		const selfTouchReq = affiliateA.browser.request(
			"/api/v1/referral-touches",
			{
				referral_code: enrollBodyA.referral_code,
			},
		);
		selfTouchReq.headers.set("idempotency-key", randomUUID());
		const selfTouch = await recordReferralTouch(
			selfTouchReq,
			identity,
			{ referral_code: enrollBodyA.referral_code },
			{ visitorId: randomUUID(), buyerUserId: affiliateA.id },
		);
		assert.equal(selfTouch.status, "ignored");

		// 6. Expired touch is rejected at attribution time, while active first-touch freezes Affiliate A attribution
		const expiredVisitor = randomUUID();
		const pastTouchReq = ordinaryBuyer.browser.request(
			"/api/v1/referral-touches",
			{
				referral_code: enrollBodyB.referral_code,
			},
		);
		pastTouchReq.headers.set("idempotency-key", randomUUID());
		await recordReferralTouch(
			pastTouchReq,
			identity,
			{ referral_code: enrollBodyB.referral_code },
			{
				visitorId: expiredVisitor,
				buyerUserId: null,
				now: "2025-01-01T00:00:00.000Z",
				ttlSeconds: 60,
			},
		);
		const [expiredTouchRow] = await sql<{ id: string }[]>`
      select id from app.referral_touch where visitor_id = ${expiredVisitor}
    `;
		assert.ok(expiredTouchRow);

		// Create a guest order attributed to Affiliate A
		const client = new CommerceClient(identity);
		const bootRes = new Response(null);
		await bootstrapGuest(identity, bootRes);
		client.absorb(bootRes);
		const guestBuyer = await commerceActor(
			client.request("/api/v1/carts"),
			identity,
		);
		assert.ok(guestBuyer);

		const line = f.line("fixture-offer-shirt");
		const cartReq = client.request("/api/v1/carts", {});
		const createdCart = await sql.begin((tx) =>
			createCart(
				tx,
				cartReq,
				identity,
				guestBuyer,
				{
					lines: [
						{
							variant_id: line.offer_id,
							quantity: 1,
							expected_publication_id: line.publication_id,
						},
					],
				},
				{ clock_namespace: f.namespace },
			),
		);
		const token = await capability(
			identity,
			"cart",
			createdCart.cart.id,
			guestBuyer.id,
			createdCart.cart.cap_issued_at as string,
		);
		const cookieRes = new Response(null);
		setCookie(
			cookieRes,
			`${await prefix(identity)}.cart_access`,
			`${createdCart.cart.id}.${token}`,
		);
		client.absorb(cookieRes);

		const quoteInput = {
			cart_id: createdCart.cart.id,
			address: {
				recipient_name: "Pembeli Rujukan",
				phone: "+6281200000001",
				address_line: "Jalan Rujukan 10",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281200000001" },
			payment_method: "prepaid" as const,
		};
		const quote = (await sql.begin((tx) =>
			createQuote(
				tx,
				client.request("/api/v1/checkout/quotes", quoteInput, { version: 1 }),
				identity,
				guestBuyer,
				quoteInput,
				{ affiliate_id: profileA.id },
			),
		)) as { id: string };

		const submitted = await sql.begin((tx) =>
			submitOrder(
				tx,
				client.request(
					"/api/v1/orders",
					{ quote_id: quote.id },
					{ version: 1 },
				),
				identity,
				guestBuyer,
				{ quote_id: quote.id },
			),
		);
		assert.equal(submitted.order.merchandise_amount, "99000");

		// Attempting to attribute the order with an expired touch fails with REFERRAL_TOUCH_EXPIRED
		await assert.rejects(
			sql.begin((tx) =>
				attributeOrderToAffiliate(tx, {
					orderId: submitted.order.id,
					referralTouchId: expiredTouchRow.id,
				}),
			),
			{ code: "REFERRAL_TOUCH_EXPIRED" },
		);

		// Attributing with the active first-touch visitor binds Affiliate A (not Affiliate B!)
		const attribution = await sql.begin((tx) =>
			attributeOrderToAffiliate(tx, {
				orderId: submitted.order.id,
				visitorId,
			}),
		);
		assert.ok(attribution);
		assert.equal(attribution.affiliate_id, profileA.id);
		assert.equal(attribution.basis_points, profileA.rate_basis_points);
	} finally {
		try {
			await closeFulfillmentActor(identity, affiliateA);
			await closeFulfillmentActor(identity, affiliateB);
			await closeFulfillmentActor(identity, ordinaryBuyer);
		} finally {
			await f.close();
		}
	}
});
