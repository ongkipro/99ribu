import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { connectDatabase } from "../../src/db/client.ts";
import { runOneJob } from "../../src/jobs/worker.ts";
import { getPrincipal } from "../../src/modules/access/policy.ts";
import {
	ingestRecoverySourceEvent,
	simulateRecoveryOutcome,
} from "../../src/modules/checkout/exceptions/refund-source.ts";
import {
	reconcileRecoveryRefundNow,
	recoveryRefundAdapter,
} from "../../src/modules/checkout/exceptions/refund-worker.ts";
import { retryRecoveryRefund } from "../../src/modules/checkout/exceptions/refunds.ts";
import { handleCommerceExceptions } from "../../src/modules/checkout/exceptions/routes.ts";
import { actor, enroll } from "../contract/access-fixture.ts";
import {
	closeFulfillmentActor,
	fulfillmentFixture,
} from "./fulfillment-fixture.ts";

type Staff = Awaited<ReturnType<typeof actor>>;

// S71: drive one prepaid stock-discrepancy case through the real routes until
// its original recovery refund is queued (same path as recovery-refund-worker).
async function queuedPrepaidRecovery() {
	const f = await fulfillmentFixture("prepaid");
	const sql = f.identity.sql;
	const users: Staff[] = [];
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
			staff: Staff,
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
			reason: "SYNTHETIC physical bin count shortage for recovery retry",
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
		const issueProof = async (subjectId: string) => {
			const proof = `recovery-proof-${randomUUID()}`;
			const [session] = await sql<
				{ id: string }[]
			>`select id from app.auth_session where user_id=${finance.id} order by created_at desc limit 1`;
			await sql`insert into app.access_proof (digest,session_id,action,subject_id,expires_at)
        values (${createHash("sha256").update(proof).digest("hex")},${session.id},'finance.recovery_refund',${subjectId},clock_timestamp()+interval '5 minutes')`;
			return proof;
		};
		const queued = await call(
			finance,
			`/api/v1/admin/commerce-exceptions/${exceptionId}/refunds`,
			{
				expected_version: 4,
				reason: "SYNTHETIC queue original prepaid recovery refund",
				reauthentication_proof: await issueProof(exceptionId),
			},
		);
		assert.equal(queued.status, 201);
		const refundId = String(queued.payload.refunds[0].id);
		const [refund] = await sql<
			{ current_job_id: string; amount: string }[]
		>`select current_job_id,amount from app.recovery_refund where id=${refundId}`;
		// Domain-level finance retry; the HTTP route is covered separately below.
		const retry = async (reason: string) => {
			const [head] = await sql<
				{ revision: number }[]
			>`select revision from app.recovery_refund where id=${refundId}`;
			const request = finance.browser.request(
				`/api/v1/admin/commerce-exceptions/${exceptionId}/refunds/${refundId}`,
				{},
			);
			request.headers.set("idempotency-key", randomUUID());
			const principal = await getPrincipal(request, f.identity);
			return retryRecoveryRefund(
				request,
				f.identity,
				principal,
				exceptionId,
				refundId,
				{
					expected_version: head.revision,
					reason,
					reauthentication_proof: await issueProof(refundId),
				},
			);
		};
		return {
			f,
			sql,
			exceptionId,
			refundId,
			creationJobId: refund.current_job_id,
			amount: Number(refund.amount),
			adapters: { "recovery.refund.create": recoveryRefundAdapter(sql, "test") },
			retry,
			finance,
			issueProof,
			// Extra staff are closed with the fixture.
			staff: async (role: Parameters<typeof actor>[1]) => {
				const user = await actor(f.identity, role, []);
				users.push(user);
				await enroll(user.browser, user.password);
				return user;
			},
			close,
		};
	} catch (error) {
		await close();
		throw error;
	}
}

type Recovery = Awaited<ReturnType<typeof queuedPrepaidRecovery>>;

async function jobRow(sql: Recovery["sql"], jobId: string) {
	const [job] =
		await sql`select status,attempts,last_error,result from app.outbox_job where id=${jobId}`;
	return job;
}
const cashCount = async (r: Recovery) =>
	(
		await r.sql`select id from app.finance_transaction where kind='recovery_cash' and order_id=${r.f.order.id}`
	).length;
