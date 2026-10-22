import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { LocalAuth } from "../../src/modules/access/auth.ts";
import { handleAdvertisingDiagnostics } from "../../src/modules/advertising/diagnostics.ts";
import { handleAffiliateProfile } from "../../src/modules/affiliates/profile.ts";
import {
	bootstrapGuest,
	capability,
	commerceActor,
	prefix,
	setCookie,
} from "../../src/modules/checkout/access.ts";
import { createCart } from "../../src/modules/checkout/carts.ts";
import { submitOrder } from "../../src/modules/checkout/orders.ts";
import { createQuote } from "../../src/modules/checkout/quotes.ts";
import {
	handlePayouts,
	queueEligibleAffiliatePayouts,
} from "../../src/modules/payouts/service.ts";
import { handleSupport } from "../../src/modules/support/routes.ts";
import { actor, enroll } from "../contract/access-fixture.ts";
import { advertisingFixture, deniedChoices } from "./advertising-fixture.ts";
import { CommerceClient } from "./checkout-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { shippingFixture } from "./shipping-fixture.ts";

const origin = "http://127.0.0.1:3099";

type AuditRow = {
	actor_id: string | null;
	action: string;
	subject_id: string | null;
	outcome: string;
	reason: string;
	details: Record<string, unknown>;
};

function audits(identity: LocalAuth, actorId: string, action: string) {
	return identity.sql<AuditRow[]>`
		select actor_id, action, subject_id, outcome, reason, details
		from app.audit_event
		where actor_id = ${actorId} and action = ${action}
		order by created_at asc, id asc
	`;
}

async function support(
	identity: LocalAuth,
	cookies: Map<string, string>,
	path: string,
	body?: unknown,
	key: string = randomUUID(),
) {
	const headers = new Headers({ origin });
	if (body !== undefined) {
		headers.set("idempotency-key", key);
		headers.set("content-type", "application/json");
	}
	const cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
	if (cookie) headers.set("cookie", cookie);
	const response = await handleSupport(
		new Request(`${origin}${path}`, {
			method: body === undefined ? "GET" : "POST",
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		}),
		identity,
	);
	for (const raw of response.headers.getSetCookie()) {
		const [pair] = raw.split(";");
		const eq = pair.indexOf("=");
		const value = pair.slice(eq + 1);
		if (value) cookies.set(pair.slice(0, eq), value);
	}
	return { status: response.status, payload: await response.json() };
}

