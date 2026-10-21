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
import { handleCommissions } from "../../src/modules/commissions/service.ts";
import {
	handlePayouts,
	queueEligibleAffiliatePayouts,
} from "../../src/modules/payouts/service.ts";
import { actor, enroll } from "../contract/access-fixture.ts";
import { CommerceClient } from "./checkout-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { shippingFixture } from "./shipping-fixture.ts";

test("PR-10: IDR 98,999 vs 99,000 threshold, frozen beneficiary snapshot, exclusive finance claim, balanced ledger verification, and unknown transfer reservation", async () => {
	const f = await shippingFixture();
	const affiliate = await actor(f.identity, "affiliate", []);
	const finance1 = await actor(f.identity, "finance", []);
	const finance2 = await actor(f.identity, "finance", []);
	const sql = f.identity.sql;
	const identity = f.identity;

	try {
		await enroll(finance1.browser, finance1.password);
		await enroll(finance2.browser, finance2.password);

		// 1. Enroll affiliate with verified initial beneficiary
		const enrollReq = affiliate.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
			referral_code: `PAYOUT-${randomUUID().slice(0, 8).toUpperCase()}`,
			beneficiary_bank_code: "BCA",
			beneficiary_account_number: "1111222233",
			beneficiary_account_holder: "Mitra Awal",
		});
		enrollReq.headers.set("idempotency-key", randomUUID());
		const enrollRes = await handleAffiliateProfile(enrollReq, identity);
		assert.equal(enrollRes.status, 201);
		const profile = await enrollRes.json();
		assert.equal(profile.beneficiary_status, "verified");

		// Create a 3-unit order so we have 3 distinct fulfillment_item rows
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
				recipient_name: "Pembeli Payout",
				phone: "+6281200000088",
				address_line: "Jalan Payout 88",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281200000088" },
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

		const units = await sql<
			{ fulfillment_item_id: string; order_item_id: string }[]
		>`
      select fi.id as fulfillment_item_id, fi.order_item_id
      from app.fulfillment_item fi
      join app.order_item oi on oi.id = fi.order_item_id
      where oi.order_id = ${submitted.order.id}
      order by fi.unit_index asc
    `;
		assert.equal(units.length, 3);

		// 2. Insert first eligible commission of IDR 98,999 -> must NOT queue!
		const [_c1] = await sql<{ id: string }[]>`
      insert into app.commission_entry (
        order_id, order_item_id, fulfillment_item_id, affiliate_id,
        basis_points, merchandise_amount, amount_idr, status,
        receipt_anchor, available_at, revision
      ) values (
        ${submitted.order.id}, ${units[0].order_item_id}, ${units[0].fulfillment_item_id}, ${profile.id},
        9999, 99000, 98999, 'eligible',
        '2026-06-01T00:00:00.000Z'::timestamptz, '2026-06-11T00:00:00.000Z'::timestamptz, 2
      ) returning id
    `;

		const belowThreshold = await sql.begin((tx) =>
			queueEligibleAffiliatePayouts(tx, { affiliateId: profile.id }),
		);
		assert.equal(
			belowThreshold.length,
			0,
			"IDR 98,999 is below IDR 99,000 threshold",
		);

		// 3. Insert second eligible commission of IDR 1 -> total is now exact IDR 99,000 -> queues automatically!
		const [_c2] = await sql<{ id: string }[]>`
      insert into app.commission_entry (
        order_id, order_item_id, fulfillment_item_id, affiliate_id,
        basis_points, merchandise_amount, amount_idr, status,
        receipt_anchor, available_at, revision
      ) values (
        ${submitted.order.id}, ${units[1].order_item_id}, ${units[1].fulfillment_item_id}, ${profile.id},
        1, 99000, 1, 'eligible',
        '2026-06-01T00:00:00.000Z'::timestamptz, '2026-06-11T00:00:00.000Z'::timestamptz, 2
      ) returning id
    `;

		const atThreshold = await sql.begin((tx) =>
			queueEligibleAffiliatePayouts(tx, { affiliateId: profile.id }),
		);
		assert.equal(atThreshold.length, 1);
		const payout1 = atThreshold[0];
		assert.equal(Number(payout1.amount_idr), 99000);
		assert.equal(payout1.status, "queued");

		// Affiliate cannot POST a manual withdrawal or access admin payout queue
		const affiliatePostPayout = affiliate.browser.request(
			"/api/v1/me/affiliate/payouts",
			{},
		);
		affiliatePostPayout.headers.set("idempotency-key", randomUUID());
		assert.equal(
			(await handlePayouts(affiliatePostPayout, identity)).status,
			404,
		);
		assert.equal(
			(
				await handlePayouts(
					affiliate.browser.request("/api/v1/admin/payouts"),
					identity,
				)
			).status,
			403,
		);

		// 4. Affiliate changes beneficiary AFTER payout1 is queued; payout1 must keep frozen beneficiary snapshot
		const changeBenReq = affiliate.browser.request(
			"/api/v1/me/affiliate/beneficiary-changes",
			{
				bank_code: "MANDIRI",
				account_number: "9999888877",
				account_holder_name: "Mitra Baru",
				reauthentication_proof: `proof-${randomUUID()}`,
			},
		);
		changeBenReq.headers.set("idempotency-key", randomUUID());
		assert.equal(
			(await handleAffiliateProfile(changeBenReq, identity)).status,
			202,
		);

		// 5. Finance 1 claims payout1 exclusively; Finance 2 concurrent claim is rejected with 409
		const claimReq1 = finance1.browser.request(
			`/api/v1/admin/payouts/${payout1.id}/manual-transfer-claims`,
			{
				expected_version: 1,
				reauthentication_proof: `fin1-claim-${randomUUID()}`,
			},
		);
		claimReq1.headers.set("idempotency-key", randomUUID());
		const claimRes1 = await handlePayouts(claimReq1, identity);
		assert.equal(claimRes1.status, 200);
		const claimed1 = await claimRes1.json();
		assert.equal(claimed1.payout.status, "processing");
		assert.equal(claimed1.payout.version, 2);
		assert.ok(claimed1.payout.transfer_claim_id);
		// Beneficiary snapshot is still the original BCA 1111222233!
		assert.deepEqual(claimed1.beneficiary_snapshot, {
			bank_code: "BCA",
			account_number: "1111222233",
			account_holder_name: "Mitra Awal",
		});

		const claimReq2 = finance2.browser.request(
			`/api/v1/admin/payouts/${payout1.id}/manual-transfer-claims`,
			{
				expected_version: 2,
				reauthentication_proof: `fin2-claim-${randomUUID()}`,
			},
		);
		claimReq2.headers.set("idempotency-key", randomUUID());
		const claimRes2 = await handlePayouts(claimReq2, identity);
		assert.equal(claimRes2.status, 409);

		// 6. Evidence upload by active claim holder (Finance 1)
		const uploadReq = finance1.browser.request(
			`/api/v1/admin/payouts/${payout1.id}/evidence-uploads`,
			{
				file_name: "bukti-transfer-bca.png",
				media_type: "image/png",
				size_bytes: 24500,
			},
		);
		uploadReq.headers.set("idempotency-key", randomUUID());
		const uploadRes = await handlePayouts(uploadReq, identity);
		assert.equal(uploadRes.status, 200);
		const uploaded = await uploadRes.json();
		assert.ok(uploaded.id);
		assert.ok(String(uploaded.upload_url).includes(payout1.id));

		// Affiliate payout history never exposes upload_url, transfer_claim_id, or raw account_number
		const affPayoutsRes = await handlePayouts(
			affiliate.browser.request("/api/v1/me/affiliate/payouts"),
			identity,
		);
		assert.equal(affPayoutsRes.status, 200);
		const affPayoutsJson = JSON.stringify(await affPayoutsRes.json());
		assert.ok(!affPayoutsJson.includes("1111222233"));
		assert.ok(!affPayoutsJson.includes(uploaded.upload_url));
		assert.ok(!affPayoutsJson.includes(claimed1.payout.transfer_claim_id));

		// 7. Manual transfer verification with wrong evidence_id fails with 422
		const badVerifyReq = finance1.browser.request(
			`/api/v1/admin/payouts/${payout1.id}/manual-transfer-verifications`,
			{
				expected_version: 2,
				transfer_claim_id: claimed1.payout.transfer_claim_id,
				bank_transfer_reference: `BCA-REF-${randomUUID()}`,
				evidence_id: randomUUID(),
				transferred_at: "2026-06-12T09:30:00.000Z",
				reason: "Verifikasi bukti transfer manual BCA",
				reauthentication_proof: `fin1-verify-${randomUUID()}`,
			},
		);
		badVerifyReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handlePayouts(badVerifyReq, identity)).status, 422);

		// Valid verification succeeds, posts balanced ledger journal, and marks commissions paid
		const validVerifyReq = finance1.browser.request(
			`/api/v1/admin/payouts/${payout1.id}/manual-transfer-verifications`,
			{
				expected_version: 2,
				transfer_claim_id: claimed1.payout.transfer_claim_id,
				bank_transfer_reference: `BCA-REF-${randomUUID()}`,
				evidence_id: uploaded.id,
				transferred_at: "2026-06-12T09:30:00.000Z",
				reason: "Verifikasi bukti transfer manual BCA Rp99.000",
				reauthentication_proof: `fin1-verify-${randomUUID()}`,
			},
		);
		validVerifyReq.headers.set("idempotency-key", randomUUID());
		const verifyRes = await handlePayouts(validVerifyReq, identity);
		assert.equal(verifyRes.status, 200);
		const verifiedPayout = await verifyRes.json();
		assert.equal(verifiedPayout.status, "succeeded");
		assert.ok(verifiedPayout.completed_at);

		// Check finance_transaction and finance_posting
		const [storedPayout] = await sql<{ finance_transaction_id: string }[]>`
      select finance_transaction_id from app.affiliate_payout where id = ${payout1.id}
    `;
		assert.ok(storedPayout.finance_transaction_id);
		const postings = await sql<
			{ account: string; side: string; amount: number }[]
		>`
      select account, side, amount::bigint as amount
      from app.finance_posting
      where transaction_id = ${storedPayout.finance_transaction_id}
      order by ordinal asc
    `;
		assert.equal(postings.length, 2);
		assert.equal(Number(postings[0].amount), 99000);
		assert.equal(Number(postings[1].amount), 99000);

		// Commission balance reflects paid = 99000 and allocated = 0
		const balAfterPaid = await (
			await handleCommissions(
				affiliate.browser.request("/api/v1/me/affiliate/balance"),
				identity,
			)
		).json();
		assert.equal(balAfterPaid.paid, 99000);
		assert.equal(balAfterPaid.allocated, 0);

		// 8. Second payout with ambiguous transfer outcome transitions to 'unknown' and retains allocated funds
		await sql`
      insert into app.commission_entry (
        order_id, order_item_id, fulfillment_item_id, affiliate_id,
        basis_points, merchandise_amount, amount_idr, status,
        receipt_anchor, available_at, revision
      ) values (
        ${submitted.order.id}, ${units[2].order_item_id}, ${units[2].fulfillment_item_id}, ${profile.id},
        10000, 99000, 99000, 'eligible',
        '2026-06-01T00:00:00.000Z'::timestamptz, '2026-06-11T00:00:00.000Z'::timestamptz, 2
      )
    `;
		const [payout2] = await sql.begin((tx) =>
			queueEligibleAffiliatePayouts(tx, { affiliateId: profile.id }),
		);
		assert.ok(payout2);
		assert.equal(payout2.beneficiary_snapshot.bank_code, "MANDIRI");

		const reconcileReq = finance1.browser.request(
			`/api/v1/admin/payouts/${payout2.id}/reconciliations`,
			{
				reason:
					"Status mutasi bank belum pasti; tahan cadangan hingga rekonsiliasi selesai",
			},
		);
		reconcileReq.headers.set("idempotency-key", randomUUID());
		const reconcileRes = await handlePayouts(reconcileReq, identity);
		assert.equal(reconcileRes.status, 202);
		const reconciledPayout = await reconcileRes.json();
		assert.equal(reconciledPayout.status, "unknown");

		// Re-running queueEligibleAffiliatePayouts must NOT re-queue the allocated funds
		const requeued = await sql.begin((tx) =>
			queueEligibleAffiliatePayouts(tx, { affiliateId: profile.id }),
		);
		assert.equal(requeued.length, 0);

		const balFinal = await (
			await handleCommissions(
				affiliate.browser.request("/api/v1/me/affiliate/balance"),
				identity,
			)
		).json();
		assert.equal(balFinal.allocated, 99000);
		assert.equal(balFinal.paid, 99000);
	} finally {
		try {
			await closeFulfillmentActor(identity, affiliate);
			await closeFulfillmentActor(identity, finance1);
			await closeFulfillmentActor(identity, finance2);
		} finally {
			await f.close();
		}
	}
});
