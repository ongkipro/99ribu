import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import test from "node:test";
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import { runOneJob } from "../../src/jobs/worker.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { commerceActor } from "../../src/modules/checkout/access.ts";
import { createCart } from "../../src/modules/checkout/carts.ts";
import { expireOwnedOrderJob } from "../../src/modules/checkout/expiry.ts";
import { simulateTrackingObservation } from "../../src/modules/fulfillment/manual.ts";
import { handleManualFulfillment } from "../../src/modules/fulfillment/manual-routes.ts";
import { releaseReservation } from "../../src/modules/inventory/reservations.ts";
import { seedCommerce } from "../../src/modules/local/commerce.ts";
import { advanceFixtureClock, readFixtureClock } from "../../src/modules/local/fixtures.ts";
import { prepareStorefront } from "../../src/modules/local/storefront.ts";
import { allOrderIssuedCookies, orderReceiptPath, recoverOrderReceipt } from "../../src/modules/orders/receipt.ts";
import { ingestCodEvent, simulateCodCollection } from "../../src/modules/payments/cod-local.ts";
import { paymentAdapter } from "../../src/modules/payments/worker.ts";
import { rupiah } from "../../src/modules/storefront/format.ts";
import { actor, enroll } from "../contract/access-fixture.ts";
import { CommerceClient } from "../integration/checkout-fixture.ts";
import { closeFulfillmentActor, installFulfillmentCalendars } from "../integration/fulfillment-fixture.ts";
import {RENDERS} from "../render-root.ts";

// S91/S92 rendered proof on the built web at the canonical origin: the real manual-fulfillment,
// payments and COD-settlement consoles plus the buyer checkout/receipt pages, driven through their
// accessible UI against the owner's LOCAL database. Every fixture lives in its own clock namespace
// and warehouses; paid parcels are shipped, delivered (and COD-collected) on teardown so no work
// queue keeps them, the company payment terms are restored, and the runner withdraws publications.
const origin = "http://127.0.0.1:3099";
const output = `${RENDERS}/s91-s92`;
const namespace = `s9192-${randomUUID().slice(0, 8)}`;
const identity = createLocalAuth("local");
const sql = identity.sql;
const ACCOUNT = { bank_name: "Bank Contoh", account_number: "8800123456", account_holder: "PT Contoh Sembilan Sembilan" };
const ADDRESS = { recipient_name: "Penerima Contoh", phone: "+6281200000000", address_line: "Jalan Contoh 12 RT 01", destination_id: "test-malang", postal_code: "00001" };
const LONG = { timeout: 180000 };

type User = Awaited<ReturnType<typeof actor>>;
let owner: User, staff: User, finance: User, browser: Browser;
let seeded: Awaited<ReturnType<typeof seedCommerce>>, curated: Awaited<ReturnType<typeof prepareStorefront>>;
let originalTerms: Record<string, unknown> | null = null, termsWritten = 0, malang = "";
const users: User[] = [];
const orders = new Set<string>();
// S91 hands its shipped COD parcel to the S92 COD-settlement check.
let s91: { order: string; number: string; shipment: string; resi: string; codDue: number } | undefined;