test("S73: support classification, tag and saved-reply versions write audit rows with reason and before/after in the same transaction", async () => {
	const f = await shippingFixture();
	const identity = f.identity;
	const sql = identity.sql;
	const owner = new Map(f.owner.browser.cookies);
	const ownerId = f.owner.id;
	const guest = new Map<string, string>();
	const conversationIds: string[] = [];
	const tagIds: string[] = [];
	const savedReplyIds: string[] = [];
	try {
		const session = await support(
			identity,
			guest,
			"/api/v1/guest-support-sessions",
			{ client_request_id: `req-${randomUUID()}` },
		);
		assert.equal(session.status, 201);
		const conv = await support(
			identity,
			guest,
			"/api/v1/support/conversations",
			{
				client_conversation_id: `conv-${randomUUID()}`,
				product_id: f.line("fixture-offer-shirt").product_id,
			},
		);
		assert.equal(conv.status, 200);
		const convId = conv.payload.id as string;
		conversationIds.push(convId);

		// Tag create and version keep the prior snapshot in the immutable audit row.
		const tag = await support(identity, owner, "/api/v1/admin/support/tags", {
			expected_version: 0,
			label: `Audit ${randomUUID().slice(0, 6)}`,
			enabled: true,
			reason: "Tag audit awal",
		});
		assert.equal(tag.status, 201);
		tagIds.push(tag.payload.id);
		const tagV2 = await support(
			identity,
			owner,
			`/api/v1/admin/support/tags/${tag.payload.id}/versions`,
			{
				expected_version: 1,
				label: `${tag.payload.label} v2`,
				enabled: true,
				reason: "Ganti label tag",
			},
		);
		assert.equal(tagV2.payload.version, 2);
		const [tagCreate] = (
			await audits(identity, ownerId, "support.tag.create")
		).filter((a) => a.subject_id === tag.payload.id);
		assert.equal(tagCreate.reason, "Tag audit awal");
		assert.equal(tagCreate.outcome, "allowed");
		const [tagVersion] = (
			await audits(identity, ownerId, "support.tag.version")
		).filter((a) => a.subject_id === tag.payload.id);
		assert.equal(tagVersion.reason, "Ganti label tag");
		assert.deepEqual(tagVersion.details.before, {
			id: tag.payload.id,
			version: 1,
			label: tag.payload.label,
			enabled: true,
		});
		assert.equal(
			(tagVersion.details.after as { label: string }).label,
			`${tag.payload.label} v2`,
		);

		// Saved reply version keeps the prior template text.
		const reply = await support(
			identity,
			owner,
			"/api/v1/admin/support/saved-replies",
			{
				expected_version: 0,
				title: `Audit ${randomUUID().slice(0, 6)}`,
				text: "Halo {{customer_name}}, versi satu.",
				placeholders: ["customer_name"],
				enabled: true,
				reason: "Template audit awal",
			},
		);
		assert.equal(reply.status, 201);
		savedReplyIds.push(reply.payload.id);
		const replyV2 = await support(
			identity,
			owner,
			`/api/v1/admin/support/saved-replies/${reply.payload.id}/versions`,
			{
				expected_version: 1,
				title: reply.payload.title,
				text: "Halo {{customer_name}}, versi dua.",
				placeholders: ["customer_name"],
				enabled: true,
				reason: "Perbarui teks template",
			},
		);
		assert.equal(replyV2.payload.version, 2);
		const [replyVersion] = (
			await audits(identity, ownerId, "support.saved_reply.version")
		).filter((a) => a.subject_id === reply.payload.id);
		assert.equal(replyVersion.reason, "Perbarui teks template");
		assert.equal(
			(replyVersion.details.before as { text: string }).text,
			"Halo {{customer_name}}, versi satu.",
		);
		assert.equal(replyVersion.details.version, 2);
		assert.equal(
			(await audits(identity, ownerId, "support.saved_reply.create")).filter(
				(a) => a.subject_id === reply.payload.id,
			).length,
			1,
		);

		// Classification records actor, subject, reason, version and before/after once per operation.
		const current = await support(
			identity,
			owner,
			`/api/v1/admin/support/conversations/${convId}/classification`,
		);
		const key = randomUUID();
		const input = {
			expected_version: current.payload.version,
			priority: "high",
			tag_ids: [tag.payload.id],
			reason: "Eskalasi stok ukuran",
		};
		const classified = await support(
			identity,
			owner,
			`/api/v1/admin/support/conversations/${convId}/classification`,
			input,
			key,
		);
		assert.equal(classified.status, 201);
		const replayed = await support(
			identity,
			owner,
			`/api/v1/admin/support/conversations/${convId}/classification`,
			input,
			key,
		);
		assert.deepEqual(replayed.payload, classified.payload);
		const rows = (
			await audits(identity, ownerId, "support.classification.set")
		).filter((a) => a.subject_id === convId);
		assert.equal(
			rows.length,
			1,
			"Idempotent replay writes no second audit row",
		);
		assert.equal(rows[0].reason, "Eskalasi stok ukuran");
		assert.deepEqual(rows[0].details, {
			version: classified.payload.version,
			before: { priority: current.payload.priority, tag_ids: [] },
			after: { priority: "high", tag_ids: [tag.payload.id] },
		});

		// A refused change (stale version) commits neither the change nor an allowed audit row.
		const stale = await support(
			identity,
			owner,
			`/api/v1/admin/support/conversations/${convId}/classification`,
			{ ...input, priority: "low" },
		);
		assert.equal(stale.status, 409);
		assert.equal(
			(await audits(identity, ownerId, "support.classification.set")).filter(
				(a) => a.subject_id === convId,
			).length,
			1,
		);
	} finally {
		if (conversationIds.length > 0) {
			for (const table of [
				"support_in_app_notification",
				"support_challenge",
				"support_conversation_tag",
				"support_participant_preference",
				"support_assignment_event",
				"support_read_position",
				"support_internal_note",
				"support_context_card",
				"support_attachment",
				"support_message",
			]) {
				await sql`delete from ${sql(`app.${table}`)} where conversation_id in ${sql(conversationIds)}`;
			}
			await sql`delete from app.support_conversation where id in ${sql(conversationIds)}`;
		}
		if (tagIds.length > 0)
			await sql`delete from app.support_tag where id in ${sql(tagIds)}`;
		if (savedReplyIds.length > 0)
			await sql`delete from app.support_saved_reply where id in ${sql(savedReplyIds)}`;
		await f.close();
	}
});

