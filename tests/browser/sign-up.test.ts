import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import { challengeVerificationCode } from "../../src/modules/accounts/service.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { bootstrapGuest, capability, commerceActor, prefix, setCookie } from "../../src/modules/checkout/access.ts";
import { createCart } from "../../src/modules/checkout/carts.ts";
import { expireOwnedOrderJob } from "../../src/modules/checkout/expiry.ts";
import { releaseReservation } from "../../src/modules/inventory/reservations.ts";
import { seedCommerce } from "../../src/modules/local/commerce.ts";
import { advanceFixtureClock, readFixtureClock } from "../../src/modules/local/fixtures.ts";
import { prepareStorefront } from "../../src/modules/local/storefront.ts";
import { allOrderIssuedCookies, orderReceiptPath, recoverOrderReceipt } from "../../src/modules/orders/receipt.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { CommerceClient } from "../integration/checkout-fixture.ts";
import { resetBrowserAuthLimits } from "../integration/storefront-http-fixture.ts";

// S123 buyer sign-up against the built localhost server (127.0.0.1:3099) and the LOCAL database: the
// "Masuk / Daftar" switch in the modal and on /masuk, name-and-email sign-up (owner decision 2026-10-25),
// the uniform "check your email" answer, the set-password link that creates the password, the no-JS form
// posts, and the receipt's "Simpan pesanan ini ke akun" → sign-up → set password (signed in) → link-order
// path. Links are read from app.local_delivery (the local notification adapter), as the auth suites do.
// Every synthetic buyer is removed afterwards.
const origin = "http://127.0.0.1:3099";
const password = "99ribu123456";
const identity = createLocalAuth("local");
const created = new Set<string>();
const launch = () => chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const newEmail = (label: string) => { const email = `s123-${label}-${randomUUID().slice(0, 8)}@example.test`; created.add(email); return email; };
const focused = (page: Page, selector: string) => page.locator(selector).evaluate((el) => el === document.activeElement);

async function deliveries(email: string, kind: string) {
	return identity.sql<{ url: string }[]>`select url from app.local_delivery where recipient=${email} and kind=${kind} order by created_at desc, id desc`;
}
// The newest set-password link for an address.
async function activationUrl(email: string) {
	const [row] = await deliveries(email, "password_reset");
	assert.ok(row, `A set-password link was queued for ${email}`);
	return row.url;
}

test.before(async () => {
	await resetBrowserAuthLimits();
});

test.after(async () => {
	try {
		for (const email of created) {
			const [user] = await identity.sql<{ id: string }[]>`select id from app.auth_user where email=${email}`;
			if (user) {
				await identity.sql`delete from app.buyer_identity_challenge where user_id=${user.id}`;
				await identity.sql`delete from app.buyer_notification_preference where user_id=${user.id}`;
				await identity.sql`delete from app.buyer_address where user_id=${user.id}`;
				await identity.sql`delete from app.buyer_profile where user_id=${user.id}`;
				await cleanup(identity, [{ id: user.id, email }]);
			} else {
				await identity.sql`delete from app.outbox_job where kind='local.notification' and payload->>'deliveryId' in (select id::text from app.local_delivery where recipient=${email})`;
				await identity.sql`delete from app.local_delivery where recipient=${email}`;
			}
		}
	} finally { await identity.sql.end(); }
});

