import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
	chmodSync,
	lstatSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import postgres, { type Sql, type TransactionSql } from "postgres";
import {
	assertLocalNextCommand,
	privateDirectory,
	readLocalConfig,
} from "../../src/config/local.ts";
import { expireLeases } from "../../src/jobs/leases.ts";
import { runOneJob } from "../../src/jobs/worker.ts";
import {
	challengeVerificationCode,
	handleAccounts,
} from "../../src/modules/accounts/service.ts";
import { handleAdvertisingDiagnostics } from "../../src/modules/advertising/diagnostics.ts";
import { localGoogleSink } from "../../src/modules/advertising/google/offline-clicks.ts";
import { localMetaSink } from "../../src/modules/advertising/meta/capi.ts";
import { handleSignals } from "../../src/modules/advertising/routes.ts";
import { localTiktokSink } from "../../src/modules/advertising/tiktok/events-api.ts";
import { advertisingAdapter } from "../../src/modules/advertising/worker.ts";
import { handleAffiliateProfile } from "../../src/modules/affiliates/profile.ts";
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
import {
	accrueOrderCommissions,
	handleCommissions,
	holdUnitCommission,
	matureEligibleCommissions,
	recordUnitReceiptMaturity,
} from "../../src/modules/commissions/service.ts";
import { handleShippingLabels } from "../../src/modules/documents/labels.ts";
import {
	ingestWaybillEvent,
	simulateWaybillIssue,
} from "../../src/modules/fulfillment/local.ts";
import {
	advanceFixtureClock,
	readFixtureClock,
} from "../../src/modules/local/fixtures.ts";
import { handleOrderReceipt } from "../../src/modules/orders/receipt.ts";
import { createAttempt } from "../../src/modules/payments/attempts.ts";
import {
	ingestProviderEvent,
	simulateCollection,
} from "../../src/modules/payments/local.ts";
import {
	handlePayouts,
	queueEligibleAffiliatePayouts,
} from "../../src/modules/payouts/service.ts";
import { handleReporting } from "../../src/modules/reporting/service.ts";
import { handleSupport } from "../../src/modules/support/routes.ts";
import {
	readPrivateArtifact,
	savePrivateArtifact,
} from "../../src/storage/private.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { grantedChoices } from "./advertising-fixture.ts";
import { CommerceClient } from "./checkout-fixture.ts";
import {
	closeFulfillmentActor,
	fulfillmentFixture,
} from "./fulfillment-fixture.ts";

function validPngBytes(): Uint8Array {
	return new Uint8Array([
		0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
		0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
		0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
	]);
}

// S67 backup/restore uses the pinned PostgreSQL 18 client binaries inside this checkout's compose
// container; the project name matches scripts/database.ts.
const composeProject = `99ribu-${createHash("sha256").update(process.cwd()).digest("hex").slice(0, 10)}`;
function containerPostgres(args: string[], input?: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			"docker",
			[
				"compose",
				"--project-name",
				composeProject,
				"--file",
				"compose.yaml",
				"exec",
				"-T",
				"database",
				...args,
			],
			{
				env: {
					...process.env,
					LOCAL_UID: String(process.getuid?.()),
					LOCAL_GID: String(process.getgid?.()),
				},
			},
		);
		const out: Buffer[] = [];
		const err: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
		child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
		child.on("error", reject);
		// An early exit closes stdin; the exit code and stderr below carry the real failure.
		child.stdin.on("error", () => {});
		child.on("close", (code) =>
			code === 0
				? resolve(Buffer.concat(out))
				: reject(
						new Error(
							`${args[0]} exited ${code}: ${Buffer.concat(err).toString()}`,
						),
					),
		);
		child.stdin.end(input);
	});
}
// Database creation, pg_dump snapshots and pg_restore require the cluster bootstrap role on the private socket.
function superuserConnection(database: string) {
	return postgres({
		path: join(privateDirectory("pgsocket"), ".s.PGSQL.5432"),
		database,
		username: "bootstrap",
		max: 1,
		connect_timeout: 3,
		onnotice: () => {},
	});
}
const restoreParityTables = [
	"commerce_order",
	"order_item",
	"economic_receipt",
	"finance_transaction",
	"finance_posting",
	"commission_entry",
	"commission_adjustment",
	"affiliate_payout",
	"affiliate_payout_entry",
	"affiliate_payout_event",
	"inventory_balance",
	"outbox_job",
	"role_grant",
] as const;
async function restoreInventory(db: Sql | TransactionSql) {
	const [{ tables, triggers, functions }] = await db<
		{ tables: number; triggers: number; functions: number }[]
	>`
		select
			(select count(*)::int from pg_tables where schemaname = 'app') as tables,
			(select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid
				where c.relnamespace = 'app'::regnamespace and not t.tgisinternal) as triggers,
			(select count(*)::int from pg_proc where pronamespace = 'app'::regnamespace) as functions
	`;
	const rows: Record<string, number> = {};
	for (const table of restoreParityTables) {
		const [{ n }] = await db.unsafe<{ n: number }[]>(
			`select count(*)::int as n from app."${table}"`,
		);
		rows[table] = n;
	}
	return { tables, triggers, functions, rows };
}

function assertPrivateCacheControl(headers: Headers, label: string) {
	const cc = (headers.get("cache-control") ?? "").toLowerCase();
	assert.ok(
		cc.includes("no-store"),
		`Expected ${label} to set Cache-Control with no-store, got "${cc}"`,
	);
}

