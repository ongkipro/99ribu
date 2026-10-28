import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
	FinanceIntent,
	type FinanceProofAction,
} from "../../src/components/admin/finance-intent-core.ts";
import {
	cursorBefore,
	financeAccess,
	formatDashboardMoney,
	formatStatementAmount,
	missingInputLabel,
} from "../../src/components/admin/finance-model.ts";
import { runOneJob } from "../../src/jobs/worker.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
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
import { handleFinanceSummary } from "../../src/modules/finance/realized-contribution.ts";
import { handleSettlements } from "../../src/modules/finance/settlements/routes.ts";
import {
	advanceFixtureClock,
	readFixtureClock,
} from "../../src/modules/local/fixtures.ts";
import { createAttempt } from "../../src/modules/payments/attempts.ts";
import {
	ingestProviderEvent,
	simulateCollection,
} from "../../src/modules/payments/local.ts";
import { paymentAdapter } from "../../src/modules/payments/worker.ts";
import {
	handlePayouts,
	queueEligibleAffiliatePayouts,
} from "../../src/modules/payouts/service.ts";
import { handleReporting } from "../../src/modules/reporting/service.ts";
import { createReturn } from "../../src/modules/returns/cases.ts";
import {
	ingestParcelReceiptSource,
	simulateParcelReceipt,
} from "../../src/modules/returns/receipt-source.ts";
import { reconcileRefundNow } from "../../src/modules/returns/refund-recovery.ts";
import {
	ingestRefundSourceEvent,
	simulateRefundOutcome,
} from "../../src/modules/returns/refund-source.ts";
import { handleReturns } from "../../src/modules/returns/routes.ts";
import { refundAdapter } from "../../src/modules/returns/worker.ts";
import { actor, type BrowserSession, enroll } from "../contract/access-fixture.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";
import { CommerceClient } from "./checkout-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { paymentFixture } from "./payment-fixture.ts";
import { returnFixture } from "./return-fixture.ts";
import { settlementFixture } from "./settlement-fixture.ts";
import { shippingFixture } from "./shipping-fixture.ts";

// S131 Finance workbench (spec 17 B16–B19) integration tests over the real PostgreSQL test DB and
// route handlers: role and permission matrix across B16–B19, new GET /api/v1/admin/refunds keyset
// paging + status filter + OpenAPI contract probe, reconciliation match/unmatch/escalate with
// finance.reconcile proof, affiliate payout claim -> evidence -> verify -> reconcile with
// payout.claim/verify proofs, refund reconcile/retry with finance.refund proof, unknown outcome
// money safety (no duplicate postings), and finance summary incomplete vs zero reporting.

type StaffActor = {
	id: string;
	email: string;
	password: string;
	browser: BrowserSession;
};

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

