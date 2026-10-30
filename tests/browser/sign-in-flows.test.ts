import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { type Browser, chromium, type Page } from "@playwright/test";
import { resetBrowserAuthLimits } from "../integration/storefront-http-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S112: /masuk as an intercepted modal over storefront pages and as a plain form without JavaScript.
// Built localhost server (127.0.0.1:3099) + local database; `login local` resets the dummy accounts.
const origin = "http://127.0.0.1:3099";
const exec = promisify(execFile);
const seed = async (args: string[]) => JSON.parse((await exec(process.execPath, ["--env-file=.env.example", "scripts/seed.ts", ...args], { timeout: 25000 })).stdout);
type Account = { email: string; password: string };
let accounts: Account[] = [];
const account = (email: string) => { const found = accounts.find((item) => item.email === email); assert.ok(found, email); return found; };
// A current TOTP code with at least 3 seconds left in its window.
async function code(email: string): Promise<string> {
	const result = await seed(["login-codes", "local"]);
	if (result.valid_for_seconds < 3) { await new Promise((resolve) => setTimeout(resolve, result.valid_for_seconds * 1000 + 200)); return code(email); }
	return result.codes.find((item: { email: string }) => item.email === email).code;
}
const session = async (page: Page) => (await page.context().cookies()).find((item) => item.name === "99ribu-local.session_token");
const launch = () => chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
const focused = (page: Page, selector: string) => page.locator(selector).evaluate((el) => el === document.activeElement || el.contains(document.activeElement));

test.before(async () => {
	accounts = (await seed(["login", "local"])).accounts;
	await resetBrowserAuthLimits();
});

test("modal over a storefront page: focus stays inside, Escape and close return focus, reload shows the page", async () => {
	const browser: Browser = await launch();
	try {
		const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		// Signed-out /akun holds the forms inline (owner 2026-10-29); the home hero still opens the modal.
		await page.goto(`${origin}/`);
		const trigger = page.locator("main").getByRole("link", { name: "Masuk", exact: true });
		await trigger.focus();
		await page.keyboard.press("Enter");
		const modal = page.getByRole("dialog", { name: "Masuk" });
		await modal.waitFor();
		assert.equal(page.url(), `${origin}/masuk`);
		assert.equal(await page.locator("main.home-main").count(), 1, "The page under the modal stays rendered");
		assert.ok(await focused(page, "#signin-email"), "Focus starts in the email field");
		assert.equal(await modal.getByLabel("Email").getAttribute("autocomplete"), "username");
		assert.equal(await modal.getByLabel("Kata sandi").getAttribute("autocomplete"), "current-password");
		for (const key of ["Tab", "Tab", "Tab", "Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab", "Shift+Tab"]) {
			await page.keyboard.press(key);
			assert.ok(await focused(page, "[data-testid=signin-modal]"), `Focus left the modal after ${key}`);
		}
		await page.screenshot({ path: `${RENDERS}/s112/test-modal-1440.png` });
		await page.keyboard.press("Escape");
		await modal.waitFor({ state: "detached" });
		await page.waitForURL(`${origin}/`);
		assert.ok(await trigger.evaluate((el) => el === document.activeElement), "Escape returns focus to the link that opened the modal");
		await trigger.click();
		await modal.getByRole("button", { name: "Tutup" }).click();
		await modal.waitFor({ state: "detached" });
		assert.equal(page.url(), `${origin}/`);
		// A reload (or a shared link) of the modal URL renders the dedicated page, not a modal.
		await trigger.click();
		await modal.waitFor();
		await page.reload();
		await page.getByRole("heading", { level: 1, name: "Masuk ke 99ribu" }).waitFor();
		assert.equal(await page.getByRole("dialog").count(), 0);
		assert.deepEqual(errors, []);
	} finally { await browser.close(); }
});

test("buyer signs in with the inline /akun form and returns to the account (?next=/akun)", async () => {
	const buyer = account("pembeli2@99ribu.test");
	const browser = await launch();
	try {
		const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
		await page.goto(`${origin}/akun`);
		const modal = page.locator("main .signin-forms");
		await modal.getByRole("heading", { level: 1, name: "Masuk ke 99ribu" }).waitFor();
		await modal.getByLabel("Email").fill(buyer.email);
		await modal.getByLabel("Kata sandi").fill("not-the-password-123");
		await modal.getByRole("button", { name: "Masuk", exact: true }).click();
		await modal.getByTestId("signin-error").getByText("Email atau kata sandi tidak cocok").waitFor();
		assert.equal(await modal.getByLabel("Kata sandi").getAttribute("aria-invalid"), "true");
		await modal.getByLabel("Kata sandi").fill(buyer.password);
		await modal.getByRole("button", { name: "Masuk", exact: true }).click();
		await page.waitForURL(`${origin}/akun/pesanan`);
		await page.getByTestId("sign-out-button").first().waitFor();
		assert.ok(await session(page));
	} finally { await browser.close(); }
});