const stamp = () => `${String(Date.now()).slice(-8)}${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
const wall = async () => new Date((await sql`select clock_timestamp() now`)[0].now).getTime();
async function tick(seconds: number) {
	const clock = await readFixtureClock("local", namespace);
	await advanceFixtureClock("local", namespace, seconds, clock.version);
}
// Fixture business clocks stand still; keep this namespace at or after wall time.
async function syncClock() {
	const clock = await readFixtureClock("local", namespace);
	await advanceFixtureClock("local", namespace, Math.max(1, Math.ceil(((await wall()) - Date.parse(clock.now)) / 1000) + 5), clock.version);
}
async function runJob(id: string, adapters: Parameters<typeof runOneJob>[1] = {}) {
	await runOneJob(sql, adapters, id);
	const [job] = await sql`select status,last_error from app.outbox_job where id=${id}`;
	return job as { status: string; last_error: string | null };
}
async function proof(user: User, action: string, subject: string) {
	const request = user.browser.request("/api/v1/me/reauthentication-proofs", { password: user.password, action, subject_id: subject });
	request.headers.set("idempotency-key", randomUUID());
	const response = await handleAccess(request, identity);
	assert.equal(response.status, 201);
	return (await response.json()).proof as string;
}
async function readTerms() {
	return (await (await owner.browser.access("/admin/policy-versions?kind=payment")).json()) as { latest_version: number; current: { values: Record<string, unknown> } | null };
}
async function writeTerms(values: Record<string, unknown>, reason: string) {
	const history = await readTerms();
	const request = owner.browser.request("/api/v1/admin/policy-versions", {
		kind: "payment", warehouse_id: null, expected_version: history.latest_version, effective_at: null, values, reason,
		reauthentication_proof: await proof(owner, "payment_policy.version", "company-payment"),
	});
	request.headers.set("idempotency-key", randomUUID());
	const response = await handleAccess(request, identity);
	assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
}
async function staffUser(role: "warehouse" | "finance", warehouses: string[]) {
	const user = await actor(identity, role, warehouses);
	users.push(user);
	await enroll(user.browser, user.password);
	if (role === "finance") await sql`update app.role_grant set permissions=${["finance.reconciliation.read", "finance.reconciliation.write"]} where user_id=${user.id}`;
	return user;
}

async function open(cookies: { name: string; value: string; path?: string }[]) {
	const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce", timezoneId: "Asia/Jakarta" });
	await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, domain: "127.0.0.1", path: c.path ?? "/", httpOnly: true, sameSite: "Lax" as const, secure: false })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const problems: string[] = [];
	page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
	page.on("request", (request) => {
		if (new URL(request.url()).origin !== origin) problems.push(`external request: ${request.url()}`);
	});
	return { context, page, problems };
}
const asStaff = (user: User) => open([...user.browser.cookies].map(([name, value]) => ({ name, value })));
const asBuyer = (client: CommerceClient) => open([...client.cookies.values()]);

async function capture(page: Page, name: string, storefront = false) {
	await mkdir(output, { recursive: true });
	await page.evaluate(() => document.fonts.ready);
	await expect(page.getByText("Menyimpan draf…", { exact: true })).not.toBeVisible();
	if (storefront) assert.doesNotMatch(await page.locator("body").innerText(), /SYNTHETIC|\[s9192-[a-f0-9]+\]/, "Buyer-visible fixture labels stay natural Indonesian");
	await page.mouse.move(0, 0);
	await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	assert.ok(overflow <= 1, `No horizontal overflow on ${name} (${overflow}px)`);
}
async function captureBoth(page: Page, name: string, storefront = false) {
	for (const width of [390, 1440]) {
		await page.setViewportSize({ width, height: 900 });
		await capture(page, `${name}-${width}`, storefront);
	}
	await page.setViewportSize({ width: 390, height: 900 });
}

async function guestCart(offer: { offer_id: string; publication_id: string | null }, quantity: number) {
	assert.ok(offer.publication_id);
	const client = new CommerceClient(identity), body = { lines: [{ variant_id: offer.offer_id, quantity, expected_publication_id: offer.publication_id }] }, key = randomUUID();
	assert.equal((await client.call("/api/v1/carts", body, { key })).response.status, 401);
	const request = client.request("/api/v1/carts", body, { key }), principal = await commerceActor(request, identity);
	assert.ok(principal?.kind === "guest");
	const created = await sql.begin((tx) => createCart(tx, request, identity, principal, body, { clock_namespace: namespace }));
	assert.equal((await client.call("/api/v1/carts", body, { key })).response.status, 201);
	return { client, cart: created.cart.id as string };
}
async function fillContact(page: Page, method: RegExp) {
	await page.getByLabel("Nama penerima", { exact: true }).fill("Penerima Contoh");
	await page.getByLabel("Nomor HP", { exact: true }).fill(`0812${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`);
	await page.getByLabel("Wilayah pengiriman", { exact: true }).selectOption("test-malang");
	await page.getByLabel("Alamat lengkap", { exact: true }).fill("Jalan Contoh 12\nRT 01");
	await page.getByRole("radio", { name: method }).check();
	await page.getByRole("button", { name: "Hitung ongkir", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Pengiriman per paket", exact: true })).toBeVisible();
	await page.getByRole("button", { name: "Tinjau pesanan", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Tinjau pesanan", exact: true })).toBeVisible();
}
const parcelsOf = (orderId: string) =>
	sql`select f.id,f.revision,f.handover_at,f.booking_id,s.id shipment_id,s.warehouse_id,s.cod_due from app.fulfillment f join app.order_shipment s on s.id=f.shipment_id where s.order_id=${orderId} order by s.id`;
async function pollJob(fulfillmentId: string) {
	const [row] = await sql`select j.id from app.manual_tracking mt join app.outbox_job j on j.dedup_key='fulfillment-tracking:'||mt.id::text where mt.fulfillment_id=${fulfillmentId} order by mt.version desc limit 1`;
	assert.ok(row, "a shipped manual parcel has a tracking poll job");
	await sql`update app.outbox_job set run_at=clock_timestamp() where id=${row.id} and status='pending'`;
	return runJob(row.id);
}

// Teardown: a paid/COD order's parcels leave every manual queue — shipped (if still waiting),
// COD collected, delivered through the simulated tracking adapter with buyer receipts recorded.
async function retire(orderId: string) {
	const [order] = await sql`select payment_method,payment_status,status from app.commerce_order where id=${orderId}`;
	if (!order || order.status === "cancelled") return;
	if (order.payment_method !== "cod" && order.payment_status !== "confirmed") {
		// Unpaid manual-bank order: past the 24 h window and the finance grace, then expire it.
		await tick(86400 + 13 * 3600);
		const [job] = await sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${orderId}`;
		if (job) await sql.begin((tx) => expireOwnedOrderJob(tx, { id: job.id, kind: job.kind, payload: job.payload }));
		return;
	}
	for (const [index, parcel] of (await parcelsOf(orderId)).entries()) {
		if (parcel.booking_id) continue;
		if (!parcel.handover_at) {
			const request = owner.browser.request(`/api/v1/admin/fulfillments/${parcel.id}/manual-shipment`, { expected_version: parcel.revision, courier: "jnt", tracking_number: `RT${stamp()}${index}` });
			request.headers.set("idempotency-key", randomUUID());
			const response = await handleManualFulfillment(request, identity);
			assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
		}
		if (order.payment_method === "cod" && !(await sql`select 1 from app.economic_receipt where shipment_id=${parcel.shipment_id} and kind='cod'`).length) {
			const event = await simulateCodCollection(sql, "local", String(parcel.shipment_id));
			assert.equal((await runJob(await ingestCodEvent(sql, event))).status, "completed");
		}
		if (!(await sql`select 1 from app.shipment_tracking_event where fulfillment_id=${parcel.id} and status='delivered'`).length) {
			await tick(60);
			const [current] = await sql`select courier,tracking_number from app.manual_tracking where fulfillment_id=${parcel.id} order by version desc limit 1`;
			await simulateTrackingObservation(sql, "local", { courier: current.courier, tracking_number: current.tracking_number, provider_status: "DELIVERED" });
			assert.equal((await pollJob(parcel.id)).status, "completed");
		}
		for (const receipt of await sql`select j.id from app.shipment_tracking_event t join app.parcel_receipt_provider_event p on p.id=t.receipt_source_id join app.outbox_job j on j.id=p.callback_job_id where t.fulfillment_id=${parcel.id} and j.status='pending'`)
			assert.equal((await runJob(receipt.id)).status, "completed");
	}
}

