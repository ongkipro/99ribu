import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createLocalAuth, type LocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { handleAdvertisingDiagnostics } from "../../src/modules/advertising/diagnostics.ts";
import { projectOrder } from "../../src/modules/checkout/orders.ts";
import { handleShippingLabels } from "../../src/modules/documents/labels.ts";
import { advanceFixtureClock, readFixtureClock } from "../../src/modules/local/fixtures.ts";
import { handleSupport } from "../../src/modules/support/routes.ts";
import { actor, BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";
import { paymentFixture } from "./payment-fixture.ts";

// S130 settings hub integration proof (--case=settings-hub):
// 1. DEC-018 Q3 read/write boundaries: finance reads payment, commercial, and label-template history (200)
//    and is refused on writes (403) and on warehouse_calendar (403); other roles 403.
// 2. Payment, commercial and label-template writes require dedicated single-use owner proofs;
//    ad destinations and support definitions use their existing role/reason/version/audit guards without proof.
//    Stale expected_version returns 409 and every resource returns version history.
// 3. Existing orders keep their frozen publication/item snapshot and payment policy
//    (payment_policy_version_id, cod_fee_bps, payment_charge_amount, receiving bank accounts).
type Actor = {
	id: string;
	email: string;
	password: string;
	browser: BrowserSession;
};
async function issueProof(
	identity: LocalAuth,
	user: Actor,
	action: "payment_policy.version" | "company_policy.version" | "warehouse_calendar.version" | "shipping_label_template.version",
	subjectId: string,
) {
	await identity.sql`delete from app.auth_rate_limit where key=${`access-proof:${user.id}`}`;
	const req = user.browser.request("/api/v1/me/reauthentication-proofs", {
		password: user.password,
		action,
		subject_id: subjectId,
	});
	req.headers.set("idempotency-key", randomUUID());
	const res = await handleAccess(req, identity);
	assert.equal(res.status, 201, await res.clone().text());
	return (await res.json()).proof as string;
}

function postReq(user: Actor, path: string, body: Record<string, unknown>, key = randomUUID()) {
	const req = user.browser.request(path, body);
	req.headers.set("idempotency-key", key);
	return req;
}

test("S130 DEC-018 Q3 & role boundaries: finance reads payment, commercial and label-template history (200), refused on writes (403) and warehouse_calendar (403); other roles 403", async () => {
	const identity = createLocalAuth("test");
	const sql = identity.sql;
	const users: Actor[] = [];
	const warehouseId = randomUUID();

	try {
		await sql`insert into app.warehouse (id, name, city, active) values (${warehouseId}, 'Gudang Uji S130', 'Malang', true)`;

		const owner = await actor(identity, "owner", []);
		const finance = await actor(identity, "finance", []);
		const ecommerce = await actor(identity, "ecommerce_admin", [warehouseId]);
		const warehouse = await actor(identity, "warehouse", [warehouseId]);
		const cs = await actor(identity, "customer_service", []);
		const buyer = await actor(identity, "buyer", []);
		const affiliate = await actor(identity, "affiliate", []);
		users.push(owner, finance, ecommerce, warehouse, cs, buyer, affiliate);

		for (const staff of [owner, finance, ecommerce, warehouse, cs]) {
			await enroll(staff.browser, staff.password);
		}

		// Ensure baseline payment & commercial policies and a warehouse calendar exist
		const payHistRes = await handleAccess(
			owner.browser.request("/api/v1/admin/policy-versions?kind=payment"),
			identity,
		);
		assert.equal(payHistRes.status, 200);
		const payHist = await payHistRes.json();
		if (payHist.latest_version === 0) {
			const pf = await issueProof(identity, owner, "payment_policy.version", "company-payment");
			const saveRes = await handleAccess(
				postReq(owner, "/api/v1/admin/policy-versions", {
					kind: "payment",
					warehouse_id: null,
					effective_at: null,
					expected_version: 0,
					values: {
						cod_fee_bps: 333,
						manual_bank_accounts: [
							{
								bank_name: "BCA",
								account_number: "8800112233",
								account_holder: "PT Serba Sembilan Puluh Sembilan",
							},
						],
					},
					reason: "Baseline payment policy S130",
					reauthentication_proof: pf,
				}),
				identity,
			);
			assert.equal(saveRes.status, 201);
		}

		const commHistRes = await handleAccess(
			owner.browser.request("/api/v1/admin/policy-versions?kind=commercial"),
			identity,
		);
		assert.equal(commHistRes.status, 200);
		const commHist = await commHistRes.json();
		if (commHist.latest_version === 0) {
			const pf = await issueProof(identity, owner, "company_policy.version", "company-commercial");
			const saveRes = await handleAccess(
				postReq(owner, "/api/v1/admin/policy-versions", {
					kind: "commercial",
					warehouse_id: null,
					effective_at: null,
					expected_version: 0,
					values: { default_commission_bps: 1000, minimum_payout_idr: 99000 },
					reason: "Baseline commercial policy S130",
					reauthentication_proof: pf,
				}),
				identity,
			);
			assert.equal(saveRes.status, 201);
		}

		const year = new Date().getUTCFullYear();
		const calProof = await issueProof(identity, owner, "warehouse_calendar.version", warehouseId);
		const calSaveRes = await handleAccess(
			postReq(owner, "/api/v1/admin/policy-versions", {
				kind: "warehouse_calendar",
				warehouse_id: warehouseId,
				effective_at: null,
				expected_version: 0,
				values: {
					timezone: "Asia/Jakarta",
					year,
					working_weekdays: [1, 2, 3, 4, 5, 6],
					cutoff_local: "15:00",
					closed_dates: [],
					source: "TEST-ONLY",
					approval: "test_only",
				},
				reason: "Kalender gudang S130",
				reauthentication_proof: calProof,
			}),
			identity,
		);
		assert.equal(calSaveRes.status, 201);

		// 1. Unauthenticated guest -> 401 across all settings endpoints
		const guest = new BrowserSession(identity);
		assert.equal(
			(await handleAccess(guest.request("/api/v1/admin/policy-versions?kind=payment"), identity)).status,
			401,
		);
		assert.equal(
			(await handleShippingLabels(guest.request("/api/v1/admin/shipping-label-templates"), identity)).status,
			401,
		);
		assert.equal(
			(await handleAdvertisingDiagnostics(guest.request("/api/v1/admin/advertising/destinations"), identity)).status,
			401,
		);
		assert.equal(
			(await handleSupport(guest.request("/api/v1/admin/support/saved-replies"), identity)).status,
			401,
		);
		assert.equal(
			(await handleSupport(guest.request("/api/v1/admin/support/tags"), identity)).status,
			401,
		);

		// 2. Finance reads payment, commercial, and label-template history (200)
		const finPaymentRead = await handleAccess(
			finance.browser.request("/api/v1/admin/policy-versions?kind=payment"),
			identity,
		);
		assert.equal(finPaymentRead.status, 200);
		const finPaymentJson = await finPaymentRead.json();
		assert.ok(finPaymentJson.current);
		assert.ok(Array.isArray(finPaymentJson.data) && finPaymentJson.data.length >= 1);

		const finCommercialRead = await handleAccess(
			finance.browser.request("/api/v1/admin/policy-versions?kind=commercial"),
			identity,
		);
		assert.equal(finCommercialRead.status, 200);
		const finCommercialJson = await finCommercialRead.json();
		assert.ok(finCommercialJson.current);
		assert.ok(Array.isArray(finCommercialJson.data) && finCommercialJson.data.length >= 1);

		const finTemplatesRead = await handleShippingLabels(
			finance.browser.request("/api/v1/admin/shipping-label-templates"),
			identity,
		);
		assert.equal(finTemplatesRead.status, 200);
		const finTemplatesJson = await finTemplatesRead.json();
		assert.ok(Array.isArray(finTemplatesJson.data) && finTemplatesJson.data.length >= 2);
		assert.ok(Array.isArray(finTemplatesJson.data[0].history) && finTemplatesJson.data[0].history.length >= 1);

		// 3. Finance is refused on warehouse_calendar GET (403) and on all writes (403)
		const finCalendarRead = await handleAccess(
			finance.browser.request(
				`/api/v1/admin/policy-versions?kind=warehouse_calendar&warehouse_id=${warehouseId}`,
			),
			identity,
		);
		assert.equal(finCalendarRead.status, 403);

		const finProofAttempt = await handleAccess(
			postReq(finance, "/api/v1/me/reauthentication-proofs", {
				password: finance.password,
				action: "payment_policy.version",
				subject_id: "company-payment",
			}),
			identity,
		);
		assert.equal(finProofAttempt.status, 403);

		const finPolicyWrite = await handleAccess(
			postReq(finance, "/api/v1/admin/policy-versions", {
				kind: "payment",
				warehouse_id: null,
				effective_at: null,
				expected_version: finPaymentJson.latest_version,
				values: { cod_fee_bps: 100, manual_bank_accounts: [] },
				reason: "Finance unauthorized write",
				reauthentication_proof: "bogus-proof-string",
			}),
			identity,
		);
		assert.equal(finPolicyWrite.status, 403);

		const finTemplateCreate = await handleShippingLabels(
			postReq(finance, "/api/v1/admin/shipping-label-templates", {
				name: "finance-forbidden-tpl",
				format: "thermal_100x150",
				privacy_mode: "masked_phone",
				brand_mode: "99ribu",
				expected_version: 0,
				reason: "Finance unauthorized template",
			}),
			identity,
		);
		assert.equal(finTemplateCreate.status, 403);

		const finTemplateVersion = await handleShippingLabels(
			postReq(
				finance,
				`/api/v1/admin/shipping-label-templates/${finTemplatesJson.data[0].id}/versions`,
				{
					format: "thermal_100x150",
					privacy_mode: "masked_phone",
					brand_mode: "99ribu",
					expected_version: 1,
					reason: "Finance unauthorized template version",
				},
			),
			identity,
		);
		assert.equal(finTemplateVersion.status, 403);

		assert.equal(
			(await handleAdvertisingDiagnostics(finance.browser.request("/api/v1/admin/advertising/destinations"), identity))
				.status,
			403,
		);
		assert.equal(
			(await handleSupport(finance.browser.request("/api/v1/admin/support/saved-replies"), identity)).status,
			403,
		);
		assert.equal(
			(await handleSupport(finance.browser.request("/api/v1/admin/support/tags"), identity)).status,
			403,
		);

		const destinationId = randomUUID();
		for (const [operation, body] of [
			["versions", { expected_version: 1, public_identifier: "finance-forbidden", reason: "Unauthorized" }],
			["pause", { expected_version: 1, paused: true, reason: "Unauthorized" }],
			["replays", { expected_version: 1, event_id: randomUUID(), reason: "Unauthorized" }],
		] as const) {
			const response = await handleAdvertisingDiagnostics(
				postReq(finance, `/api/v1/admin/advertising/destinations/${destinationId}/${operation}`, body),
				identity,
				destinationId,
			);
			assert.equal(response.status, 403, `Finance advertising ${operation}`);
		}
		for (const [resource, body] of [
			["saved-replies", { title: "Forbidden", text: "Halo", placeholders: [], enabled: true, reason: "Unauthorized" }],
			["tags", { label: "Forbidden", enabled: true, reason: "Unauthorized" }],
		] as const) {
			for (const version of [false, true]) {
				const response = await handleSupport(
					postReq(finance, `/api/v1/admin/support/${resource}${version ? `/${randomUUID()}/versions` : ""}`, {
						...body,
						expected_version: version ? 1 : 0,
					}),
					identity,
				);
				assert.equal(response.status, 403, `Finance support ${resource} ${version ? "version" : "create"}`);
			}
		}

		// 4. Other roles (ecommerce_admin, warehouse, customer_service, buyer, affiliate) -> 403 on policy-versions and writes
		for (const other of [ecommerce, warehouse, cs, buyer, affiliate]) {
			for (const query of [
				"kind=payment",
				"kind=commercial",
				`kind=warehouse_calendar&warehouse_id=${warehouseId}`,
			]) {
				const res = await handleAccess(
					other.browser.request(`/api/v1/admin/policy-versions?${query}`),
					identity,
				);
				assert.equal(res.status, 403, `${other.email} GET policy-versions?${query}`);
			}
			const writeRes = await handleAccess(
				postReq(other, "/api/v1/admin/policy-versions", {
					kind: "commercial",
					warehouse_id: null,
					effective_at: null,
					expected_version: 1,
					values: { default_commission_bps: 1000, minimum_payout_idr: 99000 },
					reason: "Unauthorized",
					reauthentication_proof: "bogus-proof-string",
				}),
				identity,
			);
			assert.equal(writeRes.status, 403);

			const tplWriteRes = await handleShippingLabels(
				postReq(other, "/api/v1/admin/shipping-label-templates", {
					name: `forbidden-${randomUUID().slice(0, 6)}`,
					format: "thermal_100x150",
					privacy_mode: "masked_phone",
					brand_mode: "99ribu",
					expected_version: 0,
					reason: "Unauthorized",
				}),
				identity,
			);
			assert.equal(tplWriteRes.status, 403);

			const adReadRes = await handleAdvertisingDiagnostics(
				other.browser.request("/api/v1/admin/advertising/destinations"),
				identity,
			);
			assert.equal(adReadRes.status, 403);

			const srWriteRes = await handleSupport(
				postReq(other, "/api/v1/admin/support/saved-replies", {
					expected_version: 0,
					title: "Forbidden",
					text: "Halo",
					placeholders: [],
					enabled: true,
					reason: "Unauthorized",
				}),
				identity,
			);
			assert.equal(srWriteRes.status, 403);

			const tagWriteRes = await handleSupport(
				postReq(other, "/api/v1/admin/support/tags", {
					expected_version: 0,
					label: "Forbidden",
					enabled: true,
					reason: "Unauthorized",
				}),
				identity,
			);
			assert.equal(tagWriteRes.status, 403);
		}

		// CS and non-staff cannot read label templates; ecommerce/warehouse/buyer/affiliate cannot read CS tools
		for (const deniedLabelReader of [cs, buyer, affiliate]) {
			const res = await handleShippingLabels(
				deniedLabelReader.browser.request("/api/v1/admin/shipping-label-templates"),
				identity,
			);
			assert.equal(res.status, 403);
		}
		for (const deniedSupportReader of [ecommerce, warehouse, buyer, affiliate]) {
			assert.equal(
				(
					await handleSupport(
						deniedSupportReader.browser.request("/api/v1/admin/support/saved-replies"),
						identity,
					)
				).status,
				403,
			);
			assert.equal(
				(
					await handleSupport(
						deniedSupportReader.browser.request("/api/v1/admin/support/tags"),
						identity,
					)
				).status,
				403,
			);
		}
		// Ordinary CS can read saved replies and tags (200)
		assert.equal(
			(await handleSupport(cs.browser.request("/api/v1/admin/support/saved-replies"), identity)).status,
			200,
		);
		assert.equal(
			(await handleSupport(cs.browser.request("/api/v1/admin/support/tags"), identity)).status,
			200,
		);
	} finally {
		for (const u of users) {
			await sql`delete from app.auth_rate_limit where key=${`access-proof:${u.id}`}`;
		}
		await cleanup(identity, users);
		await sql`update app.warehouse set active=false where id=${warehouseId}`;
		await sql.end();
	}
});

test("S130 label-template create and version require the dedicated purpose, fixed subject, fresh single-use proof and owner", async () => {
	const identity = createLocalAuth("test");
	const sql = identity.sql;
	const owner = await actor(identity, "owner", []);
	let templateId: string | null = null;
	const name = `s130-proof-${randomUUID().slice(0, 8)}`;
	const proofDigest = (proof: string) => createHash("sha256").update(proof).digest("hex");
	try {
		await enroll(owner.browser, owner.password);
		const invalidSubject = await handleAccess(
			postReq(owner, "/api/v1/me/reauthentication-proofs", {
				password: owner.password,
				action: "shipping_label_template.version",
				subject_id: "company-commercial",
			}),
			identity,
		);
		assert.equal(invalidSubject.status, 400, "The issuer refuses an interchangeable commercial subject");

		for (const mode of ["create", "version"] as const) {
			const path = mode === "create"
				? "/api/v1/admin/shipping-label-templates"
				: `/api/v1/admin/shipping-label-templates/${templateId}/versions`;
			const body = {
				name,
				format: "thermal_100x150",
				privacy_mode: "masked_phone",
				brand_mode: "99ribu",
				expected_version: mode === "create" ? 0 : 1,
				reason: `S130 dedicated proof ${mode}`,
			};
			const commercial = await issueProof(identity, owner, "company_policy.version", "company-commercial");
			const payment = await issueProof(identity, owner, "payment_policy.version", "company-payment");
			const wrongSubject = await issueProof(identity, owner, "shipping_label_template.version", "shipping-label-templates");
			await sql`update app.access_proof set subject_id='company-commercial' where digest=${proofDigest(wrongSubject)}`;
			const expired = await issueProof(identity, owner, "shipping_label_template.version", "shipping-label-templates");
			await sql`update app.access_proof set expires_at=clock_timestamp()-interval '1 second' where digest=${proofDigest(expired)}`;

			for (const [scenario, proof] of [
				["missing", undefined],
				["commercial purpose", commercial],
				["payment purpose", payment],
				["wrong subject", wrongSubject],
				["expired", expired],
			] as const) {
				const response = await handleShippingLabels(
					postReq(owner, path, { ...body, ...(proof === undefined ? {} : { reauthentication_proof: proof }) }),
					identity,
				);
				assert.equal(response.status, 403, `${mode}: ${scenario}`);
				assert.equal((await response.json()).code, "REAUTHENTICATION_REQUIRED", `${mode}: ${scenario}`);
				if (proof) {
					const [stored] = await sql`select consumed_at from app.access_proof where digest=${proofDigest(proof)}`;
					assert.equal(stored.consumed_at, null, `${mode}: rejected proof is not consumed`);
				}
				if (mode === "create") {
					const [count] = await sql`select count(*)::int n from app.shipping_label_template where code=${name}`;
					assert.equal(count.n, 0, `Denied ${scenario} creates no template`);
				} else {
					const [stored] = await sql`select active_revision from app.shipping_label_template where id=${templateId}`;
					const [versions] = await sql`select count(*)::int n from app.shipping_label_template_version where template_id=${templateId}`;
					assert.equal(stored.active_revision, 1, `Denied ${scenario} leaves the current revision`);
					assert.equal(versions.n, 1, `Denied ${scenario} appends no history`);
				}
			}

			const proof = await issueProof(identity, owner, "shipping_label_template.version", "shipping-label-templates");
			const key = randomUUID();
			const requestBody = { ...body, reauthentication_proof: proof };
			const accepted = await handleShippingLabels(postReq(owner, path, requestBody, key), identity);
			assert.equal(accepted.status, 201, await accepted.clone().text());
			const saved = await accepted.json();
			templateId = saved.id;
			assert.equal(saved.active_version, mode === "create" ? 1 : 2);

			// A lost successful response remains recoverable under the original operation identity.
			const recovered = await handleShippingLabels(postReq(owner, path, requestBody, key), identity);
			assert.equal(recovered.status, 201);
			assert.deepEqual(await recovered.json(), saved);

			const replay = await handleShippingLabels(
				postReq(owner, path, {
					...requestBody,
					name: mode === "create" ? `${name}-replay` : name,
					expected_version: mode === "create" ? 0 : saved.active_version,
				}),
				identity,
			);
			assert.equal(replay.status, 403, `${mode}: a new intent cannot reuse a consumed proof`);
			assert.equal((await replay.json()).code, "REAUTHENTICATION_REQUIRED");
		}
		const [stored] = await sql`select active_revision from app.shipping_label_template where id=${templateId}`;
		const [versions] = await sql`select count(*)::int n from app.shipping_label_template_version where template_id=${templateId}`;
		const [replayedCreate] = await sql`select count(*)::int n from app.shipping_label_template where code=${`${name}-replay`}`;
		assert.equal(stored.active_revision, 2);
		assert.equal(versions.n, 2);
		assert.equal(replayedCreate.n, 0);
	} finally {
		if (templateId) {
			await sql`delete from app.shipping_label_template_version where template_id=${templateId}`;
			await sql`delete from app.shipping_label_template where id=${templateId}`;
		}
		await cleanup(identity, [owner]);
		await sql.end();
	}
});

test("S130 owner policies and label templates require dedicated proofs; advertising and support use reason/version/audit; stale versions return 409", async () => {
	const identity = createLocalAuth("test");
	const sql = identity.sql;
	const users: Actor[] = [];
	const createdTemplateIds: string[] = [];
	const createdReplyIds: string[] = [];
	const createdTagIds: string[] = [];
	let originalPaymentValues: Record<string, unknown> | null = null;
	let originalCommercialValues: Record<string, unknown> | null = null;

	try {
		const owner = await actor(identity, "owner", []);
		users.push(owner);
		await enroll(owner.browser, owner.password);

		// 1. Payment policy: write new version with proof, check history, verify stale expected_version -> 409
		const payBefore = await (
			await handleAccess(owner.browser.request("/api/v1/admin/policy-versions?kind=payment"), identity)
		).json();
		originalPaymentValues = payBefore.current?.values ?? {
			cod_fee_bps: 333,
			manual_bank_accounts: [
				{
					bank_name: "BCA",
					account_number: "8800112233",
					account_holder: "PT Serba Sembilan Puluh Sembilan",
				},
			],
		};

		const payProof = await issueProof(identity, owner, "payment_policy.version", "company-payment");
		const payWriteRes = await handleAccess(
			postReq(owner, "/api/v1/admin/policy-versions", {
				kind: "payment",
				warehouse_id: null,
				effective_at: null,
				expected_version: payBefore.latest_version,
				values: {
					cod_fee_bps: 425,
					manual_bank_accounts: [
						{
							bank_name: "Bank Mandiri",
							account_number: "1400099887766",
							account_holder: "PT Serba Sembilan Puluh Sembilan",
						},
					],
				},
				reason: "S130 uji versi baru ketentuan pembayaran",
				reauthentication_proof: payProof,
			}),
			identity,
		);
		assert.equal(payWriteRes.status, 201);
		const paySaved = await payWriteRes.json();
		assert.equal(paySaved.version, payBefore.latest_version + 1);
		assert.equal(paySaved.values.cod_fee_bps, 425);

		// Stale expected_version on payment -> 409 VERSION_CONFLICT
		const stalePayProof = await issueProof(identity, owner, "payment_policy.version", "company-payment");
		const stalePayRes = await handleAccess(
			postReq(owner, "/api/v1/admin/policy-versions", {
				kind: "payment",
				warehouse_id: null,
				effective_at: null,
				expected_version: payBefore.latest_version,
				values: { cod_fee_bps: 200, manual_bank_accounts: [] },
				reason: "S130 versi pembayaran basi",
				reauthentication_proof: stalePayProof,
			}),
			identity,
		);
		assert.equal(stalePayRes.status, 409);
		assert.equal((await stalePayRes.json()).code, "VERSION_CONFLICT");

		// 2. Commercial policy: write new version with proof, check history, verify stale expected_version -> 409
		const commBefore = await (
			await handleAccess(owner.browser.request("/api/v1/admin/policy-versions?kind=commercial"), identity)
		).json();
		originalCommercialValues = commBefore.current?.values ?? {
			default_commission_bps: 1000,
			minimum_payout_idr: 99000,
		};

		const commProof = await issueProof(identity, owner, "company_policy.version", "company-commercial");
		const commWriteRes = await handleAccess(
			postReq(owner, "/api/v1/admin/policy-versions", {
				kind: "commercial",
				warehouse_id: null,
				effective_at: null,
				expected_version: commBefore.latest_version,
				values: {
					default_commission_bps: 1100,
					minimum_payout_idr: 120000,
					minimum_contribution_idr: 5000,
				},
				reason: "S130 uji versi baru kebijakan komersial",
				reauthentication_proof: commProof,
			}),
			identity,
		);
		assert.equal(commWriteRes.status, 201);
		const commSaved = await commWriteRes.json();
		assert.equal(commSaved.version, commBefore.latest_version + 1);
		assert.equal(commSaved.values.default_commission_bps, 1100);
		assert.equal(commSaved.values.minimum_contribution_idr, 5000);

		const staleCommProof = await issueProof(identity, owner, "company_policy.version", "company-commercial");
		const staleCommRes = await handleAccess(
			postReq(owner, "/api/v1/admin/policy-versions", {
				kind: "commercial",
				warehouse_id: null,
				effective_at: null,
				expected_version: commBefore.latest_version,
				values: { default_commission_bps: 900, minimum_payout_idr: 99000 },
				reason: "S130 versi komersial basi",
				reauthentication_proof: staleCommProof,
			}),
			identity,
		);
		assert.equal(staleCommRes.status, 409);
		assert.equal((await staleCommRes.json()).code, "VERSION_CONFLICT");

		// 3. Label template: create v1 with proof, append v2 with proof, check history, stale expected_version -> 409
		const tplName = `s130-tpl-${randomUUID().slice(0, 8)}`;
		const tplCreateProof = await issueProof(identity, owner, "shipping_label_template.version", "shipping-label-templates");
		const tplCreateRes = await handleShippingLabels(
			postReq(owner, "/api/v1/admin/shipping-label-templates", {
				name: tplName,
				format: "thermal_100x150",
				privacy_mode: "masked_phone",
				brand_mode: "neutral_partner",
				partner_brand_name: "Mitra S130",
				disclosure_text: "Dikirim melalui mitra logistik S130 v1",
				renderer_version: "v1",
				expected_version: 0,
				reason: "Buat template label S130 v1",
				reauthentication_proof: tplCreateProof,
			}),
			identity,
		);
		assert.equal(tplCreateRes.status, 201, await tplCreateRes.clone().text());
		const tplCreated = await tplCreateRes.json();
		createdTemplateIds.push(tplCreated.id);
		assert.equal(tplCreated.active_version, 1);
		assert.equal(tplCreated.history.length, 1);

		// Reusing consumed proof on label template version is rejected (403 REAUTHENTICATION_REQUIRED)
		const reusedTplProofRes = await handleShippingLabels(
			postReq(owner, `/api/v1/admin/shipping-label-templates/${tplCreated.id}/versions`, {
				name: tplName,
				format: "thermal_100x150",
				privacy_mode: "carrier_required_full_phone",
				brand_mode: "neutral_partner",
				partner_brand_name: "Mitra S130",
				disclosure_text: "Dikirim melalui mitra logistik S130 v2",
				renderer_version: "v2",
				expected_version: 1,
				reason: "Coba ulang bukti bekas",
				reauthentication_proof: tplCreateProof,
			}),
			identity,
		);
		assert.equal(reusedTplProofRes.status, 403);
		assert.equal((await reusedTplProofRes.json()).code, "REAUTHENTICATION_REQUIRED");

		const tplV2Proof = await issueProof(identity, owner, "shipping_label_template.version", "shipping-label-templates");
		const tplV2Res = await handleShippingLabels(
			postReq(owner, `/api/v1/admin/shipping-label-templates/${tplCreated.id}/versions`, {
				name: tplName,
				format: "thermal_100x150",
				privacy_mode: "carrier_required_full_phone",
				brand_mode: "neutral_partner",
				partner_brand_name: "Mitra S130",
				disclosure_text: "Dikirim melalui mitra logistik S130 v2",
				renderer_version: "v2",
				expected_version: 1,
				reason: "Naikkan template label ke v2",
				reauthentication_proof: tplV2Proof,
			}),
			identity,
		);
		assert.equal(tplV2Res.status, 201);
		const tplV2 = await tplV2Res.json();
		assert.equal(tplV2.active_version, 2);
		assert.equal(tplV2.history.length, 2);
		assert.deepEqual(
			tplV2.history.map((h: { version: number }) => h.version),
			[2, 1],
		);

		// Stale expected_version on label template -> 409 TEMPLATE_VERSION_CONFLICT
		const staleTplProof = await issueProof(identity, owner, "shipping_label_template.version", "shipping-label-templates");
		const staleTplRes = await handleShippingLabels(
			postReq(owner, `/api/v1/admin/shipping-label-templates/${tplCreated.id}/versions`, {
				name: tplName,
				format: "thermal_100x150",
				privacy_mode: "masked_phone",
				brand_mode: "99ribu",
				expected_version: 1,
				reason: "Versi template basi",
				reauthentication_proof: staleTplProof,
			}),
			identity,
		);
		assert.equal(staleTplRes.status, 409);
		assert.equal((await staleTplRes.json()).code, "TEMPLATE_VERSION_CONFLICT");

		// 4. Ad destination: version/pause/resume without proof (B24), history and stale version refusal.
		const adListRes = await handleAdvertisingDiagnostics(
			owner.browser.request("/api/v1/admin/advertising/destinations"),
			identity,
		);
		assert.equal(adListRes.status, 200);
		const adList = await adListRes.json();
		const meta = adList.data.find((d: { platform: string }) => d.platform === "meta");
		assert.ok(meta);
		assert.ok(Array.isArray(meta.history) && meta.history.length >= 1);

		const adVersionRes = await handleAdvertisingDiagnostics(
			postReq(owner, `/api/v1/admin/advertising/destinations/${meta.id}/versions`, {
				expected_version: meta.version,
				public_identifier: meta.public_identifier,
				destination_version: meta.destination_version,
				paused: meta.paused,
				reason: "S130 pembaruan versi tujuan iklan Meta",
			}),
			identity,
			meta.id,
		);
		assert.equal(adVersionRes.status, 201);
		const adUpdated = await adVersionRes.json();
		assert.equal(adUpdated.version, meta.version + 1);
		assert.ok(adUpdated.history.some((h: { version: number }) => h.version === meta.version + 1));

		const pauseRes = await handleAdvertisingDiagnostics(
			postReq(owner, `/api/v1/admin/advertising/destinations/${meta.id}/pause`, {
				expected_version: adUpdated.version,
				paused: true,
				reason: "Jeda sinyal S130",
			}),
			identity,
			meta.id,
		);
		assert.equal(pauseRes.status, 200);
		const paused = await pauseRes.json();
		const resumeRes = await handleAdvertisingDiagnostics(
			postReq(owner, `/api/v1/admin/advertising/destinations/${meta.id}/pause`, {
				expected_version: paused.version,
				paused: meta.paused,
				reason: "Pulihkan status sinyal setelah S130",
			}),
			identity,
			meta.id,
		);
		assert.equal(resumeRes.status, 200);

		// Stale expected_version on ad destination -> 409 VERSION_CONFLICT
		const staleAdRes = await handleAdvertisingDiagnostics(
			postReq(owner, `/api/v1/admin/advertising/destinations/${meta.id}/versions`, {
				expected_version: meta.version,
				public_identifier: meta.public_identifier,
				reason: "Versi tujuan iklan basi",
			}),
			identity,
			meta.id,
		);
		assert.equal(staleAdRes.status, 409);
		assert.equal((await staleAdRes.json()).code, "VERSION_CONFLICT");

		// 5. Saved reply: create and version without proof (B25), history and stale version refusal.
		const srTitle = `S130 Balasan ${randomUUID().slice(0, 8)}`;
		const srCreateRes = await handleSupport(
			postReq(owner, "/api/v1/admin/support/saved-replies", {
				expected_version: 0,
				title: srTitle,
				text: "Halo {{customer_name}}, pesanan {{order_reference}} sedang kami cek (v1).",
				placeholders: ["customer_name", "order_reference"],
				enabled: true,
				reason: "Buat balasan tersimpan S130 v1",
			}),
			identity,
		);
		assert.equal(srCreateRes.status, 201);
		const srCreated = await srCreateRes.json();
		createdReplyIds.push(srCreated.id);
		assert.equal(srCreated.version, 1);

		const srV2Res = await handleSupport(
			postReq(owner, `/api/v1/admin/support/saved-replies/${srCreated.id}/versions`, {
				expected_version: 1,
				title: srTitle,
				text: "Halo {{customer_name}}, pesanan {{order_reference}} sudah diproses (v2).",
				placeholders: ["customer_name", "order_reference"],
				enabled: true,
				reason: "Perbarui balasan tersimpan S130 ke v2",
			}),
			identity,
		);
		assert.equal(srV2Res.status, 201);
		const srV2 = await srV2Res.json();
		assert.equal(srV2.version, 2);

		// Stale expected_version on saved reply -> 409 VERSION_CONFLICT
		const staleSrRes = await handleSupport(
			postReq(owner, `/api/v1/admin/support/saved-replies/${srCreated.id}/versions`, {
				expected_version: 1,
				title: srTitle,
				text: "Teks basi",
				placeholders: [],
				enabled: true,
				reason: "Versi balasan basi",
			}),
			identity,
		);
		assert.equal(staleSrRes.status, 409);
		assert.equal((await staleSrRes.json()).code, "VERSION_CONFLICT");

		const srListRes = await handleSupport(
			owner.browser.request("/api/v1/admin/support/saved-replies?limit=100"),
			identity,
		);
		assert.equal(srListRes.status, 200);
		const srList = await srListRes.json();
		const listedSr = srList.data.find((r: { id: string }) => r.id === srCreated.id);
		assert.ok(listedSr);
		assert.equal(listedSr.version, 2);
		assert.deepEqual(
			listedSr.history.map((h: { version: number }) => h.version),
			[2, 1],
		);

		// 6. Support tag: create and version without proof (B25), history and stale version refusal.
		const tagLabel = `S130-Tag-${randomUUID().slice(0, 8)}`;
		const tagCreateRes = await handleSupport(
			postReq(owner, "/api/v1/admin/support/tags", {
				expected_version: 0,
				label: tagLabel,
				enabled: true,
				reason: "Buat tag S130 v1",
			}),
			identity,
		);
		assert.equal(tagCreateRes.status, 201);
		const tagCreated = await tagCreateRes.json();
		createdTagIds.push(tagCreated.id);
		assert.equal(tagCreated.version, 1);

		const tagV2Res = await handleSupport(
			postReq(owner, `/api/v1/admin/support/tags/${tagCreated.id}/versions`, {
				expected_version: 1,
				label: `${tagLabel}-v2`,
				enabled: true,
				reason: "Perbarui tag S130 ke v2",
			}),
			identity,
		);
		assert.equal(tagV2Res.status, 201);
		const tagV2 = await tagV2Res.json();
		assert.equal(tagV2.version, 2);

		// Stale expected_version on tag -> 409 VERSION_CONFLICT
		const staleTagRes = await handleSupport(
			postReq(owner, `/api/v1/admin/support/tags/${tagCreated.id}/versions`, {
				expected_version: 1,
				label: `${tagLabel}-stale`,
				enabled: false,
				reason: "Versi tag basi",
			}),
			identity,
		);
		assert.equal(staleTagRes.status, 409);
		assert.equal((await staleTagRes.json()).code, "VERSION_CONFLICT");

		const tagListRes = await handleSupport(
			owner.browser.request("/api/v1/admin/support/tags?limit=100"),
			identity,
		);
		assert.equal(tagListRes.status, 200);
		const tagList = await tagListRes.json();
		const listedTag = tagList.data.find((t: { id: string }) => t.id === tagCreated.id);
		assert.ok(listedTag);
		assert.equal(listedTag.version, 2);
		assert.deepEqual(
			listedTag.history.map((h: { version: number }) => h.version),
			[2, 1],
		);
	} finally {
		// Restore payment and commercial policies to their original baseline values
		if (users[0] && originalPaymentValues) {
			try {
				const cur = await (
					await handleAccess(
						users[0].browser.request("/api/v1/admin/policy-versions?kind=payment"),
						identity,
					)
				).json();
				const pf = await issueProof(identity, users[0], "payment_policy.version", "company-payment");
				await handleAccess(
					postReq(users[0], "/api/v1/admin/policy-versions", {
						kind: "payment",
						warehouse_id: null,
						effective_at: null,
						expected_version: cur.latest_version,
						values: originalPaymentValues,
						reason: "Restore payment policy after S130 test",
						reauthentication_proof: pf,
					}),
					identity,
				);
			} catch {
				// ignore restore failure on teardown
			}
		}
		if (users[0] && originalCommercialValues) {
			try {
				const cur = await (
					await handleAccess(
						users[0].browser.request("/api/v1/admin/policy-versions?kind=commercial"),
						identity,
					)
				).json();
				const pf = await issueProof(identity, users[0], "company_policy.version", "company-commercial");
				await handleAccess(
					postReq(users[0], "/api/v1/admin/policy-versions", {
						kind: "commercial",
						warehouse_id: null,
						effective_at: null,
						expected_version: cur.latest_version,
						values: originalCommercialValues,
						reason: "Restore commercial policy after S130 test",
						reauthentication_proof: pf,
					}),
					identity,
				);
			} catch {
				// ignore restore failure on teardown
			}
		}
		for (const tplId of createdTemplateIds) {
			await sql`delete from app.shipping_label_template_version where template_id=${tplId}`;
			await sql`delete from app.shipping_label_template where id=${tplId}`;
		}
		for (const replyId of createdReplyIds) {
			await sql`delete from app.support_saved_reply where id=${replyId}`;
		}
		for (const tagId of createdTagIds) {
			await sql`delete from app.support_tag where id=${tagId}`;
		}
		for (const u of users) {
			await sql`delete from app.auth_rate_limit where key=${`access-proof:${u.id}`}`;
		}
		await cleanup(identity, users);
		await sql.end();
	}
});

test("S130 existing orders keep their applied policy snapshot after payment and commercial policy updates", async () => {
	const f = await paymentFixture();
	const sql = f.identity.sql;
	let originalPayment: Record<string, unknown> | null = null;
	let originalCommercial: Record<string, unknown> | null = null;

	const settleClock = async () => {
		const clock = await readFixtureClock("test", f.namespace);
		const [wall] = await sql`select clock_timestamp() now`;
		await advanceFixtureClock(
			"test",
			f.namespace,
			Math.max(1, Math.ceil((new Date(wall.now).getTime() - Date.parse(clock.now)) / 1000) + 5),
			clock.version,
		);
	};

	const setPolicy = async (
		kind: "payment" | "commercial",
		values: Record<string, unknown>,
		reason: string,
	) => {
		const histRes = await handleAccess(
			f.owner.browser.request(`/api/v1/admin/policy-versions?kind=${kind}`),
			f.identity,
		);
		assert.equal(histRes.status, 200);
		const hist = await histRes.json();
		const pf = await issueProof(
			f.identity,
			f.owner,
			kind === "payment" ? "payment_policy.version" : "company_policy.version",
			kind === "payment" ? "company-payment" : "company-commercial",
		);
		const saveRes = await handleAccess(
			postReq(f.owner, "/api/v1/admin/policy-versions", {
				kind,
				warehouse_id: null,
				effective_at: null,
				expected_version: hist.latest_version,
				values,
				reason,
				reauthentication_proof: pf,
			}),
			f.identity,
		);
		assert.equal(saveRes.status, 201, await saveRes.clone().text());
		await settleClock();
		return saveRes.json();
	};

	try {
		const payInit = await (
			await handleAccess(
				f.owner.browser.request("/api/v1/admin/policy-versions?kind=payment"),
				f.identity,
			)
		).json();
		originalPayment = payInit.current?.values ?? { cod_fee_bps: 0, manual_bank_accounts: [] };

		const commInit = await (
			await handleAccess(
				f.owner.browser.request("/api/v1/admin/policy-versions?kind=commercial"),
				f.identity,
			)
		).json();
		originalCommercial = commInit.current?.values ?? {
			default_commission_bps: 1000,
			minimum_payout_idr: 99000,
		};

		// 1. Set Policy vA (250 bps COD fee, Bank A)
		const paymentPolicyA = await setPolicy(
			"payment",
			{
				cod_fee_bps: 250,
				manual_bank_accounts: [
					{
						bank_name: "Bank A",
						account_number: "1111222233",
						account_holder: "PT Contoh A",
					},
				],
			},
			"S130 policy snapshot vA",
		);

		const { order: orderCodA } = await f.order(1, "cod");
		const { order: orderBankA } = await f.order(1, "prepaid", "manual-bank");
		const [storedCodBefore] = await sql`
			select cod_fee_bps, payment_charge_amount, buyer_total
			from app.commerce_order
			where id = ${orderCodA.id}
		`;
		assert.equal(storedCodBefore.cod_fee_bps, 250);
		const [storedBankBefore] = await sql`
			select payment_policy_version_id, transfer_code, payment_charge_amount, buyer_total
			from app.commerce_order
			where id = ${orderBankA.id}
		`;
		assert.equal(storedBankBefore.payment_policy_version_id, paymentPolicyA.id);
		const projectedCodBefore = await sql.begin((tx) => projectOrder(tx, orderCodA.id));
		const itemsBefore = await sql`
			select id, publication_id, snapshot from app.order_item
			where order_id = ${orderCodA.id} order by id
		`;
		assert.ok(itemsBefore.length > 0);
		assert.ok(itemsBefore.every((item) => item.publication_id && item.snapshot));

		// 2. Update payment policy to vB (600 bps COD fee, Bank B); new orders get vB while existing orders keep vA
		const paymentPolicyB = await setPolicy(
			"payment",
			{
				cod_fee_bps: 600,
				manual_bank_accounts: [
					{
						bank_name: "Bank B",
						account_number: "9999888877",
						account_holder: "PT Contoh B",
					},
				],
			},
			"S130 policy snapshot vB",
		);

		const { order: orderCodB } = await f.order(1, "cod");
		const { order: orderBankB } = await f.order(1, "prepaid", "manual-bank");
		const [storedCodB] = await sql`
			select cod_fee_bps
			from app.commerce_order
			where id = ${orderCodB.id}
		`;
		assert.equal(storedCodB.cod_fee_bps, 600);
		const [storedBankB] = await sql`
			select payment_policy_version_id
			from app.commerce_order
			where id = ${orderBankB.id}
		`;
		assert.equal(storedBankB.payment_policy_version_id, paymentPolicyB.id);

		// 3. Also update commercial policy to vB; existing orders keep their frozen items and payment snapshots
		await setPolicy(
			"commercial",
			{
				default_commission_bps: 1250,
				minimum_payout_idr: 150000,
			},
			"S130 commercial policy vB",
		);
		const itemsAfter = await sql`
			select id, publication_id, snapshot from app.order_item
			where order_id = ${orderCodA.id} order by id
		`;
		assert.deepEqual([...itemsAfter], [...itemsBefore], "Commercial policy changes preserve issued publication IDs and item snapshots");

		const [storedCodAfter] = await sql`
			select cod_fee_bps, payment_charge_amount, buyer_total
			from app.commerce_order
			where id = ${orderCodA.id}
		`;
		assert.equal(storedCodAfter.cod_fee_bps, 250);
		assert.equal(storedCodAfter.payment_charge_amount, storedCodBefore.payment_charge_amount);
		assert.equal(storedCodAfter.buyer_total, storedCodBefore.buyer_total);

		const projectedCodAfter = await sql.begin((tx) => projectOrder(tx, orderCodA.id));
		assert.equal(projectedCodAfter.payment_charge_total, projectedCodBefore.payment_charge_total);
		assert.equal(projectedCodAfter.amount_due, projectedCodBefore.amount_due);

		const [storedBankAfter] = await sql`
			select o.payment_policy_version_id, o.transfer_code, v.values->'manual_bank_accounts' as accounts
			from app.commerce_order o
			join app.policy_version v on v.id = o.payment_policy_version_id
			where o.id = ${orderBankA.id}
		`;
		assert.equal(storedBankAfter.payment_policy_version_id, paymentPolicyA.id);
		assert.equal(storedBankAfter.transfer_code, storedBankBefore.transfer_code);
		assert.equal(storedBankAfter.accounts[0].account_number, "1111222233");
	} finally {
		try {
			if (originalPayment) {
				await setPolicy("payment", originalPayment, "Restore payment policy after S130");
			}
			if (originalCommercial) {
				await setPolicy("commercial", originalCommercial, "Restore commercial policy after S130");
			}
		} finally {
			await sql`delete from app.auth_rate_limit where key=${`access-proof:${f.owner.id}`}`;
			await f.close();
		}
	}
});
