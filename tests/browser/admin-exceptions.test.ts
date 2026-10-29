import { UNKNOWN_ADMIN_ID } from "../../src/modules/access/admin-paths.ts";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { type Browser, chromium, expect, type Page, type Route } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S133 Masalah Pengiriman (/admin/pesanan/kendala, /admin/pesanan/kendala/{id}) on the built web at the
// canonical origin. The signed-in synthetic staff users are real (the page guards read their
// roles); the exception, fulfillment and inventory APIs are answered by Playwright routes with
// fixed projections and every mutation is captured and fulfilled here, so no business state
// changes. Domain behaviour, scope and money invariants are proven by
// tests/integration/exception-workbench.test.ts over the real routes.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const sql = identity.sql;
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;
const renders = join(RENDERS, "s133");
const API = "/api/v1/admin/commerce-exceptions";

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
	page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
	page.on("request", (request) => assert.equal(new URL(request.url()).origin, origin, "No external browser request"));
	return { page, errors, close: () => context.close() };
}
const json = (route: Route, body: unknown, status = 200) =>
	route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const W = randomUUID();
// The case is addressed by its admin number; this number has no row, so the page hands the client the well-formed
// UNKNOWN_ADMIN_ID and every mocked API route below is keyed on it.
const exId = UNKNOWN_ADMIN_ID;
const exNo = 987654321;
const orderId = randomUUID();
const itemId = randomUUID();
const shipmentId = randomUUID();
const fulfillmentId = randomUUID();
const stockId = randomUUID();
const lotId = randomUUID();
const balanceId = randomUUID();
const outcomeId = randomUUID();
const unitId = randomUUID();

const unit = (over: Record<string, unknown> = {}) => ({
	id: unitId, order_item_id: randomUUID(), unit_ordinal: 1, shipment_id: shipmentId, fulfillment_item_id: itemId, replacement_link_id: null,
	warehouse_id: W, physical_state: "unhanded", product_name: "Botol Minum 1 L", variant_label: "Biru", warehouse_name: "Gudang Malang", ...over,
});
const exception = (status: string, over: Record<string, unknown> = {}) => ({
	id: exId, admin_no: exNo, order_admin_no: 1042, order_id: orderId, order_number: "99-TEST0001", kind: "stock_discrepancy", status, version: 3, source_kind: "stock_report",
	source_id: randomUUID(), occurred_at: "2026-10-20T03:00:00.000Z", created_at: "2026-10-20T03:00:00.000Z", units: [unit()], proposal: null,
	explanation: "Hitungan fisik kurang satu botol.", ...over,
});
const proposal = (action: string) => ({
	id: randomUUID(), action, unit_ids: [unitId], explanation: "Stok botol kurang satu; usulkan pembatalan.", created_at: "2026-10-20T04:00:00.000Z",
});
const refund = (status: string, over: Record<string, unknown> = {}) => ({
	id: randomUUID(), exception_id: exId, order_id: orderId, version: 2, status, amount: 99000, source_kind: "payment_event", source_id: randomUUID(),
	source_transaction_id: randomUUID(), receipt_id: randomUUID(), obligation_transaction_id: randomUUID(), cash_transaction_id: null, remaining_capacity: 0,
	created_at: "2026-10-20T05:00:00.000Z", explanation: "Pengiriman dana sedang diproses.", ...over,
});
const fulfillment = () => ({
	id: fulfillmentId, order_id: orderId, warehouse_id: W, status: "ready", version: 5, handover_at: null, shipment_id: shipmentId,
	items: [{ order_item_id: randomUUID(), fulfillment_item_id: itemId, quantity: 1 }],
	pick_items: [{ fulfillment_item_id: itemId, order_item_id: randomUUID(), sku: "BTL-1L", name: "Botol 1 L", quantity: 1, stock_item_id: stockId, lot_id: lotId }],
});
const balance = () => ({
	id: balanceId, warehouse_id: W, stock_item_id: stockId, lot_id: lotId, lot_code: "L-1", on_hand: 5, reserved: 2, quarantined: 0, available: 3, version: 7,
});