test.before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	owner = await actor(identity, "owner", []);
	await enroll(owner.browser, owner.password);
	const request = () => owner.browser.request("/api/v1/admin/products");
	seeded = await seedCommerce(request(), identity, "local", namespace);
	curated = await prepareStorefront(request(), identity, "local", namespace, seeded);
	await syncClock();
	// DEC-008/009 company payment terms for this run: 3.33 % buyer COD fee and one manual-bank account.
	originalTerms = (await readTerms()).current?.values ?? null;
	await writeTerms({ cod_fee_bps: 333, manual_bank_accounts: [ACCOUNT] }, "Owned S91/S92 browser proof payment terms");
	termsWritten = (await readTerms()).latest_version;
	await syncClock();
	await installFulfillmentCalendars(identity, owner, namespace);
	const [warehouse] = await sql`select warehouse_id from app.local_fixture_warehouse where namespace=${namespace} and fixture_id='fixture-malang'`;
	malang = String(warehouse.warehouse_id);
	staff = await staffUser("warehouse", [malang]);
	finance = await staffUser("finance", []);
}, LONG);

test.after(async () => {
	const failures: unknown[] = [];
	// Every order of this namespace, including ones created before a failed assertion recorded them.
	for (const r of await sql`select id from app.commerce_order where clock_namespace=${namespace}`) orders.add(String(r.id));
	for (const orderId of orders) {
		try { await retire(orderId); } catch (error) { failures.push(error); }
	}
	try {
		// Compare-and-swap: restore only if nobody published newer terms during the run.
		if (termsWritten && (await readTerms()).latest_version === termsWritten) await writeTerms(originalTerms ?? { cod_fee_bps: 0, manual_bank_accounts: [] }, "Owned S91/S92 browser proof finished; restore previous payment terms");
	} catch (error) { failures.push(error); }
	try {
		if (seeded) for (const reservation of Object.values(seeded.reservations)) {
			await sql.begin((tx) => releaseReservation(tx, reservation, "Owned S91/S92 browser fixture finished"));
			await sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservation}`;
		}
	} catch (error) { failures.push(error); }
	for (const user of [...users, ...(owner ? [owner] : [])]) {
		try { await closeFulfillmentActor(identity, user); } catch (error) { failures.push(error); }
	}
	await browser?.close();
	await sql.end();
	if (failures.length) throw new AggregateError(failures, "Owned S91/S92 browser cleanup failed");
}, LONG);

test("S91 built browser: scoped warehouse staff records a Berlapak reference and a manual resi through the real dialog; the buyer order page shows courier, resi and tracking status", LONG, async () => {
	await syncClock();
	const { client, cart } = await guestCart(curated.products.shirt, 4);
	const quote = await client.call("/api/v1/checkout/quotes", { cart_id: cart, address: ADDRESS, contact: { phone: `+62812${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, email: null }, payment_method: "cod" }, { version: 1 });
	assert.equal(quote.response.status, 201, JSON.stringify(quote.payload));
	const submitted = await client.call("/api/v1/orders", { quote_id: quote.payload.id }, { version: 1 });
	assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
	const order = submitted.payload.order as { id: string; number: string };
	orders.add(order.id);
	const parcels = await parcelsOf(order.id);
	assert.equal(parcels.length, 2, "four shirts split across the two owned origin warehouses");
	const mine = parcels.find((p) => p.warehouse_id === malang), other = parcels.find((p) => p.warehouse_id !== malang);
	assert.ok(mine && other, "one parcel per warehouse");
	const resi = `JP${stamp()}`, reference = "BL-INV/2026/0042";

	const desk = await asStaff(staff);
	try {
		const { page } = desk;
		await page.goto(`${origin}/admin/fulfillment`);
		await expect(page.getByRole("heading", { name: "Pengiriman Manual", level: 1 })).toBeVisible();
		await expect(page.getByRole("tab", { name: "Perlu dipesan kurir" })).toHaveAttribute("aria-selected", "true");
		const rows = page.getByRole("row").filter({ hasText: order.number });
		// Scope: the Malang-only staff sees exactly its own parcel of this two-warehouse order.
		await expect(rows).toHaveCount(1);
		await expect(rows.first()).toContainText("COD");
		const denied = await page.request.get(`${origin}/api/v1/admin/manual-shipments?queue=to_book&warehouse_id=${other.warehouse_id}&limit=100`);
		assert.equal(denied.status(), 404, "another warehouse's queue is not visible");
		const deniedShip = await page.request.post(`${origin}/api/v1/admin/fulfillments/${other.id}/manual-shipment`, {
			headers: { origin, "idempotency-key": randomUUID() },
			data: { expected_version: other.revision, courier: "jne", tracking_number: `JX${stamp()}` },
		});
		assert.equal(deniedShip.status(), 404, "another warehouse's parcel cannot be shipped");
		await captureBoth(page, "s91-fulfillment-queue");

		await rows.first().getByRole("button", { name: "Catat resi" }).click();
		const dialog = page.getByRole("dialog", { name: `Catat resi ${order.number}` });
		await expect(dialog).toBeVisible();
		await dialog.getByLabel("Kurir", { exact: true }).selectOption("jne");
		await dialog.getByLabel("Nomor resi", { exact: true }).fill("JP-12");
		await dialog.getByRole("button", { name: "Simpan" }).click();
		await expect(dialog.getByText("Nomor resi harus 8–40 karakter huruf, angka atau tanda hubung.")).toBeVisible();
		assert.equal((await sql`select count(*)::int n from app.manual_tracking where fulfillment_id=${mine.id}`)[0].n, 0, "an invalid resi persists nothing");
		// Typed with spaces and lower case; the server normalizes it.
		await dialog.getByLabel("Nomor resi", { exact: true }).fill(resi.toLowerCase().replace(/(.{4})/g, "$1 ").trim());
		await dialog.getByLabel("Referensi pembelian Berlapak (opsional)").fill(reference);
		await captureBoth(page, "s91-fulfillment-dialog");
		await dialog.getByRole("button", { name: "Simpan" }).click();
		await expect(page.getByRole("status").filter({ hasText: `Resi ${resi} tercatat; paket ${order.number} berstatus dikirim.` })).toBeVisible();
		await expect(dialog).toHaveCount(0);
		await expect(rows).toHaveCount(0);

		// Persisted: API projection, fulfillment state, stock consumed once; the other parcel untouched.
		const shipped = await page.request.get(`${origin}/api/v1/admin/manual-shipments?queue=shipped&warehouse_id=${malang}&limit=100`);
		assert.equal(shipped.status(), 200);
		const row = ((await shipped.json()).data as { id: string; status: string; manual: { courier: string; tracking_number: string; purchase_reference: { reference: string } | null } }[]).find((r) => r.id === mine.id);
		assert.ok(row, "the shipped parcel is in the shipped queue");
		assert.equal(row.status, "handed_over");
		assert.equal(row.manual.courier, "jne");
		assert.equal(row.manual.tracking_number, resi);
		assert.equal(row.manual.purchase_reference?.reference, reference);
		const [components] = await sql`select sum(a.quantity)::int expected from app.fulfillment_component_allocation a join app.fulfillment_item i on i.id=a.fulfillment_item_id where i.shipment_id=${mine.shipment_id}`;
		const [consumed] = await sql`select sum(m.quantity)::int actual,count(distinct e.id)::int events from app.stock_movement m join app.fulfillment_event e on m.source_ref='handover:'||e.id::text where e.fulfillment_id=${mine.id} and m.kind='consume'`;
		assert.equal(consumed.actual, components.expected);
		assert.equal(consumed.events, 1, "stock consumed by exactly one handover");
		assert.equal((await sql`select handover_at from app.fulfillment where id=${other.id}`)[0].handover_at, null, "the other warehouse's parcel is unchanged");

		// Simulated tracking adapter (S98 live adapter stays gated): in transit, shown to staff and buyer.
		await tick(60);
		await simulateTrackingObservation(sql, "local", { courier: "jne", tracking_number: resi, provider_status: "IN_TRANSIT" });
		assert.equal((await pollJob(mine.id)).status, "pending", "polling continues until delivery");
		assert.deepEqual((await sql`select status from app.shipment_tracking_event where fulfillment_id=${mine.id}`).map((r) => r.status), ["in_transit"]);
		await page.reload();
		await page.getByRole("tab", { name: "Menunggu terkirim" }).click();
		const shippedRow = page.getByRole("row").filter({ hasText: order.number });
		await expect(shippedRow).toHaveCount(1);
		await expect(shippedRow).toContainText("JNE");
		await expect(shippedRow).toContainText(resi);
		await expect(shippedRow).toContainText("Dalam perjalanan");
		await captureBoth(page, "s91-fulfillment-shipped");
		assert.deepEqual(desk.problems, []);
	} finally {
		await desk.context.close();
	}

	const [stored] = await sql`select cod_due from app.order_shipment where id=${mine.shipment_id}`;
	s91 = { order: order.id, number: order.number, shipment: String(mine.shipment_id), resi, codDue: Number(stored.cod_due) };

	const recovered = await recoverOrderReceipt(client.request(orderReceiptPath(order.id), {}), identity, order.id);
	for (const entry of await allOrderIssuedCookies(identity, order.id, recovered.cookies)) client.cookies.set(`${entry.name}:${entry.path}`, { name: entry.name, value: entry.value, path: entry.path });
	const buyer = await asBuyer(client);
	try {
		const { page } = buyer;
		await page.goto(`${origin}${orderReceiptPath(order.id)}`);
		const tracking = page.locator(".receipt-tracking").filter({ hasText: resi });
		await expect(tracking).toContainText(`Nomor resi: ${resi}`);
		await expect(tracking.getByTestId("parcel-tracking-status")).toHaveText("Status kurir: Dalam perjalanan");
		await expect(page.locator(".receipt-carrier").filter({ hasText: "JNE" })).toHaveCount(1);
		await expect(page.getByText("Biaya COD (3,33%)", { exact: true }).first()).toBeAttached();
		assert.ok(!(await page.content()).includes(reference), "the Berlapak purchase reference stays internal");
		await captureBoth(page, "s91-buyer-order", true);
		assert.deepEqual(buyer.problems, []);
	} finally {
		await buyer.context.close();
	}
});

