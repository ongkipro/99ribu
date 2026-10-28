import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runOneJob } from "../../src/jobs/worker.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import {
	advanceException,
	type ExceptionHead,
} from "../../src/modules/checkout/exceptions/core.ts";
import { exceptionProposalPlan } from "../../src/modules/checkout/exceptions/policy.ts";
import {
	ingestRecoverySourceEvent,
	simulateRecoveryOutcome,
} from "../../src/modules/checkout/exceptions/refund-source.ts";
import {
	reconcileRecoveryRefundNow,
	recoveryRefundAdapter,
} from "../../src/modules/checkout/exceptions/refund-worker.ts";
import { handleCommerceExceptions } from "../../src/modules/checkout/exceptions/routes.ts";
import {
	ingestWaybillEvent,
	simulateWaybillIssue,
} from "../../src/modules/fulfillment/local.ts";
import { handleFulfillment } from "../../src/modules/fulfillment/routes.ts";
import { handleInventory } from "../../src/modules/inventory/routes.ts";
import {
	canApply,
	canDecide,
	canIntake,
	canReinspect,
	type Decision,
	decisionsFor,
	type ExceptionKind,
	type ExceptionStatus,
	KINDS,
	STATUSES,
} from "../../src/components/admin/exception-model.ts";
import { componentsOf } from "../../src/components/admin/exception-basis.ts";
import { actor, enroll } from "../contract/access-fixture.ts";
import { Intent } from "../../src/components/admin/exception-intent-core.ts";
import {
	closeFulfillmentActor,
	fulfillmentFixture,
} from "./fulfillment-fixture.ts";

// S133 commerce exception workbench over the real routes: each decision, intake and recovery
// refund path with the role that may take it and the roles that may not, warehouse scope
// negatives, the labels the screen reads, and an unknown refund outcome that never yields a
// second refund. The screen's own action gates are compared with what the domain accepts.

type Staff = Awaited<ReturnType<typeof actor>>;
const COMMERCE = "/api/v1/admin/commerce-exceptions";

const DECISIONS: Decision[] = [
	"propose_cancellation",
	"propose_refund",
	"keep_waiting",
	"escalate",
];
const accepted = (
	kind: ExceptionKind,
	status: ExceptionStatus,
	decision: Decision,
) => {
	try {
		exceptionProposalPlan({ kind, status }, decision);
		return true;
	} catch {
		return false;
	}
};

test("S133 the screen offers exactly the decisions the domain accepts for each kind and status", () => {
	for (const kind of KINDS) {
		const offered = decisionsFor(kind);
		assert.deepEqual(
			DECISIONS.filter((d) => accepted(kind, "open", d)),
			DECISIONS.filter((d) => offered.includes(d)),
			`decisions for ${kind}`,
		);
	}
	// A status is decidable on screen only when the domain would not refuse it outright;
	// ready_for_refund is accepted by the plan but hidden on purpose (finance is next).
	for (const status of STATUSES) {
		const domainAllows = accepted("stock_discrepancy", status, "escalate");
		if (canDecide(status)) assert.ok(domainAllows, `${status} offered but refused`);
		else
			assert.ok(
				!domainAllows || status === "ready_for_refund",
				`${status} refused by the screen but allowed by the domain`,
			);
	}
	const unit = (state: string) =>
		({ replacement_link_id: null, physical_state: state }) as never;
	assert.equal(
		canApply({
			status: "awaiting_source",
			proposal: { action: "continue_waiting" } as never,
		}),
		false,
		"waiting is never applied",
	);
	assert.equal(
		canApply({
			status: "awaiting_source",
			proposal: { action: "cancel_affected_units" } as never,
		}),
		true,
	);
	assert.equal(
		canApply({ status: "awaiting_buyer", proposal: { action: "cancel_affected_units" } as never }),
		false,
		"the buyer has not answered yet",
	);
	assert.equal(
		canIntake({
			kind: "cod_refusal",
			status: "awaiting_return",
			source_kind: "parcel_outcome",
			units: [unit("return_expected")],
		}),
		true,
	);
	assert.equal(
		canIntake({
			kind: "cod_refusal",
			status: "awaiting_return",
			source_kind: "parcel_outcome",
			units: [unit("quarantined")],
		}),
		false,
		"complete quarantine needs no further intake",
	);
	assert.equal(
		canIntake({
			kind: "stock_discrepancy",
			status: "awaiting_stock",
			source_kind: "stock_report",
			units: [unit("unhanded")],
		}),
		false,
		"intake needs a signed parcel outcome",
	);
	assert.equal(
		canReinspect({ kind: "stock_discrepancy", status: "refunding", units: [unit("unhanded")] }),
		false,
	);
});

type Call = { url: string; key: string | null; body: Record<string, unknown> };
// A scripted browser: each entry answers the next request (a Response, or an Error = lost answer).
function scripted(answers: (Response | Error)[]) {
	const calls: Call[] = [];
	const send = (async (url: string, init: RequestInit) => {
		calls.push({
			url,
			key: new Headers(init.headers).get("idempotency-key"),
			body: JSON.parse(String(init.body)),
		});
		const next = answers.shift();
		if (!next) throw new Error(`unexpected request to ${url}`);
		if (next instanceof Error) throw next;
		return next;
	}) as typeof fetch;
	return { calls, send };
}
const reply = (body: unknown, status = 201) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PROOFS = "/api/v1/me/reauthentication-proofs";
const QUEUE = "/api/v1/admin/commerce-exceptions/x/refunds";
const money = { password: "synthetic", action: "finance.recovery_refund", subject: "x" } as const;
const counter = () => {
	let n = 0;
	return () => `key-${++n}`;
};

