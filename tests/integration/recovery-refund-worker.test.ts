import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { runOneJob } from "../../src/jobs/worker.ts";
import { handleCommerceExceptions } from "../../src/modules/checkout/exceptions/routes.ts";
import {
	ingestCodEvent,
	simulateCodCollection,
} from "../../src/modules/payments/cod-local.ts";
import {
	ingestRecoverySourceEvent,
	simulateRecoveryOutcome,
} from "../../src/modules/checkout/exceptions/refund-source.ts";
import { recoveryRefundAdapter } from "../../src/modules/checkout/exceptions/refund-worker.ts";
import { actor, enroll } from "../contract/access-fixture.ts";
import {
	closeFulfillmentActor,
	fulfillmentFixture,
} from "./fulfillment-fixture.ts";

// Drives one prepaid stock-discrepancy case through the real routes until its
// original recovery refund is queued, then hands control to the real worker.
async function queuedPrepaidRecovery() {
	const f = await fulfillmentFixture("prepaid");
	const sql = f.identity.sql;
	const users: Awaited<ReturnType<typeof actor>>[] = [];
	const close = async () => {
		try {
			for (const user of users) await closeFulfillmentActor(f.identity, user);
		} finally {
			await f.close();
		}
	};
	try {
		const finance = await actor(f.identity, "finance", []);
		users.push(finance);
		await enroll(finance.browser, finance.password);
		await sql`update app.role_grant set permissions=${["finance.refunds.read", "finance.refunds.write"]},revision=revision+1 where user_id=${finance.id}`;
		const call = async (
			staff: Awaited<ReturnType<typeof actor>>,
			path: string,
			body: Record<string, unknown>,
		) => {
			const request = staff.browser.request(path, body);
			request.headers.set("idempotency-key", randomUUID());
			const response = await handleCommerceExceptions(request, f.identity);
			return { status: response.status, payload: await response.json() };
		};
		const parcel = f.parcels[0];
		const units = await sql<
			{ id: string }[]
		>`select id from app.fulfillment_item where shipment_id=${parcel.shipment_id} order by id`;
		const balances = await sql<
			{ balance_id: string; stock_item_id: string; revision: number }[]
		>`
      select distinct a.balance_id,a.stock_item_id,b.revision from app.fulfillment_component_allocation a
        join app.inventory_balance b on b.id=a.balance_id
       where a.fulfillment_item_id in ${sql(units.map((u) => u.id))} order by a.balance_id`;
		const reported = await call(f.owner, "/api/v1/admin/commerce-exceptions", {
			fulfillment_id: parcel.id,
			fulfillment_item_ids: units.map((u) => u.id),
			expected_version: 1,
			reason: "SYNTHETIC physical bin count shortage for recovery worker",
			observed_components: balances.map((b, index) => ({
				balance_id: b.balance_id,
				stock_item_id: b.stock_item_id,
				expected_balance_version: Number(b.revision),
				missing_quantity: index === 0 ? 1 : 0,
			})),
		});
		assert.equal(reported.status, 201);
		const exceptionId = String(reported.payload.id);
		const proposed = await call(
			f.owner,
			`/api/v1/admin/commerce-exceptions/${exceptionId}/decisions`,
			{
				expected_version: 1,
				decision: "propose_cancellation",
				reason: "SYNTHETIC propose cancelling affected shortage units",
			},
		);
		assert.equal(proposed.status, 201);
		const proposalId = String(proposed.payload.proposal.id);
		const acceptRequest = f.client.request(
			`/api/v1/orders/${f.order.id}/recovery-actions`,
			{
				exception_id: exceptionId,
				expected_version: 2,
				action: "accept_proposal",
				proposal_id: proposalId,
			},
		);
		acceptRequest.headers.set("idempotency-key", randomUUID());
		assert.equal(
			(await handleCommerceExceptions(acceptRequest, f.identity)).status,
			201,
		);
		const applied = await call(
			f.owner,
			`/api/v1/admin/commerce-exceptions/${exceptionId}/decisions`,
			{
				expected_version: 3,
				proposal_id: proposalId,
				reason: "SYNTHETIC apply buyer-accepted cancellation",
			},
		);
		assert.equal(applied.status, 201);
		assert.equal(applied.payload.status, "ready_for_refund");
		const proof = `recovery-proof-${randomUUID()}`;
		const [session] = await sql<
			{ id: string }[]
		>`select id from app.auth_session where user_id=${finance.id} order by created_at desc limit 1`;
		await sql`insert into app.access_proof (digest,session_id,action,subject_id,expires_at)
      values (${createHash("sha256").update(proof).digest("hex")},${session.id},'finance.recovery_refund',${exceptionId},clock_timestamp()+interval '5 minutes')`;
		const queued = await call(
			finance,
			`/api/v1/admin/commerce-exceptions/${exceptionId}/refunds`,
			{
				expected_version: 4,
				reason: "SYNTHETIC queue original prepaid recovery refund",
				reauthentication_proof: proof,
			},
		);
		assert.equal(queued.status, 201);
		assert.equal(queued.payload.refunds.length, 1);
		const refundId = String(queued.payload.refunds[0].id);
		const [refund] = await sql<
			{ status: string; current_job_id: string; amount: string }[]
		>`select status,current_job_id,amount from app.recovery_refund where id=${refundId}`;
		assert.equal(refund.status, "queued");
		const adapters = {
			"recovery.refund.create": recoveryRefundAdapter(sql, "test"),
		};
		return {
			f,
			sql,
			exceptionId,
			refundId,
			creationJobId: refund.current_job_id,
			amount: Number(refund.amount),
			adapters,
			close,
		};
	} catch (error) {
		await close();
		throw error;
	}
}

