import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { handleShippingLabels } from "../../src/modules/documents/labels.ts";
import {
	ingestWaybillEvent,
	simulateWaybillIssue,
} from "../../src/modules/fulfillment/local.ts";
import { handleCommerceExceptions } from "../../src/modules/checkout/exceptions/routes.ts";
import { handlePicklists } from "../../src/modules/fulfillment/picklist.ts";
import { actor, enroll } from "../contract/access-fixture.ts";
import {
	closeFulfillmentActor,
	fulfillmentFixture,
} from "./fulfillment-fixture.ts";

// S161: "Label sudah dicetak" marker with reason-gated reprint, and the cross-order picklist.
test("S161 warehouse flow: printed marker, reprint reason, picklist sums and warehouse scope", async () => {
	const f = await fulfillmentFixture("cod");
	const sql = f.identity.sql;
	const [parcelA, parcelB] = f.parcels;
	assert.ok(parcelA && parcelB);
	assert.notEqual(String(parcelA.warehouse_id), String(parcelB.warehouse_id));
	const both = await actor(f.identity, "warehouse", [
		String(parcelA.warehouse_id),
		String(parcelB.warehouse_id),
	]);
	await enroll(both.browser, both.password);
	const onlyA = await actor(f.identity, "warehouse", [
		String(parcelA.warehouse_id),
	]);
	await enroll(onlyA.browser, onlyA.password);
	const finance = await actor(f.identity, "finance", []);
	await enroll(finance.browser, finance.password);
	try {
		const labels = async (
			user: typeof both,
			path: string,
			body?: Record<string, unknown>,
		) => {
			const req = user.browser.request(path, body);
			if (body !== undefined) req.headers.set("idempotency-key", randomUUID());
			const res = await handleShippingLabels(req, f.identity);
			return { status: res.status, payload: await res.json() };
		};
		const queueRow = async (shipmentId: string) => {
			const page = await labels(both, "/api/v1/admin/label-queue?limit=100");
			assert.equal(page.status, 200);
			const row = (
				page.payload.data as {
					shipment_id: string;
					label_printed_at: string | null;
					label_printed_artifact_id: string | null;
				}[]
			).find((r) => r.shipment_id === shipmentId);
			assert.ok(row, "parcel is in the queue");
			return row;
		};

		// Label for parcel A (waybill first), none for B.
		const booking = await f.book(parcelA);
		await f.run(booking.creation_job_id);
		for (const callback of await sql`
			select callback_job_id from app.waybill_provider_event where booking_id = ${booking.id}`)
			await f.run(callback.callback_job_id);
		await f.run(
			await ingestWaybillEvent(
				sql,
				await simulateWaybillIssue(sql, "test", booking.id),
			),
		);
		const job = await labels(
			both,
			`/api/v1/admin/shipments/${parcelA.shipment_id}/label-jobs`,
			{ format: "thermal_100x150" },
		);
		assert.equal(job.status, 202);
		const artifactId = job.payload.artifact_id as string;
		const printPath = `/api/v1/admin/shipments/${parcelA.shipment_id}/print-attempts`;

		// Generated but not printed: no marker. A failed attempt does not count as printed.
		assert.equal((await queueRow(String(parcelA.shipment_id))).label_printed_at, null);
		const failed = await labels(both, printPath, {
			artifact_id: artifactId,
			kind: "initial_print",
			outcome: "failed",
		});
		assert.equal(failed.status, 201);
		assert.equal((await queueRow(String(parcelA.shipment_id))).label_printed_at, null);

		// A completed print sets the marker on A only.
		const printed = await labels(both, printPath, {
			artifact_id: artifactId,
			kind: "initial_print",
			outcome: "completed",
		});
		assert.equal(printed.status, 201);
		assert.notEqual((await queueRow(String(parcelA.shipment_id))).label_printed_at, null);
		assert.equal((await queueRow(String(parcelA.shipment_id))).label_printed_artifact_id, artifactId);
		assert.equal((await queueRow(String(parcelB.shipment_id))).label_printed_at, null);
		assert.equal((await queueRow(String(parcelB.shipment_id))).label_printed_artifact_id, null);

		// Printing twice is refused; a reprint needs a reason and keeps it in the history.
		const again = await labels(both, printPath, {
			artifact_id: artifactId,
			kind: "initial_print",
			outcome: "completed",
		});
		assert.equal(again.status, 409);
		assert.equal(again.payload.code, "INITIAL_PRINT_ALREADY_COMPLETED");
		const noReason = await labels(both, printPath, {
			artifact_id: artifactId,
			kind: "reprint",
			outcome: "completed",
		});
		assert.equal(noReason.status, 422);
		assert.equal(noReason.payload.code, "REPRINT_REASON_REQUIRED");
		const reprint = await labels(both, printPath, {
			artifact_id: artifactId,
			kind: "reprint",
			outcome: "completed",
			reason: "Kertas macet saat mencetak",
		});
		assert.equal(reprint.status, 201);
		const [stored] = await sql`
			select reason from app.shipping_print_attempt
			where shipment_id = ${parcelA.shipment_id} and kind = 'reprint'`;
		assert.equal(stored?.reason, "Kertas macet saat mencetak");

		// Picklist: sums equal the stored allocations, grouped per warehouse.
		const picklist = async (user: typeof both, ids: unknown[]) => {
			const query = ids.map((id) => `shipment_id=${id}`).join("&");
			const res = await handlePicklists(
				user.browser.request(`/api/v1/admin/picklists?${query}`),
				f.identity,
			);
			return { status: res.status, payload: await res.json() };
		};
		const ids = [parcelA.shipment_id, parcelB.shipment_id];
		const expected = await sql<{ warehouse_id: string; stock_item_id: string; quantity: number }[]>`
			select s.warehouse_id, a.stock_item_id, sum(a.quantity)::int quantity
			from app.fulfillment_component_allocation a
			join app.fulfillment_item fi on fi.id = a.fulfillment_item_id
			join app.order_shipment s on s.id = fi.shipment_id
			where s.id in ${sql(ids.map(String))}
			group by s.warehouse_id, a.stock_item_id`;
		assert.ok(expected.length > 0);
		const all = await picklist(both, ids);
		assert.equal(all.status, 200);
		assert.deepEqual(all.payload.skipped_shipment_ids, []);
		assert.equal(all.payload.warehouses.length, 2);
		const flat = (all.payload.warehouses as {
			warehouse_id: string;
			items: { stock_item_id: string; quantity: number }[];
		}[]).flatMap((w) =>
			w.items.map((i) => `${w.warehouse_id}:${i.stock_item_id}:${i.quantity}`),
		);
		assert.deepEqual(
			flat.sort(),
			expected
				.map((e) => `${e.warehouse_id}:${e.stock_item_id}:${e.quantity}`)
				.sort(),
		);

		// Scope: a warehouse actor sees only its own warehouse; others answer 404/403.
		assert.equal((await picklist(onlyA, ids)).status, 404);
		const own = await picklist(onlyA, [parcelA.shipment_id]);
		assert.equal(own.status, 200);
		assert.deepEqual(
			own.payload.warehouses.map((w: { warehouse_id: string }) => w.warehouse_id),
			[String(parcelA.warehouse_id)],
		);
		assert.equal((await picklist(finance, ids)).status, 403);
		assert.equal((await picklist(both, [randomUUID()])).status, 404);
		assert.equal((await picklist(both, [])).status, 400);
		assert.equal((await picklist(both, ["not-a-uuid"])).status, 400);
	} finally {
		for (const user of [both, onlyA, finance])
			await closeFulfillmentActor(f.identity, user);
		await f.close();
	}
});

