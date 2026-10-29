import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import type { TransactionSql } from "postgres";
import {
	offerCommissionPreviewIdr,
	RateIntent,
} from "../../src/components/admin/affiliates-model.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { getPrincipal } from "../../src/modules/access/policy.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import {
	type AdminAffiliateDetail,
	type AdminAffiliatePage,
	getAdminAffiliate,
	listAdminAffiliates,
	parseAdminAffiliatesQuery,
} from "../../src/modules/affiliates/admin.ts";
import { handleAffiliateProfile } from "../../src/modules/affiliates/profile.ts";
import { offerCommissionIdr } from "../../src/modules/affiliates/rates.ts";
import {
	handleAdminAffiliates,
	handleAffiliateRates,
} from "../../src/modules/affiliates/routes.ts";
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
	accrueOrderCommissions,
	holdUnitCommission,
	matureEligibleCommissions,
	recordUnitReceiptMaturity,
	voidUnitCommissionOnRefund,
} from "../../src/modules/commissions/service.ts";
import {
	actor,
	type BrowserSession,
	enroll,
} from "../contract/access-fixture.ts";
import { type Exchange, validateExchanges } from "../contract/openapi-probe.ts";
import { CommerceClient } from "./checkout-fixture.ts";
import { closeFulfillmentActor } from "./fulfillment-fixture.ts";
import { shippingFixture } from "./shipping-fixture.ts";

const origin = "http://127.0.0.1:3099";

type TestActor = {
	id: string;
	email: string;
	password: string;
	browser: BrowserSession;
};

