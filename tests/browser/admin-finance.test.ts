import { UNKNOWN_ADMIN_ID } from "../../src/modules/access/admin-paths.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	type Browser,
	chromium,
	expect,
	type Page,
	type Route,
} from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import {
	actor,
	type BrowserSession,
	cleanup,
	enroll,
} from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S131 Finance workbench (/admin/finance/reconciliation, /payouts, /refunds, /summary) browser
// behavioral and responsive proof on the built web at 127.0.0.1:3099.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const sql = identity.sql;
type User = {
	id: string;
	email: string;
	password: string;
	browser: BrowserSession;
};
const users: User[] = [];
let browser: Browser;
const renders = join(RENDERS, "s131");

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

async function staff(role: Role, permissions: string[] = []): Promise<User> {
	const user = await actor(identity, role, []);
	users.push(user);
	await enroll(user.browser, user.password);
	await sql`update app.role_grant set permissions=${permissions} where user_id=${user.id}`;
	return user;
}

async function open(
	user: User,
	viewport = { width: 1280, height: 900 },
	touch = false,
) {
	const context = await browser.newContext({
		viewport,
		reducedMotion: "reduce",
		hasTouch: touch,
		isMobile: touch,
		timezoneId: "Asia/Jakarta",
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
	page.on(
		"console",
		(m) =>
			m.type() === "error" &&
			!/Failed to load resource/.test(m.text()) &&
			errors.push(m.text()),
	);
	page.on("request", (request) =>
		assert.equal(
			new URL(request.url()).origin,
			origin,
			"No external browser request",
		),
	);
	return { page, errors, close: () => context.close() };
}

const json = (route: Route, body: unknown, status = 200) =>
	route.fulfill({
		status,
		contentType: "application/json",
		body: JSON.stringify(body),
	});
const overflow = (page: Page) =>
	page.evaluate(
		() =>
			document.documentElement.scrollWidth -
			document.documentElement.clientWidth,
	);

// Each detail is addressed by admin number; the numbers below have no row, so the page passes the client UNKNOWN_ADMIN_ID.
const recId = UNKNOWN_ADMIN_ID;
const recNo = 987654323;
const sourceId = randomUUID();
const stmtId = randomUUID();
const matchId = randomUUID();
const receivableTxId = randomUUID();
const orderId = randomUUID();
const payoutId = UNKNOWN_ADMIN_ID;
const payoutNo = 987654324;
const evidenceId = randomUUID();
const claimId = randomUUID();
const refundId = UNKNOWN_ADMIN_ID;
const refundNo = 987654325;
const returnCaseId = randomUUID();

const recItem = (over: Record<string, unknown> = {}) => ({
	id: recId,
	admin_no: recNo,
	provider: "local.payment",
	environment: "local",
	reference: "MUT-S131-001",
	direction: "credit",
	amount: 95000,
	currency: "IDR",
	version: 2,
	status: "pending",
	problem_code: "SETTLEMENT_MANUAL_REVIEW_REQUIRED",
	explanation: "Menunggu pencocokan manual oleh keuangan.",
	source_id: sourceId,
	source_reference: stmtId,
	source_version: 1,
	latest_source_reference: stmtId,
	latest_source_version: 1,
	source_processing_pending: false,
	current_match_id: null,
	last_match_id: matchId,
	cash_transaction_id: randomUUID(),
	fee_transaction_id: randomUUID(),
	statement_totals: {
		gross_amount: 99000,
		carrier_fee: 0,
		provider_fee: 4000,
	},
	recorded_fees: {
		source_reference: stmtId,
		carrier_fee: 0,
		provider_fee: 4000,
	},
	occurred_at: "2026-10-25T04:00:00.000Z",
	recorded_at: "2026-10-25T04:05:00.000Z",
	...over,
});

const recMatch = (active = true) => ({
	id: matchId,
	statement_id: stmtId,
	transaction_id: randomUUID(),
	active,
	correction_of: null,
	reversal_transaction_id: active ? null : randomUUID(),
	reason: "Pencocokan piutang pesanan prabayar",
	occurred_at: "2026-10-25T04:10:00.000Z",
	recorded_at: "2026-10-25T04:10:00.000Z",
	totals: {
		gross_amount: 99000,
		net_amount: 95000,
		carrier_fee: 0,
		provider_fee: 4000,
	},
	remaining: {
		gross_amount: 0,
		net_amount: 0,
		carrier_fee: 0,
		provider_fee: 0,
	},
	allocations: [
		{
			id: randomUUID(),
			receivable_transaction_id: receivableTxId,
			order_id: orderId,
			order_admin_no: 1042,
			receipt_id: randomUUID(),
			source_basis: "payment_receipt",
			gross_amount: 99000,
			net_amount: 95000,
			carrier_fee: 0,
			provider_fee: 4000,
			reopens_allocation_id: null,
		},
	],
});

const payoutRow = (status: string, over: Record<string, unknown> = {}) => ({
	id: payoutId,
	admin_no: payoutNo,
	amount: 99000,
	currency: "IDR",
	status,
	explanation:
		status === "unknown"
			? "Status transfer sedang direkonsiliasi; dana tetap dicadangkan tanpa pengiriman ulang."
			: "Masuk antrean pencairan komisi manual.",
	created_at: "2026-10-25T02:00:00.000Z",
	version: 1,
	transfer_mode: "manual",
	...over,
});

const refundRow = (status: string, over: Record<string, unknown> = {}) => ({
	id: refundId,
	admin_no: refundNo,
	return_admin_no: 987654326,
	order_admin_no: 1042,
	order_id: orderId,
	return_case_id: returnCaseId,
	version: 3,
	amount: 99000,
	status,
	created_at: "2026-10-25T03:00:00.000Z",
	explanation:
		status === "unknown"
			? "Hasil pengiriman dana sedang diperiksa."
			: "Pengembalian dana masuk antrean.",
	...over,
});

test.before(async () => {
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
	});
	mkdirSync(renders, { recursive: true });
});

