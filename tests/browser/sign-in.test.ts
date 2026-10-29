import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { safeReturnPath, signInDestination } from "../../src/modules/access/return-to.ts";
import { LOCAL_ACCOUNTS } from "../../src/modules/local/logins.ts";
import { totp } from "../../src/modules/local/synthetic-session.ts";
import { resetBrowserAuthLimits } from "../integration/storefront-http-fixture.ts";

// Built localhost server (127.0.0.1:3099) + local database. `login local` is idempotent: it keeps the
// local accounts' TOTP enrollment and resets their documented dummy passwords.
const origin = "http://127.0.0.1:3099";
const exec = promisify(execFile);
const cli = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
	exec(process.execPath, ["--env-file=.env.example", "scripts/seed.ts", ...args], { timeout: 25000, env })
		.then(({ stdout }) => ({ code: 0, stdout }), (error: { code?: number; stdout?: string }) => ({ code: error.code ?? 1, stdout: error.stdout ?? "" }));
type Account = { email: string; password: string; mfa: boolean; landing: string; totp_uri?: string };
let accounts: Account[] = [];

test("return destination accepts only same-origin relative paths and routes by role", () => {
	for (const hostile of ["https://evil.invalid/", "//evil.invalid/admin", "/\\evil.invalid", "javascript:alert(1)", "/admin\n", "/api/auth/sign-out", "/masuk?next=/admin", "admin", "", 42, ["/admin"]]) {
		assert.equal(safeReturnPath(hostile), null, String(hostile));
	}
	assert.equal(safeReturnPath("/pesanan/abc?tab=1#x"), "/pesanan/abc?tab=1#x");
	assert.equal(signInDestination(null, true), "/admin");
	assert.equal(signInDestination(null, false), "/akun");
	assert.equal(signInDestination("/admin/pesanan/cetak-label", false), "/akun");
	assert.equal(signInDestination("/afiliasi", false), "/afiliasi");
});

test("local account commands refuse every non-local target without printing credentials", async () => {
	const refused = [
		await cli(["login", "test"]),
		await cli(["login", "local"], { ...process.env, APP_ENV: "production" }),
		await cli(["login-codes", "test"]),
		await cli(["prune-accounts", "test", "--apply"]),
		await cli(["prune-accounts", "local", "--force"]),
	];
	for (const result of refused) {
		assert.notEqual(result.code, 0);
		assert.ok(LOCAL_ACCOUNTS.every((account) => !result.stdout.includes(account.password)) && !result.stdout.includes("otpauth"));
	}
});

test("login sets each role's dummy password and enrolls TOTP for staff only", async () => {
	const result = await cli(["login", "local"]);
	assert.equal(result.code, 0);
	accounts = JSON.parse(result.stdout).accounts;
	assert.deepEqual(accounts.map((account) => account.email), LOCAL_ACCOUNTS.map((account) => account.email));
	for (const account of accounts) {
		assert.equal(account.mfa, account.landing === "/admin", account.email);
		assert.equal(Boolean(account.totp_uri), account.mfa, account.email);
	}
	const codes = JSON.parse((await cli(["login-codes", "local"])).stdout);
	assert.equal(codes.codes.length, 5);
});

test("prune dry run reports without deleting and never lists the local accounts", async () => {
	const result = await cli(["prune-accounts", "local"]);
	assert.equal(result.code, 0);
	const report = JSON.parse(result.stdout);
	assert.equal(report.applied, false);
	assert.ok(!result.stdout.includes("99ribu.test"));
	assert.equal(JSON.parse((await cli(["login-codes", "local"])).stdout).codes.length, 5);
});