// AccessError and PostgresError both expose the stable refusal as `code`.
const refused = (work: Promise<unknown>, code: string) =>
	assert.rejects(work, (error: { code?: string }) => error.code === code);

test("S71 terminally failed recovery callback is re-armed once by the audited owner path and posts cash exactly once", async () => {
	const r = await queuedPrepaidRecovery();
	const { sql } = r;
	try {
		assert.equal(await runOneJob(sql, r.adapters, r.creationJobId), true);
		assert.equal((await jobRow(sql, r.creationJobId)).status, "completed");
		const source = await simulateRecoveryOutcome(sql, "test", r.refundId, "succeeded");
		const callbackJobId = await ingestRecoverySourceEvent(sql, source);
		// Money left the company bank, but the callback exhausted its retries.
		await sql`update app.outbox_job set status='failed',attempts=5,last_error='TEMPORARY_DATABASE_FAILURE',completed_at=clock_timestamp() where id=${callbackJobId}`;
		assert.equal(await cashCount(r), 0);

		// No audit row: still refused. An audit from an earlier transaction: refused.
		await refused(
			sql`update app.outbox_job set status='pending',attempts=0,completed_at=null,last_error=null where id=${callbackJobId}`,
			"23514",
		);
		const [failed] = await sql<
			{ completed_at: string }[]
		>`select completed_at::text completed_at from app.outbox_job where id=${callbackJobId}`;
		await sql`insert into app.audit_event (action,subject_id,outcome,reason,details) values ('local.recovery_refund.reconcile',${r.refundId},'allowed','SYNTHETIC stale audit',${JSON.stringify({ job_id: callbackJobId, previous_status: "failed", previous_attempts: 5, previous_completed_at: failed.completed_at })}::jsonb)`;
		await refused(
			sql`update app.outbox_job set status='pending',attempts=0,completed_at=null,last_error=null where id=${callbackJobId}`,
			"23514",
		);

		// An exactly matching audit committed by another transaction after this
		// one began is still not this transaction's owner action (0028 xmin bind).
		const { sql: other } = connectDatabase("test");
		try {
			await refused(
				sql.begin(async (tx) => {
					await tx`select pg_current_xact_id()`;
					await other`insert into app.audit_event (action,subject_id,outcome,reason,details) values ('local.recovery_refund.reconcile',${r.refundId},'allowed','SYNTHETIC stale audit',${JSON.stringify({ job_id: callbackJobId, previous_status: "failed", previous_attempts: 5, previous_completed_at: failed.completed_at })}::jsonb)`;
					await tx`update app.outbox_job set status='pending',attempts=0,completed_at=null,last_error=null where id=${callbackJobId}`;
				}),
				"23514",
			);
		} finally {
			await other.end();
		}

		// Host owner path re-arms the same callback once, then the worker posts.
		const jobs = await reconcileRecoveryRefundNow(sql, r.refundId);
		assert.ok(jobs.includes(callbackJobId));
		const rearmed = await jobRow(sql, callbackJobId);
		assert.equal(rearmed.status, "pending");
		assert.equal(rearmed.attempts, 0);
		const audits = await sql`select details from app.audit_event where action='local.recovery_refund.reconcile' and subject_id=${r.refundId} and details->>'previous_status'='failed' and reason<>'SYNTHETIC stale audit'`;
		assert.equal(audits.length, 1);
		assert.equal(audits[0].details.previous_attempts, 5);
		assert.equal(await runOneJob(sql, r.adapters, callbackJobId), true);
		const callback = await jobRow(sql, callbackJobId);
		assert.equal(callback.status, "completed", String(callback.last_error));
		assert.equal(callback.result.outcome, "confirmed");
		assert.equal(await cashCount(r), 1);
		const [refund] =
			await sql`select status from app.recovery_refund where id=${r.refundId}`;
		assert.equal(refund.status, "succeeded");

		// Second re-arm: nothing to recover, guards refuse, still one posting.
		await reconcileRecoveryRefundNow(sql, r.refundId);
		assert.deepEqual(await jobRow(sql, callbackJobId), callback);
		await refused(
			sql`update app.outbox_job set status='pending',attempts=0,completed_at=null,result=null where id=${callbackJobId}`,
			"23514",
		);
		assert.equal(await runOneJob(sql, r.adapters, callbackJobId), false);
		assert.equal(await cashCount(r), 1);
		assert.equal(
			(await sql`select event_id from app.recovery_event_result where refund_id=${r.refundId}`).length,
			1,
		);
	} finally {
		await r.close();
	}
});