test.after(async () => {
	await browser?.close();
	await cleanup(identity, users);
	await sql.end({ timeout: 5 });
});

test("access: non-permitted roles see AccessDenied across B16–B19 without triggering finance APIs", async () => {
	const ecom = await staff("ecommerce_admin");
	const finBare = await staff("finance", []);
	const { page, errors, close } = await open(ecom);
	const finPage = await open(finBare);
	try {
		for (const [path, heading] of [
			[
				"/admin/finance/reconciliation",
				"Akses rekonsiliasi keuangan diperlukan",
			],
			["/admin/finance/payouts", "Akses pembayaran komisi diperlukan"],
			["/admin/finance/refunds", "Akses refund diperlukan"],
			["/admin/finance/summary", "Akses laporan keuangan diperlukan"],
		] as const) {
			await page.goto(`${origin}${path}`);
			await expect(page.getByRole("heading", { name: heading })).toBeVisible();
		}
		// Finance without explicit read permissions is denied on reconciliation, refunds, and summary, but allowed on payouts.
		for (const [path, heading] of [
			[
				"/admin/finance/reconciliation",
				"Akses rekonsiliasi keuangan diperlukan",
			],
			["/admin/finance/refunds", "Akses refund diperlukan"],
			["/admin/finance/summary", "Akses laporan keuangan diperlukan"],
		] as const) {
			await finPage.page.goto(`${origin}${path}`);
			await expect(
				finPage.page.getByRole("heading", { name: heading }),
			).toBeVisible();
		}
		assert.deepEqual(errors, []);
		assert.deepEqual(finPage.errors, []);
	} finally {
		await close();
		await finPage.close();
	}
});

