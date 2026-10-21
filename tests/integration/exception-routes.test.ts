import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { runOneJob } from "../../src/jobs/worker.ts";
import {
	advanceException,
	type ExceptionHead,
} from "../../src/modules/checkout/exceptions/core.ts";
import { handleCommerceExceptions } from "../../src/modules/checkout/exceptions/routes.ts";
import {
	ingestWaybillEvent,
	simulateWaybillIssue,
} from "../../src/modules/fulfillment/local.ts";
import {
	advanceFixtureClock,
	readFixtureClock,
} from "../../src/modules/local/fixtures.ts";
import { actor, enroll } from "../contract/access-fixture.ts";
import {
	closeFulfillmentActor,
	fulfillmentFixture,
} from "./fulfillment-fixture.ts";
import { paymentFixture } from "./payment-fixture.ts";

test("S33 commerce exception routes cover stock discrepancy report, admin list/read, CS proposal/application, buyer recovery actions, recovery refund queue/read/reconcile, physical intake, and order cancellation", async () => {
	const f = await fulfillmentFixture("prepaid");
	const sql = f.identity.sql;
	const users: Awaited<ReturnType<typeof actor>>[] = [];

	try {
		const finance = await actor(f.identity, "finance", []);
		users.push(finance);
		await enroll(finance.browser, finance.password);
		await sql`
      update app.role_grant
         set permissions=${["finance.refunds.read", "finance.refunds.write"]},
             revision=revision+1
       where user_id=${finance.id}`;

		const parcel = f.parcels[0];
		const otherParcel = f.parcels[1];

		// Scoped CS actor only has access to otherParcel's warehouse
		const scopedCs = await actor(f.identity, "customer_service", [
			otherParcel.warehouse_id,
		]);
		users.push(scopedCs);
		await enroll(scopedCs.browser, scopedCs.password);

		const units = await sql<{ id: string; shipment_id: string }[]>`
      select id,shipment_id from app.fulfillment_item
       where shipment_id=${parcel.shipment_id}
       order by id`;
		assert.ok(units.length >= 1);

		const balances = await sql<
			{
				balance_id: string;
				stock_item_id: string;
				revision: number;
			}[]
		>`
      select distinct a.balance_id,a.stock_item_id,b.revision
        from app.fulfillment_component_allocation a
        join app.inventory_balance b on b.id=a.balance_id
       where a.fulfillment_item_id in ${sql(units.map((u) => u.id))}
       order by a.balance_id`;
		assert.ok(balances.length >= 1);

		const callStaff = async (
			staffActor: Awaited<ReturnType<typeof actor>>,
			path: string,
			body?: Record<string, unknown>,
			key = randomUUID(),
		) => {
			const req = staffActor.browser.request(path, body);
			if (body !== undefined) req.headers.set("idempotency-key", key);
			const res = await handleCommerceExceptions(req, f.identity);
			return { status: res.status, payload: await res.json() };
		};

		const callBuyer = async (
			path: string,
			body?: Record<string, unknown>,
			key = randomUUID(),
		) => {
			const req = f.client.request(path, body);
			if (body !== undefined) req.headers.set("idempotency-key", key);
			const res = await handleCommerceExceptions(req, f.identity);
			return { status: res.status, payload: await res.json() };
		};

		// 1. Report stock discrepancy via POST /api/v1/admin/commerce-exceptions
		const reportBody = {
			fulfillment_id: parcel.id,
			fulfillment_item_ids: units.map((u) => u.id),
			expected_version: 1,
			reason: "SYNTHETIC physical bin count shortage on parcel 0",
			observed_components: balances.map((b, idx) => ({
				balance_id: b.balance_id,
				stock_item_id: b.stock_item_id,
				expected_balance_version: Number(b.revision),
				missing_quantity: idx === 0 ? 1 : 0,
			})),
		};
		const reportKey = randomUUID();
		const reported = await callStaff(
			f.owner,
			"/api/v1/admin/commerce-exceptions",
			reportBody,
			reportKey,
		);
		assert.equal(reported.status, 201);
		assert.equal(reported.payload.kind, "stock_discrepancy");
		assert.equal(reported.payload.status, "awaiting_stock");
		assert.equal(reported.payload.version, 1);
		const exceptionId = String(reported.payload.id);

		// Idempotent replay of stock discrepancy report
		const replayedReport = await callStaff(
			f.owner,
			"/api/v1/admin/commerce-exceptions",
			reportBody,
			reportKey,
		);
		assert.equal(replayedReport.status, 201);
		assert.equal(replayedReport.payload.id, exceptionId);

		// 2. GET /api/v1/admin/commerce-exceptions & warehouse scope isolation
		const listedOwner = await callStaff(
			f.owner,
			"/api/v1/admin/commerce-exceptions?kind=stock_discrepancy&status=awaiting_stock&limit=10",
		);
		assert.equal(listedOwner.status, 200);
		assert.ok(
			listedOwner.payload.data.some(
				(item: { id: string }) => item.id === exceptionId,
			),
		);

		const listedOutScope = await callStaff(
			scopedCs,
			"/api/v1/admin/commerce-exceptions?limit=20",
		);
		assert.equal(listedOutScope.status, 200);
		assert.ok(
			listedOutScope.payload.data.every(
				(item: { id: string }) => item.id !== exceptionId,
			),
		);

		// 3. GET /api/v1/admin/commerce-exceptions/{exceptionId}
		const detailOwner = await callStaff(
			f.owner,
			`/api/v1/admin/commerce-exceptions/${exceptionId}`,
		);
		assert.equal(detailOwner.status, 200);
		assert.equal(detailOwner.payload.id, exceptionId);

		const detailOutScope = await callStaff(
			scopedCs,
			`/api/v1/admin/commerce-exceptions/${exceptionId}`,
		);
		assert.equal(detailOutScope.status, 404);

		// 4. POST /api/v1/admin/commerce-exceptions/{exceptionId}/decisions (propose_cancellation)
		const proposeBody = {
			expected_version: 1,
			decision: "propose_cancellation",
			reason: "SYNTHETIC propose cancelling affected shortage units",
		};
		const proposed = await callStaff(
			f.owner,
			`/api/v1/admin/commerce-exceptions/${exceptionId}/decisions`,
			proposeBody,
		);
		assert.equal(proposed.status, 201);
		assert.equal(proposed.payload.status, "awaiting_buyer");
		assert.equal(proposed.payload.version, 2);
		const proposalId = String(proposed.payload.proposal.id);

		// 5. GET & POST /api/v1/orders/{orderId}/recovery-actions (buyer lists and accepts proposal)
		const buyerListed = await callBuyer(
			`/api/v1/orders/${f.order.id}/recovery-actions?limit=10`,
		);
		assert.equal(buyerListed.status, 200);
		assert.ok(
			buyerListed.payload.data.some(
				(item: { id: string }) => item.id === exceptionId,
			),
		);

		const acceptBody = {
			exception_id: exceptionId,
			expected_version: 2,
			action: "accept_proposal",
			proposal_id: proposalId,
		};
		const buyerAccepted = await callBuyer(
			`/api/v1/orders/${f.order.id}/recovery-actions`,
			acceptBody,
		);
		assert.equal(buyerAccepted.status, 201);
		assert.equal(buyerAccepted.payload.status, "awaiting_source");
		assert.equal(buyerAccepted.payload.version, 3);

		// 6. POST /api/v1/admin/commerce-exceptions/{exceptionId}/decisions (CS applyException)
		const applyBody = {
			expected_version: 3,
			proposal_id: proposalId,
			reason: "SYNTHETIC apply buyer-accepted cancellation",
		};
		const applied = await callStaff(
			f.owner,
			`/api/v1/admin/commerce-exceptions/${exceptionId}/decisions`,
			applyBody,
		);
		assert.equal(applied.status, 201);
		assert.equal(applied.payload.status, "ready_for_refund");
		assert.equal(applied.payload.version, 4);

		const issueRecoveryProof = async (subjectId: string) => {
			const proof = `recovery-proof-${randomUUID()}`;
			const [session] = await sql<{ id: string }[]>`
        select id from app.auth_session
         where user_id=${finance.id}
         order by created_at desc limit 1`;
			await sql`
        insert into app.access_proof (digest,session_id,action,subject_id,expires_at)
        values (
          ${createHash("sha256").update(proof).digest("hex")},
          ${session.id},
          'finance.recovery_refund',
          ${subjectId},
          clock_timestamp() + interval '5 minutes'
        )`;
			return proof;
		};

		// 7. POST /api/v1/admin/commerce-exceptions/{exceptionId}/refunds (queueRecoveryRefund)
		const queueProof = await issueRecoveryProof(exceptionId);
		const queued = await callStaff(
			finance,
			`/api/v1/admin/commerce-exceptions/${exceptionId}/refunds`,
			{
				expected_version: 4,
				reason: "SYNTHETIC queue original prepaid recovery refund",
				reauthentication_proof: queueProof,
			},
		);
		assert.equal(queued.status, 201);
		assert.equal(queued.payload.refunds.length, 1);
		const refundId = String(queued.payload.refunds[0].id);

		// 8. GET /api/v1/admin/commerce-exceptions/{exceptionId}/refunds/{refundId}
		const refundDetail = await callStaff(
			finance,
			`/api/v1/admin/commerce-exceptions/${exceptionId}/refunds/${refundId}`,
		);
		assert.equal(refundDetail.status, 200);
		assert.equal(refundDetail.payload.id, refundId);
		assert.equal(refundDetail.payload.status, "queued");

		// 9. POST /api/v1/admin/commerce-exceptions/{exceptionId}/refunds/{refundId}/reconciliations
		const recProof = await issueRecoveryProof(refundId);
		const recKey = randomUUID();
		const recBody = {
			expected_version: Number(refundDetail.payload.version),
			reason: "SYNTHETIC reconcile queued recovery refund",
			reauthentication_proof: recProof,
		};
		const reconciled = await callStaff(
			finance,
			`/api/v1/admin/commerce-exceptions/${exceptionId}/refunds/${refundId}/reconciliations`,
			recBody,
			recKey,
		);
		assert.equal(reconciled.status, 201);
		assert.equal(reconciled.payload.id, refundId);

		// Replay reconciliation with same idempotency key
		const replayedRec = await callStaff(
			finance,
			`/api/v1/admin/commerce-exceptions/${exceptionId}/refunds/${refundId}/reconciliations`,
			recBody,
			recKey,
		);
		assert.equal(replayedRec.status, 201);
		assert.equal(replayedRec.payload.id, refundId);

		// 10. POST /api/v1/admin/commerce-exceptions/{exceptionId}/intakes (physical return intake on parcel 1)
		const booking = await f.book(otherParcel);
		await f.run(booking.creation_job_id);
		for (const callback of await sql`select callback_job_id from app.waybill_provider_event where booking_id=${booking.id}`) {
			await f.run(callback.callback_job_id);
		}
		await f.run(
			await ingestWaybillEvent(
				sql,
				await simulateWaybillIssue(sql, "test", booking.id),
			),
		);
		const root = `/api/v1/admin/fulfillments/${otherParcel.id}`;
		assert.equal(
			(await f.fulfillmentCall(`${root}/packing`, { expected_version: 4 }))
				.response.status,
			201,
		);
		assert.equal(
			(
				await f.fulfillmentCall(`${root}/handover`, {
					expected_version: 5,
					shipment_id: otherParcel.shipment_id,
					handover_reference: "SYNTHETIC handover for parcel return intake",
				})
			).response.status,
			201,
		);

		const otherUnits = await sql<{ id: string }[]>`
      select id from app.fulfillment_item
       where shipment_id=${otherParcel.shipment_id}
       order by id`;
		const otherAllocations = await sql<
			{
				fulfillment_item_id: string;
				balance_id: string;
				stock_item_id: string;
				quantity: number;
			}[]
		>`
      select fulfillment_item_id,balance_id,stock_item_id,quantity::int as quantity
        from app.fulfillment_component_allocation
       where fulfillment_item_id in ${sql(otherUnits.map((u) => u.id))}
       order by fulfillment_item_id,balance_id`;

		const outcomeId = randomUUID();
		const returnExId = randomUUID();
		const callbackJobId = randomUUID();
		const returnExUnits = await sql.begin(async (tx) => {
			const [clockRow] = await tx<{ now: string }[]>`
        select date_trunc('milliseconds',app.reservation_clock(${f.namespace}))::text as now`;
			await tx`
        insert into app.local_parcel_outcome (
          id,reference,environment,shipment_id,booking_id,clock_namespace,
          status,unit_ids,request_hash,signature,occurred_at
        ) values (
          ${outcomeId},${`rts-${outcomeId}`},'test',${otherParcel.shipment_id},
          ${booking.id},${f.namespace},'returned_to_sender',
          ${JSON.stringify(otherUnits.map((u) => u.id))}::jsonb,
          ${"a".repeat(64)},${"b".repeat(64)},${clockRow.now}
        )`;
			await tx`
        insert into app.outbox_job (id,kind,dedup_key,payload,status,attempts,max_attempts,completed_at,result)
        values (
          ${callbackJobId},'parcel.outcome.callback',${`parcel-outcome:${outcomeId}`},
          ${JSON.stringify({ eventId: outcomeId })}::jsonb,'completed',1,3,clock_timestamp(),
          ${JSON.stringify({ event_id: outcomeId, outcome: "observed" })}::jsonb
        )`;
			await tx`
        insert into app.parcel_outcome_provider_event (id,callback_job_id,payload_hash)
        values (${outcomeId},${callbackJobId},${"c".repeat(64)})`;
			const [insertedHead] = await tx<ExceptionHead[]>`
        insert into app.commerce_exception (
          id,order_id,kind,revision,status,source_kind,source_id,reason,occurred_at,created_at
        ) values (
          ${returnExId},${f.order.id},'delivery_failure',0,'preparing',
          'parcel_outcome',${outcomeId},'SYNTHETIC carrier returned parcel to sender',
          ${clockRow.now},${clockRow.now}
        ) returning *`;
			const insertedUnits: { id: string; fulfillment_item_id: string }[] = [];
			for (const u of otherUnits) {
				const [eu] = await tx<{ id: string; fulfillment_item_id: string }[]>`
          insert into app.exception_unit (id,exception_id,kind,fulfillment_item_id,active,created_at)
          values (${randomUUID()},${returnExId},'delivery_failure',${u.id},true,${clockRow.now})
          returning id,fulfillment_item_id`;
				insertedUnits.push(eu);
			}
			await advanceException(tx, insertedHead, {
				kind: "open",
				status: "awaiting_return",
				source_kind: "parcel",
				source_id: outcomeId,
				actor_id: null,
				reason: "SYNTHETIC carrier returned parcel to sender",
				occurred_at: new Date(insertedHead.created_at).toISOString(),
				proposal_event_id: null,
			});
			await tx`
        insert into app.parcel_outcome_result (event_id,outcome,exception_ids)
        values (${outcomeId},'observed',${JSON.stringify([returnExId])}::jsonb)`;
			return insertedUnits;
		});

		const intakeLines = returnExUnits.flatMap((eu) =>
			otherAllocations
				.filter((a) => a.fulfillment_item_id === eu.fulfillment_item_id)
				.map((a) => ({
					exception_unit_id: eu.id,
					identity_confirmed: true,
					stock_item_id: a.stock_item_id,
					expected_balance_id: a.balance_id,
					quantity: a.quantity,
				})),
		);
		const intakeKey = randomUUID();
		const intakeBody = {
			expected_version: 1,
			physical_outcome_id: outcomeId,
			reason:
				"SYNTHETIC warehouse physical intake of RTS parcel into quarantine",
			lines: intakeLines,
		};
		const intaken = await callStaff(
			f.owner,
			`/api/v1/admin/commerce-exceptions/${returnExId}/intakes`,
			intakeBody,
			intakeKey,
		);
		assert.equal(intaken.status, 201);
		assert.equal(intaken.payload.id, returnExId);
		assert.equal(intaken.payload.version, 2);
		assert.ok(
			intaken.payload.units.every(
				(u: { physical_state: string }) => u.physical_state === "quarantined",
			),
		);

		// Idempotent replay of physical intake
		const replayedIntake = await callStaff(
			f.owner,
			`/api/v1/admin/commerce-exceptions/${returnExId}/intakes`,
			intakeBody,
			intakeKey,
		);
		assert.equal(replayedIntake.status, 201);
		assert.equal(replayedIntake.payload.id, returnExId);

		// 11. Buyer cancellation conflict on funded order
		const ineligibleCancel = await callBuyer(
			`/api/v1/orders/${f.order.id}/cancellations`,
			{ reason: "SYNTHETIC buyer tries to cancel funded order" },
		);
		assert.equal(ineligibleCancel.status, 409);
		assert.equal(
			ineligibleCancel.payload.code,
			"ORDER_CANCELLATION_NOT_ELIGIBLE",
		);
	} finally {
		for (const u of users) await closeFulfillmentActor(f.identity, u);
		await f.close();
	}
});