test("S132 admin affiliates read & rate versions: owner/finance read, non-permitted roles 403, anonymous 401, keyset paging, owner-only prospective rate with proof, and zero buyer PII or bank account leakage", async () => {
	const f = await shippingFixture();
	const identity = f.identity;
	const sql = identity.sql;
	const marker = randomUUID().slice(0, 8).toUpperCase();
	const extraActors: TestActor[] = [];
	const samples: Exchange[] = [];

	try {
		const [{ warehouse_id: warehouseId }] = await sql<{ warehouse_id: string }[]>`
			select warehouse_id from app.inventory_balance where id = ${Object.values(f.seeded.positions)[0]}
		`;
		const rateOwner = await actor(identity, "owner", []);
		const finance = await actor(identity, "finance", []);
		const ecommerceAdmin = await actor(identity, "ecommerce_admin", [
			warehouseId,
		]);
		const warehouseStaff = await actor(identity, "warehouse", [warehouseId]);
		const cs = await actor(identity, "customer_service", []);
		const buyer = await actor(identity, "buyer", []);
		const staffNoMfa = await actor(identity, "owner", []);
		const affiliateA = await actor(identity, "affiliate", []);
		const affiliateB = await actor(identity, "affiliate", []);
		const affiliateC = await actor(identity, "affiliate", []);
		extraActors.push(
			rateOwner,
			finance,
			ecommerceAdmin,
			warehouseStaff,
			cs,
			buyer,
			staffNoMfa,
			affiliateA,
			affiliateB,
			affiliateC,
		);

		await enroll(rateOwner.browser, rateOwner.password);
		await enroll(finance.browser, finance.password);
		await enroll(ecommerceAdmin.browser, ecommerceAdmin.password);
		await enroll(warehouseStaff.browser, warehouseStaff.password);
		await enroll(cs.browser, cs.password);

		// Seed secret canaries on affiliateA (TOTP seed, backup code, session token, password hash, raw bank account number).
		const totpSecretCanary = `TOTP-SECRET-CANARY-${marker}`;
		const backupCodeCanary = `BACKUP-CODE-CANARY-${marker}`;
		const bankAccountCanary = "9988776655443322";
		const bankHolderCanary = `CANARY-BANK-HOLDER-${marker}`;
		await sql`
			insert into app.auth_two_factor (id, secret, backup_codes, user_id, verified)
			values (${randomUUID()}, ${totpSecretCanary}, ${backupCodeCanary}, ${affiliateA.id}, true)
		`;

		const enrollPartner = async (
			who: TestActor,
			suffix: string,
			displayName: string,
		) => {
			const req = who.browser.request("/api/v1/me/affiliate", {
				terms_version: "v1",
				referral_code: `S132-${marker}-${suffix}`,
				display_name: displayName,
				beneficiary_bank_code: "BCA",
				beneficiary_account_number: bankAccountCanary,
				beneficiary_account_holder: bankHolderCanary,
			});
			req.headers.set("idempotency-key", randomUUID());
			const res = await handleAffiliateProfile(req, identity);
			assert.equal(res.status, 201);
			return (await res.json()) as { id: string; rate_basis_points: number };
		};

		const enrolledA = await enrollPartner(
			affiliateA,
			"A",
			`Mitra S132 A ${marker}`,
		);
		const enrolledB = await enrollPartner(
			affiliateB,
			"B",
			`Mitra S132 B ${marker}`,
		);
		// Insert affiliateC with status = 'suspended' so status filter and rate_eligible=false can be tested.
		const [enrolledC] = await sql<{ id: string }[]>`
			insert into app.affiliate_account (user_id, status)
			values (${affiliateC.id}, 'suspended')
			returning id
		`;
		await sql`
			insert into app.affiliate_profile (
				affiliate_id,
				referral_code,
				display_name,
				beneficiary_bank_code,
				beneficiary_account_number,
				beneficiary_account_holder,
				beneficiary_status
			) values (
				${enrolledC.id},
				${`S132-${marker}-C`},
				${`Mitra S132 C ${marker}`},
				'BCA',
				${bankAccountCanary},
				${bankHolderCanary},
				'verified'
			)
		`;

		// Seed a buyer with distinct PII canaries and create a 6-unit attributed order under affiliateA.
		const buyerNameCanary = `CANARY-BUYER-NAME-${marker}`;
		const buyerEmailCanary = `canary-buyer-${marker.toLowerCase()}@example.invalid`;
		const buyerPhoneCanary = "+6281299887766";
		const buyerPhoneLocalCanary = "081299887766";
		const buyerStreetCanary = `Jalan Canary Rahasia Pembeli No. 99 ${marker}`;

		await sql`
			update app.auth_user
			set name = ${buyerNameCanary}, email = ${buyerEmailCanary}
			where id = ${buyer.id}
		`;
		await sql`
			insert into app.buyer_profile (user_id, display_name, phone, email)
			values (${buyer.id}, ${buyerNameCanary}, ${buyerPhoneCanary}, ${buyerEmailCanary})
			on conflict (user_id) do update set
				display_name = excluded.display_name,
				phone = excluded.phone,
				email = excluded.email
		`;

		const client = new CommerceClient(identity);
		const bootRes = new Response(null);
		await bootstrapGuest(
			identity,
			bootRes,
			new Request(`${origin}/api/v1/carts`, { method: "POST" }),
		);
		client.absorb(bootRes);
		const guestBuyer = await commerceActor(
			client.request("/api/v1/carts"),
			identity,
		);
		if (!guestBuyer) throw new Error("Expected guest commerce actor");

		await f.move("fixture-malang:fixture-shirt", "receive", 10);
		const line = f.line("fixture-offer-shirt");
		const createdCart = await sql.begin((tx: TransactionSql) =>
			createCart(
				tx,
				client.request("/api/v1/carts", {}),
				identity,
				guestBuyer,
				{
					lines: [
						{
							variant_id: line.offer_id,
							quantity: 6,
							expected_publication_id: line.publication_id,
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
		const cookieRes = new Response(null);
		setCookie(
			cookieRes,
			`${await prefix(identity)}.cart_access`,
			`${createdCart.cart.id}.${cartToken}`,
		);
		client.absorb(cookieRes);

		const quoteInput = {
			cart_id: createdCart.cart.id,
			address: {
				recipient_name: buyerNameCanary,
				phone: buyerPhoneCanary,
				address_line: buyerStreetCanary,
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: buyerPhoneCanary, email: buyerEmailCanary },
			payment_method: "prepaid" as const,
		};
		const quote = (await sql.begin((tx: TransactionSql) =>
			createQuote(
				tx,
				client.request("/api/v1/checkout/quotes", quoteInput, { version: 1 }),
				identity,
				guestBuyer,
				quoteInput,
				{ affiliate_id: enrolledA.id },
			),
		)) as { id: string };

		const submitted = await sql.begin((tx: TransactionSql) =>
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
		const accrued = await sql.begin((tx: TransactionSql) =>
			accrueOrderCommissions(tx, { orderId: submitted.order.id }),
		);
		assert.equal(accrued.length, 6);
		const unitAmount = Number(accrued[0].amount_idr);
		assert.equal(
			unitAmount,
			offerCommissionIdr(enrolledA.rate_basis_points),
		);
		assert.equal(
			unitAmount,
			offerCommissionPreviewIdr(enrolledA.rate_basis_points),
		);

		// Transition the 6 units across all 6 commission statuses:
		// u0 -> pending, u1 -> eligible, u2 -> allocated, u3 -> paid, u4 -> held, u5 -> void
		const [u0, u1, u2, u3, u4, u5] = accrued;
		const t0 = "2026-06-01T10:00:00.000Z";
		const tMatured = "2026-06-12T10:00:00.000Z";
		await sql.begin(async (tx: TransactionSql) => {
			for (const entry of [u1, u2, u3]) {
				await recordUnitReceiptMaturity(tx, {
					fulfillmentItemId: entry.fulfillment_item_id,
					receivedAt: t0,
				});
			}
			await matureEligibleCommissions(tx, {
				affiliateId: enrolledA.id,
				asOf: tMatured,
			});
			await holdUnitCommission(tx, {
				fulfillmentItemId: u4.fulfillment_item_id,
				holdReason: "Return claim under inspection",
			});
			await voidUnitCommissionOnRefund(tx, {
				fulfillmentItemId: u5.fulfillment_item_id,
				reason: "Unit refunded",
			});
			await tx`
				update app.commission_entry
				set status = 'allocated', revision = revision + 1
				where id = ${u2.id}
			`;
			await tx`
				update app.commission_entry
				set status = 'paid', revision = revision + 1
				where id = ${u3.id}
			`;
		});
		assert.equal(u0.status, "pending");

		const [{ token: affiliateSessionToken }] = await sql<{ token: string }[]>`
			select token from app.auth_session where user_id = ${affiliateA.id} limit 1
		`;
		const [{ password: affiliatePasswordHash }] = await sql<
			{ password: string }[]
		>`
			select password from app.auth_account where user_id = ${affiliateA.id} and password is not null limit 1
		`;

		const observeRead = async (request: Request, valid = true) => {
			const response = await handleAdminAffiliates(request, identity);
			const text = await response.text();
			const payload = JSON.parse(text);
			const headers = Object.fromEntries(response.headers);
			for (const [name, value] of [
				["cache-control", "no-store"],
				["referrer-policy", "no-referrer"],
				["x-content-type-options", "nosniff"],
			]) {
				assert.equal(headers[name], value);
			}
			samples.push({
				url: request.url,
				method: request.method,
				request_headers: Object.fromEntries(request.headers),
				request_valid: valid,
				status: response.status,
				headers,
				payload,
			});
			return { status: response.status, text, payload };
		};

		// 1. Anonymous gets 401 on list and detail
		const anonList = await observeRead(
			new Request(`${origin}/api/v1/admin/affiliates`, {
				headers: { origin },
			}),
		);
		assert.equal(anonList.status, 401);
		const anonDetail = await observeRead(
			new Request(`${origin}/api/v1/admin/affiliates/${enrolledA.id}`, {
				headers: { origin },
			}),
		);
		assert.equal(anonDetail.status, 401);

		// Unsupported auth headers get 401
		for (const header of ["authorization", "x-cart-token", "x-order-token"]) {
			const req = f.owner.browser.request("/api/v1/admin/affiliates");
			req.headers.set(header, "SYNTHETIC-TOKEN");
			assert.equal((await observeRead(req)).status, 401);
		}

		// 2. Non-permitted roles (ecommerce_admin, warehouse, customer_service, buyer, affiliate, and owner without MFA) get 403
		for (const denied of [
			ecommerceAdmin,
			warehouseStaff,
			cs,
			buyer,
			affiliateA,
			staffNoMfa,
		]) {
			const listRes = await observeRead(
				denied.browser.request("/api/v1/admin/affiliates"),
			);
			assert.equal(listRes.status, 403);
			const detailRes = await observeRead(
				denied.browser.request(
					`/api/v1/admin/affiliates/${enrolledA.id}`,
				),
			);
			assert.equal(detailRes.status, 403);
		}

		// 3. Invalid query parameters on list and invalid path/query on detail return 400
		for (const badQuery of [
			"?limit=0",
			"?limit=101",
			"?limit=1&limit=2",
			"?status=unknown",
			"?code=bad%20code",
			"?cursor=not-valid-cursor!",
			"?extra=1",
		]) {
			const res = await observeRead(
				f.owner.browser.request(`/api/v1/admin/affiliates${badQuery}`),
				false,
			);
			assert.equal(res.status, 400, badQuery);
		}
		assert.equal(
			(
				await observeRead(
					f.owner.browser.request("/api/v1/admin/affiliates/not-a-uuid"),
					false,
				)
			).status,
			400,
		);
		assert.equal(
			(
				await observeRead(
					f.owner.browser.request(
						`/api/v1/admin/affiliates/${enrolledA.id}?extra=1`,
					),
					false,
				)
			).status,
			400,
		);
		assert.equal(
			(
				await observeRead(
					f.owner.browser.request(
						`/api/v1/admin/affiliates/${randomUUID()}`,
					),
				)
			).status,
			404,
		);

		// 4. Both owner and finance can read list (with keyset paging and filters) and detail (200), with zero PII/secret leakage
		const canaries = [
			buyerNameCanary,
			buyerEmailCanary,
			buyerPhoneCanary,
			buyerPhoneLocalCanary,
			"81299887766",
			"7766",
			buyerStreetCanary,
			submitted.order.number,
			totpSecretCanary,
			backupCodeCanary,
			affiliateSessionToken,
			affiliatePasswordHash,
			bankAccountCanary,
			"55443322",
			"3322",
			bankHolderCanary,
			affiliateA.email,
		];

		for (const reader of [f.owner, finance]) {
			// Walk keyset pages bounded to our marker code prefix (limit=2 -> 2 pages for 3 affiliates)
			const walkedIds: string[] = [];
			let cursor: string | null = null;
			for (let pageNo = 0; pageNo < 3; pageNo++) {
				const q = `?limit=2&code=${encodeURIComponent(`S132-${marker}-`)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
				const pageRes = await observeRead(
					reader.browser.request(`/api/v1/admin/affiliates${q}`),
				);
				assert.equal(pageRes.status, 200);
				for (const canary of canaries) {
					assert.ok(
						!pageRes.text.includes(canary),
						`List response leaked canary: ${canary}`,
					);
				}
				const pageData = pageRes.payload as AdminAffiliatePage;
				assert.ok(pageData.data.length <= 2);
				walkedIds.push(...pageData.data.map((row) => row.id));
				cursor = pageData.pagination.next_cursor;
				if (!cursor) break;
			}
			assert.deepEqual(walkedIds, [
				enrolledC.id,
				enrolledB.id,
				enrolledA.id,
			]);

			// Filter by status=suspended
			const suspendedRes = await observeRead(
				reader.browser.request(
					`/api/v1/admin/affiliates?status=suspended&code=${encodeURIComponent(`S132-${marker}-`)}`,
				),
			);
			assert.equal(suspendedRes.status, 200);
			const suspendedPage = suspendedRes.payload as AdminAffiliatePage;
			assert.deepEqual(
				suspendedPage.data.map((row) => row.id),
				[enrolledC.id],
			);
			assert.equal(suspendedPage.data[0].rate_eligible, false);

			// Read detail of affiliateA
			const detailRes = await observeRead(
				reader.browser.request(
					`/api/v1/admin/affiliates/${enrolledA.id}`,
				),
			);
			assert.equal(detailRes.status, 200);
			for (const canary of canaries) {
				assert.ok(
					!detailRes.text.includes(canary),
					`Detail response leaked canary: ${canary}`,
				);
			}
			const detail = detailRes.payload as AdminAffiliateDetail;
			assert.equal(detail.id, enrolledA.id);
			assert.equal(detail.referral_code, `S132-${marker}-A`);
			assert.equal(detail.status, "active");
			assert.equal(detail.beneficiary_status, "verified");
			assert.equal(detail.rate_eligible, true);
			assert.equal(detail.rate_version, 0);
			assert.equal(detail.rate_source, "default_policy");
			assert.equal(detail.attributed_orders_count, 1);
			assert.deepEqual(detail.commissions, {
				pending_count: 1,
				pending_idr: unitAmount,
				eligible_count: 1,
				eligible_idr: unitAmount,
				allocated_count: 1,
				allocated_idr: unitAmount,
				matured_count: 2,
				matured_idr: unitAmount * 2,
				paid_count: 1,
				paid_idr: unitAmount,
				held_count: 1,
				held_idr: unitAmount,
				void_count: 1,
				void_idr: unitAmount,
			});
			assert.deepEqual(detail.rate_versions, []);
		}

		// 5. Finance gets 403 on proof issuance for affiliate_rate.version and on setAffiliateRate
		const finProofReq = finance.browser.request(
			"/api/v1/me/reauthentication-proofs",
			{
				password: finance.password,
				action: "affiliate_rate.version",
				subject_id: enrolledA.id,
			},
		);
		finProofReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleAccess(finProofReq, identity)).status, 403);

		const finRateReq = finance.browser.request(
			`/api/v1/admin/affiliates/${enrolledA.id}/rates`,
			{
				basis_points: 1200,
				effective_at: null,
				expected_version: 0,
				reason: "Finance attempt must fail",
				reauthentication_proof: "SYNTHETIC-PROOF-NOT-ISSUED",
			},
		);
		finRateReq.headers.set("idempotency-key", randomUUID());
		assert.equal(
			(await handleAffiliateRates(finRateReq, identity)).status,
			403,
		);

		// 6. Owner sets a prospective rate (now) and a scheduled future rate; backdated and stale expected_version are refused
		const issueOwnerProof = async (subjectId = enrolledA.id) => {
			await sql`delete from app.auth_rate_limit where key = ${`access-proof:${rateOwner.id}`}`;
			const req = rateOwner.browser.request(
				"/api/v1/me/reauthentication-proofs",
				{
					password: rateOwner.password,
					action: "affiliate_rate.version",
					subject_id: subjectId,
				},
			);
			req.headers.set("idempotency-key", randomUUID());
			const res = await handleAccess(req, identity);
			assert.equal(res.status, 201);
			return String((await res.json()).proof);
		};

		const postRate = async (body: Record<string, unknown>, key = randomUUID()) => {
			const req = rateOwner.browser.request(
				`/api/v1/admin/affiliates/${enrolledA.id}/rates`,
				body,
			);
			req.headers.set("idempotency-key", key);
			const res = await handleAffiliateRates(req, identity);
			return { status: res.status, body: await res.json() };
		};

		const proof1 = await issueOwnerProof();
		const proof1Digest = createHash("sha256").update(proof1).digest("hex");

		// Backdated rate is refused with 400 and does NOT consume the proof
		const backdated = await postRate({
			basis_points: 1250,
			effective_at: "2020-01-01T00:00:00.000Z",
			expected_version: 0,
			reason: "Backdated rate must be refused",
			reauthentication_proof: proof1,
		});
		assert.equal(backdated.status, 400);
		assert.equal(backdated.body.code, "RETROACTIVE_RATE_FORBIDDEN");

		// Stale expected_version (1 instead of 0) is refused with 409 and does NOT consume the proof
		const wrongVersion = await postRate({
			basis_points: 1250,
			effective_at: null,
			expected_version: 1,
			reason: "Wrong version must be refused",
			reauthentication_proof: proof1,
		});
		assert.equal(wrongVersion.status, 409);
		assert.equal(wrongVersion.body.code, "VERSION_CONFLICT");

		// Valid immediate rate succeeds with the still-unconsumed proof1
		const v1Key = randomUUID();
		const v1Res = await postRate(
			{
				basis_points: 1250,
				effective_at: null,
				expected_version: 0,
				reason: "Tarif khusus mitra berprestasi v1",
				reauthentication_proof: proof1,
			},
			v1Key,
		);
		assert.equal(v1Res.status, 201);
		assert.equal(v1Res.body.version, 1);
		assert.equal(v1Res.body.basis_points, 1250);

		// Replaying the same idempotency key returns the identical v1 response
		const v1Replay = await postRate(
			{
				basis_points: 1250,
				effective_at: null,
				expected_version: 0,
				reason: "Tarif khusus mitra berprestasi v1",
				reauthentication_proof: proof1,
			},
			v1Key,
		);
		assert.equal(v1Replay.status, 201);
		assert.deepEqual(v1Replay.body, v1Res.body);

		// Reusing consumed proof1 on a new key is refused by proof_digest uniqueness (409 AFFILIATE_RATE_CONFLICT)
		const reusedProof = await postRate({
			basis_points: 1500,
			effective_at: null,
			expected_version: 1,
			reason: "Reused proof must fail",
			reauthentication_proof: proof1,
		});
		assert.equal(reusedProof.status, 409);
		assert.equal(reusedProof.body.code, "AFFILIATE_RATE_CONFLICT");

		// A proof bound to another affiliate subject (enrolledB) is refused with 403 REAUTHENTICATION_REQUIRED
		const wrongSubjectProof = await issueOwnerProof(enrolledB.id);
		const wrongSubjectRes = await postRate({
			basis_points: 1500,
			effective_at: null,
			expected_version: 1,
			reason: "Wrong subject proof must fail",
			reauthentication_proof: wrongSubjectProof,
		});
		assert.equal(wrongSubjectRes.status, 403);
		assert.equal(wrongSubjectRes.body.code, "REAUTHENTICATION_REQUIRED");

		// Schedule a future v2 rate (+7 days)
		const proof2 = await issueOwnerProof();
		const futureIso = new Date(Date.now() + 7 * 86_400_000).toISOString();
		const v2Res = await postRate({
			basis_points: 1500,
			effective_at: futureIso,
			expected_version: 1,
			reason: "Kenaikan tarif terjadwal minggu depan",
			reauthentication_proof: proof2,
		});
		assert.equal(v2Res.status, 201);
		assert.equal(v2Res.body.version, 2);

		// Detail read shows effective_rate_bps = 1250 (v1 is active now) and rate_version = 2 (v2 is scheduled), and never leaks proof1Digest
		const afterRatesRes = await observeRead(
			finance.browser.request(
				`/api/v1/admin/affiliates/${enrolledA.id}`,
			),
		);
		assert.equal(afterRatesRes.status, 200);
		assert.ok(
			!afterRatesRes.text.includes(proof1Digest),
			"proof_digest never exposed in detail",
		);
		const afterDetail = afterRatesRes.payload as AdminAffiliateDetail;
		assert.equal(afterDetail.rate_version, 2);
		assert.equal(afterDetail.effective_rate_bps, 1250);
		assert.equal(
			afterDetail.effective_commission_idr,
			offerCommissionIdr(1250),
		);
		assert.equal(afterDetail.rate_source, "override");
		assert.equal(afterDetail.rate_versions.length, 2);
		assert.equal(afterDetail.rate_versions[0].version, 2);
		assert.equal(afterDetail.rate_versions[0].state, "scheduled");
		assert.equal(afterDetail.rate_versions[0].basis_points, 1500);
		assert.equal(
			afterDetail.rate_versions[0].reason,
			"Kenaikan tarif terjadwal minggu depan",
		);
		assert.equal(afterDetail.rate_versions[1].version, 1);
		assert.equal(afterDetail.rate_versions[1].state, "effective");
		assert.equal(afterDetail.rate_versions[1].basis_points, 1250);

		validateExchanges(samples, "admin-affiliates");
	} finally {
		for (const who of extraActors) {
			await closeFulfillmentActor(identity, who);
		}
		await f.close();
	}
});

test("S132 RateIntent dialog safety: uncertain response freezes idempotency key and body; 409 VERSION_CONFLICT rotates key while keeping mount-frozen expected_version", async () => {
	const intent = new RateIntent();
	const calls: { url: string; key: string; body: Record<string, unknown> }[] =
		[];
	let step = 0;
	let uncertainCount = 0;

	const fakeFetch: typeof fetch = async (input, init) => {
		const url = String(input);
		const headers = new Headers(init?.headers);
		const key = headers.get("idempotency-key") ?? "";
		const body = JSON.parse(String(init?.body ?? "{}")) as Record<
			string,
			unknown
		>;
		calls.push({ url, key, body });
		step++;
		if (step === 1) {
			return new Response(JSON.stringify({ proof: "PROOF-TOKEN-1" }), {
				status: 201,
				headers: { "content-type": "application/json" },
			});
		}
		if (step === 2) {
			return new Response(
				JSON.stringify({ status: 503, code: "UNAVAILABLE" }),
				{
					status: 503,
					headers: { "content-type": "application/problem+json" },
				},
			);
		}
		if (step === 3) {
			return new Response(
				JSON.stringify({
					id: "00000000-0000-4000-8000-000000000001",
					version: 3,
					basis_points: 1100,
					effective_at: "2026-10-27T00:00:00.000Z",
				}),
				{
					status: 201,
					headers: { "content-type": "application/json" },
				},
			);
		}
		if (url.endsWith("/reauthentication-proofs")) {
			return new Response(JSON.stringify({ proof: "PROOF-TOKEN-2" }), {
				status: 201,
				headers: { "content-type": "application/json" },
			});
		}
		return new Response(
			JSON.stringify({ status: 409, code: "VERSION_CONFLICT" }),
			{
				status: 409,
				headers: { "content-type": "application/problem+json" },
			},
		);
	};

	const capturedVersion = 2;
	let mutableBps = 1100;

	const firstAttempt = await intent.send<{ version: number }>(
		"/api/v1/admin/affiliates/00000000-0000-4000-8000-000000000099/rates",
		() => ({
			basis_points: mutableBps,
			effective_at: null,
			expected_version: capturedVersion,
			reason: "Percobaan pertama",
		}),
		{
			password: "secret-password",
			affiliateId: "00000000-0000-4000-8000-000000000099",
			onUncertain: () => {
				uncertainCount++;
			},
			fetch: fakeFetch,
		},
	);
	assert.equal(firstAttempt.uncertain, true);
	assert.equal(uncertainCount, 1);
	assert.equal(calls.length, 2);

	mutableBps = 9999;
	const replayAttempt = await intent.send<{ version: number }>(
		"/api/v1/admin/affiliates/00000000-0000-4000-8000-000000000099/rates",
		() => ({
			basis_points: mutableBps,
			effective_at: null,
			expected_version: capturedVersion,
			reason: "Jangan dipakai saat replay",
		}),
		{
			password: "secret-password",
			affiliateId: "00000000-0000-4000-8000-000000000099",
			onUncertain: () => {
				uncertainCount++;
			},
			fetch: fakeFetch,
		},
	);
	assert.equal(replayAttempt.uncertain, false);
	assert.equal(replayAttempt.data?.version, 3);
	assert.equal(calls.length, 3, "No second proof call on uncertain retry");
	assert.equal(calls[2].key, calls[1].key, "Same Idempotency-Key reused");
	assert.deepEqual(
		calls[2].body,
		calls[1].body,
		"Frozen body and proof reused",
	);

	const conflictFirst = await intent.send<{ version: number }>(
		"/api/v1/admin/affiliates/00000000-0000-4000-8000-000000000099/rates",
		() => ({
			basis_points: 1200,
			effective_at: null,
			expected_version: capturedVersion,
			reason: "Konflik versi",
		}),
		{
			password: "secret-password",
			affiliateId: "00000000-0000-4000-8000-000000000099",
			fetch: fakeFetch,
		},
	);
	assert.equal(conflictFirst.code, "VERSION_CONFLICT");
	assert.equal(conflictFirst.uncertain, false);

	// A definitive 409 rolled back on the server: the corrected retry is a new request (new key, rebuilt body),
	// keeps the mount-frozen expected_version and reuses the still-valid proof (no second proof call).
	const conflictKey = calls[calls.length - 1].key;
	const before = calls.length;
	const conflictRetry = await intent.send<{ version: number }>(
		"/api/v1/admin/affiliates/00000000-0000-4000-8000-000000000099/rates",
		() => ({
			basis_points: 1300,
			effective_at: null,
			expected_version: capturedVersion,
			reason: "Konflik versi, dicoba lagi",
		}),
		{
			password: "secret-password",
			affiliateId: "00000000-0000-4000-8000-000000000099",
			fetch: fakeFetch,
		},
	);
	assert.equal(conflictRetry.code, "VERSION_CONFLICT");
	assert.equal(calls.length, before + 1, "No second proof call after a version conflict");
	const retried = calls[calls.length - 1];
	assert.notEqual(retried.key, conflictKey, "Idempotency-Key rotates after a definitive 409");
	assert.equal(retried.body.expected_version, capturedVersion);
	assert.equal(retried.body.basis_points, 1300, "The body is rebuilt from the current fields");
});

test("S132 cached owner or finance principal cannot read affiliates after role, MFA, verified email or session is revoked in DB", async () => {
	const identity = createLocalAuth("test");
	const actors: TestActor[] = [];
	try {
		for (const revoked of ["roles", "mfa", "verified_email", "session"] as const) {
			const finance = await actor(identity, "finance", []);
			actors.push(finance);
			await enroll(finance.browser, finance.password);
			const cachedPrincipal = await getPrincipal(
				finance.browser.request("/api/v1/me"),
				identity,
			);
			if (revoked === "roles") {
				await identity.sql`update app.role_grant set roles = '{}'::text[] where user_id = ${finance.id}`;
			} else if (revoked === "mfa") {
				await identity.sql`update app.auth_user set two_factor_enabled = false where id = ${finance.id}`;
			} else if (revoked === "verified_email") {
				await identity.sql`update app.auth_user set email_verified = false where id = ${finance.id}`;
			} else {
				await identity.sql`delete from app.auth_session where id = ${cachedPrincipal.sessionId}`;
			}
			const query = parseAdminAffiliatesQuery(
				new URL(`${origin}/api/v1/admin/affiliates`),
			);
			await assert.rejects(
				listAdminAffiliates(identity, cachedPrincipal, query),
				{ code: "FORBIDDEN" },
				`listAdminAffiliates must reject revoked ${revoked}`,
			);
			await assert.rejects(
				getAdminAffiliate(
					identity,
					cachedPrincipal,
					"00000000-0000-4000-8000-000000000001",
				),
				{ code: "FORBIDDEN" },
				`getAdminAffiliate must reject revoked ${revoked}`,
			);
		}
	} finally {
		for (const who of actors) {
			await closeFulfillmentActor(identity, who);
		}
		await identity.sql.end();
	}
});