test("S131 financeAccess permission matrix, cursorBefore helper, incomplete formatting, and FinanceIntent money-safety replay", async () => {
	assert.deepEqual(financeAccess(["owner"], []), {
		reconcileRead: true,
		reconcileWrite: true,
		payouts: true,
		refundRead: true,
		refundWrite: true,
		summaryRead: true,
	});
	for (const role of ["ecommerce_admin", "warehouse", "customer_service"]) {
		assert.deepEqual(
			financeAccess(
				[role],
				[
					"finance.reconciliation.read",
					"finance.reconciliation.write",
					"finance.refunds.read",
					"finance.refunds.write",
					"finance.summary.read",
				],
			),
			{
				reconcileRead: false,
				reconcileWrite: false,
				payouts: false,
				refundRead: false,
				refundWrite: false,
				summaryRead: false,
			},
			`${role} never gains finance access`,
		);
	}
	assert.deepEqual(financeAccess(["finance"], []), {
		reconcileRead: false,
		reconcileWrite: false,
		payouts: true,
		refundRead: false,
		refundWrite: false,
		summaryRead: false,
	});
	assert.deepEqual(
		financeAccess(["finance"], ["finance.reconciliation.read"]),
		{
			reconcileRead: true,
			reconcileWrite: false,
			payouts: true,
			refundRead: false,
			refundWrite: false,
			summaryRead: false,
		},
	);
	assert.deepEqual(
		financeAccess(
			["finance"],
			["finance.reconciliation.read", "finance.reconciliation.write"],
		),
		{
			reconcileRead: true,
			reconcileWrite: true,
			payouts: true,
			refundRead: false,
			refundWrite: false,
			summaryRead: false,
		},
	);
	assert.deepEqual(financeAccess(["finance"], ["finance.refunds.read"]), {
		reconcileRead: false,
		reconcileWrite: false,
		payouts: true,
		refundRead: true,
		refundWrite: false,
		summaryRead: false,
	});
	assert.deepEqual(
		financeAccess(
			["finance"],
			["finance.refunds.read", "finance.refunds.write", "finance.summary.read"],
		),
		{
			reconcileRead: false,
			reconcileWrite: false,
			payouts: true,
			refundRead: true,
			refundWrite: true,
			summaryRead: true,
		},
	);

	// cursorBefore computes the exact preceding UUID.
	assert.equal(
		cursorBefore("12345678-1234-4234-8234-123456789abd"),
		"12345678-1234-4234-8234-123456789abc",
	);
	assert.equal(cursorBefore("00000000-0000-0000-0000-000000000000"), null);
	assert.equal(cursorBefore("not-a-uuid"), null);

	// Incomplete sections and dashboard metrics never render as Rp 0.
	assert.equal(
		formatStatementAmount({
			complete: false,
			amount: null,
			missing_inputs: ["hpp:sku-1"],
		}),
		"Belum lengkap",
	);
	assert.equal(
		formatStatementAmount({
			complete: false,
			amount: 0,
			missing_inputs: ["settlement:rec-1"],
		}),
		"Belum lengkap",
	);
	assert.equal(
		formatStatementAmount({ complete: true, amount: 0, missing_inputs: [] }),
		formatDashboardMoney({ complete: true, amount: 0 }),
	);
	assert.equal(
		formatDashboardMoney({ complete: false, amount: null }),
		"Belum lengkap",
	);
	assert.match(missingInputLabel("hpp:12345678-0000"), /HPP komponen fisik/);
	assert.match(
		missingInputLabel("settlement:12345678-0000"),
		/belum direkonsiliasi/,
	);

	// FinanceIntent reuses the same Idempotency-Key, frozen body, and proof on uncertain responses,
	// and rotates the key after a definitive 409 VERSION_CONFLICT.
	const calls: { url: string; key: string | null; body: Record<string, unknown> }[] =
		[];
	const answers: (Response | Error)[] = [
		new Response(JSON.stringify({ proof: "PROOF-1" }), {
			status: 201,
			headers: { "content-type": "application/json" },
		}),
		new Error("socket hang up"),
		new Response(JSON.stringify({ code: "SERVICE_UNAVAILABLE" }), {
			status: 503,
			headers: { "content-type": "application/json" },
		}),
		new Response(JSON.stringify({ id: "ref-1", version: 2, status: "queued" }), {
			status: 202,
			headers: { "content-type": "application/json" },
		}),
		new Response(JSON.stringify({ proof: "PROOF-2" }), {
			status: 201,
			headers: { "content-type": "application/json" },
		}),
		new Response(JSON.stringify({ code: "VERSION_CONFLICT" }), {
			status: 409,
			headers: { "content-type": "application/json" },
		}),
	];
	const fakeFetch = (async (url: string, init: RequestInit) => {
		calls.push({
			url,
			key: new Headers(init.headers).get("idempotency-key"),
			body: JSON.parse(String(init.body)),
		});
		const next = answers.shift();
		if (!next) throw new Error(`Unexpected call to ${url}`);
		if (next instanceof Error) throw next;
		return next;
	}) as typeof fetch;

	let seq = 0;
	const uuid = () => `key-${++seq}`;
	let uncertainCount = 0;
	let conflictCount = 0;
	const intent = new FinanceIntent();
	const targetUrl = "/api/v1/admin/refunds/r1/reconciliations";
	const money = {
		password: "pw",
		action: "finance.refund" as FinanceProofAction,
		subject: "r1",
	};

	const first = await intent.send(
		targetUrl,
		() => ({ action: "reconcile", expected_version: 1, reason: "awal" }),
		{
			money,
			fetch: fakeFetch,
			uuid,
			onUncertain: () => uncertainCount++,
		},
	);
	assert.equal(first.uncertain, true);
	assert.equal(first.data, null);

	// Even if build() would produce a different version/reason, the resend repeats the frozen body and key.
	const second = await intent.send(
		targetUrl,
		() => ({ action: "retry", expected_version: 99, reason: "diubah" }),
		{
			money,
			fetch: fakeFetch,
			uuid,
			onUncertain: () => uncertainCount++,
		},
	);
	assert.equal(second.uncertain, true);

	const third = await intent.send<{ id: string; version: number }>(
		targetUrl,
		() => ({ action: "retry", expected_version: 99, reason: "diubah" }),
		{
			money,
			fetch: fakeFetch,
			uuid,
			onUncertain: () => uncertainCount++,
		},
	);
	assert.equal(third.uncertain, false);
	assert.equal(third.data?.version, 2);
	assert.equal(uncertainCount, 2);

	const targetSends = calls.filter((c) => c.url === targetUrl);
	assert.equal(targetSends.length, 3);
	assert.equal(new Set(targetSends.map((c) => c.key)).size, 1);
	assert.deepEqual(targetSends[0].body, {
		action: "reconcile",
		expected_version: 1,
		reason: "awal",
		reauthentication_proof: "PROOF-1",
	});
	assert.equal(
		new Set(targetSends.map((c) => JSON.stringify(c.body))).size,
		1,
	);

	// Next intent receives a 409 VERSION_CONFLICT -> invokes onConflict and rotates the key.
	const fourth = await intent.send(
		targetUrl,
		() => ({ action: "reconcile", expected_version: 2, reason: "kedua" }),
		{
			money,
			fetch: fakeFetch,
			uuid,
			onConflict: () => conflictCount++,
		},
	);
	assert.equal(fourth.uncertain, false);
	assert.equal(fourth.code, "VERSION_CONFLICT");
	assert.equal(conflictCount, 1);
	assert.equal(intent.key, null);
	assert.equal(intent.frozen, null);

	// A refused proof (wrong password) never sent the mutation: the operator edits the form and submits again, and the
	// body that reaches the money endpoint is the edited one, not the stale frozen body (regression for review S131 #1).
	const refusedCalls: { url: string; body: Record<string, unknown> }[] = [];
	const refusedAnswers: Response[] = [
		new Response(JSON.stringify({ code: "INVALID_PASSWORD" }), { status: 403, headers: { "content-type": "application/json" } }),
		new Response(JSON.stringify({ proof: "PROOF-OK" }), { status: 201, headers: { "content-type": "application/json" } }),
		new Response(JSON.stringify({ id: "p-1", version: 3, status: "paid" }), { status: 200, headers: { "content-type": "application/json" } }),
	];
	const refusedFetch = (async (url: string, init: RequestInit) => {
		refusedCalls.push({ url, body: JSON.parse(String(init.body)) });
		const next = refusedAnswers.shift();
		if (!next) throw new Error(`Unexpected call to ${url}`);
		return next;
	}) as typeof fetch;
	const verifyUrl = "/api/v1/admin/payouts/p-1/verifications";
	const verify = new FinanceIntent();
	const typo = await verify.send(verifyUrl, () => ({ bank_transfer_reference: "TYPO-123" }), {
		money: { password: "wrong", action: "payout.verify" as FinanceProofAction, subject: "p-1" },
		fetch: refusedFetch,
		uuid: () => "key-v",
	});
	assert.equal(typo.uncertain, false);
	assert.equal(typo.code, "INVALID_PASSWORD");
	assert.equal(refusedCalls.filter((c) => c.url === verifyUrl).length, 0, "nothing was sent to the money endpoint");
	const fixed = await verify.send(verifyUrl, () => ({ bank_transfer_reference: "CORRECT-456" }), {
		money: { password: "right", action: "payout.verify" as FinanceProofAction, subject: "p-1" },
		fetch: refusedFetch,
		uuid: () => "key-v",
	});
	assert.equal(fixed.uncertain, false);
	assert.deepEqual(refusedCalls.filter((c) => c.url === verifyUrl).map((c) => c.body), [
		{ bank_transfer_reference: "CORRECT-456", reauthentication_proof: "PROOF-OK" },
	]);
});