async function jobRow(
	sql: Awaited<ReturnType<typeof queuedPrepaidRecovery>>["sql"],
	jobId: string,
) {
	const [job] =
		await sql`select kind,status,attempts,last_error,result from app.outbox_job where id=${jobId}`;
	return job;
}

test("S33 worker drives a prepaid recovery refund queue -> leased bank request -> signed debit -> callback with one exact cash posting", async () => {
	const r = await queuedPrepaidRecovery();
	const { sql } = r;
	try {
		// Leased creation through the real worker selector and registered adapter.
		assert.equal(await runOneJob(sql, r.adapters, r.creationJobId), true);
		const creation = await jobRow(sql, r.creationJobId);
		assert.equal(
			creation.status,
			"completed",
			`creation: ${creation.last_error ?? "no error"}`,
		);
		const [prepared] = await sql<
			{ status: string; current_operation_id: string }[]
		>`select status,current_operation_id from app.recovery_refund where id=${r.refundId}`;
		assert.equal(prepared.status, "processing");
		assert.deepEqual(creation.result, {
			operation_id: prepared.current_operation_id,
		});
		assert.equal(
			(
				await sql`select id from app.finance_transaction where kind='recovery_cash' and order_id=${r.f.order.id}`
			).length,
			0,
		);

		// Simulated bank effect commits separately; the callback is the only money writer.
		const source = await simulateRecoveryOutcome(
			sql,
			"test",
			r.refundId,
			"succeeded",
		);
		const callbackJobId = await ingestRecoverySourceEvent(sql, source);
		assert.equal((await jobRow(sql, callbackJobId)).status, "pending");
		assert.equal(await runOneJob(sql, r.adapters, callbackJobId), true);
		const callback = await jobRow(sql, callbackJobId);
		assert.equal(
			callback.status,
			"completed",
			`callback: ${callback.last_error ?? "no error"}`,
		);
		assert.equal(callback.kind, "recovery.refund.callback");

		const [refund] = await sql<
			{ status: string; cash_transaction_id: string; revision: number }[]
		>`select status,cash_transaction_id,revision from app.recovery_refund where id=${r.refundId}`;
		assert.equal(refund.status, "succeeded");
		assert.deepEqual(callback.result, {
			event_id: source.id,
			refund_id: r.refundId,
			outcome: "confirmed",
			version: refund.revision,
		});
		const [exception] =
			await sql`select status from app.commerce_exception where id=${r.exceptionId}`;
		assert.equal(exception.status, "resolved");

		const cash = await sql<
			{ id: string; effect_reference: string }[]
		>`select id,effect_reference from app.finance_transaction where kind='recovery_cash' and order_id=${r.f.order.id}`;
		assert.equal(cash.length, 1);
		assert.equal(cash[0].id, refund.cash_transaction_id);
		assert.equal(cash[0].effect_reference, source.id);
		const postings = await sql<
			{ account: string; side: string; amount: string }[]
		>`select account,side,amount from app.finance_posting where transaction_id=${cash[0].id} order by side,account`;
		assert.deepEqual(
			postings.map((p) => [p.account, p.side, Number(p.amount)]),
			[
				["company_cash", "credit", r.amount],
				["refund_payable", "debit", r.amount],
			],
		);

		// Replays: same bank outcome, same callback identity, nothing left to run.
		const replayed = await simulateRecoveryOutcome(
			sql,
			"test",
			r.refundId,
			"succeeded",
		);
		assert.equal(replayed.id, source.id);
		assert.equal(
			await ingestRecoverySourceEvent(sql, replayed),
			callbackJobId,
		);
		assert.equal(await runOneJob(sql, r.adapters, callbackJobId), false);
		assert.equal(await runOneJob(sql, r.adapters, r.creationJobId), false);
		assert.deepEqual(await jobRow(sql, callbackJobId), callback);
		assert.equal(
			(
				await sql`select id from app.finance_transaction where kind='recovery_cash' and order_id=${r.f.order.id}`
			).length,
			1,
		);
		assert.equal(
			(
				await sql`select event_id from app.recovery_event_result where refund_id=${r.refundId}`
			).length,
			1,
		);
		assert.equal(
			(
				await sql`select id from app.outbox_job where kind='recovery.refund.callback' and payload->>'eventId'=${source.id}`
			).length,
			1,
		);
	} finally {
		await r.close();
	}
});

