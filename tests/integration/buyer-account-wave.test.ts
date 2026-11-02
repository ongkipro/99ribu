import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { type AccountOrder, sentParcels } from "../../src/modules/accounts/order-summary.ts";
import { challengeVerificationCode, handleAccounts, readBuyerAccountWorkspace } from "../../src/modules/accounts/service.ts";
import { commerceActor } from "../../src/modules/checkout/access.ts";
import type { OrderReceipt } from "../../src/modules/orders/receipt.ts";
import { createReturn } from "../../src/modules/returns/cases.ts";
import { ingestParcelReceiptSource, simulateParcelReceipt } from "../../src/modules/returns/receipt-source.ts";
import { handleReturns } from "../../src/modules/returns/routes.ts";
import { actor } from "../contract/access-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { returnFixture } from "./return-fixture.ts";

// S157 buyer account wave. Pure helper first (no database), then one database-backed journey.

test("sentParcels lists only original parcels already handed to a courier, with a null resi when none exists", () => {
	const shipments = [
		{ kind: "original", status: "handed_over", courier_name: "Kurir A", tracking_number: "RESI-A" },
		{ kind: "original", status: "in_transit", courier_name: "Kurir B", tracking_number: null },
		{ kind: "original", status: "packed", courier_name: "Kurir C", tracking_number: "RESI-C" },
		{ kind: "original", status: "cancelled", courier_name: "Kurir D", tracking_number: "RESI-D" },
		{ kind: "replacement", status: "handed_over", courier_name: "Kurir E", tracking_number: "RESI-E" },
	];
	const parcels: AccountOrder["parcels"] = sentParcels({ shipments } as unknown as OrderReceipt["order"]);
	assert.deepEqual(parcels, [
		{ courier_name: "Kurir A", tracking_number: "RESI-A" },
		{ courier_name: "Kurir B", tracking_number: null },
	]);
});

