import { UNKNOWN_ADMIN_ID } from "../../src/modules/access/admin-paths.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { type Browser, chromium, expect, type Page, type Route } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";

// S101 screens on the built web: the returns list and case decision screen (decide, inspect,
// refund, replacement steps) and the owner warehouse calendar panel with the bulk default. The
// return/calendar APIs are answered by Playwright routes with fixed projections and every
// mutation is captured and fulfilled here, so no business state changes; only the synthetic
// staff users are written and removed again. Domain behaviour is proven by
// tests/integration/admin-returns.test.ts and warehouse-calendars.test.ts.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const sql = identity.sql;
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;

async function staff(role: Role, permissions: string[] = []) {
	const user = await actor(identity, role, []);
	users.push(user);
	await enroll(user.browser, user.password);
	await sql`update app.role_grant set permissions=${permissions} where user_id=${user.id}`;
	return user;
}
async function open(user: User, viewport = { width: 1280, height: 900 }, touch = false) {
	const context = await browser.newContext({ viewport, reducedMotion: "reduce", hasTouch: touch, isMobile: touch, timezoneId: "Asia/Jakarta" });
	await context.addCookies([...user.browser.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	return { page, errors, close: () => context.close() };
}
const json = (route: Route, body: unknown, status = 200) =>
	route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

// Addressed by admin number in the console; no row has this number, so the page passes the client UNKNOWN_ADMIN_ID.
const caseId = UNKNOWN_ADMIN_ID;
const caseNo = 987654322;
const W = randomUUID();
const item = (over: Record<string, unknown> = {}) => ({
	id: randomUUID(), fulfillment_item_id: randomUUID(), order_item_id: randomUUID(), shipment_id: randomUUID(), warehouse_id: W,
	reason: "damaged", details: "Tutup botol pecah saat diterima.", claim_state: "held", inspection_status: "pending", can_inspect: true,
	product_name: "Botol Minum 1 L", variant_label: "Biru", warehouse_name: "Gudang Malang",
	components: [{ balance_id: randomUUID(), name: "Botol 1 L", quantity: 1 }], ...over,
});
const caseOf = (status: string, over: Record<string, unknown> = {}) => ({
	id: caseId, admin_no: caseNo, order_admin_no: 1042, order_id: randomUUID(), order_number: "99-TEST0001", version: 3, status, requested_resolution: "refund", resolution: null,
	requires_goods: null, created_at: "2026-10-20T03:00:00.000Z", items_complete: true, can_decide: true, refund_ids: [], items: [item()],
	replacement_ids: [], evidence: [], events: [{ version: 1, kind: "create", status: "requested", actor: "buyer", actor_name: null, reason: "x", occurred_at: "2026-10-20T03:00:00.000Z" }],
	...over,
});

/** Answers the returns APIs from `state` and records every mutation body. */
async function routes(page: Page, state: { detail: Record<string, unknown>; posts: { path: string; body: Record<string, unknown> }[] }) {
	await page.route((url) => url.origin === origin && url.pathname.startsWith("/api/v1/"), async (route) => {
		const request = route.request(), url = new URL(request.url()), path = url.pathname;
		if (request.method() === "POST") {
			state.posts.push({ path, body: request.postDataJSON() });
			assert.ok(request.headers()["idempotency-key"], `idempotency key on ${path}`);
			if (path === "/api/v1/me/reauthentication-proofs") return json(route, { proof: "SYNTHETIC-PROOF", expires_at: new Date(Date.now() + 300000).toISOString() }, 201);
			if (path.endsWith("/decisions")) return json(route, { case_id: caseId, version: 4, status: "awaiting_goods" }, 201);
			if (path.endsWith("/inspections")) return json(route, { case_id: caseId, version: 5, status: "approved" }, 201);
			if (path === "/api/v1/admin/refunds") return json(route, { id: randomUUID(), order_id: randomUUID(), return_case_id: caseId, version: 1, amount: 113000, status: "awaiting_destination", created_at: new Date().toISOString(), explanation: "Dana belum dikirim." }, 202);
			if (path === "/api/v1/admin/warehouse-calendars/default-applications") return json(route, { applied: [{}] }, 201);
			return json(route, { code: "NOT_FOUND" }, 404);
		}
		if (path === "/api/v1/admin/returns") return json(route, { data: [state.detail], pagination: { next_cursor: null } });
		if (path === `/api/v1/admin/returns/${caseId}`) return json(route, state.detail);
		return route.fallback();
	});
}

test.before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
});
test.after(async () => {
	await browser?.close();
	await cleanup(identity, users);
	await sql.end({ timeout: 5 });
});

