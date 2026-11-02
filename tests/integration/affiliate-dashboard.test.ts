import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { TransactionSql } from "postgres";
import { handleAccess } from "../../src/modules/access/routes.ts";
import {
	COMMISSION_PAGE_SIZE,
	readBalanceDetail,
	readCommissionPage,
	parseCommissionCursor,
	readPeriodSummary,
} from "../../src/modules/affiliates/dashboard.ts";
import {
	balanceNotes,
	buildDashboardView,
	classifyVoid,
	type CommissionRowInput,
	parsePeriod,
	periodRange,
	reversalReason,
} from "../../src/modules/affiliates/dashboard-view.ts";
import {
	handleAffiliateProfile,
	readAffiliateProfileDetail,
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
import {
	accrueOrderCommissions,
	holdUnitCommission,
	matureEligibleCommissions,
	readCommissionBalanceForAffiliate,
	recordUnitReceiptMaturity,
	voidUnitCommissionOnRefund,
} from "../../src/modules/commissions/service.ts";
import { actor } from "../contract/access-fixture.ts";
import { CommerceClient } from "./checkout-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { shippingFixture } from "./shipping-fixture.ts";

const base = {
	pending: 0,
	held: 0,
	eligible: 0,
	allocated: 0,
	paid: 0,
	minimum_payout: 99000,
};
const detail = {
	pending_next_at: null,
	pending_awaiting_receipt: 0,
	held_reasons: [],
	paid_last_at: null,
};
const row = (over: Partial<CommissionRowInput>): CommissionRowInput => ({
	id: randomUUID(),
	product_name: "Kaos polos",
	basis_points: 1000,
	amount_idr: 9900,
	status: "pending",
	hold_reason: null,
	receipt_anchor: null,
	available_at: null,
	replacement: false,
	void_basis: null,
	created_at: "2026-11-02T03:00:00.000Z",
	...over,
});

test("S158 pure: periods are cut in WIB and unknown values fall back to 30 hari", () => {
	assert.equal(parsePeriod("x"), "30h");
	assert.equal(parsePeriod("bulan"), "bulan");
	// 2026-11-03 03:00 WIB: the month already started on 2026-11-01 00:00 WIB = 2026-10-31T17:00Z.
	const now = new Date("2026-11-02T20:00:00.000Z");
	assert.equal(periodRange("bulan", now).from, "2026-10-31T17:00:00.000Z");
	assert.equal(periodRange("7h", now).from, "2026-10-26T20:00:00.000Z");
	assert.equal(periodRange("semua", now).from, null);
});

test("S158 pure: each reversal basis has its own plain reason and a reversed row never reads as valid", () => {
	const reasons = (["refund", "cod_refusal", "delivery_failure", "other", null] as const).map(reversalReason);
	assert.deepEqual(reasons, [
		"Barang diretur dan dananya dikembalikan",
		"COD tidak diterima pembeli",
		"Pesanan tidak terkirim",
		"Pesanan dibatalkan",
		"Pesanan dibatalkan",
	]);
	const view = buildDashboardView({
		balance: base,
		detail,
		beneficiaryVerified: true,
		summary: { clicks: 0, orders: 0, units: 0, estimate_idr: 0, paid_idr: 0, reversed_units: 1 },
		commissions: [row({ status: "void", void_basis: "cod_refusal" })],
		payouts: [],
	});
	assert.equal(view.commissions[0].note, "COD tidak diterima pembeli");
	assert.ok(!/valid/i.test(JSON.stringify(view)), "the word valid never labels an amount");
});

test("S158 pure: classifyVoid names each branch, a refund beats an exception and nothing matched is a cancellation", () => {
	assert.equal(classifyVoid(true, null), "refund");
	assert.equal(classifyVoid(true, "cod_refusal"), "refund");
	assert.equal(classifyVoid(false, "cod_refusal"), "cod_refusal");
	assert.equal(classifyVoid(false, "delivery_failure"), "delivery_failure");
	assert.equal(classifyVoid(false, "stock_discrepancy"), "other");
	assert.equal(classifyVoid(false, null), "other");
	assert.equal(classifyVoid(null, null), "other");
	assert.deepEqual(
		[classifyVoid(true, null), classifyVoid(false, "cod_refusal"), classifyVoid(false, "delivery_failure"), classifyVoid(false, null)].map(reversalReason),
		["Barang diretur dan dananya dikembalikan", "COD tidak diterima pembeli", "Pesanan tidak terkirim", "Pesanan dibatalkan"],
	);
});

test("S158 pure: the five states stay separate and say when they mature or why they wait", () => {
	const notes = balanceNotes(
		{ ...base, eligible: 50000 },
		{ ...detail, pending_next_at: "2026-11-12T03:00:00.000Z", pending_awaiting_receipt: 2, held_reasons: ["Retur pembeli sedang diproses"] },
		true,
	);
	assert.match(notes.pending, /Paling cepat matang .*2026/);
	assert.match(notes.pending, /2 unit menunggu paket diterima/);
	assert.equal(notes.held, "Retur pembeli sedang diproses.");
	assert.match(notes.eligible, /Kurang Rp49\.000 dari batas minimum Rp99\.000/);
	assert.match(balanceNotes({ ...base, eligible: 120000 }, detail, false).eligible, /rekening tujuan terverifikasi/);
	assert.match(balanceNotes({ ...base, eligible: 120000 }, detail, true).eligible, /antrean transfer otomatis/);
	const view = buildDashboardView({
		balance: { ...base, pending: 1000, held: 2000, eligible: 3000, allocated: 4000, paid: 5000 },
		detail,
		beneficiaryVerified: true,
		summary: { clicks: 0, orders: 0, units: 0, estimate_idr: 0, paid_idr: 0, reversed_units: 0 },
		commissions: [],
		payouts: [],
	});
	assert.deepEqual(view.states.map((s) => s.amount), ["Rp1.000", "Rp2.000", "Rp3.000", "Rp4.000", "Rp5.000"]);
});

test("S158 pure: the view model carries no buyer name, address, phone, bank data or cookie identifier", () => {
	const poison = {
		buyer_name: "Budi Rahasia",
		address_line: "Jalan Rahasia Pembeli 77",
		phone: "+6281299998888",
		bank_account: "889900112233",
		visitor_id: "0b6f6c8e-3b3b-4a53-9d61-a0f1c2d3e4f5",
	};
	// Extra fields smuggled into every input row must not reach the output.
	const view = buildDashboardView({
		balance: { ...base, pending: 9900 },
		detail: { ...detail, ...poison } as typeof detail,
		beneficiaryVerified: true,
		summary: { clicks: 3, orders: 1, units: 1, estimate_idr: 9900, paid_idr: 0, reversed_units: 0, ...poison },
		commissions: [row({ ...poison } as Partial<CommissionRowInput>)],
		payouts: [{ id: randomUUID(), amount: 99000, status: "queued", explanation: "Masuk antrean.", created_at: "2026-11-02T03:00:00.000Z", ...poison }],
	});
	const text = JSON.stringify(view);
	for (const value of Object.values(poison)) assert.ok(!text.includes(value), `leaked ${value}`);
	for (const key of Object.keys(poison)) assert.ok(!text.includes(key), `leaked key ${key}`);
});

test("S158 pure: a cursor must be a real timestamp and a real uuid, anything else reads as no cursor", () => {
	const id = "0b6f6c8e-3b3b-4a53-9d61-a0f1c2d3e4f5";
	assert.deepEqual(parseCommissionCursor(`2026-11-02 03:00:00.123456+00|${id}`), { at: "2026-11-02 03:00:00.123456+00", id });
	assert.deepEqual(parseCommissionCursor(`2026-11-02 10:00:00+07:00|${id}`), { at: "2026-11-02 10:00:00+07:00", id });
	for (const bad of [
		null,
		"",
		"garbage",
		id,
		`2026-13-45 03:00:00+00|${id}`,
		`2026-02-30 03:00:00+00|${id}`,
		`2026-11-02 25:00:00+00|${id}`,
		`2026-11-02 03:61:00+00|${id}`,
		`2026-11-02 03:00:00+99|${id}`,
		`2026-11-02 03:00:00+00|not-a-uuid`,
		"2026-11-02 03:00:00+00|ZZZZZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZZZZZZZZZ",
		`2026-11-02 03:00:00+00|${id}'; drop table app.commission_entry;--`,
		`2026-11-02 03:00:00.1234567+00|${id}`,
	])
		assert.equal(parseCommissionCursor(bad), null, String(bad));
});

test("S158 integration: five states reconcile with the ledger, every reversal has a reason, paging and the proof gate hold", async () => {
	const f = await shippingFixture();
	const affiliate = await actor(f.identity, "affiliate", []);
	const sql = f.identity.sql;
	const identity = f.identity;
	try {
		const referralCode = `MITRA99-${randomUUID().slice(0, 6).toUpperCase()}`;
		const enroll = affiliate.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
			referral_code: referralCode,
			display_name: "Siti Rahma",
			beneficiary_bank_code: "BRI",
			beneficiary_account_number: "889900112233",
			beneficiary_account_holder: "Siti Rahma",
		});
		enroll.headers.set("idempotency-key", randomUUID());
		const enrolled = await handleAffiliateProfile(enroll, identity);
		assert.equal(enrolled.status, 201);
		const profile = await enrolled.json();

		const client = new CommerceClient(identity);
		const boot = new Response(null);
		await bootstrapGuest(identity, boot, new Request("http://127.0.0.1:3099/api/v1/carts", { method: "POST" }));
		client.absorb(boot);
		const buyer = await commerceActor(client.request("/api/v1/carts"), identity);
		assert.ok(buyer);
		const line = f.line("fixture-offer-shirt");
		const created = await sql.begin((tx) =>
			createCart(tx, client.request("/api/v1/carts", {}), identity, buyer, {
				lines: [{ variant_id: line.offer_id, quantity: 3, expected_publication_id: line.publication_id }],
			}, { clock_namespace: f.namespace }),
		);
		const token = await capability(identity, "cart", created.cart.id, buyer.id, created.cart.cap_issued_at as string);
		const cookie = new Response(null);
		setCookie(cookie, `${await prefix(identity)}.cart_access`, `${created.cart.id}.${token}`);
		client.absorb(cookie);
		const quoteInput = {
			cart_id: created.cart.id,
			address: {
				recipient_name: "Budi Rahasia",
				phone: "+6281299998888",
				address_line: "Jalan Rahasia Pembeli 77",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281299998888" },
			payment_method: "prepaid" as const,
		};
		const quote = (await sql.begin((tx) =>
			createQuote(tx, client.request("/api/v1/checkout/quotes", quoteInput, { version: 1 }), identity, buyer, quoteInput, { affiliate_id: profile.id }),
		)) as { id: string };
		const submitted = await sql.begin((tx) =>
			submitOrder(tx, client.request("/api/v1/orders", { quote_id: quote.id }, { version: 1 }), identity, buyer, { quote_id: quote.id }),
		);
		// A real referral touch with a visitor id, so the privacy check below has something to leak.
		const visitorId = randomUUID();
		await sql`
      insert into app.referral_touch (affiliate_id, referral_code, visitor_id, source_path, touched_at, expires_at, operation_id, request_hash)
      values (${profile.id}, ${referralCode}, ${visitorId}::uuid, '/', now() - interval '1 hour', now() + interval '7 days', ${randomUUID()}, ${`key-${randomUUID()}:hash`})`;
		const accrued = await sql.begin((tx) => accrueOrderCommissions(tx, { orderId: submitted.order.id }));
		assert.equal(accrued.length, 3);

		await sql.begin(async (tx) => {
			await holdUnitCommission(tx, { fulfillmentItemId: accrued[0].fulfillment_item_id, holdReason: "Retur pembeli sedang diproses" });
			await recordUnitReceiptMaturity(tx, { fulfillmentItemId: accrued[1].fulfillment_item_id, receivedAt: "2026-05-01T08:00:00.000Z" });
			await matureEligibleCommissions(tx, { affiliateId: profile.id, asOf: "2026-05-12T08:00:00.000Z" });
			await voidUnitCommissionOnRefund(tx, { fulfillmentItemId: accrued[2].fulfillment_item_id, reason: "Unit dibatalkan; komisi dibatalkan" });
		});

		const range = periodRange("semua", new Date());
		const data = await sql.begin(async (tx) => {
			const balance = await readCommissionBalanceForAffiliate(tx, profile.id);
			const [page, summary, balanceDetail, beneficiary] = await Promise.all([
				readCommissionPage(tx, profile.id, { status: null, range, cursor: null }),
				readPeriodSummary(tx, profile.id, range),
				readBalanceDetail(tx, profile.id),
				readAffiliateProfileDetail(tx, affiliate.id),
			]);
			const [ledger] = await tx<{ net: string }[]>`
        select coalesce(sum(case p.side when 'credit' then p.amount else -p.amount end), 0) net
        from app.finance_posting p join app.finance_transaction t on t.id = p.transaction_id
        where t.source = 'affiliate.commission' and p.account = 'affiliate_payable'
          and t.order_id in (select order_id from app.commission_entry where affiliate_id = ${profile.id})`;
			const touches = await tx<{ visitor_id: string }[]>`select visitor_id from app.referral_touch where affiliate_id = ${profile.id}`;
			return { balance, page, summary, balanceDetail, beneficiary, ledger: Number(ledger.net), visitors: touches.map((t) => t.visitor_id) };
		});

		// 1. Per-status totals of the listed units equal the balance; the payable in the ledger equals
		//    eligible + allocated + paid (a voided unit's recognition is reversed).
		const byStatus = (s: string) => data.page.data.filter((r) => r.status === s).reduce((n, r) => n + r.amount_idr, 0);
		for (const key of ["pending", "held", "eligible", "allocated", "paid"] as const)
			assert.equal(byStatus(key), data.balance[key], `state ${key} reconciles with its units`);
		assert.equal(data.ledger, data.balance.eligible + data.balance.allocated + data.balance.paid);
		assert.ok(data.balance.held > 0 && data.balance.eligible > 0, "fixture exercises held and eligible");
		assert.ok(data.visitors.includes(visitorId), "the fixture holds a real visitor touch");
		assert.equal(data.summary.clicks, data.visitors.length);
		assert.equal(data.summary.reversed_units, 1);
		assert.equal(data.summary.estimate_idr, data.balance.held + data.balance.eligible + data.balance.pending);
		assert.equal(data.summary.paid_idr, 0);
		assert.equal(data.balanceDetail.paid_last_at, null, "no payout completed, so no transfer date");
		assert.deepEqual(data.balanceDetail.held_reasons, ["Retur pembeli sedang diproses"]);

		// 2. Every reversed commission carries a plain reason; held keeps its own reason.
		const view = buildDashboardView({
			balance: data.balance,
			detail: data.balanceDetail,
			beneficiaryVerified: true,
			summary: data.summary,
			commissions: data.page.data,
			payouts: [],
		});
		const voidedId = data.page.data.find((r) => r.status === "void")?.id as string;
		const voided = view.commissions.filter((r) => r.status === "void");
		assert.equal(voided.length, 1);
		for (const r of voided) assert.ok(r.note.length > 0 && r.note !== "Ditahan sementara.");
		assert.equal(view.commissions.find((r) => r.status === "held")?.note, "Retur pembeli sedang diproses");
		assert.ok(COMMISSION_PAGE_SIZE >= 3);

		// 3. Keyset paging: walking with a cursor never repeats or skips a unit.
		const seen = new Set<string>();
		let cursor: string | null = null;
		await sql.begin(async (tx) => {
			for (let i = 0; i < 5; i++) {
				const page = await readCommissionPage(tx, profile.id, { status: null, range, cursor });
				for (const r of page.data) {
					assert.ok(!seen.has(r.id));
					seen.add(r.id);
				}
				cursor = page.nextCursor;
				if (!cursor) break;
			}
		});
		assert.equal(seen.size, 3);

		// 3b. Keyset paging for real: a page size of 1 walks 3 pages, two rows share one created_at (the id
		//     breaks the tie), and a cursor in any malformed shape reads as the first page instead of a 500.
		//     The mutations run in a transaction that is rolled back.
		const rollback = new Error("rollback");
		const inRollback = async (work: (tx: TransactionSql) => Promise<void>) => {
			await assert.rejects(
				sql.begin(async (tx) => {
					await work(tx);
					throw rollback;
				}),
				(error) => error === rollback,
			);
		};
		await inRollback(async (tx) => {
			const ids = data.page.data.map((r) => r.id);
			await tx`update app.commission_entry set created_at = '2026-10-01 10:00:00.123456+00' where id in ${tx(ids.slice(0, 2))}`;
			await tx`update app.commission_entry set created_at = '2026-09-30 10:00:00.000001+00' where id = ${ids[2]}`;
			const expected = [...ids.slice(0, 2)].sort().reverse().concat(ids[2]);
			const all = (await readCommissionPage(tx, profile.id, { status: null, range, cursor: null }, 50)).data.map((r) => r.id);
			assert.deepEqual(all, expected, "created_at desc, id desc");
			const walked: string[] = [];
			let next: string | null = null;
			let pages = 0;
			do {
				const page = await readCommissionPage(tx, profile.id, { status: null, range, cursor: next }, 1);
				assert.equal(page.data.length, 1);
				walked.push(...page.data.map((r) => r.id));
				next = page.nextCursor;
				pages += 1;
			} while (next && pages < 10);
			assert.equal(pages, 3);
			assert.deepEqual(walked, expected, "no unit repeated or skipped across pages");
			const twos = await readCommissionPage(tx, profile.id, { status: null, range, cursor: null }, 2);
			const rest = await readCommissionPage(tx, profile.id, { status: null, range, cursor: twos.nextCursor }, 2);
			assert.deepEqual([...twos.data, ...rest.data].map((r) => r.id), expected);
			assert.equal(rest.nextCursor, null);
			// Malformed cursors: never an error, always the first page.
			const firstIds = (await readCommissionPage(tx, profile.id, { status: null, range, cursor: null }, 2)).data.map((r) => r.id);
			const uuid = randomUUID();
			for (const bad of ["garbage", "", `2026-13-45 03:00:00+00|${uuid}`, `2026-02-30 03:00:00+00|${uuid}`, `2026-10-01 10:00:00+00|not-a-uuid`, `2026-10-01 25:00:00+00|${uuid}`, `x|${uuid}`, `2026-10-01 10:00:00+00|${uuid}'; select 1;--`]) {
				const page = await readCommissionPage(tx, profile.id, { status: null, range, cursor: bad }, 2);
				assert.deepEqual(page.data.map((r) => r.id), firstIds, `cursor ${JSON.stringify(bad)} reads as the first page`);
			}
		});

		// 3c. The reversal reason follows the void's own source. The tables an exception or a refund hangs on
		//     (exception_cancellation, refund) need their whole workbench graph and the test role cannot lift
		//     their foreign keys, so those two branches are proven by the pure classifier above; here the real
		//     query is run against the real voided unit and against a later void from another source.
		await inRollback(async (tx) => {
			const [entry] = await tx<{ id: string; fulfillment_item_id: string }[]>`
        select id, fulfillment_item_id from app.commission_entry where id = ${voidedId}`;
			const basis = async () => (await readCommissionPage(tx, profile.id, { status: "void", range, cursor: null })).data.find((r) => r.id === entry.id)?.void_basis;
			assert.equal(await basis(), "other", "a cancelled unit with no refund and no exception");
			await tx`
        insert into app.commission_adjustment (commission_entry_id, revision, kind, delta_idr, status_after, source_kind, source_id, reason, occurred_at)
        values (${entry.id}, 200, 'voided', -1, 'void', 'refund', ${randomUUID()}, 'uji', now())`;
			assert.equal(await basis(), "other", "a later void from an unrelated source is not explained by the unit's exceptions");
		});

		// 3d. The paid and allocated states reconcile like the others, and the transfer date is the payout's own.
		await inRollback(async (tx) => {
			const [eligible] = data.page.data.filter((r) => r.status === "eligible");
			const [held] = data.page.data.filter((r) => r.status === "held");
			await tx`update app.commission_entry set status = 'allocated' where id = ${eligible.id}`;
			await tx`update app.commission_entry set status = 'paid', hold_reason = null where id = ${held.id}`;
			const balance = await readCommissionBalanceForAffiliate(tx, profile.id);
			const page = await readCommissionPage(tx, profile.id, { status: null, range, cursor: null });
			const sum = (state: string) => page.data.filter((r) => r.status === state).reduce((n, r) => n + r.amount_idr, 0);
			for (const key of ["pending", "held", "eligible", "allocated", "paid"] as const) assert.equal(sum(key), balance[key], `state ${key}`);
			assert.equal(balance.allocated, eligible.amount_idr);
			assert.equal(balance.paid, held.amount_idr);
			const summary = await readPeriodSummary(tx, profile.id, range);
			assert.equal(summary.paid_idr, balance.paid);
			assert.equal(summary.estimate_idr, balance.pending + balance.held + balance.eligible + balance.allocated + balance.paid);
			assert.equal((await readBalanceDetail(tx, profile.id)).paid_last_at, null, "a paid row alone does not give a transfer date");
		});

		// 4. No buyer or bank data in anything the dashboard shows.
		const text = JSON.stringify(view);
		for (const secret of ["Budi Rahasia", "+6281299998888", "Jalan Rahasia Pembeli 77", "889900112233", ...data.visitors])
			assert.ok(!text.includes(secret), `leaked ${secret}`);
		assert.equal(data.beneficiary?.beneficiary?.masked_account, "••••2233");

		// 5. Changing the payout account without a valid proof is refused and changes nothing.
		const change = (proof: string | undefined) => {
			const request = affiliate.browser.request("/api/v1/me/affiliate/beneficiary-changes", {
				bank_code: "BCA",
				account_number: "1234567890",
				account_holder_name: "Siti Rahma",
				...(proof ? { reauthentication_proof: proof } : {}),
			});
			request.headers.set("idempotency-key", randomUUID());
			return handleAffiliateProfile(request, identity);
		};
		assert.equal((await change(undefined)).status, 400);
		const forged = await change(`proof-${randomUUID()}`);
		assert.equal(forged.status, 403);
		assert.equal((await forged.json()).code, "REAUTHENTICATION_REQUIRED");
		const [after] = await sql`select beneficiary_bank_code from app.affiliate_profile where affiliate_id = ${profile.id}`;
		assert.equal(after.beneficiary_bank_code, "BRI");

		// A proof from the password flow is what the change form uses, and it works once.
		const proofRequest = affiliate.browser.request("/api/v1/me/reauthentication-proofs", {
			password: affiliate.password,
			action: "affiliate.beneficiary_change",
			subject_id: profile.id,
		});
		proofRequest.headers.set("idempotency-key", randomUUID());
		const proofResponse = await handleAccess(proofRequest, identity);
		assert.equal(proofResponse.status, 201);
		const { proof } = await proofResponse.json();
		assert.equal((await change(proof)).status, 202);
		assert.equal((await change(proof)).status, 403, "a proof is single-use");
	} finally {
		await closeFulfillmentActor(identity, affiliate);
	}
});