test("S33 worker applies a signed recovery rejection without outgoing cash and keeps the case refunding", async () => {
	const r = await queuedPrepaidRecovery();
	const { sql } = r;
	try {
		assert.equal(await runOneJob(sql, r.adapters, r.creationJobId), true);
		assert.equal((await jobRow(sql, r.creationJobId)).status, "completed");
		const source = await simulateRecoveryOutcome(
			sql,
			"test",
			r.refundId,
			"failed",
		);
		assert.equal(source.amount, 0);
		const callbackJobId = await ingestRecoverySourceEvent(sql, source);
		assert.equal(await runOneJob(sql, r.adapters, callbackJobId), true);
		const callback = await jobRow(sql, callbackJobId);
		assert.equal(
			callback.status,
			"completed",
			`callback: ${callback.last_error ?? "no error"}`,
		);
		assert.equal(callback.result.outcome, "failed");
		const [refund] =
			await sql`select status,cash_transaction_id from app.recovery_refund where id=${r.refundId}`;
		assert.equal(refund.status, "failed");
		assert.equal(refund.cash_transaction_id, null);
		const [exception] =
			await sql`select status from app.commerce_exception where id=${r.exceptionId}`;
		assert.equal(exception.status, "refunding");
		assert.equal(
			(
				await sql`select id from app.finance_transaction where kind='recovery_cash' and order_id=${r.f.order.id}`
			).length,
			0,
		);
		// A rejected effect is final: a contrary success cannot be simulated later.
		await assert.rejects(
			simulateRecoveryOutcome(sql, "test", r.refundId, "succeeded"),
			{ code: "RECOVERY_EFFECT_FINAL" },
		);
		assert.equal(await runOneJob(sql, r.adapters, callbackJobId), false);
		assert.equal(
			(
				await sql`select id from app.finance_transaction where kind='recovery_cash' and order_id=${r.f.order.id}`
			).length,
			0,
		);
	} finally {
		await r.close();
	}
});

const host = (mode: string, subject: string) =>
	execFileSync(
		process.execPath,
		["--env-file=.env.example", "scripts/worker.ts", "test", mode, subject],
		{ timeout: 30000, stdio: "pipe" },
	).toString();

async function recoveryCash(
	sql: Awaited<ReturnType<typeof queuedPrepaidRecovery>>["sql"],
	orderId: string,
) {
	const cash = await sql<
		{ id: string }[]
	>`select id from app.finance_transaction where kind='recovery_cash' and order_id=${orderId}`;
	const postings = cash.length
		? await sql<
				{ account: string; side: string; amount: string }[]
			>`select account,side,amount from app.finance_posting where transaction_id in ${sql(cash.map((c) => c.id))} order by side,account`
		: [];
	return {
		count: cash.length,
		postings: postings.map((p) => [p.account, p.side, Number(p.amount)]),
	};
}