test("returns list: tabs filter through the API, keep the tab in the URL and open the case; no raw ids", async () => {
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner);
	try {
		const state = { detail: caseOf("requested"), posts: [] };
		const queries: string[] = [];
		page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname === "/api/v1/admin/returns") queries.push(u.searchParams.get("state") ?? "all"); });
		await routes(page, state);
		await page.goto(`${origin}/admin/pesanan/retur`);
		const row = page.getByTestId("return-row-99-TEST0001");
		await expect(row).toBeVisible();
		await expect(row).toContainText("Menunggu keputusan");
		await expect(row).toContainText("Rusak");
		await expect(row).not.toContainText(caseId);
		await page.getByTestId("returns-tab-goods").click();
		await expect(page).toHaveURL(/tahap=goods/);
		assert.deepEqual(queries.slice(0, 2), ["decide", "goods"]);
		await page.getByTestId("returns-tab-decide").click();
		await page.getByRole("link", { name: "Buka retur pesanan 99-TEST0001" }).click();
		await expect(page.getByTestId("return-title")).toContainText("99-TEST0001");
		assert.deepEqual(errors, []);
	} finally { await close(); }
});

test("decision: approve sends the read version and the goods choice once; reject explains the buyer sees the reason", async () => {
	const cs = await staff("customer_service");
	const { page, errors, close } = await open(cs);
	try {
		const state = { detail: caseOf("requested"), posts: [] as { path: string; body: Record<string, unknown> }[] };
		await routes(page, state);
		await page.goto(`${origin}/admin/pesanan/retur/${caseNo}`);
		await expect(page.getByTestId("return-status")).toHaveText("Menunggu keputusan");
		await page.getByTestId("return-reject").click();
		await expect(page.getByRole("dialog")).toContainText("ditampilkan ke pembeli");
		await page.getByRole("button", { name: "Batal" }).click();
		await page.getByTestId("return-approve").click();
		const dialog = page.getByRole("dialog");
		await dialog.getByRole("button", { name: "Setujui" }).click();
		await expect(dialog.getByRole("alert")).toHaveText("Alasan wajib diisi.");
		await dialog.getByLabel("Alasan (wajib)").fill("Foto menunjukkan tutup pecah");
		state.detail = caseOf("awaiting_goods", { version: 4, can_decide: true });
		await dialog.getByRole("button", { name: "Setujui" }).dblclick();
		await expect(page.getByTestId("return-notice")).toContainText("Menunggu barang retur");
		const decisions = state.posts.filter((p) => p.path.endsWith("/decisions"));
		assert.equal(decisions.length, 1);
		assert.deepEqual(decisions[0].body, { decision: "approve_refund", reason: "Foto menunjukkan tutup pecah", expected_version: 3, requires_goods: true });
		// CS cannot inspect: the action belongs to the warehouse.
		await expect(page.getByTestId("return-inspect")).toHaveCount(0);
		assert.deepEqual(errors, []);
	} finally { await close(); }
});

test("inspection and refund: components are sent by allocation, the refund issues a case-bound proof first", async () => {
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner);
	try {
		const state = { detail: caseOf("awaiting_goods", { requires_goods: true, resolution: "refund", can_decide: true }), posts: [] as { path: string; body: Record<string, unknown> }[] };
		await routes(page, state);
		await page.goto(`${origin}/admin/pesanan/retur/${caseNo}`);
		await page.getByTestId("return-inspect").click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Catatan inspeksi (wajib)").fill("Botol diterima, retak di tutup");
		state.detail = caseOf("approved", { version: 5, requires_goods: true, resolution: "refund", can_decide: true, items: [item({ inspection_status: "accepted" })] });
		await dialog.getByRole("button", { name: "Simpan inspeksi" }).click();
		await expect(page.getByTestId("return-notice")).toContainText("Disetujui");
		const inspection = state.posts.find((p) => p.path.endsWith("/inspections"));
		assert.ok(inspection);
		assert.equal(inspection.body.result, "accepted");
		const goods = (inspection.body.items as { goods: { quantity: number; identity_confirmed: boolean }[] }[])[0].goods;
		assert.deepEqual(goods.map((g) => [g.quantity, g.identity_confirmed]), [[1, true]]);
		await page.getByTestId("return-refund").click();
		const refund = page.getByRole("dialog");
		await refund.getByLabel("Alasan (wajib)").fill("Barang rusak diterima gudang");
		await refund.getByLabel("Konfirmasi kata sandi").fill("not-a-real-password");
		await refund.getByRole("button", { name: "Ajukan refund" }).click();
		await expect(page.getByTestId("return-notice")).toContainText("Refund");
		const proof = state.posts.find((p) => p.path === "/api/v1/me/reauthentication-proofs");
		assert.deepEqual(proof?.body, { password: "not-a-real-password", action: "finance.refund", subject_id: caseId });
		const queued = state.posts.find((p) => p.path === "/api/v1/admin/refunds");
		assert.deepEqual(queued?.body, { return_case_id: caseId, expected_version: 5, reason: "Barang rusak diterima gudang", reauthentication_proof: "SYNTHETIC-PROOF" });
		assert.ok(state.posts.findIndex((p) => p === proof) < state.posts.findIndex((p) => p === queued));
		assert.deepEqual(errors, []);
	} finally { await close(); }
});