test("S71 finance retry after a signed failed bank outcome starts attempt 2 and confirms with one posting", async () => {
	const r = await queuedPrepaidRecovery();
	const { sql } = r;
	try {
		assert.equal(await runOneJob(sql, r.adapters, r.creationJobId), true);
		// Outcome still unknown: retry refused.
		await refused(r.retry("SYNTHETIC early retry"), "RECOVERY_OUTCOME_STILL_AMBIGUOUS");
		const failedSource = await simulateRecoveryOutcome(sql, "test", r.refundId, "failed");
		const failedCallback = await ingestRecoverySourceEvent(sql, failedSource);
		assert.equal(await runOneJob(sql, r.adapters, failedCallback), true);
		const [failed] = await sql<
			{ status: string; current_job_id: string }[]
		>`select status,current_job_id from app.recovery_refund where id=${r.refundId}`;
		assert.equal(failed.status, "failed");
		const [failedCase] =
			await sql`select status from app.commerce_exception where id=${r.exceptionId}`;
		assert.equal(failedCase.status, "refunding");

		// A retry event cannot be forged without its finance operation.
		await refused(
			sql`insert into app.recovery_refund_event (refund_id,revision,kind,status,source_kind,source_id,reason,occurred_at)
        select id,revision+1,'retry','queued','operation',operation_id,'SYNTHETIC forged retry',clock_timestamp() from app.recovery_refund where id=${r.refundId}`,
			"23514",
		);

		const projected = (await r.retry("SYNTHETIC retry after bank rejection")) as Record<string, unknown>;
		assert.ok(projected);
		const [queued] = await sql<
			{ status: string; current_job_id: string; current_operation_id: string | null }[]
		>`select status,current_job_id,current_operation_id from app.recovery_refund where id=${r.refundId}`;
		assert.equal(queued.status, "queued");
		assert.equal(queued.current_operation_id, null);
		assert.notEqual(queued.current_job_id, failed.current_job_id);
		const [next] =
			await sql`select dedup_key,payload,status from app.outbox_job where id=${queued.current_job_id}`;
		assert.equal(next.dedup_key, `recovery-refund-create:${r.refundId}:2`);
		assert.deepEqual(next.payload, { refundId: r.refundId, attempt: 2 });
		assert.equal(next.status, "pending");
		// A second retry while attempt 2 is pending is refused.
		await refused(r.retry("SYNTHETIC duplicate retry"), "RECOVERY_OUTCOME_STILL_AMBIGUOUS");

		assert.equal(await runOneJob(sql, r.adapters, queued.current_job_id), true);
		assert.equal((await jobRow(sql, queued.current_job_id)).status, "completed");
		const [operation] =
			await sql`select attempt from app.local_recovery_operation where creation_job_id=${queued.current_job_id}`;
		assert.equal(operation.attempt, 2);
		const source = await simulateRecoveryOutcome(sql, "test", r.refundId, "succeeded");
		assert.notEqual(source.id, failedSource.id);
		const callback = await ingestRecoverySourceEvent(sql, source);
		assert.equal(await runOneJob(sql, r.adapters, callback), true);
		const done = await jobRow(sql, callback);
		assert.equal(done.status, "completed", String(done.last_error));
		const [refund] =
			await sql`select status,cash_transaction_id from app.recovery_refund where id=${r.refundId}`;
		assert.equal(refund.status, "succeeded");
		assert.equal(await cashCount(r), 1);
		const [resolved] =
			await sql`select status from app.commerce_exception where id=${r.exceptionId}`;
		assert.equal(resolved.status, "resolved");
		// No retry after confirmed money.
		await refused(r.retry("SYNTHETIC retry after success"), "RECOVERY_OUTCOME_STILL_AMBIGUOUS");
		assert.equal(await cashCount(r), 1);
	} finally {
		await r.close();
	}
});

