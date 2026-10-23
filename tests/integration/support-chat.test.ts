import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createLocalAuth, type LocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import {
	bootstrapGuest,
	capability,
	commerceActor,
	prefix,
	setCookie,
} from "../../src/modules/checkout/access.ts";
import { createCart } from "../../src/modules/checkout/carts.ts";
import { expireOwnedOrderJob } from "../../src/modules/checkout/expiry.ts";
import { submitOrder } from "../../src/modules/checkout/orders.ts";
import { createQuote } from "../../src/modules/checkout/quotes.ts";
import { handleSupport } from "../../src/modules/support/routes.ts";
import {
	redactSupportMessage,
	revokeConversationOrderLink,
	supportChallengeProof,
} from "../../src/modules/support/service.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { CommerceClient } from "./checkout-fixture.ts";
import { shippingFixture } from "./shipping-fixture.ts";

const origin = "http://127.0.0.1:3099";

class SupportClient {
	readonly identity: LocalAuth;
	cookies = new Map<string, string>();

	constructor(identity: LocalAuth) {
		this.identity = identity;
	}

	absorb(response: Response) {
		for (const raw of response.headers.getSetCookie()) {
			const [pair, ...attrs] = raw.split(";").map((s) => s.trim());
			const eq = pair.indexOf("=");
			if (eq <= 0) continue;
			const name = pair.slice(0, eq);
			const value = pair.slice(eq + 1);
			if (value && !attrs.includes("Max-Age=0")) {
				this.cookies.set(name, value);
			} else {
				this.cookies.delete(name);
			}
		}
	}

	cookieHeader(): string {
		return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
	}

	async call(
		path: string,
		options: {
			method?: string;
			body?: unknown;
			form?: FormData;
			key?: string;
			headers?: Record<string, string>;
		} = {},
	) {
		const method =
			options.method ??
			(options.body !== undefined || options.form !== undefined
				? "POST"
				: "GET");
		const headers = new Headers({
			origin,
			...(method !== "GET"
				? { "idempotency-key": options.key ?? randomUUID() }
				: {}),
			...(options.body !== undefined
				? { "content-type": "application/json" }
				: {}),
			...options.headers,
		});
		const cookie = this.cookieHeader();
		if (cookie) headers.set("cookie", cookie);
		const req = new Request(`${origin}${path}`, {
			method,
			headers,
			body:
				options.form !== undefined
					? options.form
					: options.body !== undefined
						? JSON.stringify(options.body)
						: undefined,
		});
		const response = await handleSupport(req, this.identity);
		this.absorb(response);
		const contentType = response.headers.get("content-type") ?? "";
		const payload = contentType.includes("application/json")
			? await response.json()
			: contentType.startsWith("image/")
				? new Uint8Array(await response.arrayBuffer())
				: await response.text();
		return { response, payload };
	}
}

function validPngBytes(): Uint8Array {
	return new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
		0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	]);
}