test("S92 built browser: manual bank checkout adds the unique code and a 24 h deadline, the receipt shows transfer instructions, and finance confirms it through the real dialog", LONG, async () => {
	await syncClock();
	const { client, cart } = await guestCart(curated.products["cream-pair"], 1);
	const buyer = await asBuyer(client);
	try {
		const { page } = buyer;
		await page.goto(`${origin}/checkout`);
		await expect(page.getByRole("radio", { name: "Transfer bank · dicek manual, batas 24 jam" })).toBeVisible();
		await fillContact(page, /^Transfer bank/);
		await expect(page.getByText("Transfer bank", { exact: true }).first()).toBeVisible();
		// The note lives in the order summary, collapsed on narrow screens: open it like a buyer would.
		const summary = page.locator(".checkout-summary details");
		if (!(await summary.evaluate((node) => (node as HTMLDetailsElement).open))) await summary.locator("summary").click();
		await expect(page.getByText("Kode unik 1–999 rupiah ditambahkan ke total saat pesanan dibuat untuk mencocokkan transfer.").first()).toBeVisible();
		await captureBoth(page, "s92-checkout-transfer-review", true);
		await page.getByRole("button", { name: /^Buat pesanan/ }).click();
		await page.waitForURL(/\/checkout\/order\/[0-9a-f-]+$/);
		const [order] = await sql`select id,number,transfer_code,payment_charge_amount,buyer_total,payment_channel,created_at,expires_at from app.commerce_order where cart_id=${cart} and clock_namespace=${namespace}`;
		assert.ok(order, "the order was placed through the checkout UI");
		orders.add(order.id);
		const code = Number(order.transfer_code), due = Number(order.buyer_total) + code;
		assert.equal(order.payment_channel, "manual-bank");
		assert.ok(code >= 1 && code <= 999, "unique code 1–999");
		assert.equal(Number(order.payment_charge_amount), code, "the code is the separate buyer-paid payment component");
		assert.equal(new Date(order.expires_at).getTime() - new Date(order.created_at).getTime(), 86400000, "24 hour payment window");
		await expect(page.getByRole("heading", { name: "Menunggu pembayaran", exact: true })).toBeVisible();
		const charges = page.locator(".checkout-charges").first();
		await expect(charges.locator("div").filter({ hasText: "Kode unik transfer" }).first()).toContainText(rupiah(code));
		await expect(charges.locator(".checkout-total").first()).toContainText(rupiah(due));
		await expect(page.getByText(/^Batas pembayaran: .+ WIB\.$/)).toBeVisible();
		await captureBoth(page, "s92-checkout-transfer-order", true);

		await page.getByRole("button", { name: "Siapkan instruksi pembayaran", exact: true }).click();
		await expect.poll(async () => (await sql`select count(*)::int n from app.payment_attempt where order_id=${order.id}`)[0].n).toBe(1);
		const [attempt] = await sql`select id,method_id,creation_job_id,expected_amount from app.payment_attempt where order_id=${order.id}`;
		assert.equal(attempt.method_id, "manual-bank");
		assert.equal(Number(attempt.expected_amount), due);
		assert.equal((await runJob(attempt.creation_job_id, { "payment.create": paymentAdapter(sql, "local") })).status, "completed");
		await page.reload();
		const instructions = page.getByTestId("bank-transfer-instructions");
		await expect(instructions.getByRole("heading", { name: "Transfer bank" })).toBeVisible();
		await expect(instructions).toContainText(rupiah(due));
		await expect(instructions).toContainText(`kode unik ${code} rupiah`);
		await expect(instructions).toContainText(ACCOUNT.account_number);
		await captureBoth(page, "s92-receipt-transfer-instructions", true);

		// Denial: warehouse staff has no finance queue, neither the page nor the API.
		const keeper = await asStaff(staff);
		try {
			await keeper.page.goto(`${origin}/admin/payments`);
			await expect(keeper.page.getByRole("heading", { name: "Akses keuangan diperlukan" })).toBeVisible();
			assert.equal((await keeper.page.request.get(`${origin}/api/v1/admin/manual-transfers?state=open`)).status(), 403);
			await expect(keeper.page.getByRole("button", { name: "Konfirmasi transfer" })).toHaveCount(0);
		} finally {
			await keeper.context.close();
		}

		const desk = await asStaff(finance);
		try {
			const fp = desk.page;
			await fp.goto(`${origin}/admin/payments`);
			await expect(fp.getByRole("heading", { name: "Pembayaran", level: 1 })).toBeVisible();
			const row = fp.getByTestId("manual-transfers").getByRole("row").filter({ hasText: order.number });
			await expect(row).toHaveCount(1);
			await expect(row).toContainText(rupiah(due));
			await expect(row.getByRole("cell", { name: String(code), exact: true })).toBeVisible();
			await captureBoth(fp, "s92-payments-queue");

			// The business clock moves on; the transfer happened after the instructions were issued.
			await tick(180);
			const [issued] = await sql`select created_at from app.payment_attempt where id=${attempt.id}`;
			const transferredAt = Math.ceil(new Date(issued.created_at).getTime() / 60000) * 60000;
			const jakarta = new Date(transferredAt + 7 * 3600000).toISOString().slice(0, 16);
			const bankReference = `BCA-${randomUUID().slice(0, 8).toUpperCase()}`;
			await row.getByRole("button", { name: "Konfirmasi transfer" }).click();
			const dialog = fp.getByRole("dialog", { name: `Konfirmasi transfer ${order.number}` });
			await expect(dialog).toContainText(`kode unik ${code}`);
			await expect(dialog.getByLabel("Nominal diterima")).toHaveValue(String(due));
			await dialog.getByLabel("Referensi mutasi bank").fill(bankReference);
			await expect(dialog.getByLabel("Rekening penerima")).toHaveValue(ACCOUNT.account_number);
			await dialog.getByLabel(/^Waktu transfer/).fill(jakarta);
			await dialog.getByLabel("Bukti", { exact: true }).fill("Mutasi Bank Contoh: kredit masuk sesuai nominal tepat");
			await dialog.getByLabel("Alasan", { exact: true }).fill("Nominal dan kode unik cocok dengan mutasi");
			// Denial: a wrong password issues no reauthentication proof and records nothing.
			await dialog.getByLabel("Konfirmasi kata sandi").fill(`${finance.password}x`);
			await dialog.getByRole("button", { name: "Simpan konfirmasi" }).click();
			await expect(dialog.getByRole("alert")).toBeVisible();
			assert.equal((await sql`select count(*)::int n from app.manual_bank_confirmation where attempt_id=${attempt.id}`)[0].n, 0);
			await dialog.getByLabel("Konfirmasi kata sandi").fill(finance.password);
			await capture(fp, "s92-payments-confirm-dialog-390");
			await dialog.getByRole("button", { name: "Simpan konfirmasi" }).click();
			await expect(fp.getByRole("status").filter({ hasText: `Transfer ${order.number} dicatat; status pesanan diperbarui setelah diproses.` })).toBeVisible();

			const [confirmation] = await sql`select amount,bank_reference,transferred_at from app.manual_bank_confirmation where attempt_id=${attempt.id}`;
			assert.ok(confirmation, "the confirmation is persisted");
			assert.equal(Number(confirmation.amount), due);
			assert.equal(new Date(confirmation.transferred_at).getTime(), transferredAt);
			for (const job of await sql`select callback_job_id from app.payment_provider_event where attempt_id=${attempt.id}`) {
				const [state] = await sql`select status from app.outbox_job where id=${job.callback_job_id}`;
				if (state.status === "pending") assert.equal((await runJob(job.callback_job_id)).status, "completed");
			}
			assert.equal((await sql`select payment_status from app.commerce_order where id=${order.id}`)[0].payment_status, "confirmed");
			const [receipt] = await sql`select amount,payment_charge,merchandise_amount from app.economic_receipt where order_id=${order.id}`;
			assert.equal(Number(receipt.amount), due);
			assert.equal(Number(receipt.payment_charge), code, "the code posts as its own receipt component");
			assert.equal((await sql`select coalesce(sum(merchandise_amount),0)::int value from app.commerce_event where order_id=${order.id} and name='Purchase'`)[0].value, Number(receipt.merchandise_amount), "Purchase stays merchandise-only");

			await fp.getByRole("tab", { name: "Sudah dicatat" }).click();
			const resolved = fp.getByTestId("manual-transfers").getByRole("row").filter({ hasText: order.number });
			await expect(resolved).toContainText("Lunas");
			await fp.setViewportSize({ width: 1440, height: 900 });
			await capture(fp, "s92-payments-resolved-1440");
			assert.deepEqual(desk.problems, []);
		} finally {
			await desk.context.close();
		}

		await page.reload();
		await expect(page.getByRole("heading", { name: "Pembayaran terkonfirmasi", exact: true })).toBeVisible();
		await expect(page.getByTestId("bank-transfer-instructions")).toHaveCount(0);
		assert.deepEqual(buyer.problems, []);
	} finally {
		await buyer.context.close();
	}
});