test("S71 POST /refunds/{refundId}/retries queues attempt 2 over HTTP with idempotent replay, version and role guards", async () => {
	const r = await queuedPrepaidRecovery();
	const { sql } = r;
	const path = `/api/v1/admin/commerce-exceptions/${r.exceptionId}/refunds/${r.refundId}/retries`;
	const post = async (staff: Staff, body: Record<string, unknown>, key: string) => {
		const request = staff.browser.request(path, body);
		request.headers.set("idempotency-key", key);
		const response = await handleCommerceExceptions(request, r.f.identity);
		return { status: response.status, payload: await response.json() };
	};
	try {
		assert.equal(await runOneJob(sql, r.adapters, r.creationJobId), true);
		const failedCallback = await ingestRecoverySourceEvent(
			sql,
			await simulateRecoveryOutcome(sql, "test", r.refundId, "failed"),
		);
		assert.equal(await runOneJob(sql, r.adapters, failedCallback), true);
		const [failed] = await sql<
			{ status: string; revision: number; current_job_id: string }[]
		>`select status,revision,current_job_id from app.recovery_refund where id=${r.refundId}`;
		assert.equal(failed.status, "failed");

		// Non-finance staff: refused before any effect.
		const support = await r.staff("customer_service");
		const denied = await post(
			support,
			{ expected_version: failed.revision, reason: "SYNTHETIC support retry attempt", reauthentication_proof: "synthetic-proof" },
			randomUUID(),
		);
		assert.equal(denied.status, 403, JSON.stringify(denied.payload));

		const key = randomUUID();
		const body = {
			expected_version: failed.revision,
			reason: "SYNTHETIC HTTP retry after bank rejection",
			reauthentication_proof: await r.issueProof(r.refundId),
		};
		const retried = await post(r.finance, body, key);
		assert.equal(retried.status, 201, JSON.stringify(retried.payload));
		const [queued] = await sql<
			{ status: string; revision: number; current_job_id: string }[]
		>`select status,revision,current_job_id from app.recovery_refund where id=${r.refundId}`;
		assert.equal(queued.status, "queued");
		assert.equal(queued.revision, failed.revision + 1);
		assert.notEqual(queued.current_job_id, failed.current_job_id);
		const [next] =
			await sql`select dedup_key,payload,status from app.outbox_job where id=${queued.current_job_id}`;
		assert.equal(next.dedup_key, `recovery-refund-create:${r.refundId}:2`);
		assert.deepEqual(next.payload, { refundId: r.refundId, attempt: 2 });
		assert.equal(next.status, "pending");

		// Same key and body: original outcome, no second job or revision.
		const replay = await post(r.finance, body, key);
		assert.equal(replay.status, 201);
		assert.deepEqual(replay.payload, retried.payload);
		const [after] = await sql<
			{ revision: number; current_job_id: string }[]
		>`select revision,current_job_id from app.recovery_refund where id=${r.refundId}`;
		assert.deepEqual({ ...after }, { revision: queued.revision, current_job_id: queued.current_job_id });
		assert.equal(
			(await sql`select id from app.exception_operation where action='refund_retry' and subject_id=${r.refundId}`).length,
			1,
		);

		// Stale expected_version under a fresh key.
		const stale = await post(
			r.finance,
			{ ...body, reauthentication_proof: await r.issueProof(r.refundId) },
			randomUUID(),
		);
		assert.equal(stale.status, 409);
		assert.equal(stale.payload.code, "VERSION_CONFLICT");
	} finally {
		await r.close();
	}
});