test("S131 B16 reconciliation: role/permission matrix, list/detail/source/match reads, and match -> unmatch -> escalate decisions with finance.reconcile proof", async () => {
	const f = await settlementFixture();
	const sql = f.identity.sql;
	const users: StaffActor[] = [];
	const makeStaff = async (
		role: "ecommerce_admin" | "warehouse" | "customer_service" | "finance",
		permissions: string[] = [],
	) => {
		const u = await actor(f.identity, role, []);
		users.push(u);
		await enroll(u.browser, u.password);
		if (permissions.length > 0) {
			await sql`update app.role_grant set permissions=${permissions} where user_id=${u.id}`;
		}
		return u;
	};
	const call = async (
		who: StaffActor,
		path: string,
		body?: Record<string, unknown>,
		key = randomUUID(),
	) => {
		const req = who.browser.request(path, body);
		if (body) req.headers.set("idempotency-key", key);
		const res = await handleSettlements(req, f.identity);
		return { status: res.status, payload: await res.json() };
	};
	const issueProof = async (who: StaffActor, subjectId: string) => {
		const req = who.browser.request("/api/v1/me/reauthentication-proofs", {
			password: who.password,
			action: "finance.reconcile",
			subject_id: subjectId,
		});
		req.headers.set("idempotency-key", randomUUID());
		const res = await handleAccess(req, f.identity);
		return { status: res.status, payload: await res.json() };
	};

	try {
		const ecom = await makeStaff("ecommerce_admin");
		const wh = await makeStaff("warehouse");
		const cs = await makeStaff("customer_service");
		const finNone = await makeStaff("finance", []);
		const finRO = await makeStaff("finance", ["finance.reconciliation.read"]);
		const finRW = await makeStaff("finance", [
			"finance.reconciliation.read",
			"finance.reconciliation.write",
		]);

		const sourcePath = `/api/v1/admin/settlements/${f.source.operation_id}`;
		const decisionInput = {
			action: "match",
			expected_version: 1,
			expected_match_id: null,
			source_reference: f.source.statement_id,
			reason: "SYNTHETIC S131 match decision",
			allocations: [
				{
					receivable_transaction_id: f.receipts[0].transaction_id,
					gross_amount: 11,
				},
			],
			reauthentication_proof: "SYNTHETIC-NOT-ISSUED",
		};

		// Denied roles cannot read or write reconciliation.
		for (const who of [ecom, wh, cs, finNone]) {
			assert.equal((await call(who, "/api/v1/admin/reconciliation")).status, 403);
			assert.equal((await call(who, f.root)).status, 403);
			assert.equal((await call(who, sourcePath)).status, 403);
			assert.equal(
				(await call(who, `${f.root}/decisions`, decisionInput)).status,
				403,
			);
			assert.equal((await issueProof(who, f.head.id)).status, 403);
		}

		// Read-only finance can read list, detail, and source, but cannot issue proof or post decisions.
		const roList = await call(
			finRO,
			`/api/v1/admin/reconciliation?reference=${f.source.reference}&limit=5`,
		);
		assert.equal(roList.status, 200);
		assert.equal(roList.payload.data.length, 1);
		assert.equal(roList.payload.data[0].id, f.head.id);
		assert.equal((await call(finRO, f.root)).status, 200);
		assert.equal((await call(finRO, sourcePath)).status, 200);
		assert.equal((await issueProof(finRO, f.head.id)).status, 403);
		assert.equal(
			(await call(finRO, `${f.root}/decisions`, decisionInput)).status,
			403,
		);

		// Read-write finance matches -> reads match -> unmatches -> escalates.
		const matchProof = await issueProof(finRW, f.head.id);
		assert.equal(matchProof.status, 201);
		const matchKey = randomUUID();
		const matchBody = {
			...decisionInput,
			reauthentication_proof: matchProof.payload.proof,
		};
		const matched = await call(
			finRW,
			`${f.root}/decisions`,
			matchBody,
			matchKey,
		);
		assert.equal(matched.status, 201);
		assert.equal(matched.payload.status, "matched");
		assert.equal(matched.payload.version, 2);
		assert.ok(matched.payload.current_match_id);

		// Idempotent replay with same key returns identical payload without advancing version.
		const replayed = await call(
			finRW,
			`${f.root}/decisions`,
			matchBody,
			matchKey,
		);
		assert.equal(replayed.status, 201);
		assert.deepEqual(replayed.payload, matched.payload);

		// Stale expected_version is refused with 409 VERSION_CONFLICT.
		const staleProof = await issueProof(finRW, f.head.id);
		const stale = await call(finRW, `${f.root}/decisions`, {
			...decisionInput,
			expected_version: 1,
			reauthentication_proof: staleProof.payload.proof,
		});
		assert.equal(stale.status, 409);
		assert.equal(stale.payload.code, "VERSION_CONFLICT");

		// getReconciliationMatch returns active match and allocations.
		const matchId = String(matched.payload.current_match_id);
		const readMatch = await call(finRO, `${f.root}/matches/${matchId}`);
		assert.equal(readMatch.status, 200);
		assert.equal(readMatch.payload.active, true);
		assert.equal(readMatch.payload.totals.gross_amount, 11);

		// Unmatch reverses the active match and returns status to pending.
		const unmatchProof = await issueProof(finRW, f.head.id);
		const unmatched = await call(finRW, `${f.root}/decisions`, {
			action: "unmatch",
			expected_version: 2,
			expected_match_id: matchId,
			source_reference: f.source.statement_id,
			reason: "SYNTHETIC S131 unmatch decision",
			allocations: [],
			reauthentication_proof: unmatchProof.payload.proof,
		});
		assert.equal(unmatched.status, 201);
		assert.equal(unmatched.payload.status, "pending");
		assert.equal(unmatched.payload.current_match_id, null);
		assert.equal(unmatched.payload.last_match_id, matchId);

		// Historical match remains readable with active=false.
		const inactiveMatch = await call(finRO, `${f.root}/matches/${matchId}`);
		assert.equal(inactiveMatch.status, 200);
		assert.equal(inactiveMatch.payload.active, false);

		// Escalate marks item as exception with SETTLEMENT_FINANCE_REVIEW.
		const escalateProof = await issueProof(finRW, f.head.id);
		const escalated = await call(finRW, `${f.root}/decisions`, {
			action: "escalate",
			expected_version: 3,
			expected_match_id: null,
			source_reference: f.source.statement_id,
			reason: "SYNTHETIC S131 escalate for review",
			allocations: [],
			reauthentication_proof: escalateProof.payload.proof,
		});
		assert.equal(escalated.status, 201);
		assert.equal(escalated.payload.status, "exception");
		assert.equal(escalated.payload.problem_code, "SETTLEMENT_FINANCE_REVIEW");
	} finally {
		for (const u of users) await closeFulfillmentActor(f.identity, u);
		await f.close();
	}
});