test("S92 built browser: COD checkout discloses the frozen 3.33% fee line and the COD settlement console lists the manual COD parcel with its fee-inclusive due", LONG, async () => {
	await syncClock();
	const { client, cart } = await guestCart(curated.products["cream-pair"], 1);
	const buyer = await asBuyer(client);
	try {
		const { page } = buyer;
		await page.goto(`${origin}/checkout`);
		await fillContact(page, /^COD/);
		const [quote] = await sql`select buyer_total,payment_charge_amount,cod_fee_bps,payment_method from app.checkout_quote where cart_id=${cart} order by created_at desc limit 1`;
		assert.equal(quote.payment_method, "cod");
		assert.equal(quote.cod_fee_bps, 333, "the quote freezes the rate in force");
		await expect(page.getByText("Tarif pengiriman 1 paket").first()).toBeAttached();
		const fee = Math.ceil((Number(quote.buyer_total) * 333) / 10000);
		assert.equal(Number(quote.payment_charge_amount), fee, "per-parcel ceil(base × 333 / 10000)");
		const line = page.locator(".checkout-charges > div").filter({ has: page.getByText("Biaya COD (3,33%)", { exact: true }) });
		await expect(line.filter({ visible: true }).first()).toContainText(rupiah(fee));
		await expect(page.locator(".checkout-charges .checkout-total").filter({ visible: true }).first()).toContainText(rupiah(Number(quote.buyer_total) + fee));
		await captureBoth(page, "s92-checkout-cod-review", true);
		assert.equal((await sql`select count(*)::int n from app.commerce_order where cart_id=${cart}`)[0].n, 0, "the review places no order");
		assert.deepEqual(buyer.problems, []);
	} finally {
		await buyer.context.close();
	}

	const keeper = await asStaff(staff);
	try {
		await keeper.page.goto(`${origin}/admin/cod-settlements`);
		await expect(keeper.page.getByRole("heading", { name: "Akses rekonsiliasi keuangan diperlukan" })).toBeVisible();
		assert.equal((await keeper.page.request.get(`${origin}/api/v1/admin/cod-collectible-parcels`)).status(), 403);
	} finally {
		await keeper.context.close();
	}

	const desk = await asStaff(finance);
	try {
		const { page } = desk;
		await page.goto(`${origin}/admin/cod-settlements`);
		await expect(page.getByRole("heading", { name: "Setoran COD Mengantar", level: 1 })).toBeVisible();
		await expect(page.getByTestId("cod-statements").or(page.getByText("Belum ada setoran COD Mengantar yang dicatat."))).toBeVisible();
		await captureBoth(page, "s92-cod-settlements");
		await page.getByRole("button", { name: "Catat setoran COD" }).click();
		const dialog = page.getByRole("dialog", { name: "Catat setoran COD Mengantar" });
		await expect(dialog).toBeVisible();
		assert.ok(s91, "the S91 case shipped a manual COD parcel");
		const parcel = dialog.getByRole("checkbox", { name: new RegExp(s91.number) });
		await expect(parcel).toHaveCount(1);
		await expect(dialog.locator(`label[for="cod-${s91.shipment}"]`)).toContainText(`${s91.resi} · tagihan ${rupiah(s91.codDue)}`);
		const [due] = await sql`select merchandise_amount,buyer_shipping,payment_charge,cod_due from app.order_shipment where id=${s91.shipment}`;
		const base = Number(due.merchandise_amount) + Number(due.buyer_shipping);
		assert.equal(Number(due.payment_charge), Math.ceil((base * 333) / 10000));
		assert.equal(Number(due.cod_due), base + Number(due.payment_charge), "the Mengantar remittance expectation includes the buyer COD fee");
		await parcel.check();
		await expect(dialog.getByLabel(`Nominal tertagih ${s91.number}`)).toHaveValue(String(s91.codDue));
		await captureBoth(page, "s92-cod-settlements-dialog");
		await dialog.getByRole("button", { name: "Batal" }).click();
		await expect(dialog).toHaveCount(0);
		assert.equal((await sql`select count(*)::int n from app.cod_remittance_line where shipment_id=${s91.shipment}`)[0].n, 0, "viewing records no statement");
		assert.deepEqual(desk.problems, []);
	} finally {
		await desk.context.close();
	}
});