test("S33 POST /api/v1/orders/{orderId}/cancellations cancels expired unfunded order idempotently and rejects active holds", async () => {
	const f = await paymentFixture();
	try {
		const { order, client } = await f.order(2, "prepaid");
		const callCancel = async (reason: string, key = randomUUID()) => {
			const req = client.request(`/api/v1/orders/${order.id}/cancellations`, {
				reason,
			});
			req.headers.set("idempotency-key", key);
			const res = await handleCommerceExceptions(req, f.identity);
			return { status: res.status, payload: await res.json() };
		};

		// Before expiry window: active hold returns 409
		const early = await callCancel("Changed mind while hold still active");
		assert.equal(early.status, 409);
		assert.equal(early.payload.code, "ORDER_CANCELLATION_NOT_ELIGIBLE");

		// Advance fixture clock past checkout deadline
		const clock = await readFixtureClock("test", f.namespace);
		await advanceFixtureClock("test", f.namespace, 1860, clock.version);

		const cancelKey = randomUUID();
		const cancelled = await callCancel("Checkout window elapsed", cancelKey);
		assert.equal(cancelled.status, 201);
		assert.equal(cancelled.payload.id, order.id);
		assert.equal(cancelled.payload.status, "cancelled");

		// Idempotent replay returns same 201 Order
		const replayed = await callCancel("Checkout window elapsed", cancelKey);
		assert.equal(replayed.status, 201);
		assert.deepEqual(replayed.payload, cancelled.payload);

		// Different reason with same key returns 409 IDEMPOTENCY_CONFLICT
		const conflict = await callCancel("Different reason", cancelKey);
		assert.equal(conflict.status, 409);
		assert.equal(conflict.payload.code, "IDEMPOTENCY_CONFLICT");

		// Drain expiry job cleanly
		const [expiry] = await f.identity.sql`
      select id from app.outbox_job
       where kind='checkout.order.expire' and payload->>'orderId'=${order.id}`;
		if (expiry) await runOneJob(f.identity.sql, {}, expiry.id);
	} finally {
		await f.close();
	}
});
