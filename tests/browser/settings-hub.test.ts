import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect, type Page, type Route } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, type BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S130 Settings hub (/admin/settings/{payment,commercial,label-templates,advertising,support})
// on the built web at 127.0.0.1:3099 (selector `--case=settings-hub` in browser mode).
// Written for serial execution by the coordinator.

const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const renders = join(RENDERS, "s130");

type StaffActor = {
	id: string;
	email: string;
	password: string;
	browser: BrowserSession;
};

const users: StaffActor[] = [];
let browser: Browser;

async function staff(role: Role, permissions: string[] = []): Promise<StaffActor> {
	const user = await actor(identity, role, []);
	users.push(user);
	await enroll(user.browser, user.password);
	if (permissions.length > 0) {
		await identity.sql`update app.role_grant set permissions=${permissions} where user_id=${user.id}`;
	}
	return user;
}

async function open(user: StaffActor, viewport = { width: 1440, height: 900 }, touch = false) {
	const context = await browser.newContext({
		viewport,
		reducedMotion: "reduce",
		hasTouch: touch,
		isMobile: touch,
	});
	await context.addCookies(
		[...user.browser.cookies].map(([name, value]) => ({
			name,
			value,
			domain: "127.0.0.1",
			path: "/",
		})),
	);
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("request", (request) =>
		assert.equal(new URL(request.url()).origin, origin, "No external browser request"),
	);
	return { page, errors, close: () => context.close() };
}

const json = (route: Route, body: unknown, status = 200) =>
	route.fulfill({
		status,
		contentType: "application/json",
		headers: {
			"cache-control": "no-store",
			"referrer-policy": "no-referrer",
			"x-content-type-options": "nosniff",
		},
		body: JSON.stringify(body),
	});

const problem = (route: Route, status: number, code: string) =>
	json(
		route,
		{
			type: "about:blank",
			title: code,
			status,
			code,
			request_id: randomUUID(),
		},
		status,
	);

const overflow = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

before(async () => {
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
	});
	mkdirSync(renders, { recursive: true });
});

