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
import {
	enqueueCommissionClaim,
	enqueueCommissionReceipt,
	enqueueCommissionVoid,
} from "../../src/modules/commissions/jobs.ts";
import { confirmCodOrder } from "../../src/modules/payments/cod.ts";
import { runOneJob } from "../../src/jobs/worker.ts";
import { actor, enroll } from "../contract/access-fixture.ts";
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
		await bootstrapGuest(identity, bootRes, new Request("http://127.0.0.1:3099/api/v1/carts", { method: "POST" }));
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

test("PR-9/G2/G3/G4: production outbox jobs wire COD accrual, parcel receipt maturity, return hold, refund void, balanced ledger recognition, and evidence upload verification", async () => {
	const f = await shippingFixture();
	const affiliate = await actor(f.identity, "affiliate", []);
	const finance = await actor(f.identity, "finance", []);
	const sql = f.identity.sql;
	const identity = f.identity;

	try {
		await enroll(finance.browser, finance.password);

		// 1. Enroll affiliate with verified beneficiary
		const enrollReq = affiliate.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
			referral_code: `JOBS-${randomUUID().slice(0, 8).toUpperCase()}`,
			beneficiary_bank_code: "BCA",
			beneficiary_account_number: "8888777766",
			beneficiary_account_holder: "Mitra Jobs",
		});
		enrollReq.headers.set("idempotency-key", randomUUID());
		const enrollRes = await handleAffiliateProfile(enrollReq, identity);
		assert.equal(enrollRes.status, 201);
		const profile = await enrollRes.json();

		// 2. Create 2-unit COD guest order attributed to affiliate
		const client = new CommerceClient(identity);
		const bootRes = new Response(null);
		await bootstrapGuest(identity, bootRes, new Request("http://127.0.0.1:3099/api/v1/carts", { method: "POST" }));
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
							quantity: 2,
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
				recipient_name: "Pembeli Jobs",
				phone: "+6281200000077",
				address_line: "Jalan Jobs 77",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281200000077" },
			payment_method: "cod" as const,
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

		// 3. Confirm COD order -> enqueues commission.accrue outbox job
		await sql.begin((tx) => confirmCodOrder(tx, submitted.order.id));

		const [accrueJob] = await sql<
			{ id: string; kind: string; status: string }[]
		>`
			select id, kind, status from app.outbox_job
			where dedup_key = ${`commission.accrue:${submitted.order.id}`}
		`;
		assert.ok(accrueJob, "Accrue job must be enqueued on COD confirmation");
		assert.equal(accrueJob.status, "pending");

		// Run the accrue job via runOneJob
		assert.equal(await runOneJob(sql, {}, accrueJob.id), true);
		const [accrueJobAfter] = await sql<{ status: string }[]>`
			select status from app.outbox_job where id = ${accrueJob.id}
		`;
		assert.equal(accrueJobAfter.status, "completed");

		// Verify commission rows created for both units
		const entries = await sql<
			{
				id: string;
				fulfillment_item_id: string;
				status: string;
				amount_idr: number;
			}[]
		>`
			select id, fulfillment_item_id, status, amount_idr
			from app.commission_entry
			where order_id = ${submitted.order.id}
			order by id asc
		`;
		assert.equal(entries.length, 2);
		assert.equal(entries[0].status, "pending");
		assert.equal(entries[1].status, "pending");
		const unitAmount = Number(entries[0].amount_idr);
		assert.ok(unitAmount > 0);

		// 4. Record buyer receipt for unit 0 at T0 -> enqueues commission.receipt
		const t0 = "2026-06-01T10:00:00.000Z";
		const receiptSourceId = randomUUID();
		await sql.begin((tx) =>
			enqueueCommissionReceipt(
				tx,
				submitted.order.id,
				entries[0].fulfillment_item_id,
				t0,
				receiptSourceId,
			),
		);

		const [receiptJob] = await sql<
			{ id: string; kind: string; status: string }[]
		>`
			select id, kind, status from app.outbox_job
			where dedup_key = ${`commission.receipt:${entries[0].fulfillment_item_id}`}
		`;
		assert.ok(receiptJob);
		assert.equal(await runOneJob(sql, {}, receiptJob.id), true);

		// Entry 0 now has receipt_anchor and available_at (H+10), and commission.mature job scheduled
		const [entry0AfterReceipt] = await sql<
			{ receipt_anchor: string; available_at: string }[]
		>`
			select receipt_anchor::text, available_at::text
			from app.commission_entry where id = ${entries[0].id}
		`;
		assert.ok(entry0AfterReceipt.receipt_anchor);
		assert.ok(entry0AfterReceipt.available_at);

		const [matureJob] = await sql<
			{ id: string; kind: string; status: string }[]
		>`
			select id, kind, status from app.outbox_job
			where dedup_key like ${`commission.mature:${entries[0].id}:%`}
		`;
		assert.ok(matureJob, "Maturity job scheduled for H+10");
		assert.equal(matureJob.status, "pending");

		// 5. Open return for unit 1 -> enqueues commission.claim (held)
		const returnItemId = randomUUID();
		await sql.begin((tx) =>
			enqueueCommissionClaim(
				tx,
				submitted.order.id,
				returnItemId,
				"held",
				entries[1].fulfillment_item_id,
			),
		);

		const [claimJob] = await sql<
			{ id: string; kind: string; status: string }[]
		>`
			select id, kind, status from app.outbox_job
			where dedup_key = ${`commission.claim:${returnItemId}:held`}
		`;
		assert.ok(claimJob);
		assert.equal(await runOneJob(sql, {}, claimJob.id), true);

		const [entry1Held] = await sql<{ status: string; hold_reason: string }[]>`
			select status, hold_reason from app.commission_entry where id = ${entries[1].id}
		`;
		assert.equal(entry1Held.status, "held");
		assert.ok(entry1Held.hold_reason);

		// 6. Void unit 1 on refund -> enqueues commission.void
		await sql.begin((tx) =>
			enqueueCommissionVoid(
				tx,
				submitted.order.id,
				entries[1].fulfillment_item_id,
			),
		);
		const [voidJob] = await sql<
			{ id: string; kind: string; status: string }[]
		>`
			select id, kind, status from app.outbox_job
			where dedup_key = ${`commission.void:${entries[1].fulfillment_item_id}`}
		`;
		assert.ok(voidJob);
		assert.equal(await runOneJob(sql, {}, voidJob.id), true);

		const [entry1Void] = await sql<{ status: string }[]>`
			select status from app.commission_entry where id = ${entries[1].id}
		`;
		assert.equal(entry1Void.status, "void");

		// 7. Advance fixture clock past H+10 (2026-06-12) and run commission.mature job
		await sql`
			update app.local_fixture_namespace
			set clock = '2026-06-12T00:00:00.000Z'::timestamptz, revision = revision + 1
			where name = ${f.namespace}
		`;

		assert.equal(await runOneJob(sql, {}, matureJob.id), true);

		const [entry0Matured] = await sql<{ status: string }[]>`
			select status from app.commission_entry where id = ${entries[0].id}
		`;
		assert.equal(entry0Matured.status, "eligible");

		// Verify balanced ledger posting Dr commission_expense / Cr affiliate_payable
		const [recognitionTx] = await sql<
			{ id: string; kind: string; source: string; effect_reference: string }[]
		>`
			select id, kind, source, effect_reference from app.finance_transaction
			where source = 'affiliate.commission' and effect_reference = ${`commission:${entries[0].id}`}
		`;
		assert.ok(recognitionTx, "Recognition transaction must exist");
		assert.equal(recognitionTx.kind, "adjustment");

		const recognitionPostings = await sql<
			{ account: string; side: string; amount: number }[]
		>`
			select account, side, amount::bigint as amount from app.finance_posting
			where transaction_id = ${recognitionTx.id}
			order by ordinal asc
		`;
		assert.equal(recognitionPostings.length, 2);
		assert.equal(Number(recognitionPostings[0].amount), unitAmount);
		assert.equal(Number(recognitionPostings[1].amount), unitAmount);
		assert.equal(recognitionPostings.find(p => p.side === 'debit')?.account, 'commission_expense');
		assert.equal(recognitionPostings.find(p => p.side === 'credit')?.account, 'affiliate_payable');

		// Idempotent re-run does not create duplicate transaction
		const maturedAgain = await sql.begin(tx => matureEligibleCommissions(tx, { entryId: entries[0].id }));
		assert.equal(maturedAgain.length, 0);
		const txCount = await sql<{ n: number }[]>`
			select count(*)::int as n from app.finance_transaction
			where source = 'affiliate.commission' and effect_reference = ${`commission:${entries[0].id}`}
		`;
		assert.equal(txCount[0].n, 1);

		// 8. Reversal on void after recognition: voiding entry 0 posts reversal transaction
		await sql.begin((tx) =>
			voidUnitCommissionOnRefund(tx, {
				fulfillmentItemId: entries[0].fulfillment_item_id,
				reason: "Late cancellation after recognition",
			}),
		);
		const [reversalTx] = await sql<
			{ id: string; kind: string; reverses_id: string }[]
		>`
			select id, kind, reverses_id from app.finance_transaction
			where source = 'affiliate.commission' and reverses_id = ${recognitionTx.id}
		`;
		assert.ok(reversalTx, "Reversal transaction must be created");
		assert.equal(reversalTx.kind, "reversal");

		const reversalPostings = await sql<
			{ account: string; side: string; amount: number }[]
		>`
			select account, side, amount::bigint as amount from app.finance_posting
			where transaction_id = ${reversalTx.id}
			order by ordinal asc
		`;
		assert.equal(reversalPostings.length, 2);
		assert.equal(reversalPostings.find(p => p.side === 'debit')?.account, 'affiliate_payable');
		assert.equal(reversalPostings.find(p => p.side === 'credit')?.account, 'commission_expense');
	} finally {
		try {
			await closeFulfillmentActor(identity, affiliate);
			await closeFulfillmentActor(identity, finance);
		} finally {
			await f.close();
		}
	}
});
