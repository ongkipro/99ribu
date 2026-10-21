import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
	challengeVerificationCode,
	createBuyerNotification,
	handleAccounts,
} from "../../src/modules/accounts/service.ts";
import { commerceActor } from "../../src/modules/checkout/access.ts";
import { handleOrderReceipt } from "../../src/modules/orders/receipt.ts";
import { createReturn } from "../../src/modules/returns/cases.ts";
import {
	ingestParcelReceiptSource,
	simulateParcelReceipt,
} from "../../src/modules/returns/receipt-source.ts";
import { actor } from "../contract/access-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { returnFixture } from "./return-fixture.ts";

test("S46-S48 integration: buyer profile mononym & no-email support, address book default invariants & snapshot isolation, contact/guest-order challenges, notifications, session termination, and return evidence", async () => {
	const f = await returnFixture("cod");
	const identity = f.identity;
	const sql = identity.sql;
	const buyerUser = await actor(identity, "buyer", []);
	const secondSession = await actor(identity, "buyer", []);

	try {
		const callBuyer = async (
			path: string,
			body?: Record<string, unknown>,
			key = randomUUID(),
		) => {
			const req = buyerUser.browser.request(path, body);
			if (body !== undefined) req.headers.set("idempotency-key", key);
			const res = await handleAccounts(req, identity);
			return {
				status: res.status,
				headers: res.headers,
				payload: await res.json(),
			};
		};

		// 1. Profile read + mononym update + optional no-email update + version conflict
		const initialProfile = await callBuyer("/api/v1/me/profile");
		assert.equal(initialProfile.status, 200);
		assert.equal(initialProfile.payload.version, 1);

		const mononymProfile = await callBuyer("/api/v1/me/profile", {
			expected_version: 1,
			display_name: "Sukarno",
		});
		assert.equal(mononymProfile.status, 201);
		assert.equal(mononymProfile.payload.display_name, "Sukarno");
		assert.equal(mononymProfile.payload.version, 2);

		const noEmailProfile = await callBuyer("/api/v1/me/profile", {
			expected_version: 2,
			display_name: "Sukarno",
			email: null,
		});
		assert.equal(noEmailProfile.status, 201);
		assert.equal(noEmailProfile.payload.email, null);
		assert.equal(noEmailProfile.payload.email_verified, false);
		assert.equal(noEmailProfile.payload.version, 3);

		const staleProfile = await callBuyer("/api/v1/me/profile", {
			expected_version: 1,
			display_name: "Stale",
		});
		assert.equal(staleProfile.status, 409);
		assert.equal(staleProfile.payload.code, "PROFILE_VERSION_CONFLICT");

		// 2. Contact-change challenge & verification (phone)
		const phoneChallenge = await callBuyer(
			"/api/v1/me/contact-change-challenges",
			{
				channel: "phone",
				new_value: "081234567890",
			},
		);
		assert.equal(phoneChallenge.status, 201);
		const phoneChallengeId = phoneChallenge.payload.challenge_id as string;

		const wrongOtp = await callBuyer(
			`/api/v1/me/contact-change-challenges/${phoneChallengeId}/verifications`,
			{
				code: "000000",
				expected_version: 3,
			},
		);
		assert.equal(wrongOtp.status, 403);

		const validPhoneOtp = await challengeVerificationCode(
			identity,
			phoneChallengeId,
		);
		const verifiedPhone = await callBuyer(
			`/api/v1/me/contact-change-challenges/${phoneChallengeId}/verifications`,
			{
				code: validPhoneOtp,
				expected_version: 3,
			},
		);
		assert.equal(verifiedPhone.status, 201);
		assert.equal(verifiedPhone.payload.phone, "+6281234567890");
		assert.equal(verifiedPhone.payload.phone_verified, true);
		assert.equal(verifiedPhone.payload.version, 4);

		// 3. Address book CRUD + default invariants + historical order snapshot immutability
		const emptyBook = await callBuyer("/api/v1/me/addresses");
		assert.equal(emptyBook.status, 200);
		assert.equal(emptyBook.payload.data.length, 0);
		assert.equal(emptyBook.payload.book_version, 0);

		const addr1 = await callBuyer("/api/v1/me/addresses", {
			expected_book_version: 0,
			address: {
				label: "Rumah",
				recipient_name: "Sukarno",
				phone: "081234567890",
				street: "Jl. Pegangsaan Timur No. 56",
				district: "Menteng",
				subdistrict: "Pegangsaan",
				city: "Jakarta Pusat",
				province: "DKI Jakarta",
				postcode: "10320",
			},
		});
		assert.equal(addr1.status, 201);
		assert.equal(
			addr1.payload.is_default,
			true,
			"First address automatically becomes default",
		);
		const addr1Id = addr1.payload.id as string;

		const addr2 = await callBuyer("/api/v1/me/addresses", {
			expected_book_version: 1,
			make_default: false,
			address: {
				label: "Kantor",
				recipient_name: "Sukarno",
				phone: "+6281298765432",
				street: "Jl. Medan Merdeka Utara No. 1",
				district: "Gambir",
				city: "Jakarta Pusat",
				province: "DKI Jakarta",
				postcode: "10110",
			},
		});
		assert.equal(addr2.status, 201);
		assert.equal(addr2.payload.is_default, false);
		const addr2Id = addr2.payload.id as string;

		// Deleting default address without replacement when another address exists must fail with 409
		const badDelete = await callBuyer(
			`/api/v1/me/addresses/${addr1Id}/deletions`,
			{
				expected_version: 1,
				expected_book_version: 2,
			},
		);
		assert.equal(badDelete.status, 409);
		assert.equal(badDelete.payload.code, "DEFAULT_REPLACEMENT_REQUIRED");

		// Update addr2
		const updatedAddr2 = await callBuyer(`/api/v1/me/addresses/${addr2Id}`, {
			expected_version: 1,
			address: {
				label: "Kantor Utama",
				recipient_name: "Sukarno",
				phone: "+6281298765432",
				street: "Jl. Medan Merdeka Utara No. 2",
				district: "Gambir",
				city: "Jakarta Pusat",
				province: "DKI Jakarta",
				postcode: "10110",
			},
		});
		assert.equal(updatedAddr2.status, 201);
		assert.equal(updatedAddr2.payload.version, 2);

		// Delete default addr1 with replacement_default_id = addr2Id
		const goodDelete = await callBuyer(
			`/api/v1/me/addresses/${addr1Id}/deletions`,
			{
				expected_version: 1,
				expected_book_version: 3,
				replacement_default_id: addr2Id,
			},
		);
		assert.equal(goodDelete.status, 201);
		assert.equal(goodDelete.payload.status, "deleted");

		const afterDeleteBook = await callBuyer("/api/v1/me/addresses");
		assert.equal(afterDeleteBook.status, 200);
		assert.equal(afterDeleteBook.payload.data.length, 1);
		assert.equal(afterDeleteBook.payload.data[0].id, addr2Id);
		assert.equal(afterDeleteBook.payload.data[0].is_default, true);

		// 4. Guest order linking + order history continuity + snapshot immutability
		const [quoteDoc] = await sql<{ phone: string; address_line: string }[]>`
			select
				q.document->'contact'->>'phone' as phone,
				q.document->'address'->>'address_line' as address_line
			from app.commerce_order o
			join app.checkout_quote q on q.id = o.quote_id
			where o.id = ${f.order.id}
		`;
		assert.ok(quoteDoc?.phone);

		const mismatchLink = await callBuyer(
			"/api/v1/me/guest-order-link-challenges",
			{
				order_id: f.order.id,
				contact: "+6281999999999",
			},
		);
		assert.equal(mismatchLink.status, 403);
		assert.equal(mismatchLink.payload.code, "ORDER_CONTACT_MISMATCH");

		const linkChallenge = await callBuyer(
			"/api/v1/me/guest-order-link-challenges",
			{
				order_id: f.order.id,
				contact: quoteDoc.phone,
			},
		);
		assert.equal(linkChallenge.status, 201);
		const linkChallengeId = linkChallenge.payload.challenge_id as string;
		const linkOtp = await challengeVerificationCode(identity, linkChallengeId);

		const linkedAck = await callBuyer(
			`/api/v1/me/guest-order-link-challenges/${linkChallengeId}/verifications`,
			{
				code: linkOtp,
			},
		);
		assert.equal(linkedAck.status, 201);
		assert.equal(linkedAck.payload.id, f.order.id);
		assert.equal(linkedAck.payload.status, "linked");

		const buyerOrders = await callBuyer("/api/v1/me/orders");
		assert.equal(buyerOrders.status, 200);
		assert.ok(
			buyerOrders.payload.data.some((o: { id: string }) => o.id === f.order.id),
			"Linked guest order appears in /api/v1/me/orders",
		);

		// Receipt via authenticated linked buyer preserves frozen checkout address snapshot
		const receiptRes = await handleOrderReceipt(
			buyerUser.browser.request(`/api/v1/orders/${f.order.id}/receipt`),
			identity,
		);
		assert.equal(receiptRes.status, 200);
		const receiptBody = await receiptRes.json();
		assert.equal(receiptBody.order.id, f.order.id);
		assert.equal(
			receiptBody.ship_to.address_line,
			quoteDoc.address_line,
			"Historical order shipping snapshot is unaffected by buyer address book edits",
		);

		// 5. Public guest-order-access challenge & verification without an account
		const guestChallengeReq = new Request(
			"http://127.0.0.1:3099/api/v1/guest-order-access/challenges",
			{
				method: "POST",
				headers: {
					origin: "http://127.0.0.1:3099",
					"content-type": "application/json",
					"idempotency-key": randomUUID(),
				},
				body: JSON.stringify({
					order_id: f.order.id,
					contact: quoteDoc.phone,
				}),
			},
		);
		const guestChallengeRes = await handleAccounts(guestChallengeReq, identity);
		assert.equal(guestChallengeRes.status, 202);
		const guestChallengeData = await guestChallengeRes.json();
		const guestOtp = await challengeVerificationCode(
			identity,
			guestChallengeData.challenge_id,
		);

		const guestVerifyReq = new Request(
			"http://127.0.0.1:3099/api/v1/guest-order-access/verifications",
			{
				method: "POST",
				headers: {
					origin: "http://127.0.0.1:3099",
					"content-type": "application/json",
					"idempotency-key": randomUUID(),
				},
				body: JSON.stringify({
					challenge_id: guestChallengeData.challenge_id,
					code: guestOtp,
				}),
			},
		);
		const guestVerifyRes = await handleAccounts(guestVerifyReq, identity);
		assert.equal(guestVerifyRes.status, 201);
		const guestAccess = await guestVerifyRes.json();
		assert.equal(guestAccess.order_id, f.order.id);
		assert.ok(guestAccess.order_access_token);

		const tokenReceiptRes = await handleOrderReceipt(
			new Request(
				`http://127.0.0.1:3099/api/v1/orders/${f.order.id}/receipt?token=${encodeURIComponent(guestAccess.order_access_token)}`,
				{
					method: "GET",
					headers: { origin: "http://127.0.0.1:3099" },
				},
			),
			identity,
		);
		assert.equal(tokenReceiptRes.status, 200);

		// 6. Notification preferences & in-app notifications state
		const prefGet = await callBuyer("/api/v1/me/notification-preferences");
		assert.equal(prefGet.status, 200);
		assert.equal(prefGet.payload.version, 1);

		const prefUpdate = await callBuyer("/api/v1/me/notification-preferences", {
			expected_version: 1,
			in_app_order_updates: true,
			in_app_support_updates: true,
			email_order_updates: false,
		});
		assert.equal(prefUpdate.status, 201);
		assert.equal(prefUpdate.payload.email_order_updates, false);
		assert.equal(prefUpdate.payload.version, 2);

		await sql.begin((tx) =>
			createBuyerNotification(tx, {
				userId: buyerUser.id,
				eventKey: `test-support-${randomUUID()}`,
				kind: "support_reply",
				title: "Balasan Bantuan Pesanan",
				body: "Tim CS telah menanggapi pertanyaan Anda.",
			}),
		);

		const notifs = await callBuyer("/api/v1/me/notifications");
		assert.equal(notifs.status, 200);
		assert.ok(notifs.payload.data.length >= 1);
		const targetNotifId = notifs.payload.data[0].id as string;

		const markedRead = await callBuyer(
			`/api/v1/me/notifications/${targetNotifId}/state`,
			{ state: "read" },
		);
		assert.equal(markedRead.status, 201);
		assert.equal(markedRead.payload.state, "read");

		// 7. Session terminations (others)
		const terminated = await callBuyer("/api/v1/me/session-terminations", {
			scope: "others",
		});
		assert.equal(terminated.status, 201);
		assert.equal(terminated.payload.status, "terminated_others");

		// 8. Return case creation & private return evidence upload + attachment
		for (const booking of f.bookings) {
			const parcel = f.parcels.find((p) => p.id === booking.fulfillment_id);
			assert.ok(parcel);
			const input = {
				reference: randomUUID(),
				booking_id: booking.id,
				unit_ids: f.units
					.filter((u) => u.shipment_id === parcel.shipment_id)
					.map((u) => u.id),
			};
			const source = await simulateParcelReceipt(sql, "test", input);
			await f.run(await ingestParcelReceiptSource(sql, source));
		}
		const guestActor = await commerceActor(
			f.client.request("/api/v1/carts"),
			identity,
		);
		const unit = f.units[0];
		const returnClaim = {
			items: [
				{
					order_item_id: unit.order_item_id,
					delivered_fulfillment_item_id: unit.id,
					quantity: 1,
					reason: "damaged",
					details: "Kemasan rusak saat diterima",
				},
			],
			requested_resolution: "refund",
		};
		const createdReturn = (await createReturn(
			f.client.request(`/api/v1/orders/${f.order.id}/returns`, returnClaim, {
				key: randomUUID(),
			}),
			identity,
			guestActor,
			f.order.id,
			returnClaim,
		)) as { id: string; version: number };

		const uploadInit = await callBuyer(
			`/api/v1/orders/${f.order.id}/returns/${createdReturn.id}/evidence-uploads`,
			{
				file_name: "kerusakan-paket.jpg",
				media_type: "image/jpeg",
				size_bytes: 24576,
			},
		);
		assert.equal(uploadInit.status, 201);
		assert.ok(uploadInit.payload.id);
		assert.ok(uploadInit.payload.upload_url.includes(uploadInit.payload.id));

		const attachedReturn = await callBuyer(
			`/api/v1/orders/${f.order.id}/returns/${createdReturn.id}/evidence`,
			{
				upload_id: uploadInit.payload.id,
				expected_version: createdReturn.version,
			},
		);
		assert.equal(attachedReturn.status, 201);
		assert.equal(attachedReturn.payload.id, createdReturn.id);

		const [evidenceRow] = await sql<{ status: string }[]>`
			select status from app.return_evidence where id = ${uploadInit.payload.id}
		`;
		assert.equal(evidenceRow?.status, "attached");
	} finally {
		await closeFulfillmentActor(identity, buyerUser);
		await closeFulfillmentActor(identity, secondSession);
		await f.close();
	}
});