// fulfillment_item is one physical unit: a cancelled unit leaves the picklist, its siblings stay.
test("S161 picklist subtracts exactly the cancelled unit of a multi-unit parcel", { timeout: 300000 }, async () => {
	const f = await fulfillmentFixture("cod");
	const sql = f.identity.sql;
	try {
		const units = await sql`
			select fi.shipment_id, count(*)::int n from app.fulfillment_item fi
			join app.order_shipment s on s.id = fi.shipment_id
			where s.order_id = ${f.order.id} group by 1`;
		const parcel = f.parcels.find((p) =>
			units.some((u) => u.shipment_id === p.shipment_id && u.n >= 2),
		);
		assert.ok(parcel, "a parcel with at least two units");
		const [unit] = await sql`
			select id from app.fulfillment_item where shipment_id = ${parcel.shipment_id} order by id limit 1`;
		const read = async () => {
			const res = await handlePicklists(
				f.owner.browser.request(`/api/v1/admin/picklists?shipment_id=${parcel.shipment_id}`),
				f.identity,
			);
			assert.equal(res.status, 200);
			const payload = (await res.json()) as {
				warehouses: { items: { stock_item_id: string; quantity: number }[] }[];
			};
			return new Map(
				payload.warehouses.flatMap((w) => w.items).map((i) => [i.stock_item_id, i.quantity]),
			);
		};
		const sums = async (skipUnit: boolean) =>
			new Map(
				(
					await sql<{ stock_item_id: string; quantity: number }[]>`
						select a.stock_item_id, sum(a.quantity)::int quantity
						from app.fulfillment_component_allocation a join app.fulfillment_item fi on fi.id = a.fulfillment_item_id
						where fi.shipment_id = ${parcel.shipment_id} and (${!skipUnit} or fi.id <> ${unit.id})
						group by a.stock_item_id`
				).map((r) => [String(r.stock_item_id), r.quantity]),
			);
		const before = await read();
		assert.deepEqual(before, await sums(false));
		const balances = await sql`
			select distinct a.balance_id, a.stock_item_id, b.revision from app.fulfillment_component_allocation a
			join app.inventory_balance b on b.id = a.balance_id where a.fulfillment_item_id = ${unit.id} order by a.balance_id`;
		const exceptions = async (
			user: { request: (path: string, body?: Record<string, unknown>) => Request },
			path: string,
			body: Record<string, unknown>,
		) => {
			const request = user.request(path, body);
			request.headers.set("idempotency-key", randomUUID());
			const response = await handleCommerceExceptions(request, f.identity);
			const payload = await response.json();
			assert.equal(response.status, 201, `${path} ${JSON.stringify(payload)}`);
			return payload;
		};
		const reported = await exceptions(f.owner.browser, "/api/v1/admin/commerce-exceptions", {
			fulfillment_id: parcel.id,
			fulfillment_item_ids: [unit.id],
			expected_version: parcel.revision,
			reason: "SYNTHETIC one unit short",
			observed_components: balances.map((b, index) => ({
				balance_id: b.balance_id,
				stock_item_id: b.stock_item_id,
				expected_balance_version: Number(b.revision),
				missing_quantity: index === 0 ? 1 : 0,
			})),
		});
		const proposed = await exceptions(
			f.owner.browser,
			`/api/v1/admin/commerce-exceptions/${reported.id}/decisions`,
			{ expected_version: reported.version, decision: "propose_cancellation", reason: "SYNTHETIC cancel the short unit" },
		);
		const accepted = await exceptions(f.client, `/api/v1/orders/${f.order.id}/recovery-actions`, {
			exception_id: reported.id,
			expected_version: proposed.version,
			action: "accept_proposal",
			proposal_id: proposed.proposal.id,
		});
		await exceptions(f.owner.browser, `/api/v1/admin/commerce-exceptions/${reported.id}/decisions`, {
			expected_version: accepted.version,
			proposal_id: proposed.proposal.id,
			reason: "SYNTHETIC apply accepted cancellation",
		});
		const after = await read();
		assert.deepEqual(after, await sums(true));
		// Siblings stay: the total drops by the cancelled unit's own components, not by the whole item.
		const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
		assert.ok(sum(after) < sum(before) && sum(after) > 0);
	} finally {
		await f.close();
	}
});