test("S41-S43 integration: native customer support chat, verified order/product context, idempotent messages, private attachments, read markers, notifications, SSE stream, and staff CS inbox workflows", async () => {
	const f = await shippingFixture();
	const identity = f.identity;
	const sql = identity.sql;

	const cs1 = await actor(identity, "customer_service", []);
	await enroll(cs1.browser, cs1.password);
	const cs2 = await actor(identity, "customer_service", []);
	await enroll(cs2.browser, cs2.password);
	const csNoMfa = await actor(identity, "customer_service", []);
	const financeActor = await actor(identity, "finance", []);
	await enroll(financeActor.browser, financeActor.password);
	const buyerActor = await actor(identity, "buyer", []);

	const cs1Client = new SupportClient(identity);
	for (const [k, v] of cs1.browser.cookies) cs1Client.cookies.set(k, v);
	const cs2Client = new SupportClient(identity);
	for (const [k, v] of cs2.browser.cookies) cs2Client.cookies.set(k, v);
	const csNoMfaClient = new SupportClient(identity);
	for (const [k, v] of csNoMfa.browser.cookies) csNoMfaClient.cookies.set(k, v);
	const financeClient = new SupportClient(identity);
	for (const [k, v] of financeActor.browser.cookies)
		financeClient.cookies.set(k, v);
	const buyerStaffClient = new SupportClient(identity);
	for (const [k, v] of buyerActor.browser.cookies)
		buyerStaffClient.cookies.set(k, v);

	const ownerClient = new SupportClient(identity);
	for (const [k, v] of f.owner.browser.cookies) ownerClient.cookies.set(k, v);

	const publishedLine = f.line("fixture-offer-shirt");
	const publishedProductId = publishedLine.product_id;
	const publishedOfferId = publishedLine.offer_id;
	const unpublishedProductId = randomUUID();

	const createdConversationIds: string[] = [];
	const createdTagIds: string[] = [];
	const createdSavedReplyIds: string[] = [];
	let submittedOrderId: string | null = null;

	try {
		// Create a real guest order with order_access capability
		const commerceClient = new CommerceClient(identity);
		const bootRes = new Response(null);
		await bootstrapGuest(identity, bootRes);
		commerceClient.absorb(bootRes);
		const guestBuyer = await commerceActor(
			commerceClient.request("/api/v1/carts"),
			identity,
		);
		assert.ok(guestBuyer && guestBuyer.kind === "guest");

		const createdCart = await sql.begin((tx) =>
			createCart(
				tx,
				commerceClient.request("/api/v1/carts", {}),
				identity,
				guestBuyer,
				{
					lines: [
						{
							variant_id: publishedOfferId,
							quantity: 1,
							expected_publication_id: publishedLine.publication_id,
						},
					],
				},
				{ clock_namespace: f.namespace },
			),
		);
		const cartToken = await capability(
			identity,
			"cart",
			createdCart.cart.id,
			guestBuyer.id,
			createdCart.cart.cap_issued_at as string,
		);
		const cartCookieRes = new Response(null);
		setCookie(
			cartCookieRes,
			`${await prefix(identity)}.cart_access`,
			`${createdCart.cart.id}.${cartToken}`,
		);
		commerceClient.absorb(cartCookieRes);

		const quoteInput = {
			cart_id: createdCart.cart.id,
			address: {
				recipient_name: "Penerima Rahasia S41",
				phone: "+6281277776666",
				address_line: "Jl. Rahasia Pembeli No. 99",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281277776666" },
			payment_method: "prepaid" as const,
		};
		const quote = (await sql.begin((tx) =>
			createQuote(
				tx,
				commerceClient.request("/api/v1/checkout/quotes", quoteInput, {
					version: 1,
				}),
				identity,
				guestBuyer,
				quoteInput,
			),
		)) as { id: string };

		const submitted = await sql.begin((tx) =>
			submitOrder(
				tx,
				commerceClient.request(
					"/api/v1/orders",
					{ quote_id: quote.id },
					{ version: 1 },
				),
				identity,
				guestBuyer,
				{ quote_id: quote.id },
			),
		);
		submittedOrderId = submitted.order.id;
		const orderNumber = submitted.order.number;

		const [orderAccessRow] = await sql<{ issued_at: string }[]>`
			select issued_at from app.order_access where order_id = ${submittedOrderId}
		`;
		assert.ok(orderAccessRow);
		const orderToken = await capability(
			identity,
			"order",
			submittedOrderId,
			guestBuyer.id,
			orderAccessRow.issued_at,
		);

		// 1. S41: Bootstrap opaque guest support session
		const guestClient = new SupportClient(identity);
		const sessionRes = await guestClient.call(
			"/api/v1/guest-support-sessions",
			{
				body: { client_request_id: `req-${randomUUID()}` },
			},
		);
		assert.equal(sessionRes.response.status, 201);
		assert.equal(sessionRes.response.headers.get("cache-control"), "no-store");
		assert.equal(sessionRes.payload.status, "active");
		assert.ok(
			sessionRes.response.headers
				.getSetCookie()
				.some((c) => c.includes("support_guest=") && c.includes("HttpOnly")),
			"Sets HttpOnly guest support session cookie",
		);

		// 2. S41: Reject unpublished product context & unverified order context
		const unpubRes = await guestClient.call("/api/v1/support/conversations", {
			body: {
				client_conversation_id: `conv-${randomUUID()}`,
				product_id: unpublishedProductId,
			},
		});
		assert.equal(unpubRes.response.status, 404);

		const unverifiedOrderRes = await guestClient.call(
			"/api/v1/support/conversations",
			{
				body: {
					client_conversation_id: `conv-${randomUUID()}`,
					order_id: submittedOrderId,
				},
			},
		);
		assert.equal(unverifiedOrderRes.response.status, 401);

		// 3. S41: Create pre-sales conversation with published product context
		const preSalesClientConvId = `conv-${randomUUID()}`;
		const preSalesRes = await guestClient.call(
			"/api/v1/support/conversations",
			{
				body: {
					client_conversation_id: preSalesClientConvId,
					product_id: publishedProductId,
				},
			},
		);
		assert.equal(preSalesRes.response.status, 200);
		const preSalesConvId = preSalesRes.payload.id as string;
		createdConversationIds.push(preSalesConvId);
		assert.equal(preSalesRes.payload.product_id, publishedProductId);
		assert.equal(preSalesRes.payload.status, "open");

		// 4. S41: Create post-purchase conversation with verified order capability cookie
		for (const c of commerceClient.cookies.values()) {
			guestClient.cookies.set(c.name, c.value);
		}
		guestClient.cookies.set(
			`${await prefix(identity)}.order_access`,
			`${submittedOrderId}.${orderToken}`,
		);

		const orderConvRes = await guestClient.call(
			"/api/v1/support/conversations",
			{
				body: {
					client_conversation_id: `conv-${randomUUID()}`,
					order_id: submittedOrderId,
				},
			},
		);
		assert.equal(orderConvRes.response.status, 200);
		const orderConvId = orderConvRes.payload.id as string;
		createdConversationIds.push(orderConvId);
		assert.equal(orderConvRes.payload.order_id, submittedOrderId);

		// Send message with order context card on orderConvId
		const orderMsgRes = await guestClient.call(
			`/api/v1/support/conversations/${orderConvId}/messages`,
			{
				body: {
					client_message_id: `msg-${randomUUID()}`,
					text: "Mohon info jadwal pengiriman pesanan saya.",
					attachment_ids: [],
					context: {
						kind: "order",
						order_id: submittedOrderId,
					},
				},
			},
		);
		assert.equal(orderMsgRes.response.status, 200);
		assert.equal(orderMsgRes.payload.context.kind, "order");
		assert.equal(orderMsgRes.payload.context.availability, "available");
		assert.ok(orderMsgRes.payload.context.title.includes(orderNumber));
		const serializedContext = JSON.stringify(orderMsgRes.payload.context);
		assert.ok(
			!serializedContext.includes("Jl. Rahasia Pembeli No. 99") &&
				!serializedContext.includes("+6281277776666"),
			"Order context card never exposes raw shipping address or phone",
		);

		// 5. S42: Idempotent message retry & 409 payload mismatch + product context card
		const msgId1 = `msg-${randomUUID()}`;
		const send1 = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/messages`,
			{
				body: {
					client_message_id: msgId1,
					text: "Saya ingin beli 2 potong warna krem.",
					attachment_ids: [],
					context: {
						kind: "product",
						product_id: publishedProductId,
						variant_id: publishedOfferId,
					},
				},
			},
		);
		assert.equal(send1.response.status, 200);
		assert.equal(send1.payload.sequence, 1);
		assert.equal(send1.payload.context.kind, "product");
		assert.equal(send1.payload.context.availability, "available");

		const retrySame = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/messages`,
			{
				body: {
					client_message_id: msgId1,
					text: "Saya ingin beli 2 potong warna krem.",
					attachment_ids: [],
					context: {
						kind: "product",
						product_id: publishedProductId,
						variant_id: publishedOfferId,
					},
				},
			},
		);
		assert.equal(retrySame.response.status, 200);
		assert.equal(retrySame.payload.id, send1.payload.id);
		assert.equal(retrySame.payload.sequence, 1);

		const retryDiff = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/messages`,
			{
				body: {
					client_message_id: msgId1,
					text: "Kalimat berbeda dengan client_message_id sama.",
					attachment_ids: [],
				},
			},
		);
		assert.equal(retryDiff.response.status, 409);

		// 6. S42: Private attachment validation, upload, cross-thread isolation & download headers
		const svgForm = new FormData();
		svgForm.set("client_attachment_id", `att-${randomUUID()}`);
		svgForm.set(
			"file",
			new Blob(["<svg><script>alert(1)</script></svg>"], {
				type: "image/png",
			}),
			"exploit.png",
		);
		const svgAttack = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/attachments`,
			{ form: svgForm },
		);
		assert.equal(svgAttack.response.status, 400);

		const eicarBytes = Buffer.concat([
			Buffer.from(validPngBytes()),
			Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"),
		]);
		const eicarForm = new FormData();
		eicarForm.set("client_attachment_id", `att-${randomUUID()}`);
		eicarForm.set(
			"file",
			new Blob([eicarBytes], { type: "image/png" }),
			"eicar.png",
		);
		const eicarUpload = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/attachments`,
			{ form: eicarForm },
		);
		assert.equal(eicarUpload.response.status, 200);
		assert.equal(eicarUpload.payload.status, "rejected");

		const attachRejected = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/messages`,
			{
				body: {
					client_message_id: `msg-${randomUUID()}`,
					text: "Coba lampirkan file terinfeksi",
					attachment_ids: [eicarUpload.payload.id],
				},
			},
		);
		assert.equal(attachRejected.response.status, 409);

		const validForm = new FormData();
		validForm.set("client_attachment_id", `att-${randomUUID()}`);
		validForm.set(
			"file",
			new Blob([new Uint8Array(validPngBytes())], { type: "image/png" }),
			"bukti-ukuran.png",
		);
		const validUpload = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/attachments`,
			{ form: validForm },
		);
		assert.equal(validUpload.response.status, 200);
		assert.equal(validUpload.payload.status, "ready");
		const attachmentId = validUpload.payload.id as string;

		// Cross-conversation attachment reuse must fail with 403
		const crossThreadAttach = await guestClient.call(
			`/api/v1/support/conversations/${orderConvId}/messages`,
			{
				body: {
					client_message_id: `msg-${randomUUID()}`,
					text: "Coba pakai lampiran dari percakapan lain",
					attachment_ids: [attachmentId],
				},
			},
		);
		assert.equal(crossThreadAttach.response.status, 403);

		// Attach to the owning conversation + reply quote
		const msgWithAttachment = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/messages`,
			{
				body: {
					client_message_id: `msg-${randomUUID()}`,
					text: "Berikut foto contoh ukuran saya.",
					reply_to_message_id: send1.payload.id,
					attachment_ids: [attachmentId],
				},
			},
		);
		assert.equal(msgWithAttachment.response.status, 200);
		assert.equal(msgWithAttachment.payload.attachments.length, 1);
		assert.equal(msgWithAttachment.payload.reply.message_id, send1.payload.id);
		assert.equal(msgWithAttachment.payload.reply.state, "visible");

		// Download private attachment as owner, deny unrelated guest
		const downloadOwner = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/attachments/${attachmentId}`,
		);
		assert.equal(downloadOwner.response.status, 200);
		assert.equal(
			downloadOwner.response.headers.get("cache-control"),
			"no-store",
		);
		assert.equal(
			downloadOwner.response.headers.get("x-content-type-options"),
			"nosniff",
		);

		const strangerClient = new SupportClient(identity);
		await strangerClient.call("/api/v1/guest-support-sessions", {
			body: { client_request_id: `req-${randomUUID()}` },
		});
		const downloadStranger = await strangerClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/attachments/${attachmentId}`,
		);
		assert.equal(downloadStranger.response.status, 404);

		// Redaction tombstone updates message text & quoted reply state
		await sql.begin((tx) =>
			redactSupportMessage(tx, send1.payload.id as string),
		);
		const listedAfterRedact = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/messages`,
		);
		assert.equal(listedAfterRedact.response.status, 200);
		const redactedMsg = listedAfterRedact.payload.data.find(
			(m: { id: string }) => m.id === send1.payload.id,
		);
		assert.equal(redactedMsg.text, "[Pesan dihapus]");
		assert.equal(redactedMsg.context.availability, "redacted");
		const quotingMsg = listedAfterRedact.payload.data.find(
			(m: { id: string }) => m.id === msgWithAttachment.payload.id,
		);
		assert.equal(quotingMsg.reply.state, "redacted");
		assert.equal(quotingMsg.reply.excerpt, "");

		// 7. S43: Role & MFA gates on admin support routes
		assert.equal(
			(await financeClient.call("/api/v1/admin/support/conversations")).response
				.status,
			403,
		);
		assert.equal(
			(await buyerStaffClient.call("/api/v1/admin/support/conversations"))
				.response.status,
			403,
		);
		assert.equal(
			(await csNoMfaClient.call("/api/v1/admin/support/conversations")).response
				.status,
			403,
		);

		// 8. S43: Atomic exclusive claim race between CS Agent 1 and CS Agent 2
		const inboxList = await cs1Client.call(
			"/api/v1/admin/support/conversations?assignment=unassigned",
		);
		assert.equal(inboxList.response.status, 200);
		const targetInboxItem = inboxList.payload.data.find(
			(i: { conversation: { id: string } }) =>
				i.conversation.id === preSalesConvId,
		);
		assert.ok(targetInboxItem);
		const currentRev = targetInboxItem.assignment_version as number;

		const [claimA, claimB] = await Promise.all([
			cs1Client.call(
				`/api/v1/admin/support/conversations/${preSalesConvId}/claims`,
				{ body: { expected_version: currentRev } },
			),
			cs2Client.call(
				`/api/v1/admin/support/conversations/${preSalesConvId}/claims`,
				{ body: { expected_version: currentRev } },
			),
		]);
		const statuses = [claimA.response.status, claimB.response.status].sort();
		assert.deepEqual(statuses, [200, 409]);

		const winnerClient = claimA.response.status === 200 ? cs1Client : cs2Client;
		const loserClient = claimA.response.status === 200 ? cs2Client : cs1Client;
		const loserId = claimA.response.status === 200 ? cs2.id : cs1.id;
		const claimedVersion = (
			claimA.response.status === 200 ? claimA.payload : claimB.payload
		).assignment_version as number;

		// Stale version handoff fails with 409
		const staleHandoff = await winnerClient.call(
			`/api/v1/admin/support/conversations/${preSalesConvId}/assignments`,
			{
				body: {
					assignee_user_id: loserId,
					expected_version: claimedVersion - 1,
					reason: "Stale handoff",
				},
			},
		);
		assert.equal(staleHandoff.response.status, 409);

		// Valid handoff to loserId succeeds
		const handoffRes = await winnerClient.call(
			`/api/v1/admin/support/conversations/${preSalesConvId}/assignments`,
			{
				body: {
					assignee_user_id: loserId,
					expected_version: claimedVersion,
					reason: "Transfer ke shift sore",
				},
			},
		);
		assert.equal(handoffRes.response.status, 200);
		assert.equal(handoffRes.payload.assignee_user_id, loserId);

		// Assigned CS agent can download private attachment
		const downloadCs = await loserClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/attachments/${attachmentId}`,
		);
		assert.equal(downloadCs.response.status, 200);

		// 9. S42 & S43: Buyer archives conversation -> CS replies -> auto-resurfaces buyer archive + creates notification
		const archiveRes = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/preferences`,
			{
				body: { expected_version: 0, archived: true, muted: false },
			},
		);
		assert.equal(archiveRes.response.status, 201);
		assert.equal(archiveRes.payload.archived, true);

		const activeListBeforeReply = await guestClient.call(
			"/api/v1/support/conversations?view=active",
		);
		assert.ok(
			!activeListBeforeReply.payload.data.some(
				(c: { id: string }) => c.id === preSalesConvId,
			),
			"Archived conversation is hidden from active list before new CS reply",
		);

		// CS posts an internal note first: must NOT resurface buyer archive, increment buyer unread count, or appear in buyer streams
		const secretNoteText = `CATATAN-INTERNAL-RAHASIA-${randomUUID()}`;
		const noteRes = await loserClient.call(
			`/api/v1/admin/support/conversations/${preSalesConvId}/notes`,
			{
				body: { text: secretNoteText },
			},
		);
		assert.equal(noteRes.response.status, 200);

		const prefAfterNote = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/preferences`,
		);
		assert.equal(prefAfterNote.payload.archived, true);

		// CS posts a public reply
		const csReplyRes = await loserClient.call(
			`/api/v1/admin/support/conversations/${preSalesConvId}/messages`,
			{
				body: {
					client_message_id: `msg-${randomUUID()}`,
					text: "Halo kak, stok ukuran L warna krem masih tersedia 5 pcs!",
					attachment_ids: [],
				},
			},
		);
		assert.equal(csReplyRes.response.status, 200);
		assert.equal(csReplyRes.payload.sender, "customer_service");

		// Buyer conversation automatically resurfaces (archived = false) and has unread message
		const prefAfterReply = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/preferences`,
		);
		assert.equal(prefAfterReply.payload.archived, false);

		const buyerConvAfterReply = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}`,
		);
		assert.equal(buyerConvAfterReply.payload.last_message_sequence, 3);
		assert.equal(buyerConvAfterReply.payload.buyer_last_read_sequence, 2);

		// 10. S42: In-app notifications independent from chat read markers
		const notifsRes = await guestClient.call("/api/v1/support/notifications");
		assert.equal(notifsRes.response.status, 200);
		assert.ok(notifsRes.payload.data.length >= 1);
		const notif = notifsRes.payload.data[0];

		const markSeenRes = await guestClient.call(
			`/api/v1/support/notifications/${notif.id}/state`,
			{
				body: { expected_version: notif.version, state: "seen" },
			},
		);
		assert.equal(markSeenRes.response.status, 201);
		assert.ok(markSeenRes.payload.seen_at);

		// Conversation buyer_last_read_sequence MUST still be 2 until read-marker is explicitly advanced
		const convStillUnread = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}`,
		);
		assert.equal(convStillUnread.payload.buyer_last_read_sequence, 2);

		// Advance buyer read marker monotonically
		const readMarkerRes = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/read-markers`,
			{
				body: { last_seen_sequence: csReplyRes.payload.sequence },
			},
		);
		assert.equal(readMarkerRes.response.status, 200);
		assert.equal(
			readMarkerRes.payload.last_seen_sequence,
			csReplyRes.payload.sequence,
		);

		// Lower sequence number does not move read marker backward
		const backwardMarker = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/read-markers`,
			{
				body: { last_seen_sequence: 1 },
			},
		);
		assert.equal(
			backwardMarker.payload.last_seen_sequence,
			csReplyRes.payload.sequence,
		);

		// 11. S42: Resumable SSE and JSON event stream excludes internal notes
		const jsonEvents = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/events`,
		);
		assert.equal(jsonEvents.response.status, 200);
		assert.equal(jsonEvents.payload.data.length, 3);
		assert.ok(
			!JSON.stringify(jsonEvents.payload).includes(secretNoteText),
			"Internal notes never leak into public event stream",
		);

		const sseEvents = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/events`,
			{
				headers: {
					accept: "text/event-stream",
					"last-event-id": `evt:${preSalesConvId}:1`,
				},
			},
		);
		assert.equal(sseEvents.response.status, 200);
		assert.ok(
			(sseEvents.response.headers.get("content-type") ?? "").includes(
				"text/event-stream",
			),
		);
		assert.ok(
			typeof sseEvents.payload === "string" &&
				sseEvents.payload.includes("event: message") &&
				!sseEvents.payload.includes(`evt:${preSalesConvId}:1\n`) &&
				!sseEvents.payload.includes(secretNoteText),
		);

		// Customer search never matches internal notes, while staff note search does
		const customerSearchNote = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/message-searches`,
			{
				body: { query: secretNoteText },
			},
		);
		assert.equal(customerSearchNote.payload.data.length, 0);

		const staffSearchNote = await loserClient.call(
			`/api/v1/admin/support/conversations/${preSalesConvId}/note-searches`,
			{
				body: { query: secretNoteText },
			},
		);
		assert.equal(staffSearchNote.payload.data.length, 1);

		// 12. S43: Resolve conversation -> auto-reopen on new buyer message
		const resolveRes = await loserClient.call(
			`/api/v1/admin/support/conversations/${preSalesConvId}/status`,
			{
				body: {
					status: "resolved",
					expected_version: handoffRes.payload.assignment_version,
					reason: "Pertanyaan stok sudah terjawab",
				},
			},
		);
		assert.equal(resolveRes.response.status, 200);
		assert.equal(resolveRes.payload.conversation.status, "resolved");

		// Buyer replies to resolved conversation -> auto-reopens to "open"
		const reopenReply = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}/messages`,
			{
				body: {
					client_message_id: `msg-${randomUUID()}`,
					text: "Kak, kalau warna hitam apakah juga ada?",
					attachment_ids: [],
				},
			},
		);
		assert.equal(reopenReply.response.status, 200);
		const afterReopen = await guestClient.call(
			`/api/v1/support/conversations/${preSalesConvId}`,
		);
		assert.equal(afterReopen.payload.status, "open");

		// 13. S43: Tags, classification & saved reply draft preview (owner creates definitions, CS uses them)
		const tagRes = await ownerClient.call("/api/v1/admin/support/tags", {
			body: {
				expected_version: 0,
				label: `Ukuran ${randomUUID().slice(0, 6)}`,
				enabled: true,
				reason: "Kategori pertanyaan ukuran",
			},
		});
		assert.equal(tagRes.response.status, 201);
		createdTagIds.push(tagRes.payload.id as string);

		const currentClass = await loserClient.call(
			`/api/v1/admin/support/conversations/${preSalesConvId}/classification`,
		);
		const classRes = await loserClient.call(
			`/api/v1/admin/support/conversations/${preSalesConvId}/classification`,
			{
				body: {
					expected_version: currentClass.payload.version,
					priority: "high",
					tag_ids: [tagRes.payload.id],
					reason: "Prioritas tinggi untuk stok ukuran",
				},
			},
		);
		assert.equal(classRes.response.status, 201);
		assert.equal(classRes.payload.priority, "high");
		assert.deepEqual(classRes.payload.tag_ids, [tagRes.payload.id]);

		const savedReplyRes = await ownerClient.call(
			"/api/v1/admin/support/saved-replies",
			{
				body: {
					expected_version: 0,
					title: `Template S43 ${randomUUID().slice(0, 6)}`,
					text: "Halo, produk {{product_title}} siap dikirim.",
					placeholders: ["product_title"],
					enabled: true,
					reason: "Template balasan cepat produk",
				},
			},
		);
		assert.equal(savedReplyRes.response.status, 201);
		createdSavedReplyIds.push(savedReplyRes.payload.id as string);

		const previewRes = await loserClient.call(
			`/api/v1/admin/support/conversations/${preSalesConvId}/saved-reply-previews`,
			{
				body: {
					saved_reply_id: savedReplyRes.payload.id,
					saved_reply_version: savedReplyRes.payload.version,
				},
			},
		);
		assert.equal(previewRes.response.status, 200);
		assert.equal(previewRes.payload.can_send, true);
		assert.deepEqual(previewRes.payload.unresolved_placeholders, []);
		assert.ok(!previewRes.payload.text.includes("{{product_title}}"));

		// 14. S41: Contact binding & lost-session recovery rotation
		const contactPhone = `+62813${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
		const bindChallenge = await guestClient.call(
			"/api/v1/support/contact-challenges",
			{
				body: {
					expected_version: 0,
					contact: { kind: "phone", phone: contactPhone },
				},
			},
		);
		assert.equal(bindChallenge.response.status, 201);
		const bindProof = await supportChallengeProof(
			identity,
			bindChallenge.payload.challenge_id as string,
			"contact_binding",
			`phone:${contactPhone}`,
		);
		const bindVerify = await guestClient.call(
			`/api/v1/support/contact-challenges/${bindChallenge.payload.challenge_id}/verifications`,
			{
				body: { proof: bindProof },
			},
		);
		assert.equal(bindVerify.response.status, 201);
		assert.equal(bindVerify.payload.status, "confirmed");

		// Recover from a brand-new guest support session
		const recoveredClient = new SupportClient(identity);
		await recoveredClient.call("/api/v1/guest-support-sessions", {
			body: { client_request_id: `req-${randomUUID()}` },
		});
		const recChallenge = await recoveredClient.call(
			"/api/v1/support/recovery-challenges",
			{
				body: {
					contact: { kind: "phone", phone: contactPhone },
					recovery_reference: preSalesConvId,
				},
			},
		);
		assert.equal(recChallenge.response.status, 201);

		const [guestSupportRow] = await sql<{ guest_support_id: string }[]>`
			select guest_support_id from app.support_conversation where id = ${preSalesConvId}
		`;
		const recProof = await supportChallengeProof(
			identity,
			recChallenge.payload.challenge_id as string,
			"session_recovery",
			guestSupportRow.guest_support_id,
		);
		const recVerify = await recoveredClient.call(
			`/api/v1/support/recovery-challenges/${recChallenge.payload.challenge_id}/verifications`,
			{
				body: { proof: recProof },
			},
		);
		assert.equal(recVerify.response.status, 201);
		assert.equal(recVerify.payload.status, "active");

		// Old guest session cookie is revoked (401), while recovered client lists the conversations
		const oldSessionCheck = await guestClient.call(
			"/api/v1/support/conversations",
		);
		assert.equal(oldSessionCheck.response.status, 401);

		const recoveredList = await recoveredClient.call(
			"/api/v1/support/conversations",
		);
		assert.equal(recoveredList.response.status, 200);
		assert.ok(
			recoveredList.payload.data.some(
				(c: { id: string }) => c.id === preSalesConvId,
			),
		);

		// Revoking order link marks order context card unavailable without breaking conversation history
		await sql.begin((tx) => revokeConversationOrderLink(tx, orderConvId));
		const orderMsgsAfterRevoke = await recoveredClient.call(
			`/api/v1/support/conversations/${orderConvId}/messages`,
		);
		assert.equal(orderMsgsAfterRevoke.response.status, 200);
		assert.equal(
			orderMsgsAfterRevoke.payload.data[0].context.availability,
			"unavailable",
		);
		assert.equal(
			orderMsgsAfterRevoke.payload.data[0].context.title,
			"Pesanan tidak tersedia",
		);
	} finally {
		if (createdConversationIds.length > 0) {
			await sql`delete from app.support_in_app_notification where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_challenge where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_conversation_tag where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_participant_preference where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_assignment_event where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_read_position where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_internal_note where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_context_card where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_attachment where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_message where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_conversation where id in ${sql(createdConversationIds)}`;
		}
		if (createdTagIds.length > 0) {
			await sql`delete from app.support_tag where id in ${sql(createdTagIds)}`;
		}
		if (createdSavedReplyIds.length > 0) {
			await sql`delete from app.support_saved_reply where id in ${sql(createdSavedReplyIds)}`;
		}
		if (submittedOrderId) {
			const [job] = await sql<{ id: string; kind: string; payload: unknown }[]>`
				select id, kind, payload
				from app.outbox_job
				where kind = 'checkout.order.expire'
				  and payload->>'orderId' = ${submittedOrderId}
				  and status = 'ready'
			`;
			if (job) {
				await sql`
					update app.local_fixture_namespace
					set clock = clock + interval '31 minutes', revision = revision + 1
					where name = ${f.namespace}
				`;
				await sql.begin((tx) =>
					expireOwnedOrderJob(tx, {
						id: job.id,
						kind: job.kind,
						payload: job.payload as Record<string, unknown>,
					}),
				);
			}
		}
		try {
			await cleanup(identity, [cs1, cs2, csNoMfa, financeActor, buyerActor]);
		} finally {
			await f.close();
		}
	}
});