after(async () => {
	try {
		await browser?.close();
	} finally {
		for (const u of users) {
			await identity.sql`delete from app.auth_rate_limit where key=${`access-proof:${u.id}`}`;
		}
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("S130 payment & commercial policy screens: owner saves new version with proof, capturedVersion freezes across 409 conflict keeping draft, finance sees read-only view", async () => {
	const owner = await staff("owner");
	const finance = await staff("finance");
	const cs = await staff("customer_service");

	let paymentVersion = 2;
	const postedBodies: Record<string, unknown>[] = [];
	let forceConflictOnce = false;

	const mountPolicyRoutes = async (page: Page) => {
		await page.route(
			(url) =>
				url.origin === origin &&
				(url.pathname === "/api/v1/admin/policy-versions" ||
					url.pathname === "/api/v1/me/reauthentication-proofs"),
			async (route) => {
				const req = route.request();
				const url = new URL(req.url());
				if (url.pathname === "/api/v1/me/reauthentication-proofs") {
					return json(
						route,
						{
							proof: "SYNTHETIC-PROOF-TOKEN",
							expires_at: new Date(Date.now() + 300000).toISOString(),
						},
						201,
					);
				}
				if (req.method() === "GET") {
					const kind = url.searchParams.get("kind");
					if (kind === "payment") {
						const current = {
							id: "00000000-0000-4000-8000-000000000101",
							kind: "payment",
							warehouse_id: null,
							version: paymentVersion,
							effective_at: "2026-10-20T00:00:00.000Z",
							values: {
								cod_fee_bps: 333,
								manual_bank_accounts: [
									{
										bank_name: "BCA",
										account_number: "8800112233",
										account_holder: "PT Serba 99ribu",
									},
								],
							},
							actor_id: owner.id,
							reason: "Ketentuan pembayaran aktif",
							created_at: "2026-10-20T00:00:00.000Z",
						};
						return json(route, {
							data: [current],
							pagination: { next_cursor: null },
							latest_version: paymentVersion,
							current,
						});
					}
					const currentComm = {
						id: "00000000-0000-4000-8000-000000000201",
						kind: "commercial",
						warehouse_id: null,
						version: 3,
						effective_at: "2026-10-20T00:00:00.000Z",
						values: {
							default_commission_bps: 1000,
							minimum_payout_idr: 99000,
							minimum_contribution_idr: 5000,
						},
						actor_id: owner.id,
						reason: "Kebijakan komersial aktif",
						created_at: "2026-10-20T00:00:00.000Z",
					};
					return json(route, {
						data: [currentComm],
						pagination: { next_cursor: null },
						latest_version: 3,
						current: currentComm,
					});
				}
				const body = JSON.parse(req.postData() ?? "{}") as Record<string, unknown>;
				postedBodies.push(body);
				if (forceConflictOnce) {
					paymentVersion = 5;
					return problem(route, 409, "VERSION_CONFLICT");
				}
				paymentVersion += 1;
				return json(
					route,
					{
						id: randomUUID(),
						kind: body.kind,
						warehouse_id: null,
						version: Number(body.expected_version) + 1,
						effective_at: new Date().toISOString(),
						values: body.values,
						actor_id: owner.id,
						reason: body.reason,
						created_at: new Date().toISOString(),
					},
					201,
				);
			},
		);
	};

	const ownerView = await open(owner);
	try {
		await mountPolicyRoutes(ownerView.page);
		await ownerView.page.goto(`${origin}/admin/settings/payment`);
		await expect(
			ownerView.page.getByRole("heading", { name: "Pembayaran & Biaya COD", level: 1 }),
		).toBeVisible();
		await expect(ownerView.page.getByTestId("payment-policy-current")).toContainText("3,33%");
		await expect(ownerView.page.getByTestId("payment-policy-table")).toBeVisible();

		// Open dialog when latest_version === 2; simulate a 409 VERSION_CONFLICT that bumps background version to 5.
		forceConflictOnce = true;
		await ownerView.page.getByTestId("payment-policy-new").click();
		const dialog = ownerView.page.getByRole("dialog");
		await dialog.getByTestId("payment-cod-fee").fill("4,5");
		await dialog.getByTestId("payment-reason").fill("Revisi biaya COD S130");
		await dialog.getByTestId("payment-password").fill(owner.password);
		await dialog.getByRole("button", { name: "Simpan ketentuan" }).click();

		await expect(dialog.getByRole("alert")).toContainText("VERSION_CONFLICT");
		// Draft stays in the open dialog, and background table reloaded to v5
		await expect(dialog.getByTestId("payment-cod-fee")).toHaveValue("4,5");
		await expect(dialog.getByTestId("payment-reason")).toHaveValue("Revisi biaya COD S130");
		await expect(ownerView.page.getByTestId("payment-policy-current")).toContainText("Versi 5");

		// Clicking submit a second time in the same open dialog MUST still submit capturedVersion (2), not 5!
		await dialog.getByRole("button", { name: "Simpan ketentuan" }).click();
		assert.equal(postedBodies.length, 2);
		assert.equal(postedBodies[0].expected_version, 2);
		assert.equal(postedBodies[1].expected_version, 2, "capturedVersion stays frozen on dialog mount");

		await dialog.getByRole("button", { name: "Batal" }).click();
		await expect(dialog).toHaveCount(0);

		// Reopen dialog with latest version (5) and save
		forceConflictOnce = false;
		await ownerView.page.getByTestId("payment-policy-new").click();
		const freshDialog = ownerView.page.getByRole("dialog");
		await freshDialog.getByTestId("payment-cod-fee").fill("4,5");
		await freshDialog.getByTestId("payment-reason").fill("Simpan versi baru setelah tinjau");
		await freshDialog.getByTestId("payment-password").fill(owner.password);
		await freshDialog.getByRole("button", { name: "Simpan ketentuan" }).click();
		await expect(ownerView.page.getByTestId("payment-policy-notice")).toContainText("versi 6");
		assert.equal(postedBodies.at(-1)?.expected_version, 5);

		// Commercial policy page
		await ownerView.page.goto(`${origin}/admin/settings/commercial`);
		await expect(
			ownerView.page.getByRole("heading", { name: "Kebijakan Komersial", level: 1 }),
		).toBeVisible();
		await expect(ownerView.page.getByTestId("commercial-policy-current")).toContainText("10%");
		await ownerView.page.getByTestId("commercial-policy-new").click();
		const commDialog = ownerView.page.getByRole("dialog");
		await commDialog.getByTestId("commercial-commission").fill("12");
		await commDialog.getByTestId("commercial-min-payout").fill("150000");
		await commDialog.getByTestId("commercial-min-contribution").fill("8000");
		await commDialog.getByTestId("commercial-reason").fill("Penyesuaian komisi S130");
		await commDialog.getByTestId("commercial-password").fill(owner.password);
		await commDialog.getByRole("button", { name: "Simpan kebijakan" }).click();
		await expect(ownerView.page.getByTestId("commercial-policy-notice")).toContainText("versi 4");
		assert.deepEqual(ownerView.errors, []);
	} finally {
		await ownerView.close();
	}

	// Finance sees read-only on payment and commercial; CS gets AccessDenied
	const finView = await open(finance);
	const csView = await open(cs);
	try {
		await mountPolicyRoutes(finView.page);
		await finView.page.goto(`${origin}/admin/settings/payment`);
		await expect(finView.page.getByTestId("payment-policy-readonly")).toBeVisible();
		await expect(finView.page.getByTestId("payment-policy-new")).toHaveCount(0);
		await expect(finView.page.getByTestId("payment-policy-table")).toBeVisible();

		await finView.page.goto(`${origin}/admin/settings/commercial`);
		await expect(finView.page.getByTestId("commercial-policy-readonly")).toBeVisible();
		await expect(finView.page.getByTestId("commercial-policy-new")).toHaveCount(0);
		await expect(finView.page.getByTestId("commercial-policy-table")).toBeVisible();

		await csView.page.goto(`${origin}/admin/settings/payment`);
		await expect(
			csView.page.getByRole("heading", { name: "Akses kebijakan pembayaran diperlukan" }),
		).toBeVisible();
		await csView.page.goto(`${origin}/admin/settings/commercial`);
		await expect(
			csView.page.getByRole("heading", { name: "Akses kebijakan komersial diperlukan" }),
		).toBeVisible();
		assert.deepEqual([...finView.errors, ...csView.errors], []);
	} finally {
		await finView.close();
		await csView.close();
	}
});

test("S130 uncertain policy submits survive failed history reloads and retry the same key, body and proof", async () => {
	const owner = await staff("owner");
	for (const kind of ["payment", "commercial"] as const) {
		const view = await open(owner);
		const posts: { key: string | undefined; body: string }[] = [];
		const proofRequests: Record<string, unknown>[] = [];
		let reloadFails = false;
		const current = {
			id: randomUUID(),
			kind,
			warehouse_id: null,
			version: 3,
			effective_at: "2026-10-20T00:00:00.000Z",
			values: kind === "payment"
				? { cod_fee_bps: 333, manual_bank_accounts: [] }
				: { default_commission_bps: 1000, minimum_payout_idr: 99000, minimum_contribution_idr: 5000 },
			actor_id: owner.id,
			reason: "Versi aktif",
			created_at: "2026-10-20T00:00:00.000Z",
		};
		try {
			await view.page.route(
				(url) => url.origin === origin && (
					url.pathname === "/api/v1/admin/policy-versions" ||
					url.pathname === "/api/v1/me/reauthentication-proofs"
				),
				async (route) => {
					const request = route.request();
					if (new URL(request.url()).pathname === "/api/v1/me/reauthentication-proofs") {
						proofRequests.push(request.postDataJSON() as Record<string, unknown>);
						return json(route, { proof: "SYNTHETIC-FROZEN-PROOF", expires_at: new Date(Date.now() + 300000).toISOString() }, 201);
					}
					if (request.method() === "GET") {
						if (reloadFails) return problem(route, 503, "HISTORY_UNAVAILABLE");
						return json(route, { data: [current], pagination: { next_cursor: null }, latest_version: 3, current });
					}
					posts.push({ key: request.headers()["idempotency-key"], body: request.postData() ?? "" });
					if (posts.length === 1) {
						reloadFails = true;
						return kind === "payment" ? problem(route, 503, "UPSTREAM_UNAVAILABLE") : route.abort("failed");
					}
					const body = request.postDataJSON() as Record<string, unknown>;
					return json(route, { ...current, version: 4, values: body.values, reason: body.reason }, 201);
				},
			);
			await view.page.goto(`${origin}/admin/settings/${kind}`);
			await view.page.getByTestId(`${kind}-policy-new`).click();
			const dialog = view.page.getByRole("dialog");
			const field = dialog.getByTestId(kind === "payment" ? "payment-cod-fee" : "commercial-commission");
			await field.fill(kind === "payment" ? "4,5" : "12");
			await dialog.getByTestId(`${kind}-reason`).fill("Intent yang harus dipertahankan");
			await dialog.getByTestId(`${kind}-password`).fill(owner.password);
			const failedReload = view.page.waitForResponse((response) =>
				new URL(response.url()).pathname === "/api/v1/admin/policy-versions" &&
				response.request().method() === "GET" && response.status() === 503,
			);
			const submit = dialog.getByRole("button", { name: kind === "payment" ? "Simpan ketentuan" : "Simpan kebijakan" });
			await submit.click();
			await failedReload;
			await expect(dialog).toBeVisible();
			await expect(dialog.getByRole("alert")).toContainText("Hasil belum pasti");
			await expect(dialog.getByTestId(`${kind}-reason`)).toHaveValue("Intent yang harus dipertahankan");
			// Even edited controls cannot silently create a second intent while the first outcome is unknown.
			await field.fill(kind === "payment" ? "6" : "15");
			await dialog.getByTestId(`${kind}-reason`).fill("Draf baru belum boleh dikirim");
			await submit.click();
			await expect(dialog).toHaveCount(0);
			await expect(view.page.getByTestId(`${kind}-policy-notice`)).toContainText("versi 4");
			assert.equal(posts.length, 2);
			assert.ok(posts[0].key);
			assert.equal(posts[1].key, posts[0].key, `${kind}: same Idempotency-Key after failed reload`);
			assert.equal(posts[1].body, posts[0].body, `${kind}: frozen request and proof survive`);
			assert.equal(JSON.parse(posts[1].body).reauthentication_proof, "SYNTHETIC-FROZEN-PROOF");
			assert.equal(proofRequests.length, 1, `${kind}: no replacement proof on uncertain retry`);
			assert.equal(proofRequests[0].action, kind === "payment" ? "payment_policy.version" : "company_policy.version");
			assert.equal(proofRequests[0].subject_id, kind === "payment" ? "company-payment" : "company-commercial");
			assert.deepEqual(view.errors, []);
		} finally {
			await view.close();
		}
	}
});

test("S130 label templates, advertising & support screens: version history, create/version dialogs, role gating and responsive geometry (390/768/1440)", async () => {
	const owner = await staff("owner");
	const finance = await staff("finance");
	const cs = await staff("customer_service");

	const ownerView = await open(owner);
	const finView = await open(finance);
	const csView = await open(cs);

	try {
		// 1. Label templates: owner expands version history, finance sees read-only, CS denied
		await ownerView.page.goto(`${origin}/admin/settings/label-templates`);
		await expect(
			ownerView.page.getByRole("heading", { name: "Template Label", level: 1 }),
		).toBeVisible();
		await expect(ownerView.page.getByTestId("label-templates-table")).toBeVisible();
		await expect(ownerView.page.getByTestId("label-template-new")).toBeVisible();
		const firstHistoryBtn = ownerView.page
			.locator('[data-testid^="label-template-history-toggle-"]')
			.first();
		await firstHistoryBtn.click();
		await expect(
			ownerView.page.locator('[data-testid^="label-template-history-"]').first(),
		).toBeVisible();

		await finView.page.goto(`${origin}/admin/settings/label-templates`);
		await expect(finView.page.getByTestId("label-templates-readonly")).toBeVisible();
		await expect(finView.page.getByTestId("label-template-new")).toHaveCount(0);
		await expect(finView.page.getByTestId("label-templates-table")).toBeVisible();

		await csView.page.goto(`${origin}/admin/settings/label-templates`);
		await expect(
			csView.page.getByRole("heading", { name: "Akses template label diperlukan" }),
		).toBeVisible();

		// 2. Advertising destinations: owner sees cards & history, finance denied
		await ownerView.page.goto(`${origin}/admin/settings/advertising`);
		await expect(
			ownerView.page.getByRole("heading", { name: "Integrasi Iklan", level: 1 }),
		).toBeVisible();
		await expect(ownerView.page.getByTestId("ad-destination-card-meta")).toBeVisible();
		await expect(ownerView.page.getByTestId("ad-destination-card-google")).toBeVisible();
		await expect(ownerView.page.getByTestId("ad-destination-card-tiktok")).toBeVisible();
		await expect(ownerView.page.getByTestId("ad-history-meta")).toBeVisible();

		await finView.page.goto(`${origin}/admin/settings/advertising`);
		await expect(
			finView.page.getByRole("heading", { name: "Akses integrasi iklan diperlukan" }),
		).toBeVisible();

		// 3. Support saved replies & tags: owner sees create controls, CS sees read-only, finance denied
		await ownerView.page.goto(`${origin}/admin/settings/support`);
		await expect(
			ownerView.page.getByRole("heading", { name: "Balasan & Tag CS", level: 1 }),
		).toBeVisible();
		await expect(ownerView.page.getByTestId("saved-reply-new")).toBeVisible();
		await expect(ownerView.page.getByTestId("support-tag-new")).toBeVisible();

		await csView.page.goto(`${origin}/admin/settings/support`);
		await expect(csView.page.getByTestId("support-settings-readonly")).toBeVisible();
		await expect(csView.page.getByTestId("saved-reply-new")).toHaveCount(0);
		await expect(csView.page.getByTestId("support-tag-new")).toHaveCount(0);

		await finView.page.goto(`${origin}/admin/settings/support`);
		await expect(
			finView.page.getByRole("heading", { name: "Akses layanan pelanggan diperlukan" }),
		).toBeVisible();

		// 4. Responsive geometry across 390, 768, 1440 on all 5 routes
		const routes = [
			["payment", "/admin/settings/payment"],
			["commercial", "/admin/settings/commercial"],
			["label-templates", "/admin/settings/label-templates"],
			["advertising", "/admin/settings/advertising"],
			["support", "/admin/settings/support"],
		] as const;

		for (const [slug, path] of routes) {
			await ownerView.page.goto(`${origin}${path}`);
			for (const width of [390, 768, 1440]) {
				await ownerView.page.setViewportSize({ width, height: 900 });
				const px = await overflow(ownerView.page);
				assert.ok(px <= 1, `Zero horizontal overflow on ${path} at ${width}px (got ${px}px)`);
				await ownerView.page.screenshot({
					path: join(renders, `settings-${slug}-${width}.png`),
					fullPage: true,
				});
			}
		}

		assert.deepEqual([...ownerView.errors, ...finView.errors, ...csView.errors], []);
	} finally {
		await ownerView.close();
		await finView.close();
		await csView.close();
	}
});
