import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
	handleReporting,
	sanitizeCsvCell,
} from "../../src/modules/reporting/service.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { advertisingFixture } from "./advertising-fixture.ts";

test("T-34: role-scoped dashboards, unknown vs zero cost metrics, drilldown conservation, bounded exports, CSV sanitization, and operation status", async () => {
	const f = await advertisingFixture();
	const extraUsers: { id: string; email: string }[] = [];

	try {
		// 1. Seed a real order and payment so queues and money metrics have live data
		await f.consent(f.client);
		const placedOrder = await f.order(f.client);
		const payment = await f.pay(f.client, placedOrder.id);
		assert.equal(await payment.complete(), true);

		const warehouseRows = await f.identity.sql<{ id: string }[]>`
      select id from app.warehouse where active order by id
    `;
		assert.ok(
			warehouseRows.length >= 2,
			"Expected at least 2 active warehouses in fixture",
		);
		const whA = String(warehouseRows[0].id);
		const whB = String(warehouseRows[1].id);

		// Create MFA-enrolled staff actors for warehouse, customer_service, ecommerce_admin, and finance
		const warehouseStaff = await actor(f.identity, "warehouse", [whA]);
		extraUsers.push(warehouseStaff);
		await enroll(warehouseStaff.browser, warehouseStaff.password);

		const csStaff = await actor(f.identity, "customer_service", []);
		extraUsers.push(csStaff);
		await enroll(csStaff.browser, csStaff.password);

		const ecomAdmin = await actor(f.identity, "ecommerce_admin", [whA]);
		extraUsers.push(ecomAdmin);
		await enroll(ecomAdmin.browser, ecomAdmin.password);

		const financeStaff = await actor(f.identity, "finance", []);
		extraUsers.push(financeStaff);
		await enroll(financeStaff.browser, financeStaff.password);

		// 2. Unauthenticated requests must be rejected with 401
		const unauthDash = await handleReporting(
			new Request(
				"http://127.0.0.1:3099/api/v1/admin/dashboard?workspace=owner",
			),
			f.identity,
		);
		assert.equal(unauthDash.status, 401);

		// 3. Warehouse staff scoping: allowed operational counts only, no money metrics, no cross-warehouse access
		const whDashRes = await handleReporting(
			warehouseStaff.browser.request(
				`/api/v1/admin/dashboard?workspace=warehouse_staff&warehouse_id=${whA}`,
			),
			f.identity,
		);
		assert.equal(whDashRes.status, 200);
		const whDash = await whDashRes.json();
		assert.equal(whDash.workspace, "warehouse");
		assert.deepEqual(whDash.warehouse_ids, [whA]);
		assert.ok(
			whDash.metrics.every(
				(m: { kind: string; amount: number | null }) =>
					m.kind === "count" && m.amount === null,
			),
			"Warehouse workspace must never expose whole-order money metrics",
		);

		// Cross-warehouse dashboard request by warehouse staff -> 403
		const whCrossRes = await handleReporting(
			warehouseStaff.browser.request(
				`/api/v1/admin/dashboard?workspace=warehouse&warehouse_id=${whB}`,
			),
			f.identity,
		);
		assert.equal(whCrossRes.status, 403);

		// Warehouse staff requesting finance workspace or money metric -> 403
		const whFinRes = await handleReporting(
			warehouseStaff.browser.request(
				"/api/v1/admin/dashboard?workspace=finance_staff",
			),
			f.identity,
		);
		assert.equal(whFinRes.status, 403);

		const whMoneyMetricRes = await handleReporting(
			warehouseStaff.browser.request(
				"/api/v1/admin/dashboard?workspace=warehouse&metric=net_merchandise_revenue",
			),
			f.identity,
		);
		assert.equal(whMoneyMetricRes.status, 403);

		// CS and Ecommerce Admin cannot access finance workspace or reconciliation queue
		const csFinQueueRes = await handleReporting(
			csStaff.browser.request(
				"/api/v1/admin/work-queues?workspace=customer_service&queue=reconciliation",
			),
			f.identity,
		);
		assert.equal(csFinQueueRes.status, 403);

		const ecomFinQueueRes = await handleReporting(
			ecomAdmin.browser.request(
				"/api/v1/admin/work-queues?workspace=ecommerce_admin&queue=reconciliation",
			),
			f.identity,
		);
		assert.equal(ecomFinQueueRes.status, 403);

		// 4. Finance & Owner dashboards: distinguish known cost (including 0) vs unknown missing cost source
		const [orderRow] = await f.identity.sql<{ created_at: string }[]>`
      select created_at from app.commerce_order where id = ${placedOrder.id}::uuid
    `;
		const narrowFrom = new Date(
			Date.parse(orderRow.created_at) - 2000,
		).toISOString();
		const narrowTo = new Date(
			Date.parse(orderRow.created_at) + 2000,
		).toISOString();

		const finDashRes = await handleReporting(
			financeStaff.browser.request(
				`/api/v1/admin/dashboard?workspace=finance_staff&warehouse_id=${whA}&from=${encodeURIComponent(narrowFrom)}&to=${encodeURIComponent(narrowTo)}`,
			),
			f.identity,
		);
		assert.equal(finDashRes.status, 200);
		const finDash = await finDashRes.json();
		assert.equal(finDash.workspace, "finance");

		const codMetric = finDash.metrics.find(
			(m: { key: string }) => m.key === "cod_receivable",
		);
		assert.ok(codMetric);
		assert.equal(codMetric.complete, true);
		assert.equal(
			codMetric.amount,
			0,
			"Zero COD receivable must report numeric 0, not null/unknown",
		);

		const netRevMetric = finDash.metrics.find(
			(m: { key: string }) => m.key === "net_merchandise_revenue",
		);
		assert.ok(netRevMetric);
		assert.equal(netRevMetric.complete, true);
		assert.ok(
			typeof netRevMetric.amount === "number" && netRevMetric.amount >= 99000,
		);

		const estContribKnown = finDash.metrics.find(
			(m: { key: string }) => m.key === "estimated_contribution",
		);
		assert.ok(estContribKnown);
		assert.equal(estContribKnown.complete, true);
		assert.equal(typeof estContribKnown.amount, "number");

		// Verify a window prior to cost version effective_at reports incomplete/unknown (null), never fabricated 0
		const preCostFrom = "2020-01-01T00:00:00.000Z";
		const preCostTo = "2020-01-02T00:00:00.000Z";
		const finDashIncompleteRes = await handleReporting(
			financeStaff.browser.request(
				`/api/v1/admin/dashboard?workspace=finance&warehouse_id=${whA}&from=${encodeURIComponent(preCostFrom)}&to=${encodeURIComponent(preCostTo)}`,
			),
			f.identity,
		);
		assert.equal(finDashIncompleteRes.status, 200);
		const finDashIncomplete = await finDashIncompleteRes.json();
		const estContribUnknown = finDashIncomplete.metrics.find(
			(m: { key: string }) => m.key === "estimated_contribution",
		);
		assert.ok(estContribUnknown);
		assert.equal(estContribUnknown.complete, false);
		assert.equal(estContribUnknown.amount, null);
		assert.equal(estContribUnknown.financial_basis, "unknown");

		// 5. KPI-to-queue drilldown conservation & 409 mismatch enforcement
		const ownerDashRes = await handleReporting(
			f.owner.browser.request(
				`/api/v1/admin/dashboard?workspace=owner&from=${encodeURIComponent(narrowFrom)}&to=${encodeURIComponent(narrowTo)}`,
			),
			f.identity,
		);
		assert.equal(ownerDashRes.status, 200);
		const ownerDash = await ownerDashRes.json();
		const ordersMetric = ownerDash.metrics.find(
			(m: { key: string }) => m.key === "orders_pending",
		);
		assert.ok(ordersMetric);
		assert.ok(ordersMetric.count >= 1);

		const drilldownRes = await handleReporting(
			f.owner.browser.request(
				`/api/v1/admin/work-queues?workspace=owner&queue=orders&filter_token=${encodeURIComponent(ordersMetric.queue_filter_token)}`,
			),
			f.identity,
		);
		assert.equal(drilldownRes.status, 200);
		const drilldownQueue = await drilldownRes.json();
		assert.equal(
			drilldownQueue.data.length,
			ordersMetric.count,
			"Drilldown work queue must conserve the exact count from the KPI card",
		);
		for (const row of drilldownQueue.data) {
			assert.deepEqual(
				Object.keys(row).sort(),
				[
					"due_at",
					"due_at_kind",
					"id",
					"reference",
					"resource_kind",
					"state",
					"version",
					"warehouse_id",
				],
				"Work queue rows must never leak customer contacts or whole-order money",
			);
		}
		// Rows carry the order number operators see elsewhere, and say which time due_at holds.
		const orderFacts = await f.identity.sql<
			{
				id: string;
				number: string;
				expires_at: string | null;
				created_at: string;
			}[]
		>`select id, number, expires_at, created_at from app.commerce_order where id in ${f.identity.sql(drilldownQueue.data.map((r: { id: string }) => r.id))}`;
		assert.equal(orderFacts.length, drilldownQueue.data.length);
		for (const row of drilldownQueue.data) {
			const fact = orderFacts.find((o) => o.id === row.id);
			assert.ok(fact);
			assert.equal(row.reference, fact.number);
			assert.equal(
				row.due_at_kind,
				fact.expires_at ? "payment_deadline" : "created",
			);
			assert.equal(
				row.due_at,
				new Date(fact.expires_at ?? fact.created_at).toISOString(),
			);
		}

		// Fulfillment rows: waybill (else order number) and the deadline source behind due_at.
		const fulfillmentRes = await handleReporting(
			warehouseStaff.browser.request(
				"/api/v1/admin/work-queues?workspace=warehouse&queue=fulfillments&limit=100",
			),
			f.identity,
		);
		assert.equal(fulfillmentRes.status, 200);
		const fulfillmentRows = (await fulfillmentRes.json()).data as {
			id: string;
			due_at: string | null;
			due_at_kind: string | null;
			reference: string | null;
		}[];
		if (fulfillmentRows.length) {
			const facts = await f.identity.sql<
				{
					id: string;
					reference: string;
					kind: string;
					due_at: string;
				}[]
			>`select f.id, coalesce(f.tracking_number, o.number) as reference,
				case when d.packing_due_at is not null then 'packing_deadline' when d.handover_due_at is not null then 'handover_deadline' else 'created' end as kind,
				coalesce(d.packing_due_at, d.handover_due_at, f.created_at) as due_at
				from app.fulfillment f join app.order_shipment s on s.id = f.shipment_id join app.commerce_order o on o.id = s.order_id
				left join app.fulfillment_deadline d on d.id = f.deadline_id
				where f.id in ${f.identity.sql(fulfillmentRows.map((r) => r.id))}`;
			for (const row of fulfillmentRows) {
				const fact = facts.find((x) => x.id === row.id);
				assert.ok(fact);
				assert.equal(row.reference, fact.reference);
				assert.equal(row.due_at_kind, fact.kind);
				assert.equal(row.due_at, new Date(fact.due_at).toISOString());
			}
		}

		// Using the orders drilldown token against a different queue (returns) -> 409
		const mismatchQueueRes = await handleReporting(
			f.owner.browser.request(
				`/api/v1/admin/work-queues?workspace=owner&queue=returns&filter_token=${encodeURIComponent(ordersMetric.queue_filter_token)}`,
			),
			f.identity,
		);
		assert.equal(mismatchQueueRes.status, 409);

		// Using another actor's drilldown token -> 403
		const crossActorTokenRes = await handleReporting(
			csStaff.browser.request(
				`/api/v1/admin/work-queues?workspace=customer_service&queue=orders&filter_token=${encodeURIComponent(ordersMetric.queue_filter_token)}`,
			),
			f.identity,
		);
		assert.equal(crossActorTokenRes.status, 403);

		// 6. Bounded Bulk Selection Preview & CSV Export + Stale Version Rejection + Formula Sanitization
		const currentOrderVersion =
			drilldownQueue.data.find((r: { id: string }) => r.id === placedOrder.id)
				?.version ?? 2;
		const freezeRes = await handleReporting(
			f.owner.browser.request("/api/v1/admin/export-selections", {
				resource: "orders",
				warehouse_id: null,
				from: ownerDash.from,
				to: ownerDash.to,
				statuses: [],
				max_rows: 100,
				items: [{ id: placedOrder.id, expected_version: currentOrderVersion }],
			}),
			f.identity,
		);
		assert.equal(freezeRes.status, 201);
		const frozen = await freezeRes.json();
		assert.equal(frozen.row_count, 1);
		assert.equal(frozen.filter_version, 1);

		// Stale expected_version in bulk preview -> 409
		const staleFreezeRes = await handleReporting(
			f.owner.browser.request("/api/v1/admin/export-selections", {
				resource: "orders",
				warehouse_id: null,
				from: ownerDash.from,
				to: ownerDash.to,
				statuses: [],
				max_rows: 100,
				items: [{ id: placedOrder.id, expected_version: 999 }],
			}),
			f.identity,
		);
		assert.equal(staleFreezeRes.status, 409);

		// Warehouse staff forbidden from exporting orders / finance_reconciliation -> 403
		const whForbiddenExport = await handleReporting(
			warehouseStaff.browser.request("/api/v1/admin/exports", {
				resource: "orders",
				column_set: "order_service",
				reason: "Percobaan ekspor pesanan utuh oleh gudang",
				selection: {
					mode: "explicit_page",
					resource_ids: [placedOrder.id],
				},
			}),
			f.identity,
		);
		assert.equal(whForbiddenExport.status, 403);

		// Valid CSV export using frozen selection
		const csvRes = await handleReporting(
			f.owner.browser.request("/api/v1/admin/exports", {
				resource: "orders",
				column_set: "order_service",
				reason: "=SUM(1,1) Audit ekspor pesanan pemilik",
				selection: {
					mode: "filtered_snapshot",
					filter_token: frozen.filter_token,
					filter_version: frozen.filter_version,
				},
			}),
			f.identity,
		);
		assert.equal(csvRes.status, 200);
		assert.equal(csvRes.headers.get("cache-control"), "no-store");
		assert.ok(csvRes.headers.get("content-type")?.startsWith("text/csv"));
		const csvBody = await csvRes.text();
		assert.ok(csvBody.includes(placedOrder.id));
		assert.ok(csvBody.includes("amount_idr"));

		// Verify formula-injection sanitization helper on all dangerous prefixes
		assert.equal(sanitizeCsvCell("=cmd|' /C calc'!A0"), "'=cmd|' /C calc'!A0");
		assert.equal(sanitizeCsvCell("+SUM(A1:A2)"), "'+SUM(A1:A2)");
		assert.equal(sanitizeCsvCell("-10+20"), "'-10+20");
		assert.equal(sanitizeCsvCell("@IMPORTXML(A1,B1)"), '"\'@IMPORTXML(A1,B1)"');
		assert.equal(sanitizeCsvCell("\tmalicious"), "'\tmalicious");

		// 7. Operation Recovery Endpoint (/api/v1/operations/{operationId})
		const opRes = await handleReporting(
			f.owner.browser.request(`/api/v1/operations/${payment.job}`),
			f.identity,
			payment.job,
		);
		assert.equal(opRes.status, 200);
		const opPayload = await opRes.json();
		assert.equal(opPayload.id, payment.job);
		assert.equal(opPayload.status, "succeeded");

		const unknownOpRes = await handleReporting(
			f.owner.browser.request(`/api/v1/operations/${randomUUID()}`),
			f.identity,
		);
		assert.equal(unknownOpRes.status, 404);
	} finally {
		await f.identity
			.sql`delete from app.admin_export_selection where actor_id = ${f.owner.id}`;
		await cleanup(f.identity, extraUsers);
		await f.close();
	}
});