test("staff passes the TOTP step inside the modal opened from the home hero and stays on that page", async () => {
	const staff = account("cs@99ribu.test");
	const browser = await launch();
	try {
		const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
		await page.goto(`${origin}/`);
		await page.locator("main").getByRole("link", { name: "Masuk", exact: true }).click();
		const modal = page.getByRole("dialog", { name: "Masuk" });
		await modal.waitFor();
		assert.equal(page.url(), `${origin}/masuk`);
		await modal.getByLabel("Email").fill(staff.email);
		await modal.getByLabel("Kata sandi").fill(staff.password);
		await modal.getByRole("button", { name: "Masuk", exact: true }).click();
		const field = modal.getByLabel("Kode autentikator");
		await field.waitFor();
		assert.ok(await field.evaluate((el) => el === document.activeElement), "The code field takes focus");
		assert.equal(await field.getAttribute("autocomplete"), "one-time-code");
		assert.equal(await field.getAttribute("inputmode"), "numeric");
		await field.fill(await code(staff.email));
		await modal.getByRole("button", { name: "Verifikasi" }).click();
		// No `next`: the modal closes and the page it covered reloads with the new session.
		await page.waitForURL(`${origin}/`);
		await page.locator(".hero-primary", { hasText: "Lihat produk" }).waitFor();
		assert.ok(await session(page));
		assert.equal(await page.getByRole("dialog").count(), 0);
	} finally { await browser.close(); }
});

test("without JavaScript the page posts a plain form: errors, rate-limit copy, buyer and staff TOTP return to ?next=", async () => {
	const buyer = account("pembeli@99ribu.test"), staff = account("gudang@99ribu.test");
	const browser = await launch();
	try {
		const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
		const page = await context.newPage();
		await page.goto(`${origin}/masuk?next=%2Fakun`);
		assert.equal(await page.locator("form.signin-card").getAttribute("action"), "/masuk/kirim");
		await page.getByLabel("Email").fill(buyer.email);
		await page.getByLabel("Kata sandi").fill("not-the-password-123");
		await page.getByRole("button", { name: "Masuk", exact: true }).click();
		await page.getByTestId("signin-error").getByText("Email atau kata sandi tidak cocok").waitFor();
		assert.equal(new URL(page.url()).searchParams.get("next"), "/akun");
		assert.ok(!page.url().includes("pembeli"), "The email never goes into the URL");
		assert.equal(await page.getByLabel("Kata sandi").getAttribute("aria-invalid"), "true");
		await page.getByLabel("Email").fill(buyer.email);
		await page.getByLabel("Kata sandi").fill(buyer.password);
		await page.getByRole("button", { name: "Masuk", exact: true }).click();
		await page.waitForURL(`${origin}/akun/pesanan`);
		assert.ok(await session(page));
		await context.clearCookies();
		// Staff: an old /masuk console link moves to /portal; password, then the TOTP step as its own page, then the console deep link.
		await page.goto(`${origin}/masuk?next=%2Fadmin%2Fpesanan%2Fcetak-label`);
		await page.waitForURL(`${origin}/portal?next=%2Fadmin%2Fpesanan%2Fcetak-label`);
		await page.getByLabel("Email").fill(staff.email);
		await page.getByLabel("Kata sandi").fill(staff.password);
		await page.getByRole("button", { name: "Masuk", exact: true }).click();
		await page.waitForURL(/\/portal\?langkah=kode&next=%2Fadmin%2Fpesanan%2Fcetak-label$/);
		assert.equal(await page.getByRole("link", { name: "Pakai kode cadangan" }).getAttribute("href"), "/portal?langkah=cadangan&next=%2Fadmin%2Fpesanan%2Fcetak-label");
		await page.getByLabel("Kode autentikator").fill("12");
		await page.getByRole("button", { name: "Verifikasi" }).click();
		await page.getByTestId("signin-error").getByText("Masukkan 6 digit kode dari aplikasi autentikator.").waitFor();
		await page.getByLabel("Kode autentikator").fill(await code(staff.email));
		await page.getByRole("button", { name: "Verifikasi" }).click();
		await page.waitForURL(`${origin}/admin/pesanan/cetak-label`);
		// Rate-limit copy reaches the no-JS page through the redirect (the limit itself is proven in auth tests).
		await context.clearCookies();
		await page.route("**/masuk/kirim", (route) => route.fulfill({ status: 303, headers: { location: "/masuk?next=%2Fakun&galat=limit&tunggu=120" } }));
		await page.goto(`${origin}/masuk?next=%2Fakun`);
		await page.getByLabel("Email").fill(buyer.email);
		await page.getByLabel("Kata sandi").fill(buyer.password);
		await page.getByRole("button", { name: "Masuk", exact: true }).click();
		await page.getByTestId("signin-error").getByText("Terlalu banyak percobaan. Coba lagi dalam 2 menit.", { exact: true }).waitFor();
		assert.equal(await page.getByLabel("Kata sandi").getAttribute("aria-invalid"), null, "A rate limit does not blame the password");
		await page.screenshot({ path: `${RENDERS}/s112/test-nojs-limit-390.png` });
	} finally { await browser.close(); }
});

// Security review (S112): form encoding drops the JSON-only CSRF layer, so the Origin check is the
// one that stops a cross-site form post; it must answer before any auth effect or cookie.
test("a cross-site form post to /masuk/kirim is refused without a cookie", async () => {
	const response = await fetch(`${origin}/masuk/kirim`, {
		method: "POST",
		redirect: "manual",
		headers: { origin: "http://evil.example", "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ step: "password", email: "nobody@example.invalid", password: "x".repeat(12), next: "/akun" }),
	});
	assert.equal(response.status, 303);
	const location = new URL(response.headers.get("location") ?? "", origin);
	assert.equal(location.pathname, "/masuk");
	assert.equal(location.searchParams.get("galat"), "origin");
	assert.deepEqual(response.headers.getSetCookie(), []);
});
