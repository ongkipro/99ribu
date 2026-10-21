import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { runOneJob } from "../../src/jobs/worker.ts";
import { handleAdvertisingDiagnostics } from "../../src/modules/advertising/diagnostics.ts";
import { advertisingAdapter } from "../../src/modules/advertising/worker.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { advertisingFixture, deniedChoices } from "./advertising-fixture.ts";
import { CommerceClient } from "./checkout-fixture.ts";

test("T-30: owner-only advertising diagnostics, secret redaction, money-vs-signal reconciliation, versioned pause/resume, and controlled replay", async () => {
	const f = await advertisingFixture();
	const extraUsers: { id: string; email: string }[] = [];

	try {
		// 1. Create non-owner staff actors (finance, ecommerce_admin) and verify 401/403 enforcement
		const financeStaff = await actor(f.identity, "finance", []);
		extraUsers.push(financeStaff);
		await enroll(financeStaff.browser, financeStaff.password);

		const ecomAdmin = await actor(f.identity, "ecommerce_admin", []);
		extraUsers.push(ecomAdmin);
		await enroll(ecomAdmin.browser, ecomAdmin.password);

		const unauthRes = await handleAdvertisingDiagnostics(
			new Request(
				"http://127.0.0.1:3099/api/v1/admin/advertising/destinations",
			),
			f.identity,
		);
		assert.equal(unauthRes.status, 401);

		const financeDeniedRes = await handleAdvertisingDiagnostics(
			financeStaff.browser.request("/api/v1/admin/advertising/destinations"),
			f.identity,
		);
		assert.equal(financeDeniedRes.status, 403);

		const ecomDeniedRes = await handleAdvertisingDiagnostics(
			ecomAdmin.browser.request(
				"/api/v1/admin/advertising/destinations/meta/pause",
				{
					expected_version: 1,
					paused: true,
					reason: "Percobaan jeda oleh non-owner",
				},
			),
			f.identity,
			"meta",
		);
		assert.equal(ecomDeniedRes.status, 403);

		// 2. Owner lists destinations: verify secret redaction & Google UPLOAD_CLICKS source
		const listRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request("/api/v1/admin/advertising/destinations"),
			f.identity,
		);
		assert.equal(listRes.status, 200);
		const listPayload = await listRes.json();
		assert.equal(listPayload.data.length, 3);
		const rawJson = JSON.stringify(listPayload);
		assert.equal(
			rawJson.includes("secret://local/"),
			false,
			"Destination response must never leak raw secret_reference strings",
		);

		const googleDest = listPayload.data.find(
			(d: { platform: string }) => d.platform === "google",
		);
		assert.ok(googleDest);
		assert.equal(googleDest.google_conversion_source, "UPLOAD_CLICKS");
		assert.equal(googleDest.credentials_configured, true);
		assert.equal(googleDest.secret_redacted, true);
		assert.equal(googleDest.browser_purchase_enabled, false);

		// 3. Seed 1 consented prepaid order + 1 non-consented prepaid order
		await f.consent(f.client);
		const consentedOrder = await f.order(f.client);
		const consentedPay = await f.pay(f.client, consentedOrder.id);
		assert.equal(await consentedPay.complete(), true);

		const [consentedEvent] = await f.identity.sql<
			{ id: string; occurred_at: string }[]
		>`
      select id, occurred_at from app.commerce_event
      where order_id = ${consentedOrder.id}::uuid and name = 'Purchase'
    `;
		assert.ok(consentedEvent);

		// Second client with denied consent
		const noConsentClient = new CommerceClient(f.identity);
		await f.consent(noConsentClient, deniedChoices);
		const suppressedOrder = await f.order(noConsentClient);
		const suppressedPay = await f.pay(noConsentClient, suppressedOrder.id);
		assert.equal(await suppressedPay.complete(), true);

		const [suppressedEvent] = await f.identity.sql<
			{ id: string; occurred_at: string }[]
		>`
      select id, occurred_at from app.commerce_event
      where order_id = ${suppressedOrder.id}::uuid and name = 'Purchase'
    `;
		assert.ok(suppressedEvent);

		// Dispatch ONLY the meta outbox job for the consented Purchase event
		const [metaOutbox] = await f.identity.sql<{ id: string; job_id: string }[]>`
      select id, job_id from app.ad_event_outbox
      where event_id = ${consentedEvent.id}::uuid and platform = 'meta'
    `;
		assert.ok(metaOutbox?.job_id);
		assert.equal(
			await runOneJob(
				f.identity.sql,
				{ "advertising.dispatch": advertisingAdapter(f.identity.sql, "test") },
				metaOutbox.job_id,
			),
			true,
		);

		// Inspect Meta diagnostics: eligible, suppressed, queued, accepted, processed, attributed (null), and reconciliation
		const metaDiagRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request("/api/v1/admin/advertising/destinations/meta"),
			f.identity,
			"meta",
		);
		assert.equal(metaDiagRes.status, 200);
		const metaDiag = await metaDiagRes.json();
		assert.ok(metaDiag.accepted >= 1, "Meta must record accepted signal");
		assert.ok(
			metaDiag.processed >= 1,
			"Meta must record processed local sink signal",
		);
		assert.ok(
			metaDiag.suppressed >= 1,
			"Meta must record suppressed non-consented signal",
		);
		assert.equal(
			metaDiag.attributed,
			null,
			"API acceptance must never claim external ad attribution",
		);
		assert.ok(
			metaDiag.purchase_collection_instances > metaDiag.unique_orders,
			"Split-parcel collection instances must be distinguished from unique_orders count",
		);
		assert.ok(metaDiag.reconciliation.gross_merchandise_amount_idr >= 198000);
		assert.ok(
			metaDiag.reconciliation.dispatched_purchase_signal_amount_idr >= 99000,
		);
		assert.ok(
			metaDiag.reconciliation.suppressed_purchase_signal_amount_idr >= 99000,
		);
		assert.ok(metaDiag.missing_identity.orders_without_visitor_session >= 1);

		// 4. Versioned PATCH, Pause, Resume, and Stale expected_version (409)
		// Reject secret write or browser_purchase_enabled=true
		const secretWriteRes = await handleAdvertisingDiagnostics(
			new Request(
				"http://127.0.0.1:3099/api/v1/admin/advertising/destinations/meta",
				{
					method: "PATCH",
					headers: {
						origin: "http://127.0.0.1:3099",
						"content-type": "application/json",
						cookie: [...f.owner.browser.cookies]
							.map(([k, v]) => `${k}=${v}`)
							.join("; "),
					},
					body: JSON.stringify({
						expected_version: metaDiag.version,
						secret_reference: "secret://injected",
						reason: "Percobaan tulis rahasia",
					}),
				},
			),
			f.identity,
			"meta",
		);
		assert.equal(secretWriteRes.status, 400);

		// Valid PATCH on meta
		const patchMetaRes = await handleAdvertisingDiagnostics(
			new Request(
				"http://127.0.0.1:3099/api/v1/admin/advertising/destinations/meta",
				{
					method: "PATCH",
					headers: {
						origin: "http://127.0.0.1:3099",
						"content-type": "application/json",
						cookie: [...f.owner.browser.cookies]
							.map(([k, v]) => `${k}=${v}`)
							.join("; "),
					},
					body: JSON.stringify({
						expected_version: metaDiag.version,
						public_identifier: "meta-pixel-local-002",
						reason: "Rotasi ID piksel publik Meta",
					}),
				},
			),
			f.identity,
			"meta",
		);
		assert.equal(patchMetaRes.status, 200);
		const patchedMeta = await patchMetaRes.json();
		assert.equal(patchedMeta.version, metaDiag.version + 1);
		assert.equal(patchedMeta.public_identifier, "meta-pixel-local-002");

		// Stale expected_version on PATCH -> 409
		const stalePatchRes = await handleAdvertisingDiagnostics(
			new Request(
				"http://127.0.0.1:3099/api/v1/admin/advertising/destinations/meta",
				{
					method: "PATCH",
					headers: {
						origin: "http://127.0.0.1:3099",
						"content-type": "application/json",
						cookie: [...f.owner.browser.cookies]
							.map(([k, v]) => `${k}=${v}`)
							.join("; "),
					},
					body: JSON.stringify({
						expected_version: metaDiag.version,
						public_identifier: "meta-pixel-stale",
						reason: "Stale version test",
					}),
				},
			),
			f.identity,
			"meta",
		);
		assert.equal(stalePatchRes.status, 409);

		// Pause Google destination
		const googleBeforeRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request("/api/v1/admin/advertising/destinations/google"),
			f.identity,
			"google",
		);
		const googleBefore = await googleBeforeRes.json();

		const pauseGoogleRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request(
				"/api/v1/admin/advertising/destinations/google/pause",
				{
					expected_version: googleBefore.version,
					paused: true,
					reason: "Jeda pengiriman Google Ads selama audit",
				},
			),
			f.identity,
			"google",
		);
		assert.equal(pauseGoogleRes.status, 200);
		const pausedGoogle = await pauseGoogleRes.json();
		assert.equal(pausedGoogle.paused, true);
		assert.equal(pausedGoogle.version, googleBefore.version + 1);

		// Replay while destination is paused -> 409 DESTINATION_PAUSED
		const replayWhilePausedRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request(
				"/api/v1/admin/advertising/destinations/google/replays",
				{
					expected_version: pausedGoogle.version,
					event_id: consentedEvent.id,
					reason: "Replay saat tujuan masih dijeda",
				},
			),
			f.identity,
			"google",
		);
		assert.equal(replayWhilePausedRes.status, 409);

		// Resume Google destination
		const resumeGoogleRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request(
				"/api/v1/admin/advertising/destinations/google/resume",
				{
					expected_version: pausedGoogle.version,
					paused: false,
					reason: "Melanjutkan pengiriman Google Ads setelah audit",
				},
			),
			f.identity,
			"google",
		);
		assert.equal(resumeGoogleRes.status, 200);
		const resumedGoogle = await resumeGoogleRes.json();
		assert.equal(resumedGoogle.paused, false);
		assert.equal(resumedGoogle.version, pausedGoogle.version + 1);

		// 5. Controlled Replay:
		// 5a. Replay of suppressed (no-consent) event -> 409 CONSENT_SUPPRESSED
		const replaySuppressedRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request(
				"/api/v1/admin/advertising/destinations/google/replays",
				{
					expected_version: resumedGoogle.version,
					event_id: suppressedEvent.id,
					reason: "Percobaan replay kejadian tanpa izin",
				},
			),
			f.identity,
			"google",
		);
		assert.equal(replaySuppressedRes.status, 409);

		// 5b. Simulate a timed-out/unknown dispatch on Google for consentedEvent, then replay it!
		const [googleOutbox] = await f.identity.sql<
			{ id: string; job_id: string }[]
		>`
      select id, job_id from app.ad_event_outbox
      where event_id = ${consentedEvent.id}::uuid and platform = 'google'
    `;
		assert.ok(googleOutbox?.job_id);
		await f.identity.sql`
      update app.outbox_job
      set status = 'unknown', attempts = 1, dispatched_at = clock_timestamp(), last_error = 'LEASE_EXPIRED'
      where id = ${googleOutbox.job_id}::uuid
    `;

		const replayValidRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request(
				"/api/v1/admin/advertising/destinations/google/replays",
				{
					expected_version: resumedGoogle.version,
					event_id: consentedEvent.id,
					reason: "Replay terkontrol setelah batas waktu habis",
				},
			),
			f.identity,
			"google",
		);
		assert.equal(replayValidRes.status, 202);
		const replayValid = await replayValidRes.json();
		assert.equal(replayValid.event_id, consentedEvent.id);
		assert.equal(
			replayValid.occurred_at,
			new Date(consentedEvent.occurred_at).toISOString(),
		);
		assert.equal(replayValid.delivery_status, "accepted");

		// Verify local_ad_sink preserved original event_id and occurred_at
		const [googleSink] = await f.identity.sql<
			{ event_id: string; payload: { event_id: string; occurred_at: string } }[]
		>`
      select event_id, payload from app.local_ad_sink
      where outbox_id = ${googleOutbox.id}::uuid and platform = 'google'
    `;
		assert.ok(googleSink);
		assert.equal(googleSink.event_id, consentedEvent.id);
		assert.equal(googleSink.payload.event_id, consentedEvent.id);
		assert.equal(
			googleSink.payload.occurred_at,
			new Date(consentedEvent.occurred_at).toISOString(),
		);

		// 5c. Withdraw consent on f.client and verify replay on tiktok (which was still queued) is refused with 409!
		await f.consent(f.client, deniedChoices, 1);
		const tiktokBeforeRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request("/api/v1/admin/advertising/destinations/tiktok"),
			f.identity,
			"tiktok",
		);
		const tiktokBefore = await tiktokBeforeRes.json();

		const replayWithdrawnRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request(
				"/api/v1/admin/advertising/destinations/tiktok/replays",
				{
					expected_version: tiktokBefore.version,
					event_id: consentedEvent.id,
					reason: "Percobaan replay setelah pencabutan izin",
				},
			),
			f.identity,
			"tiktok",
		);
		assert.equal(replayWithdrawnRes.status, 409);

		const unknownPlatformRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request(
				`/api/v1/admin/advertising/destinations/${randomUUID()}`,
			),
			f.identity,
			randomUUID(),
		);
		assert.equal(unknownPlatformRes.status, 404);
	} finally {
		await cleanup(f.identity, extraUsers);
		await f.close();
	}
});