test("S133 a lost answer is only ever repeated as the same request: same key, frozen body, same proof", async () => {
	const browser = scripted([
		reply({ proof: "P1" }), // proof issued
		new Error("connection reset"), // the queue answer is lost
		reply({ code: "SERVICE_UNAVAILABLE" }, 503), // still unknown
		reply({ refunds: [{ id: "r1" }] }), // saved result
	]);
	const intent = new Intent();
	let reloads = 0;
	const options = { money, fetch: browser.send, uuid: counter(), onUncertain: () => reloads++ };
	const first = await intent.send<{ refunds: unknown[] }>(QUEUE, () => ({ expected_version: 4, reason: "alasan" }), options);
	assert.equal(first.data, null);
	assert.equal(first.uncertain, true);
	assert.match(first.error ?? "", /Hasil belum pasti/);
	// The operator edits the reason field meanwhile: the repeated request must not change.
	const second = await intent.send(QUEUE, () => ({ expected_version: 9, reason: "diubah" }), options);
	assert.equal(second.uncertain, true);
	const third = await intent.send<{ refunds: unknown[] }>(QUEUE, () => ({ expected_version: 9, reason: "diubah" }), options);
	assert.equal(third.uncertain, false);
	assert.equal(third.data?.refunds.length, 1);
	assert.equal(reloads, 2, "the page reloads after each unknown answer");
	const sends = browser.calls.filter((c) => c.url === QUEUE);
	assert.equal(sends.length, 3);
	assert.equal(new Set(sends.map((c) => c.key)).size, 1, "one idempotency key for the whole intent");
	assert.equal(new Set(sends.map((c) => JSON.stringify(c.body))).size, 1, "one frozen body");
	assert.deepEqual(sends[0].body, { expected_version: 4, reason: "alasan", reauthentication_proof: "P1" });
	assert.equal(browser.calls.filter((c) => c.url === PROOFS).length, 1, "the proof is issued once per intent");
	// A success ends the intent: the next one is a different request with its own key and proof.
	const next = scripted([reply({ proof: "P2" }), reply({ refunds: [] })]);
	await intent.send(QUEUE, () => ({ expected_version: 5, reason: "baru" }), { money, fetch: next.send, uuid: counter() });
	assert.equal(next.calls[1].body.reauthentication_proof, "P2");
	assert.deepEqual(next.calls[1].body, { expected_version: 5, reason: "baru", reauthentication_proof: "P2" });
});

test("S133 a definitive refusal frees the key; a dead proof is replaced; a failed proof sends no money request", async () => {
	const browser = scripted([
		reply({ proof: "P1" }),
		reply({ code: "VERSION_CONFLICT" }, 409), // refused: nothing happened, the proof is not consumed
		reply({ refunds: [] }), // corrected request saved
		reply({ proof: "P2" }),
		reply({ code: "REAUTHENTICATION_REQUIRED" }, 403), // refused: the proof is dead
		reply({ proof: "P3" }),
		reply({ refunds: [] }),
	]);
	const intent = new Intent();
	const options = { money, fetch: browser.send, uuid: counter() };
	const stale = await intent.send(QUEUE, () => ({ expected_version: 4, reason: "a" }), options);
	assert.equal(stale.uncertain, false);
	assert.match(stale.error ?? "", /VERSION_CONFLICT/);
	const corrected = await intent.send(QUEUE, () => ({ expected_version: 5, reason: "a" }), options);
	assert.ok(corrected.data);
	const [, refused, saved] = browser.calls;
	assert.notEqual(refused.key, saved.key, "corrected input is a new request");
	assert.equal(saved.body.expected_version, 5, "the body is rebuilt from the corrected input");
	assert.equal(saved.body.reauthentication_proof, "P1", "an unconsumed proof is reused");
	// The next intent finds its proof rejected: it is issued again, not resent.
	const dead = await intent.send(QUEUE, () => ({ expected_version: 6, reason: "b" }), options);
	assert.equal(dead.data, null);
	assert.match(dead.error ?? "", /REAUTHENTICATION_REQUIRED/);
	const retried = await intent.send(QUEUE, () => ({ expected_version: 6, reason: "b" }), options);
	assert.ok(retried.data);
	assert.equal(browser.calls.filter((c) => c.url === PROOFS).length, 3);
	assert.equal(browser.calls.at(-1)?.body.reauthentication_proof, "P3");

	// The proof itself cannot be issued (wrong password): the money endpoint is never called.
	const denied = scripted([reply({ code: "REAUTHENTICATION_REQUIRED" }, 403)]);
	const other = await new Intent().send(QUEUE, () => ({ expected_version: 4, reason: "a" }), { money, fetch: denied.send, uuid: counter() });
	assert.equal(other.data, null);
	assert.deepEqual(denied.calls.map((c) => c.url), [PROOFS]);
	// A lost proof answer is repeated with the same proof key (the server derives the same proof).
	const lost = scripted([new Error("reset"), reply({ proof: "P4" }), reply({ refunds: [] })]);
	const again = new Intent();
	const lostOptions = { money, fetch: lost.send, uuid: counter() };
	assert.equal((await again.send(QUEUE, () => ({ expected_version: 4, reason: "a" }), lostOptions)).data, null);
	assert.ok((await again.send(QUEUE, () => ({ expected_version: 4, reason: "a" }), lostOptions)).data);
	assert.equal(lost.calls[0].url, PROOFS);
	assert.equal(lost.calls[0].key, lost.calls[1].key);
});