test("staff signs in through /masuk with the TOTP step and lands on /admin", async () => {
	await resetBrowserAuthLimits();
	const owner = accounts.find((account) => account.email === "owner@99ribu.test");
	assert.ok(owner?.totp_uri);
	const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	try {
		const page = await browser.newPage();
		assert.equal((await page.goto(`${origin}/masuk`))?.status(), 200);
		await page.getByLabel("Email").fill(owner.email);
		await page.getByLabel("Kata sandi").fill("not-the-password-123");
		await page.getByRole("button", { name: "Masuk", exact: true }).click();
		await page.getByTestId("signin-error").getByText("Email atau kata sandi tidak cocok").waitFor();
		await page.getByLabel("Kata sandi").fill(owner.password);
		await page.getByRole("button", { name: "Masuk", exact: true }).click();
		await page.getByLabel("Kode autentikator").fill(totp(owner.totp_uri));
		await page.getByRole("button", { name: "Verifikasi" }).click();
		await page.waitForURL(`${origin}/admin`);
		await page.getByTestId("admin-account").getByText(owner.email).waitFor();
		const cookie = (await page.context().cookies()).find((item) => item.name === "99ribu-local.session_token");
		assert.ok(cookie?.httpOnly && cookie.sameSite === "Lax");
		// Already signed in: /masuk routes straight to the role home instead of showing the form.
		await page.goto(`${origin}/masuk`);
		await page.waitForURL(`${origin}/admin`);
		// S128: sign-out lives in the sidebar account menu.
		await page.getByRole("button", { name: /^Menu akun/ }).click();
		await page.getByTestId("sign-out-button").click();
		await page.waitForURL(/\/masuk\?next=%2Fadmin$/);
		await page.getByLabel("Email").waitFor();
	} finally { await browser.close(); }
});

test("buyer signs in without MFA, ignores an off-site next and lands on /account", async () => {
	const buyer = accounts.find((account) => account.email === "pembeli@99ribu.test");
	assert.ok(buyer && !buyer.totp_uri);
	const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	try {
		const page = await browser.newPage();
		await page.goto(`${origin}/masuk?next=${encodeURIComponent("https://evil.invalid/")}`);
		await page.getByLabel("Email").fill(buyer.email);
		await page.getByLabel("Kata sandi").fill(buyer.password);
		await page.getByRole("button", { name: "Masuk", exact: true }).click();
		await page.waitForURL(`${origin}/akun/pesanan`);
		await page.getByTestId("sign-out-button").waitFor();
		// A buyer asked to return to the console is offered an account switch, not a staff session.
		await page.goto(`${origin}/masuk?next=%2Fadmin`);
		await page.getByTestId("signin-switch").waitFor();
	} finally { await browser.close(); }
});

test("sign-in errors name their real cause: untrusted origin, rate limit, disabled service, no connection", async () => {
	const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	try {
		// A real untrusted origin: the same server opened as http://localhost:3099 (not a trusted origin).
		const real = await browser.newPage();
		await real.goto("http://localhost:3099/masuk");
		await real.getByLabel("Email").fill("pembeli@example.invalid");
		await real.getByLabel("Kata sandi").fill("bukan-sandi");
		await real.getByRole("button", { name: "Masuk", exact: true }).click();
		await real.getByTestId("signin-error").getByText("Halaman ini dibuka dari alamat yang tidak diizinkan").waitFor();
		assert.equal(await real.getByLabel("Kata sandi").getAttribute("aria-invalid"), null, "An origin refusal does not blame the password");
		await real.close();
		// Rate limit (with and without Retry-After), a disabled service and a lost connection.
		const page = await browser.newPage();
		const cases: [(route: import("@playwright/test").Route) => Promise<void>, string][] = [
			[(route) => route.fulfill({ status: 429, headers: { "retry-after": "120" }, contentType: "application/json", body: "{}" }), "Terlalu banyak percobaan. Coba lagi dalam 2 menit."],
			[(route) => route.fulfill({ status: 429, contentType: "application/json", body: "{}" }), "Terlalu banyak percobaan. Coba lagi dalam beberapa menit."],
			[(route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }), "Layanan masuk sedang dinonaktifkan sementara. Coba lagi nanti."],
			[(route) => route.abort("internetdisconnected"), "Tidak bisa terhubung. Coba lagi."],
		];
		for (const [respond, message] of cases) {
			await page.unrouteAll();
			await page.route("**/api/auth/sign-in/email", respond);
			await page.goto(`${origin}/masuk`);
			await page.getByLabel("Email").fill("pembeli@example.invalid");
			await page.getByLabel("Kata sandi").fill("bukan-sandi");
			await page.getByRole("button", { name: "Masuk", exact: true }).click();
			await page.getByTestId("signin-error").getByText(message, { exact: true }).waitFor();
		}
	} finally {
		await browser.close();
	}
});