type Post = { path: string; key: string | undefined; body: Record<string, unknown> };
type State = {
	detail: Record<string, unknown>;
	list?: (url: URL) => { status?: number; body: unknown };
	refunds: Record<string, unknown>[];
	posts: Post[];
	reads: string[];
	/** Paths whose next POST fails with a network error (the answer is lost). */
	lose: Set<string>;
	answers: Record<string, unknown>;
};
const state = (detail: Record<string, unknown>, over: Partial<State> = {}): State => ({ detail, refunds: [], posts: [], reads: [], lose: new Set(), answers: {}, ...over });

async function routes(page: Page, s: State) {
	await page.route((url) => url.origin === origin && url.pathname.startsWith("/api/v1/"), async (route) => {
		const request = route.request();
		const url = new URL(request.url());
		const path = url.pathname;
		if (request.method() === "POST") {
			const key = request.headers()["idempotency-key"];
			assert.ok(key, `idempotency key on ${path}`);
			s.posts.push({ path, key, body: request.postDataJSON() });
			if (s.lose.has(path)) {
				s.lose.delete(path);
				return route.abort("failed");
			}
			if (path === "/api/v1/me/reauthentication-proofs") return json(route, { proof: "SYNTHETIC-PROOF", expires_at: new Date(Date.now() + 300000).toISOString() }, 201);
			if (path in s.answers) return json(route, s.answers[path], 201);
			return json(route, { code: "NOT_FOUND" }, 404);
		}
		s.reads.push(`${path}${url.search}`);
		if (path === API && s.list) {
			const out = s.list(url);
			return json(route, out.body, out.status ?? 200);
		}
		if (path === `${API}/${exId}`) return json(route, s.detail);
		if (path === `${API}/${exId}/refunds`) return json(route, { exception_id: exId, version: 3, refunds: s.refunds });
		if (path === "/api/v1/admin/warehouses") return json(route, { data: [{ id: W, name: "Gudang Malang" }], pagination: { next_cursor: null } });
		if (path === "/api/v1/admin/fulfillments") return json(route, { data: url.searchParams.get("status") === "ready" ? [fulfillment()] : [], pagination: { next_cursor: null } });
		if (path === `/api/v1/admin/shipments/${shipmentId}`) return json(route, { fulfillment_id: fulfillmentId, id: shipmentId });
		if (path === `/api/v1/admin/fulfillments/${fulfillmentId}`) return json(route, fulfillment());
		if (path === "/api/v1/admin/inventory") return json(route, { data: [balance()], pagination: { next_cursor: null } });
		return route.fallback();
	});
}

test.before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	mkdirSync(renders, { recursive: true });
});
test.after(async () => {
	await browser?.close();
	await cleanup(identity, users);
	await sql.end({ timeout: 5 });
});