test("S65 & S66 integration: assembled localhost journey across all domains enforces loopback local config, private no-store headers, and zero external HTTP dispatch", async () => {
	// 1. S65 Localhost Profile & Listener Guard Verification
	const localCfg = readLocalConfig(process.env);
	assert.deepEqual(localCfg, {
		origin: "http://127.0.0.1:3099",
		hostname: "127.0.0.1",
		port: 3099,
		// The opt-in tailnet origin is absent by default: loopback is the only served origin.
		tailnetOrigin: null,
		trustedOrigins: ["http://127.0.0.1:3099"],
	});
	assert.equal(process.env.APP_ENV, "local");
	assert.equal(process.env.EXTERNAL_DISPATCH, "disabled");

	assert.doesNotThrow(() => assertLocalNextCommand(["build"]));
	assert.doesNotThrow(() =>
		assertLocalNextCommand([
			"start",
			"--hostname",
			"127.0.0.1",
			"--port",
			"3099",
		]),
	);
	assert.doesNotThrow(() =>
		assertLocalNextCommand([
			"dev",
			"--hostname",
			"127.0.0.1",
			"--port",
			"3099",
		]),
	);
	assert.throws(
		() =>
			assertLocalNextCommand([
				"start",
				"--hostname",
				"0.0.0.0",
				"--port",
				"3000",
			]),
		/fixed local listener/,
	);

	assert.throws(
		() => readLocalConfig({ ...process.env, APP_ENV: "production" }),
		/APP_ENV must be local/,
	);
	assert.throws(
		() =>
			readLocalConfig({
				...process.env,
				APP_ORIGIN: "https://99ribu.example",
			}),
		/canonical loopback origin/,
	);
	assert.throws(
		() => readLocalConfig({ ...process.env, EXTERNAL_DISPATCH: "enabled" }),
		/EXTERNAL_DISPATCH must be disabled/,
	);
	assert.throws(
		() => readLocalConfig({ ...process.env, PAYMENT_ADAPTER: "live" }),
		/PAYMENT_ADAPTER must be simulated/,
	);
	assert.throws(
		() =>
			readLocalConfig({
				...process.env,
				META_ACCESS_TOKEN: "forbidden-live-token",
			}),
		/Provider configuration is forbidden/,
	);

	// 2. Instrument globalThis.fetch to prove ZERO outgoing external HTTP requests occur across all domains
	const originalFetch = globalThis.fetch;
	let externalFetchCalls = 0;
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		externalFetchCalls++;
		throw new Error(
			`Forbidden outgoing HTTP fetch in assembled localhost test: ${String(input)}`,
		);
	}) as typeof fetch;

	const f = await fulfillmentFixture("prepaid");
	const identity = f.identity;
	const sql = identity.sql;
	const [parcelA, parcelB] = f.parcels;
	assert.ok(parcelA && parcelB);

	const extraActors: Awaited<ReturnType<typeof actor>>[] = [];
	const createdConversationIds: string[] = [];
	let attributedOrderId: string | null = null;

	try {
		const warehouseStaff = await actor(identity, "warehouse", [
			String(parcelA.warehouse_id),
		]);
		extraActors.push(warehouseStaff);
		await enroll(warehouseStaff.browser, warehouseStaff.password);

		const financeStaff = await actor(identity, "finance", []);
		extraActors.push(financeStaff);
		await enroll(financeStaff.browser, financeStaff.password);

		const csStaff = await actor(identity, "customer_service", []);
		extraActors.push(csStaff);
		await enroll(csStaff.browser, csStaff.password);

		const affiliateActor = await actor(identity, "affiliate", []);
		extraActors.push(affiliateActor);

		const buyerActor = await actor(identity, "buyer", []);
		extraActors.push(buyerActor);

		// 3. Affiliate Enrollment (S35)
		const refCode = `READY99-${randomUUID().slice(0, 6).toUpperCase()}`;
		const enrollReq = affiliateActor.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
			referral_code: refCode,
			display_name: "Mitra Kesiapan Lokal",
			beneficiary_bank_code: "BCA",
			beneficiary_account_number: "7788990011",
			beneficiary_account_holder: "Mitra Kesiapan Lokal",
		});
		enrollReq.headers.set("idempotency-key", randomUUID());
		const enrollRes = await handleAffiliateProfile(enrollReq, identity);
		assert.equal(enrollRes.status, 201);
		assertPrivateCacheControl(enrollRes.headers, "POST /api/v1/me/affiliate");
		const affiliateProfile = await enrollRes.json();
		assert.ok(String(affiliateProfile.referral_url).includes(refCode));

		// 4. Consented Buyer Cart, Checkout, Attributed Order, Prepaid Payment & Ledger (S19–S25)
		const buyerClient = new CommerceClient(identity);
		const visitorBody = { client_request_id: randomUUID() };
		const visitorKey = randomUUID();
		let visRes = await handleSignals(
			buyerClient.request("/api/v1/visitor-sessions", visitorBody, {
				key: visitorKey,
			}),
			identity,
		);
		buyerClient.absorb(visRes);
		if (visRes.status === 401) {
			visRes = await handleSignals(
				buyerClient.request("/api/v1/visitor-sessions", visitorBody, {
					key: visitorKey,
				}),
				identity,
			);
			buyerClient.absorb(visRes);
		}
		assert.equal(visRes.status, 201);
		assertPrivateCacheControl(visRes.headers, "POST /api/v1/visitor-sessions");

		const consentRes = await handleSignals(
			buyerClient.request("/api/v1/consent/receipt", {
				expected_version: 0,
				policy_version: "local-privacy-v1",
				choices: grantedChoices,
			}),
			identity,
		);
		buyerClient.absorb(consentRes);
		assert.equal(consentRes.status, 201);
		assertPrivateCacheControl(
			consentRes.headers,
			"POST /api/v1/consent/receipt",
		);

		const bootRes = new Response(null);
		await bootstrapGuest(identity, bootRes, new Request("http://127.0.0.1:3099/api/v1/carts", { method: "POST" }));
		buyerClient.absorb(bootRes);
		const guestBuyer = await commerceActor(
			buyerClient.request("/api/v1/carts"),
			identity,
		);
		assert.ok(guestBuyer && guestBuyer.kind === "guest");

		await f.move("fixture-malang:fixture-shirt", "receive", 2);
		const createdCart = await sql.begin((tx) =>
			createCart(
				tx,
				buyerClient.request("/api/v1/carts", {}),
				identity,
				guestBuyer,
				{
					lines: [f.line("fixture-offer-shirt", 2)],
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
		buyerClient.absorb(cartCookieRes);

		const quoteInput = {
			cart_id: createdCart.cart.id,
			address: {
				recipient_name: "Sari Kesiapan",
				phone: "+6281277776666",
				address_line: "Jl. Kesiapan Lokal No. 99",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281277776666" },
			payment_method: "prepaid" as const,
		};
		const quote = (await sql.begin((tx) =>
			createQuote(
				tx,
				buyerClient.request("/api/v1/checkout/quotes", quoteInput, {
					version: 1,
				}),
				identity,
				guestBuyer,
				quoteInput,
				{ affiliate_id: affiliateProfile.id },
			),
		)) as { id: string };

		const submitted = await sql.begin((tx) =>
			submitOrder(
				tx,
				buyerClient.request(
					"/api/v1/orders",
					{ quote_id: quote.id },
					{ version: 1 },
				),
				identity,
				guestBuyer,
				{ quote_id: quote.id },
			),
		);
		attributedOrderId = submitted.order.id;
		assert.equal(Number(submitted.order.merchandise_amount), 198000);

		await sql`
			update app.local_fixture_namespace
			set clock = greatest(clock, clock_timestamp()) + interval '1 second',
				revision = revision + 1
			where name = ${f.namespace}
		`;
		const attempt = await sql.begin((tx) =>
			createAttempt(tx, submitted.order.id, randomUUID(), {
				method_id: "local-prepaid",
			}),
		);
		const [storedAttempt] = await sql<{ creation_job_id: string }[]>`
			select creation_job_id from app.payment_attempt where id = ${attempt.id}
		`;
		await f.run(storedAttempt.creation_job_id);
		const payEvent = await simulateCollection(sql, "test", attempt.id);
		const payCallbackJob = await ingestProviderEvent(sql, payEvent);
		await f.run(payCallbackJob);

		// Verify Finance Ledger & Economic Receipt Invariants (S23–S24)
		const [receiptRow] = await sql<
			{
				id: string;
				transaction_id: string;
				amount: string;
				merchandise_amount: string;
			}[]
		>`
			select id, transaction_id, amount::text, merchandise_amount::text
			from app.economic_receipt
			where order_id = ${submitted.order.id}
		`;
		assert.ok(receiptRow);
		assert.equal(receiptRow.merchandise_amount, "198000");

		const [journalBalance] = await sql<
			{ debits: string; credits: string; lines: number }[]
		>`
			select
				coalesce(sum(amount) filter (where side = 'debit'), 0)::text as debits,
				coalesce(sum(amount) filter (where side = 'credit'), 0)::text as credits,
				count(*)::int as lines
			from app.finance_posting
			where transaction_id = ${receiptRow.transaction_id}
		`;
		assert.equal(journalBalance.lines, 2);
		assert.equal(journalBalance.debits, receiptRow.amount);
		assert.equal(journalBalance.credits, receiptRow.amount);

		// 5. Canonical Signals & Meta/Google/TikTok Local Sinks + Owner Diagnostics (S25, S57–S60)
		const outboxRows = await sql<
			{ id: string; platform: string; job_id: string; status: string; reason: string }[]
		>`
			select o.id, o.platform, o.job_id, o.status, o.reason
			from app.ad_event_outbox o
			join app.commerce_event e on e.id = o.event_id
			where e.order_id = ${submitted.order.id} and e.name = 'Purchase'
			order by o.platform
		`;
		assert.equal(outboxRows.length, 3);
		assert.deepEqual(
			outboxRows.map((row) => row.reason),
			["eligible", "eligible", "eligible"],
			"Consented Purchase must be dispatch-eligible; source_not_eligible means the fixture clock ran ahead of the database clock",
		);
		for (const row of outboxRows) {
			assert.equal(
				await runOneJob(
					sql,
					{ "advertising.dispatch": advertisingAdapter(sql, "test") },
					row.job_id,
				),
				true,
			);
		}
		const [sinkCount] = await sql<{ n: number }[]>`
			select count(*)::int as n
			from app.local_ad_sink s
			join app.commerce_event e on e.id = s.event_id
			where e.order_id = ${submitted.order.id}
		`;
		assert.equal(sinkCount.n, 3);

		assert.equal(localMetaSink().dispatch().status, "disabled");
		assert.equal(localGoogleSink().dispatch().status, "disabled");
		assert.equal(localTiktokSink().dispatch().status, "disabled");

		const adDiagRes = await handleAdvertisingDiagnostics(
			f.owner.browser.request("/api/v1/admin/advertising/destinations"),
			identity,
		);
		assert.equal(adDiagRes.status, 200);
		assertPrivateCacheControl(
			adDiagRes.headers,
			"GET /api/v1/admin/advertising/destinations",
		);
		const adDiagText = await adDiagRes.text();
		assert.equal(
			adDiagText.includes("secret://local/"),
			false,
			"Advertising diagnostics must redact secret_reference",
		);

		const adDeniedFinance = await handleAdvertisingDiagnostics(
			financeStaff.browser.request("/api/v1/admin/advertising/destinations"),
			identity,
		);
		assert.equal(adDeniedFinance.status, 403);

		// 6. Commission Accrual, Hold, Maturity & Manual Payout Queue (S36–S37)
		const accrued = await sql.begin((tx) =>
			accrueOrderCommissions(tx, { orderId: submitted.order.id }),
		);
		assert.equal(accrued.length, 2);

		await sql.begin(async (tx) => {
			await holdUnitCommission(tx, {
				fulfillmentItemId: accrued[0].fulfillment_item_id,
				holdReason: "Pemeriksaan unit retur berjalan",
			});
			await recordUnitReceiptMaturity(tx, {
				fulfillmentItemId: accrued[1].fulfillment_item_id,
				receivedAt: "2026-05-01T08:00:00.000Z",
			});
			await tx`
				update app.commission_entry
				set amount_idr = 99000
				where id = ${accrued[1].id}
			`;
			await matureEligibleCommissions(tx, {
				affiliateId: affiliateProfile.id,
				asOf: "2026-05-12T08:00:00.000Z",
			});
			await queueEligibleAffiliatePayouts(tx, {
				affiliateId: affiliateProfile.id,
				asOf: "2026-05-12T08:05:00.000Z",
			});
		});

		const affBalanceRes = await handleCommissions(
			affiliateActor.browser.request("/api/v1/me/affiliate/balance"),
			identity,
		);
		assert.equal(affBalanceRes.status, 200);
		assertPrivateCacheControl(
			affBalanceRes.headers,
			"GET /api/v1/me/affiliate/balance",
		);
		const affBalance = await affBalanceRes.json();
		assert.equal(affBalance.allocated, 99000);
		assert.ok(affBalance.held > 0);

		const affPayoutsRes = await handlePayouts(
			affiliateActor.browser.request("/api/v1/me/affiliate/payouts"),
			identity,
		);
		assert.equal(affPayoutsRes.status, 200);
		assertPrivateCacheControl(
			affPayoutsRes.headers,
			"GET /api/v1/me/affiliate/payouts",
		);
		const affPayouts = await affPayoutsRes.json();
		assert.equal(affPayouts.data.length, 1);
		assert.equal(affPayouts.data[0].status, "queued");

		// Manual withdrawal attempt by affiliate is refused (404)
		const manualWithdrawReq = affiliateActor.browser.request(
			"/api/v1/me/affiliate/payouts",
			{},
		);
		manualWithdrawReq.headers.set("idempotency-key", randomUUID());
		assert.equal(
			(await handlePayouts(manualWithdrawReq, identity)).status,
			404,
		);

		// 7. Fulfillment Waybill & Scoped Private Shipping Labels (S29, S54)
		const bookingA = await f.book(parcelA);
		await f.run(bookingA.creation_job_id);
		for (const cb of await sql<{ callback_job_id: string }[]>`
			select callback_job_id from app.waybill_provider_event where booking_id = ${bookingA.id}
		`) {
			await f.run(cb.callback_job_id);
		}
		const issuedWaybill = await simulateWaybillIssue(sql, "test", bookingA.id);
		await f.run(await ingestWaybillEvent(sql, issuedWaybill));

		const labelJobReq = warehouseStaff.browser.request(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/label-jobs`,
			{ format: "thermal_100x150" },
		);
		labelJobReq.headers.set("idempotency-key", randomUUID());
		const labelJobRes = await handleShippingLabels(labelJobReq, identity);
		assert.equal(labelJobRes.status, 202);
		assertPrivateCacheControl(
			labelJobRes.headers,
			"POST /api/v1/admin/shipments/[id]/label-jobs",
		);
		const labelJob = await labelJobRes.json();
		assert.equal(labelJob.status, "succeeded");

		const pdfRes = await handleShippingLabels(
			warehouseStaff.browser.request(
				`/api/v1/admin/label-artifacts/${labelJob.artifact_id}/content`,
			),
			identity,
		);
		assert.equal(pdfRes.status, 200);
		assertPrivateCacheControl(
			pdfRes.headers,
			"GET /api/v1/admin/label-artifacts/[id]/content",
		);
		const pdfBytes = Buffer.from(await pdfRes.arrayBuffer());
		assert.ok(pdfBytes.toString("utf8").startsWith("%PDF-1.4"));

		// Cross-warehouse label access denied for warehouseStaff
		const crossWhReq = warehouseStaff.browser.request(
			`/api/v1/admin/shipments/${parcelB.shipment_id}/label-jobs`,
			{ format: "thermal_100x150" },
		);
		crossWhReq.headers.set("idempotency-key", randomUUID());
		assert.equal(
			(await handleShippingLabels(crossWhReq, identity)).status,
			403,
		);

		// 8. Buyer Account, Mononym Profile, Address Book & Linked Order Receipt (S46–S48)
		const profileReq = buyerActor.browser.request("/api/v1/me/profile", {
			expected_version: 1,
			display_name: "Kartini",
			email: null,
		});
		profileReq.headers.set("idempotency-key", randomUUID());
		const profileRes = await handleAccounts(profileReq, identity);
		assert.equal(profileRes.status, 201);
		assertPrivateCacheControl(profileRes.headers, "POST /api/v1/me/profile");

		const addrReq = buyerActor.browser.request("/api/v1/me/addresses", {
			expected_book_version: 0,
			address: {
				label: "Rumah",
				recipient_name: "Kartini",
				phone: "081234567890",
				street: "Jl. Kartini No. 21",
				district: "Menteng",
				city: "Jakarta Pusat",
				province: "DKI Jakarta",
				postcode: "10310",
			},
		});
		addrReq.headers.set("idempotency-key", randomUUID());
		const addrRes = await handleAccounts(addrReq, identity);
		assert.equal(addrRes.status, 201);
		assertPrivateCacheControl(addrRes.headers, "POST /api/v1/me/addresses");
		const addrPayload = await addrRes.json();
		assert.equal(addrPayload.is_default, true);

		const [quoteContact] = await sql<{ phone: string }[]>`
			select q.document->'contact'->>'phone' as phone
			from app.commerce_order o
			join app.checkout_quote q on q.id = o.quote_id
			where o.id = ${f.order.id}
		`;
		const linkChReq = buyerActor.browser.request(
			"/api/v1/me/guest-order-link-challenges",
			{
				order_id: f.order.id,
				contact: quoteContact.phone,
			},
		);
		linkChReq.headers.set("idempotency-key", randomUUID());
		const linkChRes = await handleAccounts(linkChReq, identity);
		assert.equal(linkChRes.status, 201);
		const linkCh = await linkChRes.json();
		const otp = await challengeVerificationCode(identity, linkCh.challenge_id);

		const verifyLinkReq = buyerActor.browser.request(
			`/api/v1/me/guest-order-link-challenges/${linkCh.challenge_id}/verifications`,
			{ code: otp },
		);
		verifyLinkReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleAccounts(verifyLinkReq, identity)).status, 201);

		const receiptRes = await handleOrderReceipt(
			buyerActor.browser.request(`/api/v1/orders/${f.order.id}/receipt`),
			identity,
		);
		assert.equal(receiptRes.status, 200);
		assertPrivateCacheControl(
			receiptRes.headers,
			"GET /api/v1/orders/[id]/receipt",
		);
		const receiptBody = await receiptRes.json();
		assert.equal(receiptBody.order.id, f.order.id);
		assert.match(receiptBody.ship_to.phone_masked, /^\+62••••/);

		// 9. Support Chat, Private Attachment & Staff Note Isolation (S41–S43)
		const convReq = buyerActor.browser.request(
			"/api/v1/support/conversations",
			{
				client_conversation_id: `conv-${randomUUID()}`,
			},
		);
		convReq.headers.set("idempotency-key", randomUUID());
		const convRes = await handleSupport(convReq, identity);
		assert.equal(convRes.status, 200);
		assertPrivateCacheControl(
			convRes.headers,
			"POST /api/v1/support/conversations",
		);
		const conv = await convRes.json();
		createdConversationIds.push(conv.id as string);

		const claimConvReq = csStaff.browser.request(
			`/api/v1/admin/support/conversations/${conv.id}/claims`,
			{ expected_version: 1 },
		);
		claimConvReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleSupport(claimConvReq, identity)).status, 200);

		const internalSecret = `STAFF-PRIVATE-NOTE-${randomUUID()}`;
		const noteReq = csStaff.browser.request(
			`/api/v1/admin/support/conversations/${conv.id}/notes`,
			{ text: internalSecret },
		);
		noteReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleSupport(noteReq, identity)).status, 200);

		const replyReq = csStaff.browser.request(
			`/api/v1/admin/support/conversations/${conv.id}/messages`,
			{
				client_message_id: `msg-${randomUUID()}`,
				text: "Halo kak Kartini, pesanan Rp99.000 Anda sedang kami siapkan.",
				attachment_ids: [],
			},
		);
		replyReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleSupport(replyReq, identity)).status, 200);

		const buyerMsgsRes = await handleSupport(
			buyerActor.browser.request(
				`/api/v1/support/conversations/${conv.id}/messages`,
			),
			identity,
		);
		assert.equal(buyerMsgsRes.status, 200);
		assertPrivateCacheControl(
			buyerMsgsRes.headers,
			"GET /api/v1/support/conversations/[id]/messages",
		);
		const buyerMsgsText = await buyerMsgsRes.text();
		assert.equal(
			buyerMsgsText.includes(internalSecret),
			false,
			"Internal CS note must never leak to customer message responses",
		);

		// 10. Admin Dashboards & Role-Scoped Work Queues (S49–S53)
		const whDashRes = await handleReporting(
			warehouseStaff.browser.request(
				`/api/v1/admin/dashboard?workspace=warehouse&warehouse_id=${parcelA.warehouse_id}`,
			),
			identity,
		);
		assert.equal(whDashRes.status, 200);
		assertPrivateCacheControl(whDashRes.headers, "GET /api/v1/admin/dashboard");
		const whDash = await whDashRes.json();
		assert.ok(
			whDash.metrics.every(
				(m: { kind: string; amount: number | null }) =>
					m.kind === "count" && m.amount === null,
			),
			"Warehouse dashboard must never leak whole-order money metrics",
		);

		const ownerDashRes = await handleReporting(
			f.owner.browser.request("/api/v1/admin/dashboard?workspace=owner"),
			identity,
		);
		assert.equal(ownerDashRes.status, 200);
		assertPrivateCacheControl(
			ownerDashRes.headers,
			"GET /api/v1/admin/dashboard (owner)",
		);
		const ownerDash = await ownerDashRes.json();
		assert.ok(
			ownerDash.metrics.some((m: { kind: string }) => m.kind === "money"),
		);

		assert.equal(
			externalFetchCalls,
			0,
			"Zero outgoing external HTTP calls occurred across the entire multi-domain journey",
		);
	} finally {
		globalThis.fetch = originalFetch;
		if (createdConversationIds.length > 0) {
			await sql`delete from app.support_in_app_notification where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_assignment_event where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_read_position where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_internal_note where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_message where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_conversation where id in ${sql(createdConversationIds)}`;
		}
		if (attributedOrderId) {
			const clock = await readFixtureClock("test", f.namespace);
			await advanceFixtureClock("test", f.namespace, 1860, clock.version);
			const [expJob] = await sql<
				{ id: string; kind: string; payload: unknown }[]
			>`
				select id, kind, payload from app.outbox_job
				where kind = 'checkout.order.expire' and payload->>'orderId' = ${attributedOrderId}
			`;
			if (expJob) {
				await sql.begin((tx) =>
					expireOwnedOrderJob(tx, {
						id: expJob.id,
						kind: expJob.kind,
						payload: expJob.payload,
					}),
				);
			}
		}
		for (const a of extraActors) {
			await closeFulfillmentActor(identity, a);
		}
		await cleanup(identity, []);
		await f.close();
	}
});

test("S67 integration: independent web/worker restart converges pending and unknown jobs without duplicate effects, and private-artifact backup/restore rehearsal verifies SHA-256 integrity while leaving original target untouched", async () => {
	const f = await fulfillmentFixture("prepaid");
	const identity = f.identity;
	const sql = identity.sql;
	const [parcelA] = f.parcels;
	assert.ok(parcelA);

	const artifactBackupDir = mkdtempSync(
		join(tmpdir(), "99ribu-s67-backup-artifacts-"),
	);
	const artifactRestoreDir = mkdtempSync(
		join(tmpdir(), "99ribu-s67-restore-artifacts-"),
	);
	chmodSync(artifactBackupDir, 0o700);
	chmodSync(artifactRestoreDir, 0o700);

	const extraActors: Awaited<ReturnType<typeof actor>>[] = [];
	const createdConversationIds: string[] = [];
	let consentedOrderId: string | null = null;

	try {
		const affiliateActor = await actor(identity, "affiliate", []);
		extraActors.push(affiliateActor);

		const enrollReq = affiliateActor.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
			referral_code: `RESTORE-${randomUUID().slice(0, 6).toUpperCase()}`,
			display_name: "Mitra Restore S67",
			beneficiary_bank_code: "BRI",
			beneficiary_account_number: "5544332211",
			beneficiary_account_holder: "Mitra Restore S67",
		});
		enrollReq.headers.set("idempotency-key", randomUUID());
		const enrollRes = await handleAffiliateProfile(enrollReq, identity);
		assert.equal(enrollRes.status, 201);
		const affiliateProfile = await enrollRes.json();

		// 1. Create a consented order + prepaid payment so we have 3 ad_event_outbox jobs (meta, google, tiktok)
		const client = new CommerceClient(identity);
		const visBody = { client_request_id: randomUUID() };
		const visKey = randomUUID();
		let visRes = await handleSignals(
			client.request("/api/v1/visitor-sessions", visBody, { key: visKey }),
			identity,
		);
		client.absorb(visRes);
		if (visRes.status === 401) {
			visRes = await handleSignals(
				client.request("/api/v1/visitor-sessions", visBody, { key: visKey }),
				identity,
			);
			client.absorb(visRes);
		}
		assert.equal(visRes.status, 201);

		const consentRes = await handleSignals(
			client.request("/api/v1/consent/receipt", {
				expected_version: 0,
				policy_version: "local-privacy-v1",
				choices: grantedChoices,
			}),
			identity,
		);
		client.absorb(consentRes);
		assert.equal(consentRes.status, 201);

		const bootRes = new Response(null);
		await bootstrapGuest(identity, bootRes, new Request("http://127.0.0.1:3099/api/v1/carts", { method: "POST" }));
		client.absorb(bootRes);
		const guestBuyer = await commerceActor(
			client.request("/api/v1/carts"),
			identity,
		);
		assert.ok(guestBuyer && guestBuyer.kind === "guest");

		const createdCart = await sql.begin((tx) =>
			createCart(
				tx,
				client.request("/api/v1/carts", {}),
				identity,
				guestBuyer,
				{
					lines: [f.line("fixture-offer-shirt", 1)],
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
		client.absorb(cartCookieRes);

		const quoteInput = {
			cart_id: createdCart.cart.id,
			address: {
				recipient_name: "Budi Restore",
				phone: "+6281233334444",
				address_line: "Jl. Pemulihan Cadangan No. 12",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281233334444" },
			payment_method: "prepaid" as const,
		};
		const quote = (await sql.begin((tx) =>
			createQuote(
				tx,
				client.request("/api/v1/checkout/quotes", quoteInput, { version: 1 }),
				identity,
				guestBuyer,
				quoteInput,
				{ affiliate_id: affiliateProfile.id },
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
				guestBuyer,
				{ quote_id: quote.id },
			),
		);
		consentedOrderId = submitted.order.id;

		await sql`
			update app.local_fixture_namespace
			set clock = greatest(clock, clock_timestamp()) + interval '1 second',
				revision = revision + 1
			where name = ${f.namespace}
		`;
		const attempt = await sql.begin((tx) =>
			createAttempt(tx, submitted.order.id, randomUUID(), {
				method_id: "local-prepaid",
			}),
		);
		const [storedAttempt] = await sql<{ creation_job_id: string }[]>`
			select creation_job_id from app.payment_attempt where id = ${attempt.id}
		`;
		await f.run(storedAttempt.creation_job_id);
		const payEvent = await simulateCollection(sql, "test", attempt.id);
		await f.run(await ingestProviderEvent(sql, payEvent));

		const accrued = await sql.begin((tx) =>
			accrueOrderCommissions(tx, { orderId: submitted.order.id }),
		);
		assert.equal(accrued.length, 1);

		// 2. Simulate Web & Worker Restart with Completed, Unknown (after-commit lost ack), and Interrupted Processing Jobs
		const outboxRows = await sql<
			{ id: string; platform: string; job_id: string; reason: string }[]
		>`
			select o.id, o.platform, o.job_id, o.reason
			from app.ad_event_outbox o
			join app.commerce_event e on e.id = o.event_id
			where e.order_id = ${submitted.order.id} and e.name = 'Purchase'
			order by o.platform
		`;
		assert.equal(outboxRows.length, 3);
		assert.deepEqual(
			outboxRows.map((row) => row.reason),
			["eligible", "eligible", "eligible"],
			"Consented Purchase must be dispatch-eligible; source_not_eligible means the fixture clock ran ahead of the database clock",
		);
		const [googleJob, metaJob, tiktokJob] = outboxRows;
		assert.ok(googleJob && metaJob && tiktokJob);

		// Meta job completes normally before restart
		assert.equal(
			await runOneJob(
				sql,
				{ "advertising.dispatch": advertisingAdapter(sql, "test") },
				metaJob.job_id,
			),
			true,
		);

		// Google job commits its local_ad_sink effect, then loses ack (simulating worker/network crash after commit) -> becomes 'unknown'
		const faultMap = new Map<string, "after-commit-lost-ack">([
			[googleJob.id, "after-commit-lost-ack"],
		]);
		assert.equal(
			await runOneJob(
				sql,
				{ "advertising.dispatch": advertisingAdapter(sql, "test", faultMap) },
				googleJob.job_id,
			),
			true,
		);
		const [googleJobAfterCrash] = await sql<
			{ status: string; last_error: string }[]
		>`
			select status, last_error from app.outbox_job where id = ${googleJob.job_id}
		`;
		assert.equal(googleJobAfterCrash.status, "unknown");
		assert.equal(googleJobAfterCrash.last_error, "UNKNOWN_OUTCOME");

		// TikTok job simulates an un-dispatched worker crash mid-lease (processing with dispatched_at = null, expired lease)
		await sql`
			update app.outbox_job
			set status = 'processing',
				lease_token = ${randomUUID()},
				lease_until = now() - interval '5 seconds',
				dispatched_at = null,
				attempts = 1
			where id = ${tiktokJob.job_id}
		`;

		// Expire leases on simulated worker restart: tiktokJob returns to 'pending'; googleJob stays 'unknown'; metaJob stays 'completed'
		await expireLeases(sql, tiktokJob.job_id);
		const [tiktokAfterExpire] = await sql<{ status: string }[]>`
			select status from app.outbox_job where id = ${tiktokJob.job_id}
		`;
		assert.equal(tiktokAfterExpire.status, "pending");

		// Make googleJob due for reconciliation and run restarted worker across all 3 jobs
		await sql`
			update app.outbox_job set run_at = now() - interval '1 second'
			where id in (${googleJob.job_id}, ${tiktokJob.job_id})
		`;
		assert.equal(
			await runOneJob(
				sql,
				{ "advertising.dispatch": advertisingAdapter(sql, "test") },
				metaJob.job_id,
			),
			false,
			"Completed job must never be re-run after restart",
		);
		assert.equal(
			await runOneJob(
				sql,
				{ "advertising.dispatch": advertisingAdapter(sql, "test") },
				googleJob.job_id,
			),
			true,
			"Unknown job reconciles cleanly on restart",
		);
		assert.equal(
			await runOneJob(
				sql,
				{ "advertising.dispatch": advertisingAdapter(sql, "test") },
				tiktokJob.job_id,
			),
			true,
			"Pending job dispatches cleanly on restart",
		);

		const postRestartJobs = await sql<
			{ id: string; status: string; attempts: number }[]
		>`
			select id, status, attempts from app.outbox_job
			where id in (${metaJob.job_id}, ${googleJob.job_id}, ${tiktokJob.job_id})
		`;
		assert.ok(postRestartJobs.every((j) => j.status === "completed"));

		// Verify googleJob reconciliation did NOT duplicate local_ad_sink effect and recorded both 'dispatch' and 'reconcile' attempts
		const [googleSinkCount] = await sql<{ n: number }[]>`
			select count(*)::int as n from app.local_ad_sink where outbox_id = ${googleJob.id}
		`;
		assert.equal(googleSinkCount.n, 1);
		const googleAttempts = await sql<{ kind: string; outcome: string }[]>`
			select kind, outcome from app.ad_delivery_attempt where outbox_id = ${googleJob.id} order by kind
		`;
		assert.deepEqual(
			[...googleAttempts],
			[
				{ kind: "dispatch", outcome: "accepted" },
				{ kind: "reconcile", outcome: "accepted" },
			],
		);

		// 3. Create Private Artifacts on Disk (Shipping Label PDF with TEST-NOT-FOR-SHIPPING + Support PNG Attachment)
		const bookingA = await f.book(parcelA);
		await f.run(bookingA.creation_job_id);
		for (const cb of await sql<{ callback_job_id: string }[]>`
			select callback_job_id from app.waybill_provider_event where booking_id = ${bookingA.id}
		`) {
			await f.run(cb.callback_job_id);
		}
		const issuedEvent = await simulateWaybillIssue(sql, "test", bookingA.id);
		await f.run(await ingestWaybillEvent(sql, issuedEvent));

		// Create template with explicit TEST-NOT-FOR-SHIPPING disclosure and generate label artifact
		const tplReq = f.owner.browser.request(
			"/api/v1/admin/shipping-label-templates",
			{
				name: `s67-test-watermark-${randomUUID().slice(0, 8)}`,
				format: "thermal_100x150",
				privacy_mode: "masked_phone",
				brand_mode: "neutral_partner",
				partner_brand_name: "99ribu Local Test",
				disclosure_text: "TEST-NOT-FOR-SHIPPING — LOCAL REHEARSAL ONLY",
			},
		);
		tplReq.headers.set("idempotency-key", randomUUID());
		const tplRes = await handleShippingLabels(tplReq, identity);
		assert.equal(tplRes.status, 201);
		const tpl = await tplRes.json();

		const genLabelReq = f.owner.browser.request(
			`/api/v1/admin/shipments/${parcelA.shipment_id}/label-jobs`,
			{
				format: "thermal_100x150",
				template_id: tpl.id,
			},
		);
		genLabelReq.headers.set("idempotency-key", randomUUID());
		const genLabelRes = await handleShippingLabels(genLabelReq, identity);
		assert.equal(genLabelRes.status, 202);
		const genLabel = await genLabelRes.json();

		const [labelArtifactRow] = await sql<
			{
				id: string;
				storage_key: string;
				sha256: string;
				byte_size: number;
				tracking_number: string;
			}[]
		>`
			select id, storage_key, sha256, byte_size, tracking_number
			from app.shipping_label_artifact
			where id = ${genLabel.artifact_id}
		`;
		assert.ok(labelArtifactRow);

		// Create a private support PNG attachment artifact on disk
		const pngBytes = validPngBytes();
		const pngSha256 = createHash("sha256").update(pngBytes).digest("hex");
		const pngStorageKey = await savePrivateArtifact(pngBytes);
		const convId = randomUUID();
		const attachmentId = randomUUID();
		createdConversationIds.push(convId);
		await sql`
			insert into app.support_conversation (id, buyer_user_id, status, priority)
			values (${convId}, ${f.owner.id}, 'open', 'normal')
		`;
		await sql`
			insert into app.support_attachment (
				id, conversation_id, uploader_scope, content_type, byte_size, sha256, storage_key, scan_status
			)
			values (
				${attachmentId}, ${convId}, ${`user:${f.owner.id}`}, 'image/png', ${pngBytes.byteLength}, ${pngSha256}, ${pngStorageKey}, 'ready'
			)
		`;

		// 4. Snapshot Original Target Rows Before Isolated Backup/Restore Rehearsal
		const [origReceipt] = await sql<
			{
				id: string;
				transaction_id: string;
				order_id: string;
				amount: string;
				merchandise_amount: string;
				buyer_shipping: string;
			}[]
		>`
			select id, transaction_id, order_id, amount::text, merchandise_amount::text, buyer_shipping::text
			from app.economic_receipt
			where order_id = ${submitted.order.id}
		`;
		assert.ok(origReceipt);

		const [origJournal] = await sql<
			{
				id: string;
				kind: string;
				source: string;
				environment: string;
				effect_reference: string;
				request_hash: string;
				order_id: string;
				reason: string;
				occurred_at: string;
				created_xid: string;
			}[]
		>`
			select id, kind, source, environment, effect_reference, request_hash, order_id, reason, occurred_at::text, created_xid
			from app.finance_transaction
			where id = ${origReceipt.transaction_id}
		`;
		assert.ok(origJournal);

		const origPostings = await sql<
			{
				transaction_id: string;
				ordinal: number;
				account: string;
				side: string;
				amount: string;
			}[]
		>`
			select transaction_id, ordinal, account, side, amount::text
			from app.finance_posting
			where transaction_id = ${origJournal.id}
			order by ordinal
		`;
		assert.equal(origPostings.length, 2);

		const origBalances = await sql<
			{
				id: string;
				warehouse_id: string;
				stock_item_id: string;
				on_hand: number;
				reserved: number;
				quarantined: number;
				revision: number;
			}[]
		>`
			select b.id, b.warehouse_id, b.stock_item_id, b.on_hand, b.reserved, b.quarantined, b.revision
			from app.inventory_balance b
			join app.local_fixture_warehouse w on w.warehouse_id = b.warehouse_id
			where w.namespace = ${f.namespace}
			order by b.id
		`;
		assert.ok(origBalances.length > 0);

		const [origCommission] = await sql<
			{
				id: string;
				order_id: string;
				affiliate_id: string;
				amount_idr: string;
				status: string;
			}[]
		>`
			select id, order_id, affiliate_id, amount_idr::text, status
			from app.commission_entry
			where order_id = ${submitted.order.id}
		`;
		assert.ok(origCommission);

		const [origRoleGrant] = await sql<{ user_id: string; roles: string[] }[]>`
			select user_id, roles from app.role_grant where user_id = ${f.owner.id}
		`;
		assert.ok(origRoleGrant);

		// 5. The database backup/restore rehearsal is the separate S67 pg_dump/pg_restore test below.
		// Also verify the live app.finance_posting rejects historical parts on origJournal.id
		await assert.rejects(
			sql`
				insert into app.finance_posting (transaction_id, ordinal, account, side, amount)
				values (${origJournal.id}, 3, 'company_cash', 'debit', 1)
			`,
			{ code: "23514" },
		);

		// 6. Rehearse Private Artifact Backup, Restore, SHA-256 Verification & Corruption Detection
		const labelBytesDisk = await readPrivateArtifact(
			labelArtifactRow.storage_key,
		);
		const pngBytesDisk = await readPrivateArtifact(pngStorageKey);

		const labelBackupPath = join(
			artifactBackupDir,
			labelArtifactRow.storage_key,
		);
		const pngBackupPath = join(artifactBackupDir, pngStorageKey);
		writeFileSync(labelBackupPath, labelBytesDisk, { mode: 0o600 });
		writeFileSync(pngBackupPath, pngBytesDisk, { mode: 0o600 });

		const labelRestorePath = join(
			artifactRestoreDir,
			labelArtifactRow.storage_key,
		);
		const pngRestorePath = join(artifactRestoreDir, pngStorageKey);
		writeFileSync(labelRestorePath, readFileSync(labelBackupPath), {
			mode: 0o600,
		});
		writeFileSync(pngRestorePath, readFileSync(pngBackupPath), { mode: 0o600 });

		for (const restoredPath of [labelRestorePath, pngRestorePath]) {
			const stat = lstatSync(restoredPath);
			assert.equal(stat.isFile(), true);
			assert.equal(stat.isSymbolicLink(), false);
			assert.equal(stat.mode & 0o777, 0o600);
		}

		const restoredLabelBytes = readFileSync(labelRestorePath);
		assert.equal(restoredLabelBytes.byteLength, labelArtifactRow.byte_size);
		assert.equal(
			createHash("sha256").update(restoredLabelBytes).digest("hex"),
			labelArtifactRow.sha256,
		);
		assert.ok(
			restoredLabelBytes.toString("utf8").includes("TEST-NOT-FOR-SHIPPING"),
			"Restored shipping label PDF preserves TEST-NOT-FOR-SHIPPING watermark",
		);

		const restoredPngBytes = readFileSync(pngRestorePath);
		assert.equal(restoredPngBytes.byteLength, pngBytes.byteLength);
		assert.equal(
			createHash("sha256").update(restoredPngBytes).digest("hex"),
			pngSha256,
		);

		// Tamper with a single byte of the restored PDF copy and verify SHA-256 integrity check detects corruption
		const corruptedBytes = Buffer.from(restoredLabelBytes);
		corruptedBytes[corruptedBytes.length - 1] ^= 0xff;
		writeFileSync(labelRestorePath, corruptedBytes, { mode: 0o600 });
		const corruptedSha = createHash("sha256")
			.update(readFileSync(labelRestorePath))
			.digest("hex");
		assert.notEqual(
			corruptedSha,
			labelArtifactRow.sha256,
			"SHA-256 verification must detect single-byte corruption in restored private artifact",
		);

		// 7. Verify Original Target Rows in 99ribu_test Remain Completely Untouched
		const [afterReceipt] = await sql<
			{
				id: string;
				transaction_id: string;
				order_id: string;
				amount: string;
				merchandise_amount: string;
				buyer_shipping: string;
			}[]
		>`
			select id, transaction_id, order_id, amount::text, merchandise_amount::text, buyer_shipping::text
			from app.economic_receipt
			where order_id = ${submitted.order.id}
		`;
		assert.deepEqual(afterReceipt, origReceipt);

		const [afterJournal] = await sql<
			{
				id: string;
				kind: string;
				source: string;
				environment: string;
				effect_reference: string;
				request_hash: string;
				order_id: string;
				reason: string;
				occurred_at: string;
				created_xid: string;
			}[]
		>`
			select id, kind, source, environment, effect_reference, request_hash, order_id, reason, occurred_at::text, created_xid
			from app.finance_transaction
			where id = ${origReceipt.transaction_id}
		`;
		assert.deepEqual(afterJournal, origJournal);

		const afterBalances = await sql<
			{
				id: string;
				warehouse_id: string;
				stock_item_id: string;
				on_hand: number;
				reserved: number;
				quarantined: number;
				revision: number;
			}[]
		>`
			select b.id, b.warehouse_id, b.stock_item_id, b.on_hand, b.reserved, b.quarantined, b.revision
			from app.inventory_balance b
			join app.local_fixture_warehouse w on w.warehouse_id = b.warehouse_id
			where w.namespace = ${f.namespace}
			order by b.id
		`;
		assert.deepEqual(afterBalances, origBalances);
	} finally {
		rmSync(artifactBackupDir, { recursive: true, force: true });
		rmSync(artifactRestoreDir, { recursive: true, force: true });
		if (createdConversationIds.length > 0) {
			await sql`delete from app.support_attachment where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_conversation where id in ${sql(createdConversationIds)}`;
		}
		if (consentedOrderId) {
			const clock = await readFixtureClock("test", f.namespace);
			await advanceFixtureClock("test", f.namespace, 1860, clock.version);
			const [expJob] = await sql<
				{ id: string; kind: string; payload: unknown }[]
			>`
				select id, kind, payload from app.outbox_job
				where kind = 'checkout.order.expire' and payload->>'orderId' = ${consentedOrderId}
			`;
			if (expJob) {
				await sql.begin((tx) =>
					expireOwnedOrderJob(tx, {
						id: expJob.id,
						kind: expJob.kind,
						payload: expJob.payload,
					}),
				);
			}
		}
		for (const a of extraActors) {
			await closeFulfillmentActor(identity, a);
		}
		await cleanup(identity, []);
		await f.close();
	}
});

test("S67 integration: pg_dump -Fc of the isolated test database restores into a disposable 99ribu_restore_<uuid> database with schema/trigger/row parity, resealed creating-XID guards and enforcing real app.* immutability triggers", { timeout: 180_000 }, async () => {
	// Dumps and restores the whole shared test database (hundreds of MB), which outgrows the runner's 30 s default.
	const f = await fulfillmentFixture("prepaid");
	const sql = f.identity.sql;
	const maintenance = superuserConnection("postgres");
	const source = superuserConnection("99ribu_test");
	const restoreDatabase = `99ribu_restore_${randomUUID().replaceAll("-", "")}`;
	let restoreCreated = false;
	let restored: Sql | null = null;
	try {
		const [origReceipt] = await sql<
			{ transaction_id: string; amount: string }[]
		>`
			select transaction_id, amount::text from app.economic_receipt where order_id = ${f.order.id}
		`;
		assert.ok(
			origReceipt,
			"Prepaid fixture order owns a historical economic receipt journal",
		);
		const [origJournal] = await sql<
			{ id: string; reason: string; created_xid: string }[]
		>`
			select id, reason, created_xid from app.finance_transaction where id = ${origReceipt.transaction_id}
		`;
		assert.ok(origJournal);
		const origPostings = await sql<
			{
				transaction_id: string;
				ordinal: number;
				account: string;
				side: string;
				amount: string;
			}[]
		>`
			select transaction_id, ordinal, account, side, amount::text
			from app.finance_posting where transaction_id = ${origJournal.id}
			order by ordinal
		`;
		assert.ok(origPostings.length >= 2);

		// Real isolated backup/restore rehearsal. pg_dump -Fc of 99ribu_test under an exported snapshot, so the
		// parity counts and the dump describe the same instant; pg_restore pre-data+data into a disposable database,
		// reseal database-local creating-XID guards while the post-data triggers are still absent, then restore
		// post-data (constraints, triggers) and prove the real app.* guards on the restored copy.
		const snapshot = await source.begin(
			"isolation level repeatable read read only",
			async (tx) => {
				const [{ id: snapshotId }] = await tx<
					{ id: string }[]
				>`select pg_export_snapshot() as id`;
				const state = await restoreInventory(tx);
				const dump = await containerPostgres([
					"pg_dump",
					"--username=bootstrap",
					"--dbname=99ribu_test",
					"--format=custom",
					`--snapshot=${snapshotId}`,
				]);
				return { state, dump };
			},
		);
		assert.ok(snapshot.dump.subarray(0, 5).toString() === "PGDMP");
		assert.ok(snapshot.state.tables > 0);
		assert.ok(snapshot.state.rows.finance_posting >= origPostings.length);

		await maintenance.unsafe(`create database "${restoreDatabase}"`);
		restoreCreated = true;
		const restoreArgs = [
			"pg_restore",
			"--username=bootstrap",
			`--dbname=${restoreDatabase}`,
			"--exit-on-error",
		];
		await containerPostgres(
			[...restoreArgs, "--section=pre-data", "--section=data"],
			snapshot.dump,
		);
		const restoredDb = superuserConnection(restoreDatabase);
		restored = restoredDb;
		const xidTables = await restoredDb<{ table_name: string }[]>`
			select table_name from information_schema.columns
			where table_schema = 'app' and column_name = 'created_xid'
			order by table_name
		`;
		assert.ok(xidTables.some((t) => t.table_name === "finance_transaction"));
		for (const { table_name } of xidTables) {
			await restoredDb.unsafe(
				`update app."${table_name}" set created_xid = 'restored:' || created_xid where created_xid !~ '^restored:'`,
			);
		}
		await containerPostgres(
			[...restoreArgs, "--section=post-data"],
			snapshot.dump,
		);

		// Schema, trigger and row parity with the dumped snapshot
		assert.deepEqual(await restoreInventory(restoredDb), snapshot.state);
		const restoredGuards = await restoredDb<{ name: string }[]>`
			select c.relname || '.' || t.tgname as name
			from pg_trigger t join pg_class c on c.oid = t.tgrelid
			where c.relnamespace = 'app'::regnamespace and not t.tgisinternal
				and c.relname in ('finance_transaction', 'finance_posting')
				and t.tgname in ('finance_transaction_immutable', 'finance_posting_immutable', 'finance_posting_guard')
			order by 1
		`;
		assert.deepEqual(
			restoredGuards.map((g) => g.name),
			[
				"finance_posting.finance_posting_guard",
				"finance_posting.finance_posting_immutable",
				"finance_transaction.finance_transaction_immutable",
			],
		);
		for (const { table_name } of xidTables) {
			const [{ unsealed }] = await restoredDb.unsafe<{ unsealed: number }[]>(
				`select count(*)::int as unsealed from app."${table_name}" where created_xid !~ '^restored:'`,
			);
			assert.equal(unsealed, 0, `${table_name} creating-XID guard resealed`);
		}

		const [restoredJournal] = await restoredDb<
			{ created_xid: string; reason: string; debits: string; credits: string }[]
		>`
			select h.created_xid, h.reason,
				coalesce(sum(p.amount) filter (where p.side = 'debit'), 0)::text as debits,
				coalesce(sum(p.amount) filter (where p.side = 'credit'), 0)::text as credits
			from app.finance_transaction h
			join app.finance_posting p on p.transaction_id = h.id
			where h.id = ${origJournal.id}
			group by h.created_xid, h.reason
		`;
		assert.equal(
			restoredJournal.created_xid,
			`restored:${origJournal.created_xid}`,
		);
		assert.equal(restoredJournal.reason, origJournal.reason);
		assert.equal(restoredJournal.debits, origReceipt.amount);
		assert.equal(restoredJournal.credits, origReceipt.amount);
		const restoredPostings = await restoredDb`
			select transaction_id, ordinal, account, side, amount::text
			from app.finance_posting where transaction_id = ${origJournal.id}
			order by ordinal
		`;
		assert.deepEqual([...restoredPostings], [...origPostings]);
		// The real migrated immutability guards reject tampering with restored history
		const [firstPosting] = origPostings;
		assert.ok(firstPosting);
		await assert.rejects(
			restoredDb`
				update app.finance_posting set amount = amount + 1
				where transaction_id = ${origJournal.id} and ordinal = ${firstPosting.ordinal}
			`,
			{ code: "23514" },
		);
		await assert.rejects(
			restoredDb`delete from app.finance_posting where transaction_id = ${origJournal.id}`,
			{ code: "23514" },
		);
		await assert.rejects(
			restoredDb`update app.finance_transaction set reason = 'Tamper restored journal' where id = ${origJournal.id}`,
			{ code: "23514" },
		);
		await assert.rejects(
			restoredDb`delete from app.finance_transaction where id = ${origJournal.id}`,
			{ code: "23514" },
		);
		await assert.rejects(
			restoredDb`
				insert into app.finance_posting (transaction_id, ordinal, account, side, amount)
				values (${origJournal.id}, 3, 'company_cash', 'debit', 1)
			`,
			{ code: "23514", message: /Historical journal is sealed/ },
		);
		// The source database is untouched by dump and restore
		const [afterJournal] = await sql`
			select id, reason, created_xid from app.finance_transaction where id = ${origJournal.id}
		`;
		assert.deepEqual({ ...afterJournal }, { ...origJournal });
		const afterPostings = await sql`
			select transaction_id, ordinal, account, side, amount::text
			from app.finance_posting where transaction_id = ${origJournal.id}
			order by ordinal
		`;
		assert.deepEqual([...afterPostings], [...origPostings]);
	} finally {
		try {
			await restored?.end();
			// Only the disposable database created by this test is ever dropped.
			if (
				restoreCreated &&
				/^99ribu_restore_[0-9a-f]{32}$/.test(restoreDatabase)
			) {
				await maintenance.unsafe(
					`drop database if exists "${restoreDatabase}" with (force)`,
				);
			}
		} finally {
			try {
				await Promise.all([maintenance.end(), source.end()]);
			} finally {
				await f.close();
			}
		}
	}
});