test("S73: registering a payout evidence slot audits the replaced evidence reference in the same transaction", async () => {
	const f = await shippingFixture();
	const identity = f.identity;
	const sql = identity.sql;
	const affiliate = await actor(identity, "affiliate", []);
	const finance = await actor(identity, "finance", []);
	try {
		await enroll(finance.browser, finance.password);
		const enrollReq = affiliate.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
			referral_code: `AUDIT-${randomUUID().slice(0, 8).toUpperCase()}`,
			beneficiary_bank_code: "BCA",
			beneficiary_account_number: "1111222233",
			beneficiary_account_holder: "Mitra Audit",
		});
		enrollReq.headers.set("idempotency-key", randomUUID());
		const enrollRes = await handleAffiliateProfile(enrollReq, identity);
		assert.equal(enrollRes.status, 201);
		const profile = await enrollRes.json();

		const client = new CommerceClient(identity);
		const bootRes = new Response(null);
		await bootstrapGuest(identity, bootRes);
		client.absorb(bootRes);
		const buyer = await commerceActor(
			client.request("/api/v1/carts"),
			identity,
		);
		assert.ok(buyer);
		const line = f.line("fixture-offer-shirt");
		const cart = await sql.begin((tx) =>
			createCart(
				tx,
				client.request("/api/v1/carts", {}),
				identity,
				buyer,
				{
					lines: [
						{
							variant_id: line.offer_id,
							quantity: 1,
							expected_publication_id: line.publication_id,
						},
					],
				},
				{ clock_namespace: f.namespace },
			),
		);
		const token = await capability(
			identity,
			"cart",
			cart.cart.id,
			buyer.id,
			cart.cart.cap_issued_at as string,
		);
		const cookieRes = new Response(null);
		setCookie(
			cookieRes,
			`${await prefix(identity)}.cart_access`,
			`${cart.cart.id}.${token}`,
		);
		client.absorb(cookieRes);
		const quoteInput = {
			cart_id: cart.cart.id,
			address: {
				recipient_name: "Pembeli Audit",
				phone: "+6281200000073",
				address_line: "Jalan Audit 73",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281200000073" },
			payment_method: "prepaid" as const,
		};
		const quote = (await sql.begin((tx) =>
			createQuote(
				tx,
				client.request("/api/v1/checkout/quotes", quoteInput, { version: 1 }),
				identity,
				buyer,
				quoteInput,
				{ affiliate_id: profile.id },
			),
		)) as { id: string };
		const submitted = await sql.begin((tx) =>
			submitOrder(
				tx,
				client.request(
					"/api/v1/orders",
					{ quote_id: quote.id },
					{ version: 1 },
				),
				identity,
				buyer,
				{ quote_id: quote.id },
			),
		);
		const [unit] = await sql<
			{ fulfillment_item_id: string; order_item_id: string }[]
		>`
      select fi.id as fulfillment_item_id, fi.order_item_id
      from app.fulfillment_item fi
      join app.order_item oi on oi.id = fi.order_item_id
      where oi.order_id = ${submitted.order.id}
    `;
		await sql`
      insert into app.commission_entry (
        order_id, order_item_id, fulfillment_item_id, affiliate_id,
        basis_points, merchandise_amount, amount_idr, status,
        receipt_anchor, available_at, revision
      ) values (
        ${submitted.order.id}, ${unit.order_item_id}, ${unit.fulfillment_item_id}, ${profile.id},
        10000, 99000, 99000, 'eligible',
        '2026-06-01T00:00:00.000Z'::timestamptz, '2026-06-11T00:00:00.000Z'::timestamptz, 2
      )
    `;
		const [payout] = await sql.begin((tx) =>
			queueEligibleAffiliatePayouts(tx, { affiliateId: profile.id }),
		);
		assert.ok(payout);

		const claimReq = finance.browser.request(
			`/api/v1/admin/payouts/${payout.id}/manual-transfer-claims`,
			{ expected_version: 1, reauthentication_proof: `audit-${randomUUID()}` },
		);
		claimReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handlePayouts(claimReq, identity)).status, 200);

		const register = async () => {
			const req = finance.browser.request(
				`/api/v1/admin/payouts/${payout.id}/evidence-uploads`,
				{ file_name: "bukti.png", media_type: "image/png", size_bytes: 2048 },
			);
			req.headers.set("idempotency-key", randomUUID());
			const res = await handlePayouts(req, identity);
			assert.equal(res.status, 200);
			return (await res.json()) as { id: string };
		};
		const first = await register();
		const second = await register();

		const rows = (
			await audits(identity, finance.id, "payout.evidence_upload")
		).filter((a) => a.subject_id === payout.id);
		assert.equal(rows.length, 2);
		assert.equal(rows[0].outcome, "allowed");
		assert.equal(rows[0].details.evidence_id, first.id);
		assert.equal(rows[0].details.replaced_evidence_id, null);
		assert.equal(rows[1].details.evidence_id, second.id);
		assert.equal(
			rows[1].details.replaced_evidence_id,
			first.id,
			"Replacing the registered evidence reference leaves the prior id in the audit trail",
		);
		const [operation] = await sql<{ id: string }[]>`
      select id from app.access_operation
      where actor_id = ${finance.id} and action = 'payout.evidence_upload'
        and response->>'id' = ${second.id}
    `;
		assert.equal(rows[1].details.operation_id, operation.id);
		assert.ok(!JSON.stringify(rows).includes("1111222233"));
	} finally {
		try {
			await closeFulfillmentActor(identity, affiliate);
			await closeFulfillmentActor(identity, finance);
		} finally {
			await f.close();
		}
	}
});