test("S133 report, decisions, apply and recovery refund: roles, scope, labels and an unknown outcome without a second refund", async (t) => {
	const f = await fulfillmentFixture("prepaid");
	const sql = f.identity.sql;
	const users: Staff[] = [];
	try {
		const parcel = f.parcels[0];
		const otherParcel = f.parcels[1];
		assert.notEqual(parcel.warehouse_id, otherParcel.warehouse_id);
		const staff = async (
			role: Parameters<typeof actor>[1],
			warehouses: string[] = [],
			permissions: string[] = [],
		) => {
			const user = await actor(f.identity, role, warehouses);
			users.push(user);
			await enroll(user.browser, user.password);
			if (permissions.length)
				await sql`update app.role_grant set permissions=${permissions},revision=revision+1 where user_id=${user.id}`;
			return user;
		};
		const whIn = await staff("warehouse", [parcel.warehouse_id]);
		const whOut = await staff("warehouse", [otherParcel.warehouse_id]);
		const csIn = await staff("customer_service", [parcel.warehouse_id]);
		const csOut = await staff("customer_service", [otherParcel.warehouse_id]);
		const ecom = await staff("ecommerce_admin");
		const financeRW = await staff("finance", [], [
			"finance.refunds.read",
			"finance.refunds.write",
		]);
		const financeRO = await staff("finance", [], ["finance.refunds.read"]);
		const financeNone = await staff("finance");

		const call = async (
			who: Staff,
			path: string,
			body?: Record<string, unknown>,
			key: string = randomUUID(),
		) => {
			const request = who.browser.request(path, body);
			if (body !== undefined) request.headers.set("idempotency-key", key);
			const response = await handleCommerceExceptions(request, f.identity);
			return { status: response.status, payload: await response.json() };
		};
		const proof = async (who: Staff, subject: string, key: string = randomUUID()) => {
			// The route budgets five proofs per minute per account; the screen issues one per intent.
			await sql`delete from app.auth_rate_limit where key=${`access-proof:${who.id}`}`;
			const request = who.browser.request("/api/v1/me/reauthentication-proofs", {
				password: who.password,
				action: "finance.recovery_refund",
				subject_id: subject,
			});
			request.headers.set("idempotency-key", key);
			const response = await handleAccess(request, f.identity);
			return { status: response.status, payload: await response.json() };
		};
		const buyer = async (body: Record<string, unknown>) => {
			const request = f.client.request(
				`/api/v1/orders/${f.order.id}/recovery-actions`,
				body,
			);
			request.headers.set("idempotency-key", randomUUID());
			const response = await handleCommerceExceptions(request, f.identity);
			return { status: response.status, payload: await response.json() };
		};
		const units = await sql<{ id: string }[]>`
      select id from app.fulfillment_item where shipment_id=${parcel.shipment_id} order by id`;
		const balances = await sql<
			{ balance_id: string; stock_item_id: string; revision: number }[]
		>`
      select distinct a.balance_id,a.stock_item_id,b.revision
        from app.fulfillment_component_allocation a join app.inventory_balance b on b.id=a.balance_id
       where a.fulfillment_item_id in ${sql(units.map((u) => u.id))} order by a.balance_id`;
		const report = {
			fulfillment_id: parcel.id,
			fulfillment_item_ids: units.map((u) => u.id),
			expected_version: 1,
			reason: "SYNTHETIC S133 physical count shortage",
			observed_components: balances.map((b, index) => ({
				balance_id: b.balance_id,
				stock_item_id: b.stock_item_id,
				expected_balance_version: Number(b.revision),
				missing_quantity: index === 0 ? 1 : 0,
			})),
		};
		const cases = async () =>
			(await sql`select id from app.commerce_exception where order_id=${f.order.id}`).length;
		let exceptionId = "";

		await t.test("report: only the warehouse of the parcel (or the owner) may count", async () => {
			for (const [who, status] of [
				[ecom, 403],
				[csIn, 403],
				[financeRW, 403],
				[whOut, 404],
			] as const) {
				const refused = await call(who, COMMERCE, report);
				assert.equal(refused.status, status, JSON.stringify(refused.payload));
			}
			assert.equal(await cases(), 0, "refused reports create nothing");
			const created = await call(whIn, COMMERCE, report);
			assert.equal(created.status, 201, JSON.stringify(created.payload));
			assert.equal(created.payload.kind, "stock_discrepancy");
			assert.equal(created.payload.status, "awaiting_stock");
			// Mutation responses stay the sealed projection; labels belong to the reads.
			assert.equal(Object.hasOwn(created.payload, "order_number"), false);
			exceptionId = String(created.payload.id);
			assert.equal(await cases(), 1);
		});

		await t.test("reads: scope, labels and denied roles", async () => {
			const want = `${COMMERCE}?kind=stock_discrepancy&limit=50`;
			for (const who of [f.owner, whIn, csIn, financeRW, financeRO]) {
				const listed = await call(who, want);
				assert.equal(listed.status, 200);
				assert.ok(listed.payload.data.some((c: { id: string }) => c.id === exceptionId));
			}
			for (const who of [whOut, csOut]) {
				const listed = await call(who, want);
				assert.equal(listed.status, 200);
				assert.ok(
					listed.payload.data.every((c: { id: string }) => c.id !== exceptionId),
					"out-of-scope staff never see the case",
				);
				assert.equal((await call(who, `${COMMERCE}/${exceptionId}`)).status, 404);
			}
			for (const who of [ecom, financeNone]) {
				assert.equal((await call(who, want)).status, 403);
				assert.equal((await call(who, `${COMMERCE}/${exceptionId}`)).status, 403);
			}
			assert.equal((await call(f.owner, `${COMMERCE}?status=bogus`)).status, 400);
			const detail = await call(whIn, `${COMMERCE}/${exceptionId}`);
			assert.equal(detail.status, 200);
			assert.equal(detail.payload.order_number, f.order.number);
			const [first] = detail.payload.units;
			assert.ok(first.product_name, "offer name from the order snapshot");
			assert.ok(first.warehouse_name, "origin warehouse name");
			// A warehouse reader gets no whole-order money, contact or bank field.
			assert.deepEqual(
				Object.keys(detail.payload).sort(),
				[
					"admin_no",
					"created_at",
					"explanation",
					"id",
					"kind",
					"occurred_at",
					"order_admin_no",
					"order_id",
					"order_number",
					"proposal",
					"source_id",
					"source_kind",
					"status",
					"units",
					"version",
				].sort(),
			);
			const listed = await call(f.owner, want);
			const row = listed.payload.data.find((c: { id: string }) => c.id === exceptionId);
			assert.equal(row.order_number, f.order.number);
			// The refund list is finance only and the case head holds no refund ids.
			for (const who of [whIn, csIn, ecom, financeNone])
				assert.equal((await call(who, `${COMMERCE}/${exceptionId}/refunds`)).status, 403);
			for (const who of [financeRW, financeRO, f.owner]) {
				const none = await call(who, `${COMMERCE}/${exceptionId}/refunds`);
				assert.equal(none.status, 200);
				assert.deepEqual(none.payload.refunds, []);
				assert.equal(none.payload.exception_id, exceptionId);
			}
			assert.equal((await call(financeRW, `${COMMERCE}/${exceptionId}/refunds?x=1`)).status, 400);
		});

		let version = 1;
		const decide = async (who: Staff, body: Record<string, unknown>) =>
			call(who, `${COMMERCE}/${exceptionId}/decisions`, body);
		let proposalId = "";
		await t.test("decisions: every choice by owner or customer service in scope, refused for the rest", async () => {
			const keepWaiting = {
				expected_version: 1,
				decision: "keep_waiting",
				reason: "SYNTHETIC wait for stock",
			};
			for (const [who, status] of [
				[whIn, 403],
				[financeRW, 403],
				[ecom, 403],
				[csOut, 404],
			] as const) {
				const refused = await decide(who, keepWaiting);
				assert.equal(refused.status, status, JSON.stringify(refused.payload));
			}
			const sequence: [Staff, Decision, ExceptionStatus][] = [
				[csIn, "keep_waiting", "awaiting_buyer"],
				[f.owner, "propose_refund", "awaiting_buyer"],
				[csIn, "escalate", "escalated"],
				[csIn, "propose_cancellation", "awaiting_buyer"],
			];
			for (const [who, decision, status] of sequence) {
				const done = await decide(who, {
					expected_version: version,
					decision,
					reason: `SYNTHETIC ${decision}`,
				});
				assert.equal(done.status, 201, `${decision}: ${JSON.stringify(done.payload)}`);
				assert.equal(done.payload.status, status);
				version += 1;
				assert.equal(done.payload.version, version);
				if (decision === "propose_cancellation") proposalId = String(done.payload.proposal.id);
			}
			// A stale version is a conflict, not a silent overwrite.
			assert.equal(
				(await decide(csIn, { expected_version: 1, decision: "escalate", reason: "SYNTHETIC stale" })).payload.code,
				"VERSION_CONFLICT",
			);
			// Nothing applied yet: no stock, cash or cancellation moved.
			assert.equal((await sql`select 1 from app.exception_cancellation where exception_id=${exceptionId}`).length, 0);
		});

		await t.test("apply: only after the buyer accepted, by owner or customer service in scope", async () => {
			const apply = { proposal_id: proposalId, reason: "SYNTHETIC apply accepted cancellation" };
			assert.equal(
				(await decide(csIn, { ...apply, expected_version: version })).payload.code,
				"RECOVERY_ACCEPTANCE_NOT_CURRENT",
				"no buyer consent yet",
			);
			const accepted = await buyer({
				exception_id: exceptionId,
				expected_version: version,
				action: "accept_proposal",
				proposal_id: proposalId,
			});
			assert.equal(accepted.status, 201, JSON.stringify(accepted.payload));
			version += 1;
			assert.equal(accepted.payload.status, "awaiting_source");
			for (const [who, status] of [
				[whIn, 403],
				[financeRW, 403],
				[csOut, 404],
			] as const)
				assert.equal((await decide(who, { ...apply, expected_version: version })).status, status);
			const applied = await decide(csIn, { ...apply, expected_version: version });
			assert.equal(applied.status, 201, JSON.stringify(applied.payload));
			version += 1;
			assert.equal(applied.payload.status, "ready_for_refund");
			assert.equal(applied.payload.version, version);
			// A decision after application is refused: the cancellation is already in force.
			assert.equal(
				(await decide(csIn, { expected_version: version, decision: "escalate", reason: "SYNTHETIC late" })).payload.code,
				"EXCEPTION_APPLICATION_IN_PROGRESS",
			);
		});

		const ledger = async (refundId: string) => {
			const count = async (query: PromiseLike<readonly unknown[]>) => (await query).length;
			return {
				refunds: await count(sql`select id from app.recovery_refund where exception_id=${exceptionId}`),
				obligations: await count(sql`select id from app.finance_transaction where kind='recovery_obligation' and order_id=${f.order.id}`),
				cash: await count(sql`select id from app.finance_transaction where kind='recovery_cash' and order_id=${f.order.id}`),
				createJobs: await count(sql`select id from app.outbox_job where kind='recovery.refund.create' and payload->>'refundId'=${refundId}`),
				queueOps: await count(sql`select id from app.exception_operation where exception_id=${exceptionId} and action='refund_queue'`),
				retryOps: await count(sql`select id from app.exception_operation where exception_id=${exceptionId} and action='refund_retry'`),
				postings: await count(sql`select p.account from app.finance_posting p join app.finance_transaction x on x.id=p.transaction_id where x.order_id=${f.order.id} and x.kind in ('recovery_obligation','recovery_cash')`),
			};
		};
		let refundId = "";
		let queueKey = "";
		let queueBody: Record<string, unknown> = {};
		let queued: { status: number; payload: Record<string, unknown> & { refunds: { id: string; version: number; amount: number }[] } };

		await t.test("queue: finance with the write grant and a subject-bound proof only", async () => {
			// Read-only finance cannot even obtain the proof; others are refused by the route itself.
			assert.equal((await proof(financeRO, exceptionId)).status, 403);
			assert.equal((await proof(csIn, exceptionId)).status, 403);
			const body = { expected_version: version, reason: "SYNTHETIC queue original refund" };
			for (const who of [csIn, whIn, ecom, financeNone, financeRO]) {
				const refused = await call(who, `${COMMERCE}/${exceptionId}/refunds`, {
					...body,
					reauthentication_proof: "synthetic-proof-not-valid",
				});
				assert.equal(refused.status, 403, JSON.stringify(refused.payload));
			}
			// A proof bound to another subject is refused and consumes nothing.
			const wrong = await proof(financeRW, randomUUID());
			assert.equal(wrong.status, 201);
			const mismatched = await call(financeRW, `${COMMERCE}/${exceptionId}/refunds`, {
				...body,
				reauthentication_proof: wrong.payload.proof,
			});
			assert.equal(mismatched.status, 403);
			assert.equal(mismatched.payload.code, "REAUTHENTICATION_REQUIRED");
			assert.equal((await sql`select id from app.recovery_refund where exception_id=${exceptionId}`).length, 0);

			const issued = await proof(financeRW, exceptionId);
			assert.equal(issued.status, 201, JSON.stringify(issued.payload));
			queueKey = randomUUID();
			queueBody = { ...body, reauthentication_proof: issued.payload.proof };
			queued = await call(financeRW, `${COMMERCE}/${exceptionId}/refunds`, queueBody, queueKey);
			assert.equal(queued.status, 201, JSON.stringify(queued.payload));
			assert.equal(queued.payload.refunds.length, 1);
			refundId = queued.payload.refunds[0].id;
			version += 1;
			const [row] = await sql`select status from app.recovery_refund where id=${refundId}`;
			assert.equal(row.status, "queued");
			// The refund is found again by a reload through the finance list.
			const listed = await call(f.owner, `${COMMERCE}/${exceptionId}/refunds`);
			assert.equal(listed.payload.refunds[0].id, refundId);
			assert.equal(listed.payload.version, version);
			assert.equal((await call(financeRO, `${COMMERCE}/${exceptionId}/refunds/${refundId}`)).status, 200);
			assert.equal((await call(csIn, `${COMMERCE}/${exceptionId}/refunds/${refundId}`)).status, 403);
		});

		const counts = await ledger(refundId);
		assert.deepEqual(
			{ refunds: counts.refunds, obligations: counts.obligations, cash: counts.cash, createJobs: counts.createJobs, queueOps: counts.queueOps },
			{ refunds: 1, obligations: 1, cash: 0, createJobs: 1, queueOps: 1 },
		);

		await t.test("an unknown bank outcome stays unresolved and cannot be sent twice", async () => {
			const [job] = await sql`select current_job_id from app.recovery_refund where id=${refundId}`;
			const faulty = {
				"recovery.refund.create": recoveryRefundAdapter(sql, "test", new Map([[refundId, "creation-commit-lost-ack" as const]])),
			};
			assert.equal(await runOneJob(sql, faulty, job.current_job_id), true);
			const [stored] = await sql`select status from app.outbox_job where id=${job.current_job_id}`;
			assert.equal(stored.status, "unknown");
			const shown = await call(financeRW, `${COMMERCE}/${exceptionId}/refunds`);
			const refund = shown.payload.refunds[0];
			assert.equal(refund.status, "unknown", "projected as unresolved, not as success or failure");
			assert.equal(refund.cash_transaction_id, null);
			assert.equal((await call(financeRW, `${COMMERCE}/${exceptionId}`)).payload.status, "refunding");
			const before = await ledger(refundId);

			// Retry is refused (never offered): no second attempt, job, obligation or operation.
			const retryProof = await proof(financeRW, refundId);
			const retry = await call(financeRW, `${COMMERCE}/${exceptionId}/refunds/${refundId}/retries`, {
				expected_version: refund.version,
				reason: "SYNTHETIC blind retry",
				reauthentication_proof: retryProof.payload.proof,
			});
			assert.equal(retry.status, 409);
			assert.equal(retry.payload.code, "RECOVERY_OUTCOME_STILL_AMBIGUOUS");
			assert.deepEqual(await ledger(refundId), before);
			for (const who of [csIn, whIn, financeRO])
				assert.equal(
					(await call(who, `${COMMERCE}/${exceptionId}/refunds/${refundId}/retries`, {
						expected_version: refund.version,
						reason: "SYNTHETIC blind retry",
						reauthentication_proof: "synthetic-proof-not-valid",
					})).status,
					403,
				);

			// The lost answer of the queue request is repeated with the same key and body:
			// the saved result comes back and nothing is created a second time.
			const replay = await call(financeRW, `${COMMERCE}/${exceptionId}/refunds`, queueBody, queueKey);
			assert.equal(replay.status, 201);
			assert.deepEqual(replay.payload, queued.payload);
			assert.deepEqual(await ledger(refundId), before);
			// A new key for the same intent finds the case already moved: refused, nothing created.
			const second = await call(financeRW, `${COMMERCE}/${exceptionId}/refunds`, {
				expected_version: version - 1,
				reason: "SYNTHETIC queue original refund",
				reauthentication_proof: (await proof(financeRW, exceptionId)).payload.proof,
			});
			assert.equal(second.status, 409);
			assert.deepEqual(await ledger(refundId), before);
			// The same key with a different request is a conflict, not a second refund.
			const changed = await call(financeRW, `${COMMERCE}/${exceptionId}/refunds`, { ...queueBody, reason: "SYNTHETIC changed reason" }, queueKey);
			assert.equal(changed.status, 409);
			assert.equal(changed.payload.code, "IDEMPOTENCY_CONFLICT");
			assert.deepEqual(await ledger(refundId), before);

			// Reconcile: finance only, no new obligation or cash by itself.
			for (const who of [csIn, whIn, financeRO])
				assert.equal(
					(await call(who, `${COMMERCE}/${exceptionId}/refunds/${refundId}/reconciliations`, {
						expected_version: refund.version,
						reason: "SYNTHETIC reconcile",
						reauthentication_proof: "synthetic-proof-not-valid",
					})).status,
					403,
				);
			const reconcileKey = randomUUID();
			const reconcileBody = {
				expected_version: refund.version,
				reason: "SYNTHETIC reconcile unknown outcome",
				reauthentication_proof: (await proof(financeRW, refundId)).payload.proof,
			};
			const reconciled = await call(financeRW, `${COMMERCE}/${exceptionId}/refunds/${refundId}/reconciliations`, reconcileBody, reconcileKey);
			assert.equal(reconciled.status, 201, JSON.stringify(reconciled.payload));
			assert.deepEqual(await ledger(refundId), before);
			// Same key again: replayed, one operation only.
			assert.equal((await call(financeRW, `${COMMERCE}/${exceptionId}/refunds/${refundId}/reconciliations`, reconcileBody, reconcileKey)).status, 201);
			assert.equal(
				(await sql`select id from app.exception_operation where exception_id=${exceptionId} and action='refund_reconcile'`).length,
				1,
			);
		});

		await t.test("the same obligation converges to one bank outcome and one cash posting", async () => {
			const adapters = { "recovery.refund.create": recoveryRefundAdapter(sql, "test") };
			for (const jobId of await reconcileRecoveryRefundNow(sql, refundId))
				await runOneJob(sql, adapters, jobId);
			const callback = await ingestRecoverySourceEvent(sql, await simulateRecoveryOutcome(sql, "test", refundId, "succeeded"));
			assert.equal(await runOneJob(sql, adapters, callback), true);
			const shown = await call(financeRW, `${COMMERCE}/${exceptionId}/refunds`);
			assert.equal(shown.payload.refunds[0].status, "succeeded");
			assert.equal((await call(financeRW, `${COMMERCE}/${exceptionId}`)).payload.status, "resolved");
			const after = await ledger(refundId);
			assert.equal(after.refunds, 1);
			assert.equal(after.obligations, 1);
			assert.equal(after.cash, 1);
			const postings = await sql<{ account: string; side: string; amount: string }[]>`
        select p.account,p.side,p.amount from app.finance_posting p join app.finance_transaction x on x.id=p.transaction_id
         where x.kind='recovery_cash' and x.order_id=${f.order.id} order by p.side,p.account`;
			const amount = Number(shown.payload.refunds[0].amount);
			assert.deepEqual(postings.map((p) => [p.account, p.side, Number(p.amount)]), [
				["company_cash", "credit", amount],
				["refund_payable", "debit", amount],
			]);
			// Settled money is never retried or sent again.
			const late = await call(financeRW, `${COMMERCE}/${exceptionId}/refunds/${refundId}/retries`, {
				expected_version: shown.payload.refunds[0].version,
				reason: "SYNTHETIC retry after success",
				reauthentication_proof: (await proof(financeRW, refundId)).payload.proof,
			});
			assert.equal(late.status, 409);
			assert.equal((await ledger(refundId)).cash, 1);
		});
	} finally {
		for (const user of users) await closeFulfillmentActor(f.identity, user);
		await f.close();
	}
});