test("S131 B17 affiliate payouts: role matrix, claim -> evidence -> verify -> reconcile with proofs, and unknown outcome stays reserved without duplicate postings", async () => {
	const f = await shippingFixture();
	const sql = f.identity.sql;
	const identity = f.identity;
	const users: StaffActor[] = [];
	const makeUser = async (
		role:
			| "affiliate"
			| "buyer"
			| "ecommerce_admin"
			| "warehouse"
			| "customer_service"
			| "finance",
		mfa = true,
	) => {
		const u = await actor(identity, role, []);
		users.push(u);
		if (mfa) await enroll(u.browser, u.password);
		return u;
	};
	const proofFor = async (
		who: StaffActor,
		action: "payout.claim" | "payout.verify",
		subjectId: string,
	) => {
		const req = who.browser.request("/api/v1/me/reauthentication-proofs", {
			password: who.password,
			action,
			subject_id: subjectId,
		});
		req.headers.set("idempotency-key", randomUUID());
		const res = await handleAccess(req, identity);
		assert.equal(res.status, 201);
		return String((await res.json()).proof);
	};

	try {
		const affiliate = await makeUser("affiliate", false);
		const buyer = await makeUser("buyer", false);
		const ecom = await makeUser("ecommerce_admin");
		const wh = await makeUser("warehouse");
		const cs = await makeUser("customer_service");
		const finance = await makeUser("finance");

		// Enroll affiliate and create 2 eligible commissions of IDR 99,000 so we can test both verify and unknown reconcile.
		const enrollReq = affiliate.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
			referral_code: `S131-${randomUUID().slice(0, 8).toUpperCase()}`,
			beneficiary_bank_code: "BCA",
			beneficiary_account_number: "8888999900",
			beneficiary_account_holder: "Mitra S131",
		});
		enrollReq.headers.set("idempotency-key", randomUUID());
		const enrollRes = await handleAffiliateProfile(enrollReq, identity);
		assert.equal(enrollRes.status, 201);
		const profile = await enrollRes.json();

		const client = new CommerceClient(identity);
		const bootRes = new Response(null);
		await bootstrapGuest(
			identity,
			bootRes,
			new Request("http://127.0.0.1:3099/api/v1/carts", { method: "POST" }),
		);
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
				recipient_name: "Pembeli S131",
				phone: "+6281200000131",
				address_line: "Jalan S131 No 1",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281200000131" },
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
      order by fi.unit_index asc`;

		await sql`
      insert into app.commission_entry (
        order_id, order_item_id, fulfillment_item_id, affiliate_id,
        basis_points, merchandise_amount, amount_idr, status,
        receipt_anchor, available_at, revision
      ) values (
        ${submitted.order.id}, ${units[0].order_item_id}, ${units[0].fulfillment_item_id}, ${profile.id},
        10000, 99000, 99000, 'eligible',
        '2026-06-01T00:00:00.000Z'::timestamptz, '2026-06-11T00:00:00.000Z'::timestamptz, 2
      )`;
		const [payout1] = await sql.begin((tx) =>
			queueEligibleAffiliatePayouts(tx, { affiliateId: profile.id }),
		);
		assert.ok(payout1);

		await sql`
      insert into app.commission_entry (
        order_id, order_item_id, fulfillment_item_id, affiliate_id,
        basis_points, merchandise_amount, amount_idr, status,
        receipt_anchor, available_at, revision
      ) values (
        ${submitted.order.id}, ${units[1].order_item_id}, ${units[1].fulfillment_item_id}, ${profile.id},
        10000, 99000, 99000, 'eligible',
        '2026-06-01T00:00:00.000Z'::timestamptz, '2026-06-11T00:00:00.000Z'::timestamptz, 2
      )`;
		const [payout2] = await sql.begin((tx) =>
			queueEligibleAffiliatePayouts(tx, { affiliateId: profile.id }),
		);
		assert.ok(payout2);

		// Non-finance/owner roles are denied on payouts queue and mutations.
		for (const who of [buyer, affiliate, ecom, wh, cs]) {
			const res = await handlePayouts(
				who.browser.request("/api/v1/admin/payouts"),
				identity,
			);
			assert.equal(res.status, 403);
		}

		// cursorBefore finds payout1 in a single bounded page.
		const before1 = cursorBefore(payout1.id);
		assert.ok(before1);
		const listRes = await handlePayouts(
			finance.browser.request(
				`/api/v1/admin/payouts?limit=5&cursor=${encodeURIComponent(before1)}`,
			),
			identity,
		);
		assert.equal(listRes.status, 200);
		const listPayload = await listRes.json();
		assert.equal(listPayload.data[0].id, payout1.id);

		// Payout 1: claim -> evidence upload -> verify.
		const claimProof = await proofFor(finance, "payout.claim", payout1.id);
		const claimReq = finance.browser.request(
			`/api/v1/admin/payouts/${payout1.id}/manual-transfer-claims`,
			{
				expected_version: 1,
				reauthentication_proof: claimProof,
			},
		);
		claimReq.headers.set("idempotency-key", randomUUID());
		const claimRes = await handlePayouts(claimReq, identity);
		assert.equal(claimRes.status, 200);
		const claimed = await claimRes.json();
		assert.equal(claimed.payout.status, "processing");
		assert.equal(claimed.beneficiary_snapshot.account_number, "8888999900");

		const evReq = finance.browser.request(
			`/api/v1/admin/payouts/${payout1.id}/evidence-uploads`,
			{
				file_name: "bukti-s131.png",
				media_type: "image/png",
				size_bytes: PNG.byteLength,
			},
		);
		evReq.headers.set("idempotency-key", randomUUID());
		const evRes = await handlePayouts(evReq, identity);
		assert.equal(evRes.status, 200);
		const slot = await evRes.json();

		const putReq = new Request(slot.upload_url, {
			method: "PUT",
			headers: {
				origin: "http://127.0.0.1:3099",
				cookie: [...finance.browser.cookies]
					.map(([name, value]) => `${name}=${value}`)
					.join("; "),
				"content-type": "image/png",
				"x-payout-id": payout1.id,
			},
			body: PNG,
		});
		const putRes = await handlePayouts(putReq, identity);
		assert.equal(putRes.status, 200);

		const verifyProof = await proofFor(finance, "payout.verify", payout1.id);
		const verifyKey = randomUUID();
		const verifyBody = {
			expected_version: claimed.payout.version,
			transfer_claim_id: claimed.payout.transfer_claim_id,
			bank_transfer_reference: `REF-S131-${randomUUID().slice(0, 8)}`,
			evidence_id: slot.id,
			transferred_at: new Date().toISOString(),
			reason: "SYNTHETIC S131 manual payout verification",
			reauthentication_proof: verifyProof,
		};
		const verifyReq = finance.browser.request(
			`/api/v1/admin/payouts/${payout1.id}/manual-transfer-verifications`,
			verifyBody,
		);
		verifyReq.headers.set("idempotency-key", verifyKey);
		const verifyRes = await handlePayouts(verifyReq, identity);
		assert.equal(verifyRes.status, 200);
		const verified = await verifyRes.json();
		assert.equal(verified.status, "succeeded");

		// Replay of verify with the same Idempotency-Key returns the saved result and posts no second journal.
		const replayReq = finance.browser.request(
			`/api/v1/admin/payouts/${payout1.id}/manual-transfer-verifications`,
			verifyBody,
		);
		replayReq.headers.set("idempotency-key", verifyKey);
		const replayRes = await handlePayouts(replayReq, identity);
		assert.equal(replayRes.status, 200);
		assert.deepEqual(await replayRes.json(), verified);
		const [journalCount1] = await sql<{ n: number }[]>`
      select count(*)::int as n from app.finance_transaction
      where source='affiliate.payout' and effect_reference=${payout1.id}`;
		assert.equal(journalCount1.n, 1);

		// Payout 2: reconcile marks status='unknown'; while unknown, claim and verify are refused and 0 cash journals exist.
		const recReq = finance.browser.request(
			`/api/v1/admin/payouts/${payout2.id}/reconciliations`,
			{ reason: "SYNTHETIC S131 bank outcome uncertain" },
		);
		recReq.headers.set("idempotency-key", randomUUID());
		const recRes = await handlePayouts(recReq, identity);
		assert.equal(recRes.status, 202);
		const unknownPayout = await recRes.json();
		assert.equal(unknownPayout.status, "unknown");

		const claimUnknownReq = finance.browser.request(
			`/api/v1/admin/payouts/${payout2.id}/manual-transfer-claims`,
			{
				expected_version: unknownPayout.version,
				reauthentication_proof: await proofFor(
					finance,
					"payout.claim",
					payout2.id,
				),
			},
		);
		claimUnknownReq.headers.set("idempotency-key", randomUUID());
		assert.equal(
			(await handlePayouts(claimUnknownReq, identity)).status,
			409,
			"unknown payout cannot be claimed for a second transfer",
		);
		const [journalCount2] = await sql<{ n: number }[]>`
      select count(*)::int as n from app.finance_transaction
      where source='affiliate.payout' and effect_reference=${payout2.id}`;
		assert.equal(journalCount2.n, 0);
	} finally {
		for (const u of users) await closeFulfillmentActor(identity, u);
		await f.close();
	}
});

test("S131 B18 refunds: new GET /api/v1/admin/refunds keyset paging, status filter, no bank account disclosure, unknown outcome safety, reconcile with proof, and OpenAPI parity", async () => {
	const f = await returnFixture("prepaid");
	const sql = f.identity.sql;
	const users: StaffActor[] = [];
	const samples: Exchange[] = [];
	const makeStaff = async (
		role: "ecommerce_admin" | "warehouse" | "customer_service" | "finance",
		permissions: string[] = [],
	) => {
		const u = await actor(f.identity, role, []);
		users.push(u);
		await enroll(u.browser, u.password);
		if (permissions.length > 0) {
			await sql`update app.role_grant set permissions=${permissions} where user_id=${u.id}`;
		}
		return u;
	};
	const observeList = async (
		request: Request,
		expectedStatus: number,
		requestValid = true,
	) => {
		const res = await handleReturns(request, f.identity);
		const payload = await res.json();
		assert.equal(
			res.status,
			expectedStatus,
			`Expected ${expectedStatus}, got ${res.status}: ${JSON.stringify(payload)}`,
		);
		samples.push({
			url: request.url,
			method: request.method,
			request_headers: Object.fromEntries(request.headers),
			request_valid: requestValid,
			status: res.status,
			headers: Object.fromEntries(res.headers),
			payload,
		});
		return payload;
	};
	const callReturns = async (
		who: StaffActor,
		path: string,
		body?: Record<string, unknown>,
		key = randomUUID(),
	) => {
		const req = who.browser.request(path, body);
		if (body) req.headers.set("idempotency-key", key);
		const res = await handleReturns(req, f.identity);
		return { status: res.status, payload: await res.json() };
	};
	const issueRefundProof = async (who: StaffActor, subjectId: string) => {
		const req = who.browser.request("/api/v1/me/reauthentication-proofs", {
			password: who.password,
			action: "finance.refund",
			subject_id: subjectId,
		});
		req.headers.set("idempotency-key", randomUUID());
		const res = await handleAccess(req, f.identity);
		return { status: res.status, payload: await res.json() };
	};

	try {
		const ecom = await makeStaff("ecommerce_admin");
		const wh = await makeStaff("warehouse");
		const cs = await makeStaff("customer_service");
		const finNone = await makeStaff("finance", []);
		const finRO = await makeStaff("finance", ["finance.refunds.read"]);

		// Deliver all parcels so units are eligible for return claims.
		for (const booking of f.bookings) {
			const parcel = f.parcels.find((row) => row.id === booking.fulfillment_id);
			assert.ok(parcel);
			const source = await simulateParcelReceipt(sql, "test", {
				reference: randomUUID(),
				booking_id: booking.id,
				unit_ids: f.units
					.filter((row) => row.shipment_id === parcel.shipment_id)
					.map((row) => row.id),
			});
			assert.equal(
				await runOneJob(sql, {}, await ingestParcelReceiptSource(sql, source)),
				true,
			);
		}

		const buyer = await commerceActor(
			f.client.request("/api/v1/carts"),
			f.identity,
		);
		assert.ok(buyer);

		// Create and approve 2 separate return cases (unit 0 and unit 1) and queue 2 refunds.
		const queueApprovedForUnit = async (unit: (typeof f.units)[number]) => {
			const body = {
				items: [
					{
						order_item_id: unit.order_item_id,
						delivered_fulfillment_item_id: unit.id,
						quantity: 1,
						reason: "damaged",
						details: `SYNTHETIC S131 refund list claim ${unit.id}`,
					},
				],
				requested_resolution: "refund" as const,
			};
			const created = (await createReturn(
				f.client.request(`/api/v1/orders/${f.order.id}/returns`, body),
				f.identity,
				buyer,
				f.order.id,
				body,
			)) as { id: string };
			const decided = await callReturns(
				f.owner,
				`/api/v1/admin/returns/${created.id}/decisions`,
				{
					decision: "approve_refund",
					requires_goods: false,
					expected_version: 1,
					reason: "SYNTHETIC S131 waive goods for refund test",
				},
			);
			assert.equal(decided.status, 201);
			const proof = await issueRefundProof(f.finance, created.id);
			assert.equal(proof.status, 201);
			const queued = await callReturns(f.finance, "/api/v1/admin/refunds", {
				return_case_id: created.id,
				expected_version: 2,
				reason: "SYNTHETIC S131 queue refund",
				reauthentication_proof: proof.payload.proof,
			});
			assert.equal(queued.status, 202);
			return queued.payload as {
				id: string;
				version: number;
				amount: number;
				status: string;
			};
		};

		const refundA = await queueApprovedForUnit(f.units[0]);
		const refundB = await queueApprovedForUnit(f.units[1]);
		assert.equal(refundA.status, "queued");
		assert.equal(refundB.status, "queued");

		// 1. Permission matrix on GET /api/v1/admin/refunds:
		// Anonymous -> 401
		await observeList(
			new Request("http://127.0.0.1:3099/api/v1/admin/refunds"),
			401,
		);
		// Denied staff roles -> 403
		for (const who of [ecom, wh, cs, finNone]) {
			await observeList(who.browser.request("/api/v1/admin/refunds"), 403);
			assert.equal(
				(await callReturns(who, `/api/v1/admin/refunds/${refundA.id}`)).status,
				403,
			);
		}
		// Query validation on GET /api/v1/admin/refunds -> 400
		for (const bad of [
			"limit=0",
			"limit=101",
			"status=invalid",
			"cursor=not-a-uuid",
			"extra=1",
		]) {
			await observeList(
				finRO.browser.request(`/api/v1/admin/refunds?${bad}`),
				400,
				false,
			);
		}
		await observeList(
			finRO.browser.request(`/api/v1/admin/refunds?cursor=${randomUUID()}`),
			400,
			true,
		);

		// 2. Keyset paging on GET /api/v1/admin/refunds:
		const page1 = await observeList(
			finRO.browser.request("/api/v1/admin/refunds?limit=1"),
			200,
		);
		assert.equal(page1.data.length, 1);
		assert.equal(page1.data[0].id, refundB.id, "newest refund first");
		assert.equal(page1.pagination.next_cursor, refundB.id);

		const page2 = await observeList(
			finRO.browser.request(
				`/api/v1/admin/refunds?limit=1&cursor=${encodeURIComponent(page1.pagination.next_cursor)}`,
			),
			200,
		);
		assert.equal(page2.data.length, 1);
		assert.equal(page2.data[0].id, refundA.id, "second page returns older refund without repeat");

		// No bank account or buyer contact field in the list projection; audit row recorded.
		for (const row of [...page1.data, ...page2.data]) {
			assert.deepEqual(
				Object.keys(row).sort(),
				[
					"admin_no",
					"amount",
					"created_at",
					"explanation",
					"id",
					"order_admin_no",
					"order_id",
					"return_admin_no",
					"return_case_id",
					"status",
					"version",
				],
			);
		}
		const [auditRow] = await sql`
      select id from app.audit_event
      where actor_id=${finRO.id} and action='refund.list' and outcome='allowed'
      limit 1`;
		assert.ok(auditRow, "refund.list audit event recorded");

		// Read-only finance cannot issue finance.refund proof or post reconciliations.
		assert.equal((await issueRefundProof(finRO, refundA.id)).status, 403);
		assert.equal(
			(
				await callReturns(
					finRO,
					`/api/v1/admin/refunds/${refundA.id}/reconciliations`,
					{
						action: "reconcile",
						expected_version: refundA.version,
						reason: "SYNTHETIC denied write",
						reauthentication_proof: "SYNTHETIC-NOT-ISSUED",
					},
				)
			).status,
			403,
		);

		// 3. Unknown outcome safety on refundA:
		const [jobRow] = await sql`select current_job_id from app.refund where id=${refundA.id}`;
		const faulty = {
			"refund.create": refundAdapter(
				sql,
				"test",
				new Map([[refundA.id, "creation-commit-lost-ack" as const]]),
			),
		};
		assert.equal(await runOneJob(sql, faulty, jobRow.current_job_id), true);

		// Both getAdminRefund and listAdminRefunds(?status=unknown) report status='unknown', never succeeded or queued!
		const detailUnknown = await callReturns(
			finRO,
			`/api/v1/admin/refunds/${refundA.id}`,
		);
		assert.equal(detailUnknown.status, 200);
		assert.equal(detailUnknown.payload.status, "unknown");

		const listUnknown = await observeList(
			finRO.browser.request("/api/v1/admin/refunds?status=unknown&limit=20"),
			200,
		);
		assert.ok(
			listUnknown.data.some((r: { id: string }) => r.id === refundA.id),
			"refundA appears under status=unknown",
		);
		const listQueued = await observeList(
			finRO.browser.request("/api/v1/admin/refunds?status=queued&limit=20"),
			200,
		);
		assert.ok(
			!listQueued.data.some((r: { id: string }) => r.id === refundA.id),
			"refundA does not appear under status=queued while its job is unknown",
		);

		// Retry is refused while refundA outcome is unknown; zero duplicate obligations or cash postings.
		const retryProof = await issueRefundProof(f.finance, refundA.id);
		const retryAttempt = await callReturns(
			f.finance,
			`/api/v1/admin/refunds/${refundA.id}/reconciliations`,
			{
				action: "retry",
				expected_version: detailUnknown.payload.version,
				reason: "SYNTHETIC blind retry on unknown refund",
				reauthentication_proof: retryProof.payload.proof,
			},
		);
		assert.equal(retryAttempt.status, 409);
		assert.equal(retryAttempt.payload.code, "REFUND_OUTCOME_STILL_AMBIGUOUS");

		// Reconcile with finance.refund proof succeeds (202) and converges to 1 cash posting after provider settlement.
		const recProof = await issueRefundProof(f.finance, refundA.id);
		const recKey = randomUUID();
		const recBody = {
			action: "reconcile",
			expected_version: detailUnknown.payload.version,
			reason: "SYNTHETIC reconcile unknown refund outcome",
			reauthentication_proof: recProof.payload.proof,
		};
		const reconciled = await callReturns(
			f.finance,
			`/api/v1/admin/refunds/${refundA.id}/reconciliations`,
			recBody,
			recKey,
		);
		assert.equal(reconciled.status, 202);
		// Idempotent replay with same key returns saved result.
		const replayed = await callReturns(
			f.finance,
			`/api/v1/admin/refunds/${refundA.id}/reconciliations`,
			recBody,
			recKey,
		);
		assert.equal(replayed.status, 202);
		assert.deepEqual(replayed.payload, reconciled.payload);

		const normalAdapter = { "refund.create": refundAdapter(sql, "test") };
		for (const jobId of await reconcileRefundNow(sql, refundA.id)) {
			await runOneJob(sql, normalAdapter, jobId);
		}
		const callback = await ingestRefundSourceEvent(
			sql,
			await simulateRefundOutcome(sql, "test", refundA.id, "succeeded"),
		);
		assert.equal(await runOneJob(sql, normalAdapter, callback), true);

		const listSucceeded = await observeList(
			f.owner.browser.request(
				"/api/v1/admin/refunds?status=succeeded&limit=20",
			),
			200,
		);
		assert.ok(
			listSucceeded.data.some((r: { id: string }) => r.id === refundA.id),
			"refundA appears under status=succeeded after convergence",
		);
		const [cashTxCount] = await sql<{ n: number }[]>`
      select count(*)::int as n from app.finance_transaction
      where order_id=${f.order.id} and kind='refund_cash'`;
		assert.equal(cashTxCount.n, 1, "exactly one refund_cash posting");

		validateExchanges(samples, "finance-workbench");
	} finally {
		for (const u of users) await closeFulfillmentActor(f.identity, u);
		await f.close();
	}
});

test("S131 B19 finance summary: role/permission matrix, <= 366d window guard, and missing cost/settlement inputs report incomplete rather than zero", async () => {
	const f = await paymentFixture();
	const sql = f.identity.sql;
	const users: StaffActor[] = [];
	const makeStaff = async (
		role: "ecommerce_admin" | "warehouse" | "customer_service" | "finance",
		permissions: string[] = [],
	) => {
		const u = await actor(f.identity, role, []);
		users.push(u);
		await enroll(u.browser, u.password);
		if (permissions.length > 0) {
			await sql`update app.role_grant set permissions=${permissions} where user_id=${u.id}`;
		}
		return u;
	};

	try {
		const [latestTx] = await sql<{ latest: string | null }[]>`
      select greatest(
        (select max(occurred_at) from app.finance_transaction),
        (select max(occurred_at) from app.economic_receipt),
        (select max(created_at) from app.commission_entry),
        (select max(occurred_at) from app.finance_expense),
        (select max(created_at) from app.refund),
        (select max(created_at) from app.recovery_refund),
        (select max(created_at) from app.stock_movement)
      )::text as latest`;
		const targetMs =
			Math.max(
				Date.now(),
				latestTx?.latest ? Date.parse(latestTx.latest) : Date.now(),
			) +
			7 * 86400000;
		let clock = await readFixtureClock("test", f.namespace);
		while (Date.parse(clock.now) < targetMs) {
			clock = await advanceFixtureClock(
				"test",
				f.namespace,
				Math.min(
					31622400,
					Math.ceil((targetMs - Date.parse(clock.now)) / 1000),
				),
				clock.version,
			);
		}
		const from = new Date(Date.parse(clock.now) - 60000).toISOString();
		const to = new Date(Date.parse(clock.now) + 3600000).toISOString();
		const query = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;

		const ecom = await makeStaff("ecommerce_admin");
		const wh = await makeStaff("warehouse");
		const cs = await makeStaff("customer_service");
		const finNone = await makeStaff("finance", []);
		const finSummary = await makeStaff("finance", ["finance.summary.read"]);

		for (const who of [ecom, wh, cs, finNone]) {
			const res = await handleFinanceSummary(
				who.browser.request(`/api/v1/admin/finance/summary${query}`),
				f.identity,
			);
			assert.equal(res.status, 403);
		}

		// > 366 days window is refused with 400.
		const tooWideTo = new Date(
			Date.parse(from) + 367 * 86400000,
		).toISOString();
		const tooWideRes = await handleFinanceSummary(
			finSummary.browser.request(
				`/api/v1/admin/finance/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(tooWideTo)}`,
			),
			f.identity,
		);
		assert.equal(tooWideRes.status, 400);

		// Fund a prepaid order in [from, to) without settling provider fees yet -> realized_contribution & operating_result are incomplete (null, never 0).
		const { order } = await f.order(1, "prepaid");
		const attempt = await sql.begin((tx) =>
			createAttempt(tx, order.id, randomUUID(), { method_id: "local-prepaid" }),
		);
		const [storedAttempt] = await sql`
      select creation_job_id from app.payment_attempt where id=${attempt.id}`;
		assert.equal(
			await runOneJob(
				sql,
				{ "payment.create": paymentAdapter(sql, "test") },
				storedAttempt.creation_job_id,
			),
			true,
		);
		const collectionJob = await ingestProviderEvent(
			sql,
			await simulateCollection(sql, "test", attempt.id),
		);
		assert.equal(await runOneJob(sql, {}, collectionJob), true);

		const sumRes = await handleFinanceSummary(
			finSummary.browser.request(`/api/v1/admin/finance/summary${query}`),
			f.identity,
		);
		assert.equal(sumRes.status, 200);
		const summary = await sumRes.json();
		assert.equal(summary.gross_merchandise.complete, true);
		assert.equal(summary.gross_merchandise.amount, 99000);
		assert.equal(summary.realized_contribution.complete, false);
		assert.equal(summary.realized_contribution.amount, null);
		assert.ok(summary.realized_contribution.missing_inputs.length > 0);
		assert.equal(
			formatStatementAmount(summary.realized_contribution),
			"Belum lengkap",
		);
		assert.equal(summary.operating_result.complete, false);
		assert.equal(summary.operating_result.amount, null);
		assert.equal(
			formatStatementAmount(summary.operating_result),
			"Belum lengkap",
		);

		// Dashboard money metrics for finance workspace also load for this period.
		const dashRes = await handleReporting(
			finSummary.browser.request(
				`/api/v1/admin/dashboard?workspace=finance&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
			),
			f.identity,
		);
		assert.equal(dashRes.status, 200);
		const dash = await dashRes.json();
		const moneyMetrics = dash.metrics.filter(
			(m: { kind: string }) => m.kind === "money",
		);
		assert.ok(moneyMetrics.length >= 6);
	} finally {
		for (const u of users) await closeFulfillmentActor(f.identity, u);
		await f.close();
	}
});