test("phone: the case screen has no horizontal overflow and its actions sit in the sticky bar", async () => {
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner, { width: 390, height: 844 }, true);
	try {
		await routes(page, { detail: caseOf("requested"), posts: [] });
		await page.goto(`${origin}/admin/pesanan/retur/${caseNo}`);
		await expect(page.getByTestId("return-approve")).toBeVisible();
		assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
		assert.equal(await page.getByTestId("return-approve").evaluate((el) => getComputedStyle(el.closest("[data-sticky-bar]") as Element).position), "fixed");
		assert.deepEqual(errors, []);
	} finally { await close(); }
});

test("warehouse calendars: owner sees uncovered origin warehouses and applies the default with one proof; others do not see the panel", async () => {
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner);
	try {
		const posts: { path: string; body: Record<string, unknown> }[] = [];
		const coverage = [
			{ warehouse_id: W, warehouse_name: "Gudang Malang", city: "Malang", timezone: "Asia/Jakarta", local_year: 2026, live_products: 12, origin: true, state: "missing", scheduled: false, latest_version: 0, current: null },
			{ warehouse_id: randomUUID(), warehouse_name: "Gudang Batu", city: "Batu", timezone: "Asia/Jakarta", local_year: 2026, live_products: 3, origin: true, state: "current", scheduled: false, latest_version: 1,
				current: { version_id: randomUUID(), version: 1, effective_at: "2026-01-01T00:00:00.000Z", values: { timezone: "Asia/Jakarta", year: 2026, working_weekdays: [1, 2, 3, 4, 5], cutoff_local: "14:00", closed_dates: [], source: "TEST-ONLY", approval: "test_only" } } },
		];
		await page.route((url) => url.origin === origin && url.pathname.startsWith("/api/v1/"), async (route) => {
			const request = route.request(), path = new URL(request.url()).pathname;
			if (request.method() === "POST") {
				posts.push({ path, body: request.postDataJSON() });
				if (path === "/api/v1/me/reauthentication-proofs") return json(route, { proof: "SYNTHETIC-PROOF", expires_at: new Date(Date.now() + 300000).toISOString() }, 201);
				if (path === "/api/v1/admin/warehouse-calendars/default-applications") return json(route, { applied: [{ warehouse_id: W }] }, 201);
				return json(route, { code: "NOT_FOUND" }, 404);
			}
			if (path === "/api/v1/admin/warehouse-calendars") return json(route, { data: coverage, truncated: false });
			return route.fallback();
		});
		await page.goto(`${origin}/admin/pesanan/kirim`);
		const panel = page.getByTestId("warehouse-calendars");
		await panel.getByText("Kalender gudang", { exact: true }).click();
		await expect(panel.getByTestId("calendar-test-only")).toContainText("TEST-ONLY");
		await expect(panel.getByTestId("calendar-summary")).toContainText("1 dari 2");
		await panel.getByTestId("calendar-bulk-open").click();
		const dialog = page.getByRole("dialog");
		await expect(dialog.getByTestId("calendar-bulk-list")).toHaveText(/Gudang Malang/);
		await expect(dialog.getByTestId("calendar-bulk-list")).not.toHaveText(/Gudang Batu/);
		await dialog.getByLabel("Alasan (wajib)").fill("Kalender awal gudang asal");
		await dialog.getByLabel("Konfirmasi kata sandi").fill("not-a-real-password");
		await dialog.getByRole("button", { name: "Terapkan" }).click();
		await expect(panel.getByTestId("calendar-notice")).toContainText("1 gudang");
		assert.deepEqual(posts.map((p) => p.path), ["/api/v1/me/reauthentication-proofs", "/api/v1/admin/warehouse-calendars/default-applications"]);
		assert.deepEqual(posts[0].body, { password: "not-a-real-password", action: "warehouse_calendar.default_apply", subject_id: "origin-warehouses" });
		assert.deepEqual(posts[1].body, { warehouse_ids: [W], values: { working_weekdays: [1, 2, 3, 4, 5, 6], cutoff_local: "15:00", closed_dates: [] }, reason: "Kalender awal gudang asal", reauthentication_proof: "SYNTHETIC-PROOF" });
		assert.deepEqual(errors, []);
	} finally { await close(); }
	const warehouse = await staff("warehouse");
	const other = await open(warehouse);
	try {
		await other.page.goto(`${origin}/admin/pesanan/kirim`);
		await expect(other.page.getByRole("heading", { name: "Pengiriman Manual" })).toBeVisible();
		await expect(other.page.getByTestId("warehouse-calendars")).toHaveCount(0);
	} finally { await other.close(); }
	// DEC-018 Q2: the e-commerce admin manages pickup profiles on this page but never calendars.
	const ecommerce = await open(await staff("ecommerce_admin"));
	try {
		await ecommerce.page.goto(`${origin}/admin/pesanan/kirim`);
		await expect(ecommerce.page.getByRole("heading", { name: "Pengiriman Manual" })).toBeVisible();
		await expect(ecommerce.page.getByTestId("warehouse-calendars")).toHaveCount(0);
	} finally { await ecommerce.close(); }
});