test("S41 contact rebinding requires a real session/action/subject-bound single-use reauthentication proof", async () => {
	const identity = createLocalAuth("test");
	const sql = identity.sql;
	const buyer = await actor(identity, "buyer", []);
	const otherBuyer = await actor(identity, "buyer", []);
	const guest = new SupportClient(identity);
	try {
		await sql`insert into app.buyer_profile (user_id, display_name, email, phone, phone_verified_at)
			values (${buyer.id}, 'Synthetic Rebind', ${buyer.email}, '+6281300000001', clock_timestamp())`;
		const issue = (who: typeof buyer, subjectId: string) => {
			const request = who.browser.request("/api/v1/me/reauthentication-proofs", {
				password: who.password,
				action: "support.contact_rebind",
				subject_id: subjectId,
			});
			request.headers.set("idempotency-key", randomUUID());
			return handleAccess(request, identity);
		};
		const proofFor = async (who: typeof buyer) => {
			const response = await issue(who, who.id);
			assert.equal(response.status, 201, "self rebind proof issuance");
			return String((await response.json()).proof);
		};
		const rebind = (proof: string) => {
			const request = buyer.browser.request("/api/v1/support/contact-challenges", {
				expected_version: 1,
				contact: { kind: "phone", phone: "+6281300000002" },
				reauthentication_proof: proof,
			});
			request.headers.set("idempotency-key", randomUUID());
			return handleSupport(request, identity);
		};
		const rejected = async (proof: string, scenario: string) => {
			const response = await rebind(proof);
			assert.equal(response.status, 403, scenario);
			assert.equal((await response.json()).code, "REAUTHENTICATION_REQUIRED", scenario);
		};
		const challengeCount = async () =>
			Number((await sql`select count(*)::int n from app.support_challenge where actor_scope=${`user:${buyer.id}`}`)[0].n);

		// Issuance only binds the caller's own identity.
		const foreign = await issue(buyer, otherBuyer.id);
		assert.equal(foreign.status, 403);
		assert.equal((await foreign.json()).code, "FORBIDDEN");

		await rejected(`random-${randomUUID()}`, "random unissued string");
		await rejected(await proofFor(otherBuyer), "another user's session proof");
		const otherAction = await proofFor(buyer);
		await sql`update app.access_proof set action='affiliate.beneficiary_change'
			where subject_id=${buyer.id} and action='support.contact_rebind' and consumed_at is null`;
		await rejected(otherAction, "proof bound to another action");
		const otherSubject = await proofFor(buyer);
		await sql`update app.access_proof set subject_id=${otherBuyer.id}
			where subject_id=${buyer.id} and action='support.contact_rebind' and consumed_at is null`;
		await rejected(otherSubject, "proof bound to another subject");
		const expired = await proofFor(buyer);
		await sql`update app.access_proof set expires_at=clock_timestamp()-interval '1 second'
			where subject_id=${buyer.id} and action='support.contact_rebind' and consumed_at is null`;
		await rejected(expired, "expired proof");
		assert.equal(await challengeCount(), 0, "rejected proofs create no challenge");

		const valid = await proofFor(buyer);
		const accepted = await rebind(valid);
		assert.equal(accepted.status, 201);
		assert.ok((await accepted.json()).challenge_id);
		await rejected(valid, "consumed proof cannot be replayed");
		assert.equal(await challengeCount(), 1);

		// A guest support identity has no password session: replacement fails closed.
		await guest.call("/api/v1/guest-support-sessions", {
			body: { client_request_id: `req-${randomUUID()}` },
		});
		const randomPhone = () =>
			`+62813${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
		const phone = randomPhone();
		const stagedPhone = randomPhone();
		const challenge = async (contactPhone: string) => {
			const res = await guest.call("/api/v1/support/contact-challenges", {
				body: { expected_version: 0, contact: { kind: "phone", phone: contactPhone } },
			});
			assert.equal(res.response.status, 201);
			return res.payload.challenge_id as string;
		};
		const verify = async (challengeId: string, contactPhone: string) =>
			guest.call(`/api/v1/support/contact-challenges/${challengeId}/verifications`, {
				body: {
					proof: await supportChallengeProof(
						identity,
						challengeId,
						"contact_binding",
						`phone:${contactPhone}`,
					),
				},
			});
		// Both challenges are staged at version 0 before either is verified.
		const first = await challenge(phone);
		const staged = await challenge(stagedPhone);
		assert.equal((await verify(first, phone)).response.status, 201);
		// The staged version-0 challenge cannot replace the contact verified meanwhile.
		const overwrite = await verify(staged, stagedPhone);
		assert.equal(overwrite.response.status, 409);
		assert.equal(JSON.parse(String(overwrite.payload)).code, "VERSION_CONFLICT");
		const guestId = String(guest.cookies.get([...guest.cookies.keys()].find((name) => name.endsWith(".support_guest")) ?? "")).split(".")[0];
		const [boundContact] = await sql`select contact_value from app.guest_support_identity where id=${guestId}`;
		assert.equal(boundContact.contact_value, `phone:${phone}`, "verified contact unchanged");
		const [stagedRow] = await sql`select verified_at from app.support_challenge where id=${staged}`;
		assert.equal(stagedRow.verified_at, null, "refused verification does not consume the challenge seal");
		const guestRebind = await guest.call("/api/v1/support/contact-challenges", {
			body: {
				expected_version: 1,
				contact: { kind: "phone", phone: "+6281300000003" },
				reauthentication_proof: `forged-${randomUUID()}`,
			},
		});
		assert.equal(guestRebind.response.status, 403);
		assert.equal(
			JSON.parse(String(guestRebind.payload)).code,
			"REAUTHENTICATION_REQUIRED",
		);
	} finally {
		const scopes = [`user:${buyer.id}`, `user:${otherBuyer.id}`];
		await sql`delete from app.support_challenge where actor_scope in ${sql(scopes)}`;
		await sql`delete from app.access_operation where actor_id in ${sql(scopes)}`;
		await sql`delete from app.buyer_profile where user_id=${buyer.id}`;
		await cleanup(identity, [buyer, otherBuyer]);
		await sql.end();
	}
});
