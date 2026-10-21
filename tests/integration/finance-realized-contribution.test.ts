import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runOneJob } from "../../src/jobs/worker.ts";
import { handleFinanceSummary } from "../../src/modules/finance/realized-contribution.ts";
import {
	ingestSettlementEvent,
	simulateSettlement,
} from "../../src/modules/finance/settlements/local.ts";
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
import { actor, enroll } from "../contract/access-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { paymentFixture } from "./payment-fixture.ts";

test("S34 GET /api/v1/admin/finance/summary computes complete and incomplete realized contribution, operating result, and enforces finance.summary.read authority", async () => {
	const f = await paymentFixture();
	const sql = f.identity.sql;
	const users: Awaited<ReturnType<typeof actor>>[] = [];

	try {
		// Advance fixture clock into an isolated future window beyond any prior test receipts/transactions
		const [latestTx] = await sql<{ latest: string | null }[]>`
      select greatest(
        (select max(occurred_at) from app.finance_transaction),
        (select max(occurred_at) from app.economic_receipt),
        (select max(created_at) from app.commission_entry),
        (select max(occurred_at) from app.finance_expense)
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

		// Create finance actor without finance.summary.read first, then grant it
		const finance = await actor(f.identity, "finance", []);
		users.push(finance);
		await enroll(finance.browser, finance.password);

		const callSummary = async (
			staffActor: Awaited<ReturnType<typeof actor>>,
			query: string,
		) => {
			const req = staffActor.browser.request(
				`/api/v1/admin/finance/summary${query}`,
			);
			const res = await handleFinanceSummary(req, f.identity);
			return { status: res.status, payload: await res.json() };
		};

		// 1. RBAC: finance actor without finance.summary.read is denied (403)
		const denied = await callSummary(
			finance,
			`?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
		);
		assert.equal(denied.status, 403);

		await sql`
      update app.role_grant
         set permissions=${["finance.summary.read"]},
             revision=revision+1
       where user_id=${finance.id}`;

		// 2. Query validation: invalid window or missing params returns 400
		assert.equal((await callSummary(finance, "")).status, 400);
		assert.equal(
			(
				await callSummary(
					finance,
					`?from=${encodeURIComponent(to)}&to=${encodeURIComponent(from)}`,
				)
			).status,
			400,
		);

		// 3. Create and fund a prepaid order in [from, to)
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

		const [receipt] = await sql<
			{
				id: string;
				transaction_id: string;
				amount: string;
				merchandise_amount: string;
				buyer_shipping: string;
				occurred_at: string;
			}[]
		>`
      select id,transaction_id,amount,merchandise_amount,buyer_shipping,occurred_at
        from app.economic_receipt
       where order_id=${order.id}`;
		assert.ok(receipt);

		const [unit] = await sql<
			{
				id: string;
				order_item_id: string;
				subsidy_amount: string;
			}[]
		>`
      select f.id,f.order_item_id,f.subsidy_amount
        from app.fulfillment_item f
        join app.order_item i on i.id=f.order_item_id
       where i.order_id=${order.id}`;
		assert.ok(unit);

		// 4. Before settlement: realized_contribution & operating_result are incomplete due to missing settlement
		const unsettled = await callSummary(
			finance,
			`?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
		);
		assert.equal(unsettled.status, 200);
		assert.equal(unsettled.payload.currency, "IDR");
		assert.deepEqual(unsettled.payload.gross_merchandise, {
			complete: true,
			amount: 99000,
			missing_inputs: [],
		});
		assert.deepEqual(unsettled.payload.net_merchandise_revenue, {
			complete: true,
			amount: 99000,
			missing_inputs: [],
		});
		assert.deepEqual(unsettled.payload.recognized_hpp, {
			complete: true,
			amount: 30000,
			missing_inputs: [],
		});
		assert.deepEqual(unsettled.payload.gross_merchandise_profit, {
			complete: true,
			amount: 69000,
			missing_inputs: [],
		});
		assert.deepEqual(unsettled.payload.estimated_contribution, {
			complete: true,
			amount: 54070,
			missing_inputs: [],
		});
		assert.equal(unsettled.payload.realized_contribution.complete, false);
		assert.equal(unsettled.payload.realized_contribution.amount, null);
		assert.deepEqual(unsettled.payload.realized_contribution.missing_inputs, [
			`settlement:${receipt.id}`,
		]);
		assert.equal(unsettled.payload.operating_result.complete, false);
		assert.equal(unsettled.payload.operating_result.amount, null);

		// 5. Settle the receipt with known carrier & provider fees, record earned commission and posted expense
		const grossAmount = Number(receipt.amount);
		const carrierFee = 1000;
		const providerFee = 500;
		const settlementSource = await simulateSettlement(sql, "test", {
			provider: "local.payment",
			reference: randomUUID(),
			direction: "credit",
			net_amount: grossAmount - carrierFee - providerFee,
			clock_namespace: f.namespace,
			statement: {
				gross_amount: grossAmount,
				carrier_fee: carrierFee,
				provider_fee: providerFee,
				allocation_claims: [
					{
						receivable_transaction_id: receipt.transaction_id,
						gross_amount: grossAmount,
					},
				],
				reverses_reference: null,
			},
		});
		const settlementJob = await ingestSettlementEvent(sql, settlementSource);
		assert.equal(await runOneJob(sql, {}, settlementJob), true);

		const affiliateUser = await actor(f.identity, "affiliate", []);
		users.push(affiliateUser);
		const [affiliateAccount] = await sql<{ id: string }[]>`
      insert into app.affiliate_account (user_id)
      values (${affiliateUser.id})
      returning id`;
		const receiptIso = new Date(receipt.occurred_at).toISOString();
		await sql`
      insert into app.commission_entry (
        order_id,order_item_id,fulfillment_item_id,affiliate_id,
        basis_points,merchandise_amount,amount_idr,status,created_at,updated_at
      ) values (
        ${order.id},${unit.order_item_id},${unit.id},${affiliateAccount.id},
        700,99000,6930,'available',${receiptIso},${receiptIso}
      )`;

		await sql`
      insert into app.finance_expense (
        category,amount_idr,status,period_key,evidence_reference,
        actor_id,reason,occurred_at
      ) values (
        'marketing',5000,'posted','2026-10','SYNTHETIC-INV-001',
        ${f.owner.id},'SYNTHETIC posted marketing expense',${receiptIso}
      )`;

		// 6. Query summary again: realized_contribution and operating_result are now complete
		const settled = await callSummary(
			finance,
			`?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
		);
		assert.equal(settled.status, 200);
		const expectedRealized =
			99000 +
			Number(receipt.buyer_shipping) -
			30000 -
			carrierFee -
			Number(unit.subsidy_amount) -
			providerFee -
			1000 -
			6930;
		assert.deepEqual(settled.payload.realized_contribution, {
			complete: true,
			amount: expectedRealized,
			missing_inputs: [],
		});
		assert.deepEqual(settled.payload.operating_expenses, {
			complete: true,
			amount: 5000,
			missing_inputs: [],
		});
		assert.deepEqual(settled.payload.operating_result, {
			complete: true,
			amount: expectedRealized - 5000,
			missing_inputs: [],
		});
		assert.equal(settled.payload.affiliate_liability.complete, true);
		assert.ok(settled.payload.affiliate_liability.amount >= 6930);
	} finally {
		await sql`delete from app.commission_entry where order_id in (select id from app.commerce_order where clock_namespace=${f.namespace})`;
		await sql`delete from app.finance_expense where actor_id=${f.owner.id}`;
		for (const u of users) await closeFulfillmentActor(f.identity, u);
		await f.close();
	}
});