test("S71 finance retry after a creation job failed before any bank request starts attempt 2; the DB refuses non-normalized retry input", async () => {
	const r = await queuedPrepaidRecovery();
	const { sql } = r;
	try {
		// The creation job fails permanently before the adapter prepares any request.
		const rejecting = {
			"recovery.refund.create": {
				dispatch: async () => ({ status: "failed" as const, code: "PERMANENT_REJECTION" as const }),
				reconcile: async () => ({ status: "failed" as const, code: "PERMANENT_REJECTION" as const }),
			},
		};
		assert.equal(await runOneJob(sql, rejecting, r.creationJobId), true);
		assert.equal((await jobRow(sql, r.creationJobId)).status, "failed");
		const [head] = await sql<
			{ status: string; revision: number; current_operation_id: string | null }[]
		>`select status,revision,current_operation_id from app.recovery_refund where id=${r.refundId}`;
		assert.equal(head.status, "queued");
		assert.equal(head.current_operation_id, null);
		assert.equal(
			(await sql`select id from app.local_recovery_operation where creation_job_id=${r.creationJobId}`).length,
			0,
		);

		// 0028: the refund_retry input branch carries the queue guard's
		// normalized expected_version (bound to the refund revision) and reason.
		const [session] = await sql<
			{ id: string }[]
		>`select id from app.auth_session where user_id=${r.finance.id} order by created_at desc limit 1`;
		const insert = (input: Record<string, unknown>) =>
			sql.begin(
				(tx) => tx`insert into app.exception_operation (exception_id,subject_id,actor_scope,actor_id,session_id,action,key,request_hash,proof_digest,input,response,occurred_at)
          values (${r.exceptionId},${r.refundId},${`user:${r.finance.id}`},${r.finance.id},${session.id},'refund_retry',${randomUUID()},
            ${createHash("sha256").update(randomUUID()).digest("hex")},${createHash("sha256").update(randomUUID()).digest("hex")},
            ${JSON.stringify(input)}::jsonb,'{}'::jsonb,clock_timestamp())`,
			);
		const guard = "Exception operation retains its exact subject and required financial proof";
		const reason = "SYNTHETIC retry after creation failure";
		for (const input of [
			{ expected_version: head.revision + 1, reason },
			{ expected_version: 0, reason },
			{ expected_version: 1.5, reason },
			{ expected_version: head.revision, reason: ` ${reason}` },
			{ expected_version: head.revision, reason: "" },
			{ expected_version: head.revision, reason: "x".repeat(501) },
		]) {
			await assert.rejects(insert(input), (error: { code?: string; message?: string }) =>
				error.code === "23514" && error.message === guard, JSON.stringify(input).slice(0, 80));
		}
		// Normalized input passes this guard; only the deferred seal refuses an
		// operation without its retry event.
		await assert.rejects(insert({ expected_version: head.revision, reason }), (error: { code?: string; message?: string }) =>
			error.code === "23514" && error.message !== guard);

		await r.retry(reason);
		const [queued] = await sql<
			{ status: string; revision: number; current_job_id: string; current_operation_id: string | null }[]
		>`select status,revision,current_job_id,current_operation_id from app.recovery_refund where id=${r.refundId}`;
		assert.equal(queued.status, "queued");
		assert.equal(queued.revision, head.revision + 1);
		assert.equal(queued.current_operation_id, null);
		assert.notEqual(queued.current_job_id, r.creationJobId);
		const [next] =
			await sql`select dedup_key,payload,status from app.outbox_job where id=${queued.current_job_id}`;
		assert.equal(next.dedup_key, `recovery-refund-create:${r.refundId}:2`);
		assert.deepEqual(next.payload, { refundId: r.refundId, attempt: 2 });

		assert.equal(await runOneJob(sql, r.adapters, queued.current_job_id), true);
		assert.equal((await jobRow(sql, queued.current_job_id)).status, "completed");
		const source = await simulateRecoveryOutcome(sql, "test", r.refundId, "succeeded");
		const callback = await ingestRecoverySourceEvent(sql, source);
		assert.equal(await runOneJob(sql, r.adapters, callback), true);
		const [refund] =
			await sql`select status from app.recovery_refund where id=${r.refundId}`;
		assert.equal(refund.status, "succeeded");
		assert.equal(await cashCount(r), 1);
	} finally {
		await r.close();
	}
});
