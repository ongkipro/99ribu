import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { handleAffiliateProfile } from "../../src/modules/affiliates/profile.ts";
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
import {
	accrueOrderCommissions,
	handleCommissions,
	holdUnitCommission,
	matureEligibleCommissions,
	recordReplacementUnitReceiptMaturity,
	recordUnitReceiptMaturity,
	voidUnitCommissionOnRefund,
} from "../../src/modules/commissions/service.ts";
import { actor } from "../contract/access-fixture.ts";
import { CommerceClient } from "./checkout-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { shippingFixture } from "./shipping-fixture.ts";

test("PR-9: unit commission accrual, H+10 receipt maturity, return hold, partial refund void, and replacement re-anchoring without double commission", async () => {
	const f = await shippingFixture();
	const affiliate = await actor(f.identity, "affiliate", []);
	const sql = f.identity.sql;
	const identity = f.identity;

	try {
		// 1. Enroll affiliate
		const enrollReq = affiliate.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
			referral_code: `MATURE-${randomUUID().slice(0, 8).toUpperCase()}`,
		});
		enrollReq.headers.set("idempotency-key", randomUUID());
		const enrollRes = await handleAffiliateProfile(enrollReq, identity);
		assert.equal(enrollRes.status, 201);
		const profile = await enrollRes.json();

		// 2. Create a 3-unit attributed guest order
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
		const createdCart = await sql.begin((tx) =>
			createCart(
				tx,
				client.request("/api/v1/carts", {}),
				identity,
				guestBuyer,
				{
					lines: [
						{
							variant_id: line.offer_id,
							quantity: 3,
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
				recipient_name: "Pembeli Komisi",
				phone: "+6281200000099",
				address_line: "Jalan Komisi 99",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281200000099" },
			payment_method: "prepaid" as const,
		};
		const quote = (await sql.begin((tx) =>
			createQuote(
				tx,
				client.request("/api/v1/checkout/quotes", quoteInput, { version: 1 }),
				identity,
				guestBuyer,
				quoteInput,
				{ affiliate_id: profile.id },
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

		// 3. Accrue unit commissions for the 3-unit order
		const accrued = await sql.begin((tx) =>
			accrueOrderCommissions(tx, { orderId: submitted.order.id }),
		);
		assert.equal(accrued.length, 3);
		const unitAmount = Number(accrued[0].amount_idr);
		assert.ok(unitAmount > 0);
		const [u1, u2, u3] = accrued;

		// Initial balance has all 3 units in pending
		const balRes1 = await handleCommissions(
			affiliate.browser.request("/api/v1/me/affiliate/balance"),
			identity,
		);
		assert.equal(balRes1.status, 200);
		const bal1 = await balRes1.json();
		assert.equal(bal1.pending, unitAmount * 3);
		assert.equal(bal1.held, 0);
		assert.equal(bal1.eligible, 0);

		// 4. Record receipt at T0 for u1 and u2, and hold u2 & u3
		const t0 = "2026-06-01T10:00:00.000Z";
		await sql.begin(async (tx) => {
			await recordUnitReceiptMaturity(tx, {
				fulfillmentItemId: u1.fulfillment_item_id,
				receivedAt: t0,
			});
			await recordUnitReceiptMaturity(tx, {
				fulfillmentItemId: u2.fulfillment_item_id,
				receivedAt: t0,
			});
			await holdUnitCommission(tx, {
				fulfillmentItemId: u2.fulfillment_item_id,
				holdReason: "Pengajuan retur pembeli sedang diperiksa",
			});
			await holdUnitCommission(tx, {
				fulfillmentItemId: u3.fulfillment_item_id,
				holdReason: "Menunggu pengiriman unit pengganti",
			});
		});

		// Before H+10 (9 days later), nothing matures
		const earlyMatured = await sql.begin((tx) =>
			matureEligibleCommissions(tx, {
				affiliateId: profile.id,
				asOf: "2026-06-10T23:59:59.000Z",
			}),
		);
		assert.equal(earlyMatured.length, 0);

		// At exact H+10 (2026-06-11T10:00:00.000Z), only u1 matures; held u2 and u3 do NOT mature
		const maturedAtH10 = await sql.begin((tx) =>
			matureEligibleCommissions(tx, {
				affiliateId: profile.id,
				asOf: "2026-06-11T10:00:00.000Z",
			}),
		);
		assert.equal(maturedAtH10.length, 1);
		assert.equal(maturedAtH10[0].id, u1.id);
		assert.equal(maturedAtH10[0].status, "eligible");

		// 5. Partial refund on u2 voids ONLY u2; u1 remains eligible and u3 remains held
		await sql.begin((tx) =>
			voidUnitCommissionOnRefund(tx, {
				fulfillmentItemId: u2.fulfillment_item_id,
				reason: "Unit ke-2 direfund karena retur disetujui",
			}),
		);

		const balRes2 = await handleCommissions(
			affiliate.browser.request("/api/v1/me/affiliate/balance"),
			identity,
		);
		const bal2 = await balRes2.json();
		assert.equal(bal2.eligible, unitAmount);
		assert.equal(bal2.held, unitAmount);
		assert.equal(bal2.pending, 0);

		// 6. Replacement receipt on u3 re-anchors maturity to replacement receipt + 10 days without creating a 4th entry
		const tReplacement = "2026-06-15T12:00:00.000Z";
		await sql.begin((tx) =>
			recordReplacementUnitReceiptMaturity(tx, {
				fulfillmentItemId: u3.fulfillment_item_id,
				receivedAt: tReplacement,
			}),
		);
		const [entryCount] = await sql<{ n: number }[]>`
      select count(*)::int as n from app.commission_entry where order_id = ${submitted.order.id}
    `;
		assert.equal(
			entryCount.n,
			3,
			"Replacement never creates a duplicate commission entry",
		);

		// Before replacement H+10 (2026-06-24), u3 is still pending
		const beforeRepH10 = await sql.begin((tx) =>
			matureEligibleCommissions(tx, {
				affiliateId: profile.id,
				asOf: "2026-06-24T12:00:00.000Z",
			}),
		);
		assert.equal(beforeRepH10.length, 0);

		// At replacement H+10 (2026-06-25T12:00:00.000Z), u3 matures to eligible
		const atRepH10 = await sql.begin((tx) =>
			matureEligibleCommissions(tx, {
				affiliateId: profile.id,
				asOf: "2026-06-25T12:00:00.000Z",
			}),
		);
		assert.equal(atRepH10.length, 1);
		assert.equal(atRepH10[0].id, u3.id);
		assert.equal(atRepH10[0].status, "eligible");

		// Verify commission history endpoint and PII redaction
		const listRes = await handleCommissions(
			affiliate.browser.request("/api/v1/me/affiliate/commissions"),
			identity,
		);
		assert.equal(listRes.status, 200);
		const listBody = await listRes.json();
		assert.equal(listBody.data.length, 3);
		const rawJson = JSON.stringify(listBody);
		assert.ok(!rawJson.includes("Pembeli Komisi"));
		assert.ok(!rawJson.includes("+6281200000099"));
		assert.ok(!rawJson.includes(submitted.order.number));
	} finally {
		try {
			await closeFulfillmentActor(identity, affiliate);
		} finally {
			await f.close();
		}
	}
});