test("modal sign-up from /akun: name and email only, uniform check-email, the emailed link creates the password and signs in back to /akun", async () => {
	const email = newEmail("modal");
	const browser: Browser = await launch();
	try {
		const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${origin}/akun`);
		await page.locator("main").getByRole("link", { name: "Daftar", exact: true }).click();
		const modal = page.getByRole("dialog", { name: "Masuk atau daftar" });
		await modal.getByRole("heading", { name: "Buat akun 99ribu" }).waitFor();
		assert.equal(page.url(), `${origin}/masuk?langkah=daftar&next=%2Fakun`);
		assert.equal(await page.locator("main [data-testid=buyer-account-root]").count(), 1, "The page under the modal stays rendered");
		assert.equal(await modal.getByRole("link", { name: "Daftar", exact: true }).getAttribute("aria-current"), "page");
		assert.ok(await focused(page, "#signup-name"), "Focus starts in the name field");
		assert.equal(await modal.getByLabel("Kata sandi").count(), 0, "Sign-up asks no password (owner decision 2026-10-25)");
		assert.equal(await modal.getByLabel("Email").getAttribute("autocomplete"), "email");
		// The switch swaps forms in place (the modal stays open) and back.
		await modal.getByRole("link", { name: "Masuk", exact: true }).click();
		await modal.getByRole("heading", { name: "Masuk ke 99ribu" }).waitFor();
		assert.equal(page.url(), `${origin}/masuk?langkah=daftar&next=%2Fakun`, "Switching does not navigate");
		await modal.getByRole("link", { name: "Daftar", exact: true }).click();
		await modal.getByRole("button", { name: "Daftar", exact: true }).click();
		await modal.getByTestId("signup-error").getByText("Isi nama, email, dan nomor WhatsApp.").waitFor();
		assert.equal(await modal.getByLabel("Nama").getAttribute("aria-invalid"), "true");
		await modal.getByLabel("Nama").fill("Pembeli Uji");
		// Contact inputs (owner 2026-10-25): a typo domain gets a one-tap fix, the WhatsApp field keeps digits
		// only (a pasted +62 number shows as 08…) and refuses a landline before anything is sent.
		const emailField = modal.getByLabel("Email"), phoneField = modal.getByLabel("Nomor WhatsApp");
		assert.deepEqual([await phoneField.getAttribute("inputmode"), await phoneField.getAttribute("autocomplete")], ["numeric", "tel"]);
		await emailField.fill("pembeli@gmial.com");
		await modal.getByTestId("email-suggestion").getByRole("button", { name: "pembeli@gmail.com" }).click();
		assert.equal(await emailField.inputValue(), "pembeli@gmail.com");
		await emailField.fill(email);
		await phoneField.fill("+62 812-3456-7890");
		assert.equal(await phoneField.inputValue(), "081234567890");
		await phoneField.fill("0215550123");
		await modal.getByRole("button", { name: "Daftar", exact: true }).click();
		await modal.getByTestId("signup-error").getByText("Masukkan nomor WhatsApp (diawali 08).").waitFor();
		assert.equal(await phoneField.getAttribute("aria-invalid"), "true");
		await phoneField.fill("081234567890");
		const answer = page.waitForResponse((response) => response.url().endsWith("/api/auth/sign-up/email"));
		await modal.getByRole("button", { name: "Daftar", exact: true }).click();
		const first = await answer;
		const sent = modal.getByTestId("signup-sent");
		await sent.getByRole("heading", { name: "Cek email Anda untuk verifikasi" }).waitFor();
		await expect(sent).toContainText(email);
		await expect(sent.getByTestId("resend-button")).toBeDisabled();
		await expect(sent.getByTestId("resend-button")).toHaveText(/Kirim ulang dalam 0:5\d|Kirim ulang dalam 1:00/);
		assert.equal(first.status(), 200);
		const firstBody = await first.json();
		assert.equal(new URL(await activationUrl(email)).searchParams.get("callbackURL"), "/masuk/atur-sandi?aktivasi=1&next=%2Fakun", "The link carries next");
		assert.equal((await deliveries(email, "verification")).length, 0, "Sign-up never sends a plain verification link");
		assert.equal((await identity.sql`select email_verified from app.auth_user where email=${email}`)[0].email_verified, false);

		// The same email again, on the /masuk page: the same answer and screen. Still unverified, so the address
		// gets another set-password link, never a second account.
		const again = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		await again.goto(`${origin}/masuk?langkah=daftar&next=%2Fakun`);
		await again.getByLabel("Nama").fill("Orang Lain");
		await again.getByLabel("Email").fill(email);
		await again.getByLabel("Nomor WhatsApp").fill("089876543210");
		const duplicateAnswer = again.waitForResponse((response) => response.url().endsWith("/api/auth/sign-up/email"));
		await again.getByRole("button", { name: "Daftar", exact: true }).click();
		const duplicate = await duplicateAnswer;
		assert.equal(duplicate.status(), first.status());
		assert.deepEqual(await duplicate.json(), firstBody);
		await again.getByTestId("signup-sent").getByRole("heading", { level: 1, name: "Cek email Anda untuk verifikasi" }).waitFor();
		assert.equal((await identity.sql`select id from app.auth_user where email=${email}`).length, 1);
		assert.deepEqual([(await deliveries(email, "existing_account")).length, (await deliveries(email, "password_reset")).length], [0, 2]);
		await again.close();

		// The emailed link: "Buat kata sandi", then a signed-in return to /akun.
		await page.goto(await activationUrl(email));
		await page.waitForURL(`${origin}/masuk/atur-sandi?aktivasi=1&next=%2Fakun`);
		assert.ok(!page.url().includes("token="), "The token leaves the address bar");
		await page.getByRole("heading", { level: 1, name: "Buat kata sandi" }).waitFor();
		await expect(page.getByTestId("set-password")).toContainText(email);
		assert.equal(await page.locator('meta[name="referrer"]').getAttribute("content"), "strict-origin", "The token never leaves as a Referer path; Origin stays set for the form post");
		const field = page.getByLabel("Kata sandi", { exact: true });
		assert.equal(await field.getAttribute("autocomplete"), "new-password");
		await field.fill("pendek");
		await expect(page.locator("#set-password-hint")).toHaveText("Minimal 12 karakter, kurang 6 lagi.");
		const reveal = page.getByRole("button", { name: "Tampilkan kata sandi" });
		await reveal.click();
		assert.equal(await field.getAttribute("type"), "text");
		assert.equal(await reveal.getAttribute("aria-pressed"), "true");
		await page.getByRole("button", { name: "Buat kata sandi" }).click();
		await page.getByTestId("set-password-error").getByText("Kata sandi minimal 12 karakter.").waitFor();
		await field.fill(password);
		await expect(page.locator("#set-password-hint")).toHaveText("Panjang kata sandi sudah cukup.");
		await page.getByRole("button", { name: "Buat kata sandi" }).click();
		await page.waitForURL(`${origin}/akun/pesanan`);
		await page.getByTestId("sign-out-button").first().waitFor();
		assert.equal((await identity.sql`select email_verified from app.auth_user where email=${email}`)[0].email_verified, true);
		// Profil shows the sign-up WhatsApp number masked (stored +62…, shown 08…); "Ubah" opens the form.
		await page.getByRole("link", { name: "Profil", exact: true }).click();
		await page.waitForURL(`${origin}/akun/profil`);
		await expect(page.getByTestId("profile-phone")).toHaveText("08••••••7890");
		await page.getByTestId("profile-edit-button").click();
		await page.getByTestId("profile-phone-edit").click();
		await page.getByTestId("profile-phone-input").fill("+6281299990000");
		await expect(page.getByTestId("profile-phone-input")).toHaveValue("081299990000");
		await page.getByTestId("profile-save-button").click();
		await expect(page.getByTestId("profile-phone")).toHaveText("08••••••0000");
		const [profile] = await identity.sql`select p.phone, p.phone_verified_at from app.buyer_profile p join app.auth_user u on u.id=p.user_id where u.email=${email}`;
		assert.deepEqual([profile.phone, profile.phone_verified_at], ["+6281299990000", null]);
		assert.deepEqual(errors, []);
	} finally { await browser.close(); }
});

test("link landings: a dead set-password link and a bad verification link show their recovery with a resend form", async () => {
	const browser = await launch();
	try {
		const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
		await page.goto(`${origin}/masuk/atur-sandi?aktivasi=1&next=%2Fakun&token=notALiveToken12345`);
		await page.getByRole("heading", { level: 1, name: "Tautan tidak berlaku" }).waitFor();
		assert.equal(await page.getByRole("link", { name: "Sudah membuat kata sandi? Masuk" }).getAttribute("href"), "/masuk?next=%2Fakun");
		const email = newEmail("landing");
		await page.getByLabel("Email").fill(email);
		await page.getByTestId("resend-button").click();
		// The same answer whether or not the address waits for verification (this one has no account).
		await page.getByTestId("resend-status").getByText("Jika alamat ini menunggu verifikasi, kami mengirim tautan untuk mengatur kata sandi dan mengaktifkan akun.").waitFor();
		assert.equal((await deliveries(email, "verification")).length + (await deliveries(email, "password_reset")).length, 0);
		// Legacy verification links (harness accounts) still land on /masuk/verifikasi.
		const callback = encodeURIComponent("/masuk/verifikasi?next=%2Fakun");
		await page.goto(`${origin}/api/auth/verify-email?token=not-a-token&callbackURL=${callback}`);
		await page.waitForURL(/\/masuk\/verifikasi\?next=%2Fakun&error=INVALID_TOKEN$/);
		await expect(page.getByTestId("verify-landing")).toHaveAttribute("data-state", "invalid");
		assert.equal(await page.getByRole("dialog").count(), 0);
	} finally { await browser.close(); }
});

test("without JavaScript: the switch is a link, sign-up and resend post to /masuk/kirim, the link creates the password, no form values in URLs", async () => {
	const email = newEmail("nojs");
	const browser = await launch();
	try {
		const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
		const page = await context.newPage();
		await page.goto(`${origin}/masuk?next=%2Fakun`);
		await page.getByRole("link", { name: "Daftar", exact: true }).click();
		await page.waitForURL(`${origin}/masuk?langkah=daftar&next=%2Fakun`);
		assert.equal(await page.locator("form.signin-card").getAttribute("action"), "/masuk/kirim");
		await page.getByRole("button", { name: "Daftar", exact: true }).click();
		await page.getByTestId("signup-error").getByText("Isi nama, email, dan nomor WhatsApp.").waitFor();
		await page.getByLabel("Nama").fill("Pembeli Tanpa JS");
		await page.getByLabel("Email").fill(email);
		await page.getByLabel("Nomor WhatsApp").fill("081234567890");
		await page.getByRole("button", { name: "Daftar", exact: true }).click();
		await page.waitForURL(`${origin}/masuk?langkah=cek-email&next=%2Fakun`);
		await page.getByRole("heading", { level: 1, name: "Cek email Anda untuk verifikasi" }).waitFor();
		assert.ok(!page.url().includes("s123-"), "No email in the URL");
		// No JS: the resend form asks for the email.
		await page.getByLabel("Email").fill(email);
		await page.getByRole("button", { name: "Kirim ulang email" }).click();
		await page.waitForURL(`${origin}/masuk?langkah=cek-email&next=%2Fakun&ulang=1`);
		await page.getByTestId("resend-status").waitFor();
		assert.deepEqual([(await deliveries(email, "verification")).length, (await deliveries(email, "password_reset")).length], [0, 2]);
		// The newest link creates the password without JS; the token stays only while a retry needs it.
		const link = await activationUrl(email);
		await page.goto(link);
		await page.waitForURL(/\/masuk\/atur-sandi\?aktivasi=1&next=%2Fakun&token=[A-Za-z0-9_-]+$/);
		await page.getByRole("heading", { level: 1, name: "Buat kata sandi" }).waitFor();
		assert.equal(await page.locator('meta[name="referrer"]').getAttribute("content"), "strict-origin", "The token never leaves as a Referer path; Origin stays set for the form post");
		await page.getByLabel("Kata sandi", { exact: true }).fill("pendek");
		await page.getByRole("button", { name: "Buat kata sandi" }).click();
		await page.getByTestId("set-password-error").getByText("Kata sandi minimal 12 karakter.").waitFor();
		await page.getByLabel("Kata sandi", { exact: true }).fill(password);
		await page.getByRole("button", { name: "Buat kata sandi" }).click();
		await page.waitForURL(`${origin}/masuk/atur-sandi?aktivasi=1&next=%2Fakun&selesai=1`);
		await page.getByRole("heading", { level: 1, name: "Akun sudah aktif" }).waitFor();
		assert.equal((await identity.sql`select email_verified from app.auth_user where email=${email}`)[0].email_verified, true);
		await page.getByTestId("set-password-done").getByRole("link", { name: "Masuk", exact: true }).click();
		await page.waitForURL(`${origin}/masuk?next=%2Fakun`);
		await page.getByLabel("Email").fill(email);
		await page.getByLabel("Kata sandi").fill(password);
		await page.getByRole("button", { name: "Masuk", exact: true }).click();
		await page.waitForURL(`${origin}/akun/pesanan`);
		// A used link shows the invalid state with a resend form.
		await page.goto(link);
		await page.getByRole("heading", { level: 1, name: "Tautan tidak berlaku" }).waitFor();
		await context.close();
	} finally { await browser.close(); }
});


// Form encoding drops the JSON-only CSRF layer, so the Origin check must stop a cross-site sign-up
// before any account, email or cookie; size and content-type limits answer first.
test("/masuk/kirim sign-up and resend refuse cross-site posts, wrong content types and oversized bodies", async () => {
	const email = newEmail("forged");
	for (const step of ["signup", "resend"]) {
		const response = await fetch(`${origin}/masuk/kirim`, {
			method: "POST", redirect: "manual",
			headers: { origin: "http://evil.example", "content-type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({ step, name: "Forged", email, phone: "081234567890", next: "/akun" }),
		});
		assert.equal(response.status, 303, step);
		const location = new URL(response.headers.get("location") ?? "", origin);
		assert.equal(location.pathname, "/masuk");
		assert.equal(location.searchParams.get("galat"), "origin");
		assert.equal(location.searchParams.get("langkah"), step === "signup" ? "daftar" : "cek-email");
		assert.deepEqual(response.headers.getSetCookie(), []);
	}
	assert.equal((await identity.sql`select id from app.auth_user where email=${email}`).length, 0);
	assert.equal((await deliveries(email, "verification")).length + (await deliveries(email, "password_reset")).length, 0);
	const json = await fetch(`${origin}/masuk/kirim`, { method: "POST", redirect: "manual", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ step: "signup" }) });
	assert.equal(json.status, 415);
	const large = await fetch(`${origin}/masuk/kirim`, { method: "POST", redirect: "manual", headers: { origin, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ step: "signup", name: "x".repeat(5000) }) });
	assert.equal(large.status, 413);
});

// Receipt → "Simpan pesanan ini ke akun" → sign-up (name and email pre-filled) → the emailed link creates
// the password and signs in back to the receipt → link the order with the guest-order-link challenge (the code a local test derives, as the
// buyer-account suite does) → the receipt opens for the account.
test("post-checkout prompt: save the guest order to a new account and link it", { timeout: 120_000 }, async () => {
	const namespace = `s123-${randomUUID().slice(0, 8)}`;
	const owner = await actor(identity, "owner", []);
	await enroll(owner.browser, owner.password);
	const request = () => owner.browser.request("/api/v1/admin/products");
	const seeded = await seedCommerce(request(), identity, "local", namespace);
	const curated = await prepareStorefront(request(), identity, "local", namespace, seeded);
	const clock = await readFixtureClock("local", namespace), seconds = Math.ceil((Date.now() - Date.parse(clock.now)) / 1000);
	if (seconds > 0) await advanceFixtureClock("local", namespace, seconds, clock.version);
	const email = newEmail("order");
	const product = curated.products["shirt-cream"];
	assert.ok(product.publication_id);
	const client = new CommerceClient(identity), boot = new Response(null);
	await bootstrapGuest(identity, boot, new Request(`${origin}/api/v1/carts`, { method: "POST" }));
	client.absorb(boot);
	const body = { lines: [{ variant_id: product.offer_id, quantity: 1, expected_publication_id: product.publication_id }] };
	const cartRequest = client.request("/api/v1/carts", body, { key: randomUUID() }), guest = await commerceActor(cartRequest, identity);
	assert.ok(guest?.kind === "guest");
	const cart = await identity.sql.begin((tx) => createCart(tx, cartRequest, identity, guest, body, { clock_namespace: namespace }));
	const access = new Response(null);
	setCookie(access, `${await prefix(identity)}.cart_access`, `${cart.cart.id}.${await capability(identity, "cart", cart.cart.id, guest.id, cart.cart.cap_issued_at as string)}`);
	client.absorb(access);
	const browser = await launch();
	try {
		const quote = await client.call("/api/v1/checkout/quotes", { cart_id: cart.cart.id, address: { recipient_name: "Penerima Contoh", phone: "+6281200000000", address_line: "Jalan Contoh 12 RT 01", destination_id: "test-malang", postal_code: "00001" }, contact: { phone: "+6281200000000", email }, payment_method: "prepaid" }, { version: 1 });
		assert.equal(quote.response.status, 201);
		const submitted = await client.call("/api/v1/orders", { quote_id: quote.payload.id, buyer_note: "Titip di penerima" }, { version: 1 });
		assert.equal(submitted.response.status, 201);
		const order = submitted.payload.order, path = orderReceiptPath(order.id);
		const recovered = await recoverOrderReceipt(client.request(path, {}), identity, order.id);
		for (const entry of await allOrderIssuedCookies(identity, order.id, recovered.cookies)) client.cookies.set(`${entry.name}:${entry.path}`, { name: entry.name, value: entry.value, path: entry.path });
		const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
		await context.addCookies([...client.cookies.values()].map((c) => ({ name: c.name, value: c.value, domain: "127.0.0.1", path: c.path, httpOnly: true, sameSite: "Lax" as const, secure: false })));
		const page = await context.newPage();
		page.setDefaultTimeout(15000);
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.goto(`${origin}${path}`);
		const card = page.getByTestId("order-save-card");
		await card.getByRole("heading", { name: "Simpan pesanan ini ke akun" }).waitFor();
		await card.getByTestId("order-save-signup").click();
		const modal = page.getByRole("dialog", { name: "Masuk atau daftar" });
		await modal.getByRole("heading", { name: "Buat akun 99ribu" }).waitFor();
		assert.equal(new URL(page.url()).searchParams.get("next"), path);
		assert.equal(await modal.getByLabel("Email").inputValue(), email, "The order's contact email is pre-filled");
		assert.equal(await modal.getByLabel("Nomor WhatsApp").inputValue(), "081200000000", "The order contact phone is pre-filled in the local 08 form");
		assert.equal(await modal.getByLabel("Nama").inputValue(), "Penerima Contoh", "The order's recipient name is pre-filled");
		assert.ok(!page.url().includes("s123-"), "The email never goes into the URL");
		await modal.getByRole("button", { name: "Daftar", exact: true }).click();
		await modal.getByTestId("signup-sent").waitFor();
		const link = new URL(await activationUrl(email));
		assert.equal(link.searchParams.get("callbackURL"), `/masuk/atur-sandi?aktivasi=1&next=${encodeURIComponent(path)}`);
		await page.goto(link.href);
		await page.getByRole("heading", { level: 1, name: "Buat kata sandi" }).waitFor();
		await page.getByLabel("Kata sandi", { exact: true }).fill(password);
		await page.getByRole("button", { name: "Buat kata sandi" }).click();
		// Creating the password signs in and returns to the receipt.
		await page.waitForURL(`${origin}${path}`);
		// Signing in ends the guest access; the receipt offers the link challenge with the account email.
		const linkCard = page.getByTestId("order-link-card");
		await linkCard.getByRole("heading", { name: "Hubungkan pesanan ini ke akun" }).waitFor();
		await expect(linkCard).toContainText(email);
		const challengeAnswer = page.waitForResponse((response) => response.url().endsWith("/api/v1/me/guest-order-link-challenges"));
		await linkCard.getByTestId("order-link-send").click();
		const challenge = await (await challengeAnswer).json();
		assert.ok(typeof challenge.challenge_id === "string");
		await linkCard.getByTestId("order-link-message").getByText(`Kode dikirim ke ${email}.`, { exact: false }).waitFor();
		const code = await challengeVerificationCode(identity, challenge.challenge_id);
		await linkCard.getByLabel("Kode verifikasi").fill(code === "123456" ? "654321" : "123456");
		await linkCard.getByTestId("order-link-verify").click();
		await linkCard.getByTestId("order-link-message").getByText("Kode tidak cocok.", { exact: false }).waitFor();
		await linkCard.getByLabel("Kode verifikasi").fill(code);
		const reload = page.waitForEvent("load");
		await linkCard.getByTestId("order-link-verify").click();
		await reload;
		await expect(page.getByText(order.number, { exact: false }).first()).toBeVisible();
		await expect(page.getByTestId("order-link-card")).toHaveCount(0);
		await expect(page.getByTestId("order-save-card")).toHaveCount(0);
		assert.deepEqual(errors, []);
		await page.request.post(`${origin}/api/auth/sign-out`, { headers: { origin }, data: {} });
	} finally {
		await browser.close();
		const orders = await identity.sql`select id from app.commerce_order where cart_id=${cart.cart.id} and clock_namespace=${namespace} and status='pending' and payment_status='pending'`;
		if (orders.length) {
			const now = await readFixtureClock("local", namespace);
			await advanceFixtureClock("local", namespace, 1860, now.version);
			for (const order of orders) {
				const [job] = await identity.sql`select id,kind,payload from app.outbox_job where kind='checkout.order.expire' and payload->>'orderId'=${order.id} and status='ready'`;
				if (job) await identity.sql.begin((tx) => expireOwnedOrderJob(tx, { id: job.id, kind: job.kind, payload: job.payload }));
			}
		}
		for (const reservation of Object.values(seeded.reservations)) {
			await identity.sql.begin((tx) => releaseReservation(tx, reservation, "Owned S123 browser fixture finished"));
			await identity.sql`delete from app.outbox_job where kind='inventory.reservation.expire' and payload->>'reservationId'=${reservation}`;
		}
		await cleanup(identity, [owner]);
	}
});