// A lost acknowledgement leaves the creation job unknown (30s backoff) and, for
// paid-commit-lost-ack, a committed but unregistered bank debit. The host
// reconcile pulls the same fenced job forward and re-registers the original event.
for (const fault of ["creation-commit-lost-ack", "paid-commit-lost-ack"] as const) {
	test(`S33 host recovery reconcile converges after ${fault} with exactly one cash posting`, async () => {
		const r = await queuedPrepaidRecovery();
		const { sql } = r;
		try {
			const faulty = {
				"recovery.refund.create": recoveryRefundAdapter(
					sql,
					"test",
					new Map([[r.refundId, fault]]),
				),
			};
			assert.equal(await runOneJob(sql, faulty, r.creationJobId), true);
			assert.equal((await jobRow(sql, r.creationJobId)).status, "unknown");
			const committed = await sql`select e.id from app.local_recovery_event e join app.local_recovery_operation p on p.id=e.operation_id where p.refund_id=${r.refundId}`;
			assert.equal(committed.length, fault === "paid-commit-lost-ack" ? 1 : 0);
			assert.equal(
				(
					await sql`select id from app.recovery_provider_event where refund_id=${r.refundId}`
				).length,
				0,
			);

			const output = host("--confirm-recovery-refund", r.refundId);
			assert.match(output, /callbacks=1 processed=[23]/);
			assert.equal((await jobRow(sql, r.creationJobId)).status, "completed");
			const [refund] =
				await sql`select status,cash_transaction_id from app.recovery_refund where id=${r.refundId}`;
			assert.equal(refund.status, "succeeded");
			const [exception] =
				await sql`select status from app.commerce_exception where id=${r.exceptionId}`;
			assert.equal(exception.status, "resolved");
			const registered = await sql`select p.id,j.status from app.recovery_provider_event p join app.outbox_job j on j.id=p.callback_job_id where p.refund_id=${r.refundId}`;
			assert.equal(registered.length, 1);
			assert.equal(registered[0].status, "completed");
			if (committed.length) assert.equal(registered[0].id, committed[0].id);

			// Replayed host reconcile is idempotent and never moves money again.
			assert.match(
				host("--reconcile-recovery-refund", r.refundId),
				/callbacks=1 processed=0/,
			);
			assert.deepEqual(await recoveryCash(sql, r.f.order.id), {
				count: 1,
				postings: [
					["company_cash", "credit", r.amount],
					["refund_payable", "debit", r.amount],
				],
			});
		} finally {
			await r.close();
		}
	});
}