test("S73: advertising pause/version/replay audits carry subject and details; refused and mid-way failed replays leave a trace", async () => {
	const f = await advertisingFixture();
	const ownerId = f.owner.id;
	const owner = (path: string, body?: Record<string, unknown>) =>
		handleAdvertisingDiagnostics(
			f.owner.browser.request(path, body),
			f.identity,
			path.split("/")[6],
		);
	const latest = async (action: string, subjectId: string) => {
		const rows = (await audits(f.identity, ownerId, action)).filter(
			(a) => a.subject_id === subjectId,
		);
		return rows.at(-1);
	};
	try {
		const list = await (
			await owner("/api/v1/admin/advertising/destinations")
		).json();
		const dest = (platform: string) =>
			list.data.find((d: { platform: string }) => d.platform === platform) as {
				id: string;
				version: number;
			};
		const base = (platform: string) =>
			`/api/v1/admin/advertising/destinations/${dest(platform).id}`;
		const version = async (platform: string) =>
			(await (await owner(`${base(platform)}/diagnostics`)).json())
				.version as number;

		await f.consent(f.client);
		const order = await f.order(f.client);
		const paid = await f.pay(f.client, order.id);
		assert.equal(await paid.complete(), true);
		const [event] = await f.identity.sql<{ id: string }[]>`
      select id from app.commerce_event where order_id = ${order.id}::uuid and name = 'Purchase'
    `;
		const denied = new CommerceClient(f.identity);
		await f.consent(denied, deniedChoices);
		const deniedOrder = await f.order(denied);
		const deniedPay = await f.pay(denied, deniedOrder.id);
		assert.equal(await deniedPay.complete(), true);
		const [suppressedEvent] = await f.identity.sql<{ id: string }[]>`
      select id from app.commerce_event where order_id = ${deniedOrder.id}::uuid and name = 'Purchase'
    `;

		// Version append audit
		const metaVersion = await version("meta");
		const appended = await owner(`${base("meta")}/versions`, {
			expected_version: metaVersion,
			public_identifier: `meta-pixel-audit-${randomUUID().slice(0, 6)}`,
			reason: "Rotasi piksel untuk audit",
		});
		assert.equal(appended.status, 201);
		const update = await latest(
			"advertising.destination.update",
			dest("meta").id,
		);
		assert.ok(update);
		assert.equal(update.reason, "Rotasi piksel untuk audit");
		assert.equal(update.details.version, metaVersion + 1);
		assert.equal(update.details.platform, "meta");
		assert.ok(update.details.before && update.details.after);
		assert.ok(!JSON.stringify(update).includes("secret://"));

		// Pause and resume audits
		const googleVersion = await version("google");
		assert.equal(
			(
				await owner(`${base("google")}/pause`, {
					expected_version: googleVersion,
					paused: true,
					reason: "Jeda untuk audit",
				})
			).status,
			200,
		);
		const pause = await latest(
			"advertising.destination.pause",
			dest("google").id,
		);
		assert.deepEqual(pause?.details, {
			platform: "google",
			version: googleVersion + 1,
			before: { paused: false },
			after: { paused: true },
		});
		assert.equal(
			(
				await owner(`${base("google")}/pause`, {
					expected_version: googleVersion + 1,
					paused: false,
					reason: "Lanjut setelah audit",
				})
			).status,
			200,
		);
		const resume = await latest(
			"advertising.destination.resume",
			dest("google").id,
		);
		assert.equal(resume?.reason, "Lanjut setelah audit");

		// Refused replay before any queue write still leaves a denied trace.
		const refused = await owner(`${base("google")}/replays`, {
			expected_version: googleVersion + 2,
			event_id: suppressedEvent.id,
			reason: "Replay tanpa izin",
		});
		assert.equal(refused.status, 409);
		const refusal = await latest(
			"advertising.destination.replay",
			dest("google").id,
		);
		assert.equal(refusal?.outcome, "denied");
		assert.equal(refusal?.reason, "CONSENT_SUPPRESSED");
		assert.equal(refusal?.details.event_id, suppressedEvent.id);

		// Successful replay: request row committed with the queue write, then the result row.
		const [googleOutbox] = await f.identity.sql<
			{ id: string; job_id: string }[]
		>`
      select id, job_id from app.ad_event_outbox where event_id = ${event.id}::uuid and platform = 'google'
    `;
		await f.identity.sql`
      update app.outbox_job
      set status = 'unknown', attempts = 1, dispatched_at = clock_timestamp(), last_error = 'LEASE_EXPIRED'
      where id = ${googleOutbox.job_id}::uuid
    `;
		const replay = await owner(`${base("google")}/replays`, {
			expected_version: googleVersion + 2,
			event_id: event.id,
			reason: "Replay terkontrol audit",
		});
		assert.equal(replay.status, 202);
		const requested = await latest(
			"advertising.destination.replay",
			dest("google").id,
		);
		assert.equal(requested?.outcome, "allowed");
		assert.equal(requested?.reason, "Replay terkontrol audit");
		assert.equal(requested?.details.outbox_id, googleOutbox.id);
		assert.equal(requested?.details.job_id, googleOutbox.job_id);
		const result = await latest(
			"advertising.destination.replay.result",
			dest("google").id,
		);
		assert.equal(result?.outcome, "allowed");
		assert.equal(result?.details.delivery_status, "accepted");

		// Mid-way failure: hold the effect mutex, withdraw consent while the queued replay
		// waits, then release. The dispatch cancels the signal and the replay fails after commit.
		const [tiktokOutbox] = await f.identity.sql<
			{ id: string; job_id: string; status: string }[]
		>`
      select id, job_id, status from app.ad_event_outbox where event_id = ${event.id}::uuid and platform = 'tiktok'
    `;
		assert.equal(tiktokOutbox.status, "queued");
		const tiktokVersion = await version("tiktok");
		let pending: Promise<Response> | null = null;
		await f.identity.sql.begin(async (tx) => {
			await tx`select pg_advisory_xact_lock(hashtextextended(${`ad-effect:${tiktokOutbox.id}`},0))`;
			pending = owner(`${base("tiktok")}/replays`, {
				expected_version: tiktokVersion,
				event_id: event.id,
				reason: "Replay yang gagal di tengah",
			});
			for (let i = 0; i < 200; i++) {
				const [job] = await f.identity.sql<
					{ dispatched_at: string | null; status: string }[]
				>`
          select dispatched_at, status from app.outbox_job where id = ${tiktokOutbox.job_id}::uuid
        `;
				if (job.status === "processing" && job.dispatched_at) break;
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			await f.consent(f.client, deniedChoices, 1);
		});
		const failed = await (pending as unknown as Promise<Response>);
		assert.equal(failed.status, 409);
		const failedRequest = await latest(
			"advertising.destination.replay",
			dest("tiktok").id,
		);
		assert.equal(
			failedRequest?.outcome,
			"allowed",
			"Queue write and its audit committed together",
		);
		assert.equal(failedRequest?.details.outbox_id, tiktokOutbox.id);
		const failedResult = await latest(
			"advertising.destination.replay.result",
			dest("tiktok").id,
		);
		assert.equal(failedResult?.outcome, "denied");
		assert.equal(failedResult?.reason, "CONSENT_SUPPRESSED");
		assert.equal(failedResult?.details.job_id, tiktokOutbox.job_id);
	} finally {
		await f.close();
	}
});