test("list: filters go to the API and the address, pages append without a repeat, empty and error states", async () => {
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner);
	const a = exception("awaiting_stock");
	const b = exception("ready_for_refund", { id: randomUUID(), kind: "late_collection", order_number: "99-TEST0002", units: [], source_kind: "payment_event" });
	let failures = 1;
	const s = state(a, {
		list: (url) => {
			if (url.searchParams.get("kind") === "waybill_uncertain") return { body: { data: [], pagination: { next_cursor: null }, as_of: new Date().toISOString() } };
			if (url.searchParams.get("status") === "unknown" && failures-- > 0) return { status: 503, body: { code: "SERVICE_UNAVAILABLE" } };
			if (url.searchParams.get("cursor") === "cursor-1") return { body: { data: [b], pagination: { next_cursor: null }, as_of: new Date().toISOString() } };
			return { body: { data: [a], pagination: { next_cursor: "cursor-1" }, as_of: new Date().toISOString() }, };
		},
	});
	try {
		await routes(page, s);
		await page.goto(`${origin}/admin/pesanan/kendala`);
		const rows = page.locator('[data-testid^="exception-row-"]');
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("Selisih stok");
		await expect(rows.first()).toContainText("99-TEST0001");
		await expect(rows.first()).toContainText("Menunggu stok");
		await expect(rows.first()).not.toContainText(exId);
		await page.getByTestId("exceptions-more").click();
		await expect(rows).toHaveCount(2);
		await expect(page.getByTestId("exceptions-more")).toHaveCount(0);
		const cursorReads = s.reads.filter((r) => r.includes("cursor=cursor-1"));
		assert.equal(cursorReads.length, 1, "the next page is read once");
		// Filters are the API's own and stay in the address.
		await page.getByLabel("Status", { exact: true }).selectOption("awaiting_buyer");
		await expect(page).toHaveURL(/status=awaiting_buyer/);
		assert.ok(s.reads.some((r) => r.includes("status=awaiting_buyer")));
		await page.getByLabel("Jenis kasus").selectOption("waybill_uncertain");
		await expect(page).toHaveURL(/jenis=waybill_uncertain/);
		await expect(page.getByTestId("exceptions-empty")).toContainText("Tidak ada kasus dengan filter ini");
		// A failed read keeps the screen: error with retry, then the rows.
		await page.getByLabel("Jenis kasus").selectOption("");
		await page.getByLabel("Status", { exact: true }).selectOption("unknown");
		await expect(page.getByRole("button", { name: "Coba lagi" })).toBeVisible();
		await page.getByRole("button", { name: "Coba lagi" }).click();
		await expect(rows).toHaveCount(1);
		await page.screenshot({ path: join(renders, "list-owner-1280.png"), fullPage: true });
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("access: roles without the exception authority see the denied screen, no API call", async () => {
	const ecom = await staff("ecommerce_admin");
	const { page, errors, close } = await open(ecom);
	const s = state(exception("open"));
	try {
		await routes(page, s);
		await page.goto(`${origin}/admin/pesanan/kendala`);
		await expect(page.getByRole("heading", { name: "Akses kasus pengiriman diperlukan" })).toBeVisible();
		await expect(page.getByTestId("exceptions-page")).toHaveCount(0);
		await page.goto(`${origin}/admin/pesanan/kendala/${exNo}`);
		await expect(page.getByRole("heading", { name: "Akses kasus pengiriman diperlukan" })).toBeVisible();
		assert.equal(s.reads.filter((r) => r.startsWith(API)).length, 0);
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("decide: customer service chooses among the kind's decisions; the read version, key and reason are sent once", async () => {
	const cs = await staff("customer_service");
	const { page, errors, close } = await open(cs);
	const s = state(exception("awaiting_stock"));
	s.answers[`${API}/${exId}/decisions`] = exception("escalated", { version: 4 });
	try {
		await routes(page, s);
		await page.goto(`${origin}/admin/pesanan/kendala/${exNo}`);
		await expect(page.getByTestId("exception-status")).toHaveText("Menunggu stok");
		await expect(page.getByTestId("exception-unit")).toContainText("Botol Minum 1 L");
		// Customer service neither counts stock nor receives goods nor queues money.
		for (const id of ["exception-reinspect", "exception-intake", "exception-queue-refund", "exception-apply"])
			await expect(page.getByTestId(id)).toHaveCount(0);
		await expect(page.getByTestId("exceptions-refunds")).toHaveCount(0);
		assert.equal(s.reads.filter((r) => r.includes("/refunds")).length, 0, "no finance read for customer service");
		await page.getByTestId("exception-decide").click();
		const dialog = page.getByRole("dialog");
		for (const decision of ["propose_cancellation", "propose_refund", "keep_waiting", "escalate"])
			await expect(dialog.getByTestId(`decision-${decision}`)).toBeVisible();
		await dialog.getByRole("button", { name: "Simpan keputusan" }).click();
		await expect(dialog.getByRole("alert")).toHaveText("Alasan wajib diisi.");
		await dialog.getByTestId("decision-escalate").check();
		await dialog.getByLabel("Alasan (wajib)").fill("Perlu keputusan pemilik");
		await dialog.getByRole("button", { name: "Simpan keputusan" }).dblclick();
		await expect(page.getByTestId("exception-notice")).toContainText("Perlu tindak lanjut");
		const sent = s.posts.filter((p) => p.path === `${API}/${exId}/decisions`);
		assert.equal(sent.length, 1, "one submit even on a double click");
		assert.deepEqual(sent[0].body, { expected_version: 3, decision: "escalate", reason: "Perlu keputusan pemilik" });
		// A kind that has no unit to cancel is offered no cancellation.
		s.detail = exception("open", { kind: "late_collection", source_kind: "payment_event", units: [] });
		await page.reload();
		await page.getByTestId("exception-decide").click();
		await expect(page.getByRole("dialog").getByTestId("decision-propose_cancellation")).toHaveCount(0);
		await expect(page.getByRole("dialog").getByTestId("decision-propose_refund")).toBeVisible();
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("apply: only a buyer-accepted proposal in awaiting_source is applied, with the proposal id", async () => {
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner);
	const retained = proposal("cancel_affected_units");
	const s = state(exception("awaiting_buyer", { proposal: retained }));
	s.answers[`${API}/${exId}/decisions`] = exception("ready_for_refund", { version: 4, proposal: retained });
	try {
		await routes(page, s);
		await page.goto(`${origin}/admin/pesanan/kendala/${exNo}`);
		await expect(page.getByTestId("exception-proposal")).toContainText("Batalkan unit terdampak");
		await expect(page.getByTestId("exception-apply")).toHaveCount(0);
		s.detail = exception("awaiting_source", { proposal: retained });
		await page.reload();
		await page.getByTestId("exception-apply").click();
		const dialog = page.getByRole("dialog");
		await expect(dialog.getByTestId("apply-proposal")).toContainText("Batalkan unit terdampak");
		await dialog.getByLabel("Alasan (wajib)").fill("Persetujuan pembeli tersimpan");
		await dialog.getByRole("button", { name: "Terapkan" }).click();
		await expect(page.getByTestId("exception-notice")).toContainText("Persetujuan pembeli diterapkan");
		const sent = s.posts.filter((p) => p.path === `${API}/${exId}/decisions`);
		assert.deepEqual(sent[0].body, { expected_version: 3, proposal_id: retained.id, reason: "Persetujuan pembeli tersimpan" });
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("warehouse: count a parcel (new report) and recount a case; lots are addressed by balance id and version", async () => {
	const warehouse = await staff("warehouse");
	const { page, errors, close } = await open(warehouse);
	const created = exception("awaiting_stock", { version: 1 });
	// The report response carries the case's admin number, which is what the console navigates to.
	const s = state(exception("awaiting_stock"), { list: () => ({ body: { data: [], pagination: { next_cursor: null }, as_of: new Date().toISOString() } }) });
	s.answers[API] = created;
	try {
		await routes(page, s);
		await page.goto(`${origin}/admin/pesanan/kendala`);
		await page.getByTestId("exception-report").click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Paket", { exact: true }).selectOption(fulfillmentId);
		await expect(dialog.getByTestId("report-component")).toContainText("Botol 1 L");
		await dialog.getByRole("button", { name: "Simpan hitungan" }).click();
		await expect(dialog.getByRole("alert")).toContainText("Catatan hitungan wajib diisi");
		await dialog.getByLabel("Catatan hitungan (wajib)").fill("Botol kurang satu di rak");
		await dialog.getByRole("button", { name: "Simpan hitungan" }).click();
		await expect(dialog.getByRole("alert")).toContainText("minimal satu komponen yang kurang");
		await dialog.getByLabel("Jumlah kurang Botol 1 L").fill("9");
		await dialog.getByRole("button", { name: "Simpan hitungan" }).click();
		await expect(dialog.getByRole("alert")).toContainText("harus 0–1");
		await dialog.getByLabel("Jumlah kurang Botol 1 L").fill("1");
		await dialog.getByRole("button", { name: "Simpan hitungan" }).click();
		await expect(page).toHaveURL(new RegExp(`/admin/pesanan/kendala/${exNo}$`));
		const report = s.posts.find((p) => p.path === API);
		assert.deepEqual(report?.body, {
			fulfillment_id: fulfillmentId,
			fulfillment_item_ids: [itemId],
			expected_version: 5,
			reason: "Botol kurang satu di rak",
			observed_components: [{ balance_id: balanceId, stock_item_id: stockId, expected_balance_version: 7, missing_quantity: 1 }],
		});
		// Recount from the case: the same units, tied to the case id and version.
		await expect(page.getByTestId("exception-decide")).toHaveCount(0);
		await page.getByTestId("exception-reinspect").click();
		const recount = page.getByRole("dialog");
		await expect(recount.getByTestId("report-component")).toContainText("Botol 1 L");
		await recount.getByLabel("Catatan hitungan (wajib)").fill("Hitung ulang: lengkap");
		await recount.getByRole("button", { name: "Simpan hitungan" }).click();
		await expect(page.getByTestId("exception-notice")).toContainText("Hitungan tersimpan");
		const second = s.posts.filter((p) => p.path === API)[1];
		assert.deepEqual(second.body.reinspection, { exception_id: exId, expected_version: 3 });
		assert.deepEqual(second.body.observed_components, [{ balance_id: balanceId, stock_item_id: stockId, expected_balance_version: 7, missing_quantity: 0 }]);
		assert.notEqual(report?.key, second.key, "two intents, two keys");
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("intake: returned goods are sent per unit and lot; an unconfirmed identity is sent without stock ids", async () => {
	const warehouse = await staff("warehouse");
	const { page, errors, close } = await open(warehouse);
	const s = state(
		exception("awaiting_return", { kind: "delivery_failure", source_kind: "parcel_outcome", source_id: outcomeId, units: [unit({ physical_state: "return_expected" })] }),
	);
	s.answers[`${API}/${exId}/intakes`] = exception("resolved", { version: 4 });
	try {
		await routes(page, s);
		await page.goto(`${origin}/admin/pesanan/kendala/${exNo}`);
		await expect(page.getByTestId("exception-unit")).toContainText("Menunggu barang kembali");
		await expect(page.getByTestId("exception-decide")).toHaveCount(0);
		await page.getByTestId("exception-intake").click();
		const dialog = page.getByRole("dialog");
		await expect(dialog.getByTestId("intake-unit")).toContainText("Botol Minum 1 L");
		await dialog.getByRole("button", { name: "Simpan penerimaan" }).click();
		await expect(dialog.getByRole("alert")).toContainText("Catatan penerimaan wajib diisi");
		await dialog.getByLabel("Catatan penerimaan (wajib)").fill("Botol kembali utuh");
		await dialog.getByRole("button", { name: "Simpan penerimaan" }).click();
		await expect(page.getByTestId("exception-notice")).toContainText("Barang kembali tercatat");
		const first = s.posts.find((p) => p.path === `${API}/${exId}/intakes`);
		assert.deepEqual(first?.body, {
			expected_version: 3,
			physical_outcome_id: outcomeId,
			lines: [{ exception_unit_id: unitId, stock_item_id: stockId, expected_balance_id: balanceId, quantity: 1, identity_confirmed: true }],
			reason: "Botol kembali utuh",
		});
		await page.getByTestId("exception-intake").click();
		const again = page.getByRole("dialog");
		await again.getByLabel("Identitas cocok dengan yang dikirim").uncheck();
		await again.getByLabel("Catatan penerimaan (wajib)").fill("Identitas botol tidak bisa dipastikan");
		await again.getByRole("button", { name: "Simpan penerimaan" }).click();
		await expect(again).toHaveCount(0);
		await expect(page.getByTestId("exception-notice")).toContainText("Barang kembali tercatat");
		const second = s.posts.filter((p) => p.path === `${API}/${exId}/intakes`)[1];
		assert.deepEqual((second.body.lines as unknown[])[0], { exception_unit_id: unitId, stock_item_id: null, expected_balance_id: null, quantity: 1, identity_confirmed: false });
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("refund: finance queues with a subject-bound proof; read-only finance and customer service cannot", async () => {
	const finance = await staff("finance", ["finance.refunds.read", "finance.refunds.write"]);
	const readOnly = await staff("finance", ["finance.refunds.read"]);
	const a = await open(finance);
	const b = await open(readOnly);
	const s = state(exception("ready_for_refund", { proposal: proposal("cancel_affected_units") }));
	s.answers[`${API}/${exId}/refunds`] = { exception_id: exId, version: 4, refunds: [refund("queued")] };
	try {
		await routes(a.page, s);
		await a.page.goto(`${origin}/admin/pesanan/kendala/${exNo}`);
		await expect(a.page.getByTestId("refunds-empty")).toBeVisible();
		await a.page.getByTestId("exception-queue-refund").click();
		const dialog = a.page.getByRole("dialog");
		await dialog.getByRole("button", { name: "Ajukan refund" }).click();
		await expect(dialog.getByRole("alert")).toHaveText("Isi alasan dan kata sandi.");
		await dialog.getByLabel("Alasan (wajib)").fill("Unit dibatalkan, dana kembali ke pembayaran asal");
		await dialog.getByLabel("Konfirmasi kata sandi").fill("not-a-real-password");
		await dialog.getByRole("button", { name: "Ajukan refund" }).dblclick();
		await expect(a.page.getByTestId("exception-notice")).toContainText("Refund Rp");
		const proof = s.posts.find((p) => p.path === "/api/v1/me/reauthentication-proofs");
		assert.deepEqual(proof?.body, { password: "not-a-real-password", action: "finance.recovery_refund", subject_id: exId });
		const queued = s.posts.filter((p) => p.path === `${API}/${exId}/refunds`);
		assert.equal(queued.length, 1);
		assert.deepEqual(queued[0].body, { expected_version: 3, reason: "Unit dibatalkan, dana kembali ke pembayaran asal", reauthentication_proof: "SYNTHETIC-PROOF" });
		assert.ok(s.posts.indexOf(proof as Post) < s.posts.indexOf(queued[0]));
		// Read-only finance sees the refunds and no money action.
		await routes(b.page, state(exception("ready_for_refund"), { refunds: [refund("queued")] }));
		await b.page.goto(`${origin}/admin/pesanan/kendala/${exNo}`);
		await expect(b.page.getByTestId("refund-card")).toBeVisible();
		await expect(b.page.getByTestId("exception-queue-refund")).toHaveCount(0);
		await expect(b.page.getByTestId("refund-reconcile")).toHaveCount(0);
		await expect(b.page.getByText(/hanya bisa membaca refund/)).toBeVisible();
		assert.deepEqual([...a.errors, ...b.errors], []);
	} finally {
		await a.close();
		await b.close();
	}
});

test("unknown outcome: only reconcile is offered; a lost answer is repeated with the same key, body and proof", async () => {
	const finance = await staff("finance", ["finance.refunds.read", "finance.refunds.write"]);
	const { page, errors, close } = await open(finance);
	const unknown = refund("unknown", { version: 4 });
	const s = state(exception("refunding", { version: 6 }), { refunds: [unknown] });
	const path = `${API}/${exId}/refunds/${unknown.id}/reconciliations`;
	s.answers[path] = refund("unknown", { version: 4 });
	s.lose.add(path);
	try {
		await routes(page, s);
		await page.goto(`${origin}/admin/pesanan/kendala/${exNo}`);
		await expect(page.getByTestId("refund-status")).toHaveText("Hasil belum pasti");
		await expect(page.getByTestId("refund-unknown")).toContainText("Jangan mengajukan refund lagi");
		// No blind second money action: no retry, no new refund.
		await expect(page.getByTestId("refund-retry")).toHaveCount(0);
		await expect(page.getByTestId("exception-queue-refund")).toHaveCount(0);
		await page.getByTestId("refund-reconcile").click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Alasan (wajib)").fill("Periksa hasil bank");
		await dialog.getByLabel("Konfirmasi kata sandi").fill("not-a-real-password");
		const detailReads = s.reads.filter((r) => r === `${API}/${exId}`).length;
		await dialog.getByRole("button", { name: "Rekonsiliasi" }).click();
		await expect(dialog.getByRole("alert")).toContainText("Hasil belum pasti");
		await expect(dialog.getByLabel("Alasan (wajib)")).toBeDisabled();
		await expect.poll(() => s.reads.filter((r) => r === `${API}/${exId}`).length).toBeGreaterThan(detailReads);
		await dialog.getByRole("button", { name: "Kirim ulang (kunci sama)" }).click();
		await expect(page.getByTestId("exception-notice")).toContainText("Rekonsiliasi dijalankan");
		const sent = s.posts.filter((p) => p.path === path);
		assert.equal(sent.length, 2);
		assert.equal(sent[0].key, sent[1].key, "same idempotency key");
		assert.deepEqual(sent[0].body, sent[1].body, "same request and proof");
		assert.equal(s.posts.filter((p) => p.path === "/api/v1/me/reauthentication-proofs").length, 1, "one proof for the intent");
		assert.deepEqual(sent[0].body, { expected_version: 4, reason: "Periksa hasil bank", reauthentication_proof: "SYNTHETIC-PROOF" });
		await page.screenshot({ path: join(renders, "detail-unknown-1280.png"), fullPage: true });
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("failed refund offers retry; waiting, settled and COD-waiting refunds offer none", async () => {
	const finance = await staff("finance", ["finance.refunds.read", "finance.refunds.write"]);
	const { page, errors, close } = await open(finance);
	const failed = refund("failed", { explanation: "Pengiriman dana belum berhasil." });
	const s = state(exception("refunding", { version: 6 }), { refunds: [failed] });
	const path = `${API}/${exId}/refunds/${failed.id}/retries`;
	s.answers[path] = refund("queued", { id: failed.id, version: 5 });
	try {
		await routes(page, s);
		await page.goto(`${origin}/admin/pesanan/kendala/${exNo}`);
		await expect(page.getByTestId("refund-status")).toHaveText("Gagal, dana belum keluar");
		await expect(page.getByTestId("refund-reconcile")).toHaveCount(0);
		await page.getByTestId("refund-retry").click();
		const dialog = page.getByRole("dialog");
		await dialog.getByLabel("Alasan (wajib)").fill("Bank menolak, coba lagi");
		await dialog.getByLabel("Konfirmasi kata sandi").fill("not-a-real-password");
		await dialog.getByRole("button", { name: "Coba ulang" }).click();
		await expect(page.getByTestId("exception-notice")).toContainText("Percobaan baru");
		const sent = s.posts.find((p) => p.path === path);
		assert.deepEqual(sent?.body, { expected_version: 2, reason: "Bank menolak, coba lagi", reauthentication_proof: "SYNTHETIC-PROOF" });
		for (const status of ["succeeded", "awaiting_destination"]) {
			s.refunds = [refund(status, { id: randomUUID() })];
			await page.reload();
			await expect(page.getByTestId("refund-card")).toHaveCount(1);
			await expect(page.getByTestId("refund-retry")).toHaveCount(0);
			await expect(page.getByTestId("refund-reconcile")).toHaveCount(0);
		}
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

for (const [name, width, height, touch] of [
	["phone", 390, 844, true],
	["tablet", 768, 1024, false],
	["desktop", 1440, 900, false],
] as const) {
	test(`${name} width: list and case have no horizontal overflow and the actions sit in the sticky bar on phones`, async () => {
		const owner = await staff("owner");
		const { page, errors, close } = await open(owner, { width, height }, touch);
		const row = exception("awaiting_stock");
		const s = state(exception("awaiting_source", { proposal: proposal("cancel_affected_units") }), {
			refunds: [refund("unknown")],
			list: () => ({ body: { data: [row, exception("ready_for_refund", { id: randomUUID(), kind: "late_collection", units: [] })], pagination: { next_cursor: null }, as_of: new Date().toISOString() } }),
		});
		try {
			await routes(page, s);
			await page.goto(`${origin}/admin/pesanan/kendala`);
			await expect(page.locator('[data-testid^="exception-row-"]')).toHaveCount(2);
			assert.ok((await overflow(page)) <= 0, "list overflow");
			if (touch) await expect(page.getByRole("button", { name: /^Filter/ })).toBeVisible();
			await page.screenshot({ path: join(renders, `list-${width}.png`), fullPage: false });
			await page.goto(`${origin}/admin/pesanan/kendala/${exNo}`);
			await expect(page.getByTestId("exception-apply")).toBeVisible();
			await expect(page.getByTestId("refund-card")).toBeVisible();
			assert.ok((await overflow(page)) <= 0, "detail overflow");
			if (touch)
				assert.equal(await page.getByTestId("exception-apply").evaluate((el) => getComputedStyle(el.closest("[data-sticky-bar]") as Element).position), "fixed");
			await page.getByTestId("exception-apply").click();
			assert.ok((await overflow(page)) <= 0, "dialog overflow");
			await page.screenshot({ path: join(renders, `detail-${width}.png`), fullPage: false });
			assert.deepEqual(errors, []);
		} finally {
			await close();
		}
	});
}