test("S33 COD recovery refund uses the verified destination rail and one exact cash posting", async () => {
	const f = await fulfillmentFixture("cod");
	const sql = f.identity.sql;
	const users: Awaited<ReturnType<typeof actor>>[] = [];
	try {
		const finance = await actor(f.identity, "finance", []);
		users.push(finance);
		await enroll(finance.browser, finance.password);
		await sql`update app.role_grant set permissions=${["finance.refunds.read", "finance.refunds.write"]},revision=revision+1 where user_id=${finance.id}`;
		const call = async (
			browser: { request: (path: string, body?: Record<string, unknown>) => Request },
			path: string,
			body: Record<string, unknown>,
		) => {
			const request = browser.request(path, body);
			request.headers.set("idempotency-key", randomUUID());
			const response = await handleCommerceExceptions(request, f.identity);
			return { status: response.status, payload: await response.json() };
		};
		const version = async (exceptionId: string) =>
			Number(
				(
					await sql`select revision from app.commerce_exception where id=${exceptionId}`
				)[0].revision,
			);

		// An extra authenticated COD collection is unallocated original money.
		const shipment = f.parcels[0].shipment_id;
		await f.run(await ingestCodEvent(sql, await simulateCodCollection(sql, "test", shipment)));
		const extra = await simulateCodCollection(sql, "test", shipment, {
			reference: randomUUID(),
		});
		await f.run(await ingestCodEvent(sql, extra));
		const [opened] = await sql<
			{ id: string; kind: string }[]
		>`select id,kind from app.commerce_exception where source_kind='cod_event' and source_id=${extra.id}`;
		assert.equal(opened.kind, "unallocated_collection");
		const exceptionId = opened.id;
		const decisions = `/api/v1/admin/commerce-exceptions/${exceptionId}/decisions`;
		const proposed = await call(f.owner.browser, decisions, {
			expected_version: await version(exceptionId),
			decision: "propose_refund",
			reason: "SYNTHETIC refund unallocated COD collection",
		});
		assert.equal(proposed.status, 201, JSON.stringify(proposed.payload));
		const proposalId = String(proposed.payload.proposal.id);
		const accepted = await call(f.client, `/api/v1/orders/${f.order.id}/recovery-actions`, {
			exception_id: exceptionId,
			expected_version: await version(exceptionId),
			action: "accept_proposal",
			proposal_id: proposalId,
		});
		assert.equal(accepted.status, 201, JSON.stringify(accepted.payload));
		const applied = await call(f.owner.browser, decisions, {
			expected_version: await version(exceptionId),
			proposal_id: proposalId,
			reason: "SYNTHETIC apply buyer-accepted COD refund",
		});
		assert.equal(applied.status, 201, JSON.stringify(applied.payload));
		assert.equal(applied.payload.status, "ready_for_refund");
		const proof = `recovery-proof-${randomUUID()}`;
		const [session] = await sql<
			{ id: string }[]
		>`select id from app.auth_session where user_id=${finance.id} order by created_at desc limit 1`;
		await sql`insert into app.access_proof (digest,session_id,action,subject_id,expires_at)
      values (${createHash("sha256").update(proof).digest("hex")},${session.id},'finance.recovery_refund',${exceptionId},clock_timestamp()+interval '5 minutes')`;
		const queued = await call(finance.browser, `/api/v1/admin/commerce-exceptions/${exceptionId}/refunds`, {
			expected_version: await version(exceptionId),
			reason: "SYNTHETIC queue COD recovery refund",
			reauthentication_proof: proof,
		});
		assert.equal(queued.status, 201, JSON.stringify(queued.payload));
		const refundId = String(queued.payload.refunds[0].id);
		const [awaiting] =
			await sql`select status,current_job_id,amount from app.recovery_refund where id=${refundId}`;
		assert.equal(awaiting.status, "awaiting_destination");
		assert.equal(awaiting.current_job_id, null);
		assert.equal(Number(awaiting.amount), extra.amount);
		// No creation intent exists yet: confirming cannot send money.
		assert.throws(() => host("--confirm-recovery-refund", refundId));

		// Recipient verification is a separately committed host effect; the buyer accepts it.
		const verified = host("--verify-recovery-destination", refundId);
		const destinationId = /source_id=([0-9a-f-]{36})/.exec(verified)?.[1];
		assert.ok(destinationId, verified);
		const destination = await call(f.client, `/api/v1/orders/${f.order.id}/recovery-actions`, {
			exception_id: exceptionId,
			expected_version: await version(exceptionId),
			action: "accept_destination",
			refund_id: refundId,
			destination_source_id: destinationId,
		});
		assert.equal(destination.status, 201, JSON.stringify(destination.payload));
		const [queuedRefund] =
			await sql`select status,current_job_id,destination_source_id from app.recovery_refund where id=${refundId}`;
		assert.equal(queuedRefund.status, "queued");
		assert.equal(queuedRefund.destination_source_id, destinationId);

		assert.match(
			host("--confirm-recovery-refund", refundId),
			/callbacks=1 processed=2/,
		);
		assert.equal((await jobRow(sql, queuedRefund.current_job_id)).status, "completed");
		const [refund] =
			await sql`select status,cash_transaction_id from app.recovery_refund where id=${refundId}`;
		assert.equal(refund.status, "succeeded");
		const [operation] =
			await sql`select rail,destination_source_id,original_payment_operation_id from app.local_recovery_operation where refund_id=${refundId}`;
		assert.deepEqual(
			{ ...operation },
			{
				rail: "cod_verified_destination",
				destination_source_id: destinationId,
				original_payment_operation_id: null,
			},
		);
		const [exception] =
			await sql`select status from app.commerce_exception where id=${exceptionId}`;
		assert.equal(exception.status, "resolved");
		assert.deepEqual(await recoveryCash(sql, f.order.id), {
			count: 1,
			postings: [
				["company_cash", "credit", extra.amount],
				["refund_payable", "debit", extra.amount],
			],
		});
	} finally {
		try {
			for (const user of users) await closeFulfillmentActor(f.identity, user);
		} finally {
			await f.close();
		}
	}
});