test("S157 integration: returns, orders, resi and addresses stay with their owner; a deletion request opens one case and deletes nothing", async () => {
	const f = await returnFixture("cod");
	const identity = f.identity;
	const sql = identity.sql;
	const buyerA = await actor(identity, "buyer", []);
	const buyerB = await actor(identity, "buyer", []);
	const call = async (who: typeof buyerA, path: string, body?: Record<string, unknown>, key = randomUUID()) => {
		const req = who.browser.request(path, body);
		if (body !== undefined) req.headers.set("idempotency-key", key);
		const res = await handleAccounts(req, identity);
		return { status: res.status, payload: await res.json() };
	};

	try {
		await call(buyerA, "/api/v1/me/profile");
		await call(buyerB, "/api/v1/me/profile");
		// Buyer A claims the guest order through the existing contact challenge; buyer B never does.
		const [quote] = await sql<{ phone: string }[]>`
			select q.document->'contact'->>'phone' as phone from app.commerce_order o join app.checkout_quote q on q.id = o.quote_id where o.id = ${f.order.id}`;
		const challenge = await call(buyerA, "/api/v1/me/guest-order-link-challenges", { order_id: f.order.id, contact: quote.phone });
		assert.equal(challenge.status, 201);
		const linked = await call(buyerA, `/api/v1/me/guest-order-link-challenges/${challenge.payload.challenge_id}/verifications`, {
			code: await challengeVerificationCode(identity, challenge.payload.challenge_id),
		});
		assert.equal(linked.status, 201);

		// Resi and courier: the owner sees every handed-over parcel; the other buyer sees no such order.
		const mine = await readBuyerAccountWorkspace(buyerA.browser.request("/akun/pesanan"), identity, { orders: true });
		assert.ok(mine.authenticated);
		const shipped = mine.orders.find((order) => order.id === f.order.id);
		assert.equal(shipped?.stage, "shipped");
		assert.equal(shipped?.parcels?.length, f.parcels.length, "one entry per handed-over parcel");
		assert.ok(shipped.parcels.every((p) => p.courier_name.length > 0 && p.tracking_number), "courier name and resi are present for the owner");
		const resi = shipped.parcels[0].tracking_number as string;
		const theirs = await readBuyerAccountWorkspace(buyerB.browser.request("/akun/pesanan"), identity, { orders: true });
		assert.ok(theirs.authenticated);
		assert.ok(!theirs.orders.some((order) => order.id === f.order.id), "an unclaimed guest order is not in another account");
		assert.ok(!JSON.stringify(theirs).includes(resi), "no resi leaks to the other buyer");
		assert.ok(!(await call(buyerB, "/api/v1/me/orders")).payload.data.some((order: { id: string }) => order.id === f.order.id));

		// A return on that order lists for A only, with the buyer projection and no staff fields.
		for (const booking of f.bookings) {
			const parcel = f.parcels.find((p) => p.id === booking.fulfillment_id);
			assert.ok(parcel);
			const source = await simulateParcelReceipt(sql, "test", { reference: randomUUID(), booking_id: booking.id, unit_ids: f.units.filter((u) => u.shipment_id === parcel.shipment_id).map((u) => u.id) });
			await f.run(await ingestParcelReceiptSource(sql, source));
		}
		const makeReturn = async (unit: (typeof f.units)[number]) => {
		const claim = { items: [{ order_item_id: unit.order_item_id, delivered_fulfillment_item_id: unit.id, quantity: 1, reason: "damaged", details: "Kemasan rusak saat diterima" }], requested_resolution: "refund" };
		const created = (await createReturn(f.client.request(`/api/v1/orders/${f.order.id}/returns`, claim, { key: randomUUID() }), identity, await commerceActor(f.client.request("/api/v1/carts"), identity), f.order.id, claim)) as { id: string };
			return created;
		};
		const created = await makeReturn(f.units[0]);
		const secondReturn = await makeReturn(f.units[1]);
		// DEC-016: while the guest-order link is not verified the cases on that order are not buyer A's.
		const challengeStatus = (status: string) => sql`update app.buyer_identity_challenge set status = ${status} where user_id = ${buyerA.id} and kind = 'guest_order_link' and order_id = ${f.order.id}`;
		await challengeStatus("pending");
		assert.deepEqual((await call(buyerA, "/api/v1/me/returns")).payload.data, [], "an unverified link exposes no return");
		await challengeStatus("verified");

		const aReturns = await call(buyerA, "/api/v1/me/returns");
		assert.equal(aReturns.status, 200);
		assert.deepEqual(new Set(aReturns.payload.data.map((row: { id: string }) => row.id)), new Set([created.id, secondReturn.id]), "after verification both cases are listed");
		const row = aReturns.payload.data.find((r: { id: string }) => r.id === created.id);
		assert.equal(row.order_id, f.order.id);
		assert.ok(row.order_number && row.product_names.length > 0);
		for (const staffOnly of ["admin_no", "warehouse_id", "can_decide", "can_inspect", "events", "evidence"])assert.ok(!(staffOnly in row), `${staffOnly} is staff-only`);
		assert.deepEqual((await call(buyerB, "/api/v1/me/returns")).payload.data, [], "buyer B reads no return of buyer A");
		assert.ok((await call(buyerA, "/api/v1/me/returns?limit=0")).status >= 400);
		// Paging: limit 1 walks both cases once, newest first, with no repeat and a closed last page.
		const pageOne = await call(buyerA, "/api/v1/me/returns?limit=1");
		assert.equal(pageOne.payload.data.length, 1);
		assert.ok(pageOne.payload.pagination.next_cursor);
		const pageTwo = await call(buyerA, `/api/v1/me/returns?limit=1&cursor=${pageOne.payload.pagination.next_cursor}`);
		assert.equal(pageTwo.payload.data.length, 1);
		assert.equal(pageTwo.payload.pagination.next_cursor, null);
		assert.notEqual(pageOne.payload.data[0].id, pageTwo.payload.data[0].id);
		assert.deepEqual(new Set([pageOne.payload.data[0].id, pageTwo.payload.data[0].id]), new Set([created.id, secondReturn.id]));
		// Buyer B cannot probe with A's return id: the same 400 as an unknown id, and nothing of A in the body.
		const probe = await call(buyerB, `/api/v1/me/returns?cursor=${created.id}`);
		const unknown = await call(buyerB, `/api/v1/me/returns?cursor=${randomUUID()}`);
		assert.equal(probe.status, 400);
		assert.deepEqual({ ...probe.payload, request_id: null }, { ...unknown.payload, request_id: null });
		assert.ok(!JSON.stringify(probe.payload).includes(created.id) && !JSON.stringify(probe.payload).includes(row.order_number));
		assert.equal((await call(buyerA, "/api/v1/me/returns", {})).status, 404, "read only");
		// The per-order endpoint still refuses the buyer who never claimed the order.
		const foreign = await handleReturns(buyerB.browser.request(`/api/v1/orders/${f.order.id}/returns`), identity);
		assert.notEqual(foreign.status, 200);

		// Addresses: B can neither read, change, delete nor make default an address of A.
		const address = { recipient_name: "Penerima Uji", phone: "081234567890", street: "Jl. Contoh No. 1", district: "Klojen", city: "Malang", province: "Jawa Timur", postcode: "65111" };
		const added = await call(buyerA, "/api/v1/me/addresses", { address, make_default: true, expected_book_version: 0 });
		assert.equal(added.status, 201);
		const addressId = added.payload.id as string;
		assert.deepEqual((await call(buyerB, "/api/v1/me/addresses")).payload.data, []);
		assert.equal((await call(buyerB, `/api/v1/me/addresses/${addressId}`)).status, 404);
		assert.equal((await call(buyerB, `/api/v1/me/addresses/${addressId}`, { expected_version: 1, address: { ...address, street: "Diubah B" } })).status, 404);
		assert.equal((await call(buyerB, `/api/v1/me/addresses/${addressId}/deletions`, { expected_version: 1, expected_book_version: 0, replacement_default_id: null })).status >= 400, true);
		assert.ok((await call(buyerB, "/api/v1/me/address-default", { expected_book_version: 0, address_id: addressId })).status >= 400);
		const [still] = await sql<{ street: string; deleted_at: string | null }[]>`select street, deleted_at from app.buyer_address where id = ${addressId}`;
		assert.deepEqual({ ...still }, { street: "Jl. Contoh No. 1", deleted_at: null });

		// Deletion request: one support case for A, repeated requests converge, nothing is deleted.
		const stored = async () => ({
			addresses: Number((await sql`select count(*)::int as n from app.buyer_address where user_id = ${buyerA.id} and deleted_at is null`)[0].n),
			profiles: Number((await sql`select count(*)::int as n from app.buyer_profile where user_id = ${buyerA.id}`)[0].n),
		});
		const before = await stored();
		assert.equal(before.addresses, 1);
		assert.equal((await handleAccounts(new Request("http://127.0.0.1:3099/api/v1/me/data-requests", { method: "POST", headers: { origin: "http://127.0.0.1:3099", "content-type": "application/json", "idempotency-key": randomUUID() }, body: "{}" }), identity)).status, 401);
		const first = await call(buyerA, "/api/v1/me/data-requests", {});
		const second = await call(buyerA, "/api/v1/me/data-requests", {});
		assert.equal(first.status, 201, JSON.stringify(first.payload));
		assert.equal(second.status, 200, "a replay is not a creation");
		assert.equal(first.payload.conversation_id, second.payload.conversation_id);
		assert.equal(Number((await sql`select count(*)::int n from app.support_conversation where buyer_user_id = ${buyerA.id}`)[0].n), 1);
		const messages = await sql<{ body: string }[]>`select body from app.support_message where conversation_id = ${first.payload.conversation_id}`;
		assert.equal(messages.length, 1);
		assert.match(messages[0].body, /penghapusan akun/i);
		assert.equal(Number((await sql`select count(*)::int n from app.support_conversation where buyer_user_id = ${buyerB.id}`)[0].n), 0);
		// lazy: after staff resolve the conversation a later request still returns the same one, no second case.
		await sql`update app.support_conversation set status = 'resolved' where id = ${first.payload.conversation_id}`;
		const later = await call(buyerA, "/api/v1/me/data-requests", {});
		assert.equal(later.status, 200);
		assert.equal(later.payload.conversation_id, first.payload.conversation_id);
		assert.equal(Number((await sql`select count(*)::int n from app.support_conversation where buyer_user_id = ${buyerA.id}`)[0].n), 1);
		assert.equal(Number((await sql`select count(*)::int n from app.support_message where conversation_id = ${first.payload.conversation_id}`)[0].n), 1);
		assert.deepEqual(await stored(), before, "a request deletes nothing");
		assert.equal(Number((await sql`select count(*)::int n from app.auth_user where id = ${buyerA.id}`)[0].n), 1);
		assert.equal((await call(buyerA, "/api/v1/me/data-requests", { everything: true })).status >= 400, true, "unknown fields are refused");
	} finally {
		await closeFulfillmentActor(identity, buyerA);
		await closeFulfillmentActor(identity, buyerB);
		await f.close();
	}
});