test("S133 returned goods: intake by the warehouse in scope, the join the screen performs, and refusals", async () => {
	const f = await fulfillmentFixture("prepaid");
	const sql = f.identity.sql;
	const users: Staff[] = [];
	try {
		const otherParcel = f.parcels[1];
		const staff = async (role: Parameters<typeof actor>[1], warehouses: string[]) => {
			const user = await actor(f.identity, role, warehouses);
			users.push(user);
			await enroll(user.browser, user.password);
			return user;
		};
		const whIn = await staff("warehouse", [otherParcel.warehouse_id]);
		const whOut = await staff("warehouse", [f.parcels[0].warehouse_id]);
		const csIn = await staff("customer_service", [otherParcel.warehouse_id]);
		const call = async (who: Staff, path: string, body?: Record<string, unknown>, key: string = randomUUID()) => {
			const request = who.browser.request(path, body);
			if (body !== undefined) request.headers.set("idempotency-key", key);
			const response = await handleCommerceExceptions(request, f.identity);
			return { status: response.status, payload: await response.json() };
		};
		const read = async (who: Staff, path: string, handler: typeof handleFulfillment) => {
			const response = await handler(who.browser.request(path), f.identity);
			return { status: response.status, payload: await response.json() };
		};

		const booking = await f.book(otherParcel);
		await f.run(booking.creation_job_id);
		for (const callback of await sql`select callback_job_id from app.waybill_provider_event where booking_id=${booking.id}`)
			await f.run(callback.callback_job_id);
		await f.run(await ingestWaybillEvent(sql, await simulateWaybillIssue(sql, "test", booking.id)));
		const root = `/api/v1/admin/fulfillments/${otherParcel.id}`;
		assert.equal((await f.fulfillmentCall(`${root}/packing`, { expected_version: 4 })).response.status, 201);
		assert.equal(
			(await f.fulfillmentCall(`${root}/handover`, {
				expected_version: 5,
				shipment_id: otherParcel.shipment_id,
				handover_reference: "SYNTHETIC handover for S133 intake",
			})).response.status,
			201,
		);
		const otherUnits = await sql<{ id: string }[]>`select id from app.fulfillment_item where shipment_id=${otherParcel.shipment_id} order by id`;
		const allocations = await sql<
			{ fulfillment_item_id: string; balance_id: string; stock_item_id: string; quantity: number }[]
		>`select fulfillment_item_id,balance_id,stock_item_id,quantity::int quantity from app.fulfillment_component_allocation
       where fulfillment_item_id in ${sql(otherUnits.map((u) => u.id))} order by fulfillment_item_id,balance_id`;

		const outcomeId = randomUUID();
		const exceptionId = randomUUID();
		const exceptionUnits = await sql.begin(async (tx) => {
			const [clock] = await tx<{ now: string }[]>`select date_trunc('milliseconds',app.reservation_clock(${f.namespace}))::text as now`;
			await tx`insert into app.local_parcel_outcome (id,reference,environment,shipment_id,booking_id,clock_namespace,status,unit_ids,request_hash,signature,occurred_at)
        values (${outcomeId},${`rts-${outcomeId}`},'test',${otherParcel.shipment_id},${booking.id},${f.namespace},'returned_to_sender',
         ${JSON.stringify(otherUnits.map((u) => u.id))}::jsonb,${"a".repeat(64)},${"b".repeat(64)},${clock.now})`;
			const callbackJob = randomUUID();
			await tx`insert into app.outbox_job (id,kind,dedup_key,payload,status,attempts,max_attempts,completed_at,result)
        values (${callbackJob},'parcel.outcome.callback',${`parcel-outcome:${outcomeId}`},${JSON.stringify({ eventId: outcomeId })}::jsonb,'completed',1,3,clock_timestamp(),
         ${JSON.stringify({ event_id: outcomeId, outcome: "observed" })}::jsonb)`;
			await tx`insert into app.parcel_outcome_provider_event (id,callback_job_id,payload_hash) values (${outcomeId},${callbackJob},${"c".repeat(64)})`;
			const [head] = await tx<ExceptionHead[]>`insert into app.commerce_exception (id,order_id,kind,revision,status,source_kind,source_id,reason,occurred_at,created_at)
        values (${exceptionId},${f.order.id},'delivery_failure',0,'preparing','parcel_outcome',${outcomeId},'SYNTHETIC carrier returned parcel to sender',${clock.now},${clock.now}) returning *`;
			const created: { id: string; fulfillment_item_id: string }[] = [];
			for (const u of otherUnits) {
				const [unit] = await tx<{ id: string; fulfillment_item_id: string }[]>`insert into app.exception_unit (id,exception_id,kind,fulfillment_item_id,active,created_at)
          values (${randomUUID()},${exceptionId},'delivery_failure',${u.id},true,${clock.now}) returning id,fulfillment_item_id`;
				created.push(unit);
			}
			await advanceException(tx, head, {
				kind: "open",
				status: "awaiting_return",
				source_kind: "parcel",
				source_id: outcomeId,
				actor_id: null,
				reason: "SYNTHETIC carrier returned parcel to sender",
				occurred_at: new Date(head.created_at).toISOString(),
				proposal_event_id: null,
			});
			await tx`insert into app.parcel_outcome_result (event_id,outcome,exception_ids) values (${outcomeId},'observed',${JSON.stringify([exceptionId])}::jsonb)`;
			return created;
		});

		// What the screen reads to build the intake: the case names its signed outcome, and the
		// fulfillment pick rows join the inventory balances to exactly the allocated lots.
		const detail = await call(whIn, `${COMMERCE}/${exceptionId}`);
		assert.equal(detail.status, 200);
		assert.equal(detail.payload.source_kind, "parcel_outcome");
		assert.equal(detail.payload.source_id, outcomeId);
		assert.equal(canIntake(detail.payload), true);
		const parcel = await read(whIn, `/api/v1/admin/shipments/${otherParcel.shipment_id}`, handleFulfillment);
		assert.equal(parcel.status, 200);
		assert.equal(parcel.payload.fulfillment_id, otherParcel.id);
		const fulfillment = await read(whIn, `/api/v1/admin/fulfillments/${parcel.payload.fulfillment_id}`, handleFulfillment);
		assert.equal(fulfillment.status, 200);
		const stockIds = [...new Set(fulfillment.payload.pick_items.map((p: { stock_item_id: string }) => p.stock_item_id))] as string[];
		const found = [];
		for (const stockItemId of stockIds) {
			const page = await read(whIn, `/api/v1/admin/inventory?warehouse_id=${otherParcel.warehouse_id}&stock_item_id=${stockItemId}&limit=100`, handleInventory);
			assert.equal(page.status, 200);
			found.push(...page.payload.data);
		}
		for (const unit of exceptionUnits) {
			const components = componentsOf(fulfillment.payload.pick_items, [unit.fulfillment_item_id], found);
			const expected = allocations.filter((a) => a.fulfillment_item_id === unit.fulfillment_item_id);
			assert.equal(components.length, expected.length);
			for (const a of expected) {
				const c = components.find((x) => x.stock_item_id === a.stock_item_id && x.balance?.id === a.balance_id);
				assert.ok(c, "the screen resolves the allocated balance");
				assert.equal(c.quantity, a.quantity);
				const [row] = await sql`select revision from app.inventory_balance where id=${a.balance_id}`;
				assert.equal(c.balance?.version, Number(row.revision));
			}
		}

		const lines = exceptionUnits.flatMap((eu) =>
			allocations
				.filter((a) => a.fulfillment_item_id === eu.fulfillment_item_id)
				.map((a) => ({
					exception_unit_id: eu.id,
					identity_confirmed: true,
					stock_item_id: a.stock_item_id,
					expected_balance_id: a.balance_id,
					quantity: a.quantity,
				})),
		);
		const body = { expected_version: 1, physical_outcome_id: outcomeId, reason: "SYNTHETIC S133 warehouse intake", lines };
		const path = `${COMMERCE}/${exceptionId}/intakes`;
		const movements = async () => (await sql`select id from app.stock_movement where source_ref like 'exception-goods:%'`).length;
		const before = await movements();
		assert.equal((await call(csIn, path, body)).status, 403, "customer service does not receive goods");
		assert.equal((await call(whOut, path, body)).status, 404, "another warehouse cannot receive them");
		assert.equal((await call(f.owner, path, { ...body, physical_outcome_id: randomUUID() })).payload.code, "EXCEPTION_INTAKE_OUTCOME_INVALID");
		assert.equal(await movements(), before, "refusals post no stock");
		const key = randomUUID();
		const taken = await call(whIn, path, body, key);
		assert.equal(taken.status, 201, JSON.stringify(taken.payload));
		assert.ok(taken.payload.units.every((u: { physical_state: string }) => u.physical_state === "quarantined"));
		const posted = (await movements()) - before;
		assert.equal(posted, lines.length);
		// The same key replays the saved intake; a new key finds the case moved and posts nothing.
		assert.equal((await call(whIn, path, body, key)).status, 201);
		assert.equal((await movements()) - before, posted);
		assert.equal((await call(whIn, path, body)).status, 409);
		assert.equal((await movements()) - before, posted);
		// Once every unit is quarantined the screen offers no intake.
		const after = await call(whIn, `${COMMERCE}/${exceptionId}`);
		assert.equal(canIntake(after.payload), false);

		// Keyset paging: a second case makes two rows; pages of one never repeat a row and a
		// cursor that is not a visible case is refused.
		const firstParcel = f.parcels[0];
		const firstUnits = await sql<{ id: string }[]>`select id from app.fulfillment_item where shipment_id=${firstParcel.shipment_id} order by id`;
		const firstBalances = await sql<{ balance_id: string; stock_item_id: string; revision: number }[]>`
      select distinct a.balance_id,a.stock_item_id,b.revision from app.fulfillment_component_allocation a
        join app.inventory_balance b on b.id=a.balance_id where a.fulfillment_item_id in ${sql(firstUnits.map((u) => u.id))} order by a.balance_id`;
		const reported = await call(f.owner, COMMERCE, {
			fulfillment_id: firstParcel.id,
			fulfillment_item_ids: firstUnits.map((u) => u.id),
			expected_version: 1,
			reason: "SYNTHETIC S133 second case for paging",
			observed_components: firstBalances.map((b, index) => ({
				balance_id: b.balance_id,
				stock_item_id: b.stock_item_id,
				expected_balance_version: Number(b.revision),
				missing_quantity: index === 0 ? 1 : 0,
			})),
		});
		assert.equal(reported.status, 201, JSON.stringify(reported.payload));
		const pageOne = await call(f.owner, `${COMMERCE}?limit=1`);
		assert.equal(pageOne.status, 200);
		assert.equal(pageOne.payload.data.length, 1);
		assert.equal(pageOne.payload.pagination.next_cursor, pageOne.payload.data[0].id);
		const pageTwo = await call(f.owner, `${COMMERCE}?limit=1&cursor=${pageOne.payload.pagination.next_cursor}`);
		assert.equal(pageTwo.status, 200);
		assert.equal(pageTwo.payload.data.length, 1);
		assert.notEqual(pageTwo.payload.data[0].id, pageOne.payload.data[0].id);
		assert.equal((await call(f.owner, `${COMMERCE}?limit=1&cursor=${randomUUID()}`)).status, 400);
		// A warehouse reader pages only inside its scope: the other warehouse's case never appears.
		const scoped = await call(whIn, `${COMMERCE}?limit=50`);
		assert.ok(scoped.payload.data.every((c: { id: string }) => c.id !== reported.payload.id));
		assert.ok(scoped.payload.data.some((c: { id: string }) => c.id === exceptionId));
	} finally {
		for (const user of users) await closeFulfillmentActor(f.identity, user);
		await f.close();
	}
});