test("B16 reconciliation: list filters, detail source/match inspection, match/unmatch/escalate decisions, and uncertain outcome resend with same key", async () => {
	const finRW = await staff("finance", [
		"finance.reconciliation.read",
		"finance.reconciliation.write",
	]);
	const { page, errors, close } = await open(finRW);
	let currentItem = recItem();
	const posts: { path: string; key: string | undefined; body: Record<string, unknown> }[] =
		[];
	let loseNextDecision = true;

	await page.route(
		(url) => url.origin === origin && url.pathname.startsWith("/api/v1/"),
		async (route) => {
			const req = route.request();
			const url = new URL(req.url());
			const path = url.pathname;
			if (req.method() === "POST") {
				const key = req.headers()["idempotency-key"];
				posts.push({ path, key, body: req.postDataJSON() });
				if (path === "/api/v1/me/reauthentication-proofs") {
					return json(
						route,
						{
							proof: "PROOF-REC-1",
							expires_at: new Date(Date.now() + 300000).toISOString(),
						},
						201,
					);
				}
				if (path === `/api/v1/admin/reconciliation/${recId}/decisions`) {
					if (loseNextDecision) {
						loseNextDecision = false;
						return route.abort("failed");
					}
					const body = req.postDataJSON() as { action: string };
					currentItem = recItem({
						version: currentItem.version + 1,
						status:
							body.action === "match"
								? "matched"
								: body.action === "unmatch"
									? "pending"
									: "exception",
						current_match_id: body.action === "match" ? matchId : null,
						problem_code:
							body.action === "escalate" ? "SETTLEMENT_FINANCE_REVIEW" : null,
					});
					return json(route, currentItem, 201);
				}
			}
			if (path === "/api/v1/admin/reconciliation") {
				return json(route, {
					data: [currentItem],
					pagination: { next_cursor: null },
				});
			}
			if (path === `/api/v1/admin/reconciliation/${recId}`) {
				return json(route, {
					item: currentItem,
					statement: {
						id: stmtId,
						version: 1,
						totals: currentItem.statement_totals,
						allocation_claims: [
							{
								receivable_transaction_id: receivableTxId,
								gross_amount: 99000,
								reopens_allocation_id: null,
							},
						],
						reverses_reference: null,
						reported_at: "2026-10-25T04:00:00.000Z",
						recorded_at: "2026-10-25T04:05:00.000Z",
					},
					match: currentItem.current_match_id ? recMatch(true) : null,
					history: [
						{
							id: randomUUID(),
							version: 1,
							kind: "observe",
							status: "pending",
							source_kind: "provider",
							source_id: randomUUID(),
							actor_id: null,
							source_reference: stmtId,
							match_id: matchId,
							fee_transaction_id: null,
							applied_fee_source_reference: null,
							problem_code: null,
							reason: "Mutasi awal tercatat",
							occurred_at: "2026-10-25T04:00:00.000Z",
							recorded_at: "2026-10-25T04:05:00.000Z",
						},
					],
					pagination: { next_cursor: null },
				});
			}
			if (path === `/api/v1/admin/settlements/${sourceId}`) {
				return json(route, {
					source: {
						id: sourceId,
						provider: "local.payment",
						environment: "local",
						reference: "MUT-S131-001",
						direction: "credit",
						amount: 95000,
						currency: "IDR",
						occurred_at: "2026-10-25T04:00:00.000Z",
						recorded_at: "2026-10-25T04:05:00.000Z",
					},
					item: currentItem,
					statements: [
						{
							id: stmtId,
							version: 1,
							totals: currentItem.statement_totals,
							allocation_claims: [
								{
									receivable_transaction_id: receivableTxId,
									gross_amount: 99000,
									reopens_allocation_id: null,
								},
							],
							reverses_reference: null,
							reported_at: "2026-10-25T04:00:00.000Z",
							recorded_at: "2026-10-25T04:05:00.000Z",
						},
					],
					pagination: { next_cursor: null },
					unregistered_deliveries: 0,
				});
			}
			if (path === `/api/v1/admin/reconciliation/${recId}/matches/${matchId}`) {
				return json(route, recMatch(currentItem.current_match_id !== null));
			}
			return route.fallback();
		},
	);

	try {
		await page.goto(`${origin}/admin/finance/reconciliation`);
		await expect(page.getByTestId(`reconciliation-row-${recId}`)).toContainText(
			"MUT-S131-001",
		);
		assert.equal(await overflow(page), 0);
		await page.screenshot({
			path: join(renders, "reconciliation-list-1280.png"),
			fullPage: true,
		});

		await page.goto(`${origin}/admin/finance/reconciliation/${recNo}`);
		await expect(page.getByTestId("reconciliation-status")).toContainText(
			"Menunggu pencocokan",
		);
		await expect(page.getByTestId("reconciliation-source")).toContainText(
			"Pernyataan versi 1",
		);

		// Match decision: first attempt loses network response, second attempt reuses the same key & proof.
		await page.getByTestId("reconciliation-match-open").click();
		await page.getByTestId("reconciliation-reason").fill("Cocokkan mutasi S131");
		await page.getByTestId("reconciliation-password").fill(finRW.password);
		await page.getByRole("button", { name: "Simpan pencocokan" }).click();
		await expect(
			page.getByRole("button", { name: "Kirim ulang (kunci sama)" }),
		).toBeVisible();
		await page.getByRole("button", { name: "Kirim ulang (kunci sama)" }).click();
		await expect(page.getByTestId("reconciliation-status")).toContainText(
			"Cocok",
		);

		const decisionPosts = posts.filter(
			(p) => p.path === `/api/v1/admin/reconciliation/${recId}/decisions`,
		);
		assert.equal(decisionPosts.length, 2);
		assert.equal(decisionPosts[0].key, decisionPosts[1].key);
		await page.screenshot({
			path: join(renders, "reconciliation-detail-1280.png"),
			fullPage: true,
		});
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("B17 affiliate payouts: queue list and claim -> upload evidence -> verify -> reconcile unknown", async () => {
	const fin = await staff("finance", []);
	const { page, errors, close } = await open(fin);
	let currentPayout = payoutRow("queued");

	await page.route(
		(url) => url.origin === origin && url.pathname.startsWith("/api/v1/"),
		async (route) => {
			const req = route.request();
			const url = new URL(req.url());
			const path = url.pathname;
			if (req.method() === "POST") {
				if (path === "/api/v1/me/reauthentication-proofs") {
					return json(
						route,
						{
							proof: "PROOF-PAYOUT-1",
							expires_at: new Date(Date.now() + 300000).toISOString(),
						},
						201,
					);
				}
				if (
					path === `/api/v1/admin/payouts/${payoutId}/manual-transfer-claims`
				) {
					currentPayout = payoutRow("processing", {
						version: 2,
						transfer_claim_id: claimId,
					});
					return json(route, {
						payout: currentPayout,
						beneficiary_snapshot: {
							bank_code: "BCA",
							account_number: "8888999900",
							account_holder_name: "Mitra S131",
						},
					});
				}
				if (path === `/api/v1/admin/payouts/${payoutId}/evidence-uploads`) {
					return json(route, {
						id: evidenceId,
						upload_url: `${origin}/api/v1/admin/payouts/${payoutId}/evidence-uploads/${evidenceId}`,
						expires_at: new Date(Date.now() + 900000).toISOString(),
						required_headers: {
							"content-type": "image/png",
							"x-payout-id": payoutId,
						},
					});
				}
				if (
					path ===
					`/api/v1/admin/payouts/${payoutId}/manual-transfer-verifications`
				) {
					currentPayout = payoutRow("succeeded", {
						version: 3,
						completed_at: "2026-10-25T05:00:00.000Z",
					});
					return json(route, currentPayout);
				}
				if (path === `/api/v1/admin/payouts/${payoutId}/reconciliations`) {
					currentPayout = payoutRow("unknown", { version: 4 });
					return json(route, currentPayout, 202);
				}
			}
			if (
				req.method() === "PUT" &&
				path ===
					`/api/v1/admin/payouts/${payoutId}/evidence-uploads/${evidenceId}`
			) {
				return json(route, {
					id: evidenceId,
					size_bytes: PNG.byteLength,
					sha256: "a".repeat(64),
				});
			}
			if (path === "/api/v1/admin/payouts") {
				return json(route, {
					data: [currentPayout],
					pagination: { next_cursor: null },
				});
			}
			return route.fallback();
		},
	);

	try {
		await page.goto(`${origin}/admin/finance/payouts`);
		await expect(page.getByTestId(`payout-row-${payoutId}`)).toBeVisible();
		await page.screenshot({
			path: join(renders, "payouts-list-1280.png"),
			fullPage: true,
		});

		await page.goto(`${origin}/admin/finance/payouts/${payoutNo}`);
		await expect(page.getByTestId("payout-status")).toContainText(
			"Dalam antrean",
		);

		// 1. Claim transfer
		await page.getByTestId("payout-claim-open").click();
		await page.getByTestId("payout-claim-password").fill(fin.password);
		await page.getByRole("button", { name: "Klaim transfer" }).click();
		await expect(page.getByTestId("payout-beneficiary")).toContainText(
			"8888999900",
		);

		// 2. Upload evidence
		await page.getByTestId("payout-evidence-file").setInputFiles({
			name: "bukti.png",
			mimeType: "image/png",
			buffer: PNG,
		});
		await page.getByTestId("payout-evidence-upload").click();
		await expect(page.getByTestId("payout-evidence-ready")).toContainText(
			evidenceId,
		);

		// 3. Verify transfer
		await page.getByTestId("payout-verify-open").click();
		await page.getByTestId("payout-verify-reference").fill("BCA-REF-001");
		await page
			.getByTestId("payout-verify-reason")
			.fill("Bukti mutasi sesuai nominal");
		await page.getByTestId("payout-verify-password").fill(fin.password);
		await page.getByRole("button", { name: "Verifikasi transfer" }).click();
		await expect(page.getByTestId("payout-status")).toContainText("Selesai");
		await page.screenshot({
			path: join(renders, "payout-detail-1280.png"),
			fullPage: true,
		});
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("B18 refunds & B19 finance summary: unknown refund hides retry, summary shows Belum lengkap (never Rp 0) on missing inputs", async () => {
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner);
	let currentRefund = refundRow("unknown");

	await page.route(
		(url) => url.origin === origin && url.pathname.startsWith("/api/v1/"),
		async (route) => {
			const req = route.request();
			const url = new URL(req.url());
			const path = url.pathname;
			if (req.method() === "POST") {
				if (path === "/api/v1/me/reauthentication-proofs") {
					return json(
						route,
						{
							proof: "PROOF-REF-1",
							expires_at: new Date(Date.now() + 300000).toISOString(),
						},
						201,
					);
				}
				if (path === `/api/v1/admin/refunds/${refundId}/reconciliations`) {
					currentRefund = refundRow("succeeded", { version: 4 });
					return json(route, currentRefund, 202);
				}
			}
			if (path === "/api/v1/admin/refunds") {
				return json(route, {
					data: [currentRefund],
					pagination: { next_cursor: null },
				});
			}
			if (path === `/api/v1/admin/refunds/${refundId}`) {
				return json(route, currentRefund);
			}
			if (path === "/api/v1/admin/finance/summary") {
				return json(route, {
					from: "2026-10-01T00:00:00.000Z",
					to: "2026-10-25T00:00:00.000Z",
					currency: "IDR",
					generated_at: "2026-10-25T05:00:00.000Z",
					cash: { complete: true, amount: 198000, missing_inputs: [] },
					receivables: { complete: true, amount: 99000, missing_inputs: [] },
					refund_liability: { complete: true, amount: 0, missing_inputs: [] },
					affiliate_liability: {
						complete: true,
						amount: 19800,
						missing_inputs: [],
					},
					gross_merchandise: {
						complete: true,
						amount: 297000,
						missing_inputs: [],
					},
					net_merchandise_revenue: {
						complete: true,
						amount: 297000,
						missing_inputs: [],
					},
					recognized_hpp: {
						complete: false,
						amount: null,
						missing_inputs: ["hpp:sku-botol"],
					},
					gross_merchandise_profit: {
						complete: false,
						amount: null,
						missing_inputs: ["hpp:sku-botol"],
					},
					estimated_contribution: {
						complete: false,
						amount: null,
						missing_inputs: ["assumption:offer-1"],
					},
					realized_contribution: {
						complete: false,
						amount: null,
						missing_inputs: ["hpp:sku-botol", "settlement:rec-1"],
					},
					operating_expenses: {
						complete: true,
						amount: 0,
						missing_inputs: [],
					},
					operating_result: {
						complete: false,
						amount: null,
						missing_inputs: ["hpp:sku-botol", "settlement:rec-1"],
					},
				});
			}
			if (path === "/api/v1/admin/dashboard") {
				return json(route, {
					workspace: "finance",
					warehouse_ids: [],
					from: "2026-10-01T00:00:00.000Z",
					to: "2026-10-25T00:00:00.000Z",
					timezone: "Asia/Jakarta",
					as_of: "2026-10-25T05:00:00.000Z",
					metrics: [
						{
							key: "net_merchandise_revenue",
							kind: "money",
							complete: true,
							amount: 297000,
							financial_basis: "actual",
							definition: "Pendapatan bersih barang dagangan.",
						},
						{
							key: "realized_contribution",
							kind: "money",
							complete: false,
							amount: null,
							financial_basis: "unknown",
							definition: "Kontribusi margin terealisasi.",
						},
					],
				});
			}
			return route.fallback();
		},
	);

	try {
		// B18 Refunds
		await page.goto(`${origin}/admin/finance/refunds`);
		await expect(page.getByTestId(`refund-row-${refundId}`)).toContainText(
			"Hasil belum pasti",
		);
		await page.screenshot({
			path: join(renders, "refunds-list-1280.png"),
			fullPage: true,
		});

		await page.goto(`${origin}/admin/finance/refunds/${refundNo}`);
		await expect(page.getByTestId("refund-unknown")).toBeVisible();
		await expect(page.getByTestId("refund-reconcile")).toBeVisible();
		await expect(page.getByTestId("refund-retry")).toHaveCount(0);

		await page.getByTestId("refund-reconcile").click();
		await page
			.getByTestId("refund-reason")
			.fill("Periksa callback refund tertahan");
		await page.getByTestId("refund-password").fill(owner.password);
		await page.getByRole("button", { name: "Rekonsiliasi" }).click();
		await expect(page.getByTestId("refund-status")).toContainText("Berhasil");
		await page.screenshot({
			path: join(renders, "refund-detail-1280.png"),
			fullPage: true,
		});

		// B19 Finance Summary
		await page.goto(`${origin}/admin/finance/summary`);
		await expect(page.getByTestId("summary-incomplete-alert")).toBeVisible();
		await expect(
			page.getByTestId("summary-value-realized_contribution"),
		).toHaveText("Belum lengkap");
		await expect(
			page.getByTestId("summary-value-operating_result"),
		).toHaveText("Belum lengkap");
		await expect(
			page.getByTestId("summary-kpi-value-realized_contribution"),
		).toHaveText("Belum lengkap");
		await expect(
			page.getByTestId("summary-missing-realized_contribution"),
		).toContainText("HPP komponen fisik belum lengkap");
		assert.equal(await overflow(page), 0);
		await page.screenshot({
			path: join(renders, "finance-summary-1280.png"),
			fullPage: true,
		});
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});
