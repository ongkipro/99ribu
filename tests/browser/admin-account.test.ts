import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { actor, BrowserSession, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S129 staff profile and account security against the built web on the canonical origin. Everything here is
// real: Better Auth sessions, the real APIs and PostgreSQL; the browser carries the staff session cookies.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const renders = join(RENDERS, "s129");

interface Staff {
	id: string;
	email: string;
	password: string;
	browser: BrowserSession;
	backupCodes: string[];
	used: number;
}
const users: Staff[] = [];
let browser: Browser;

async function staff(warehouseId: string | null = null) {
	const user = await actor(identity, "customer_service", warehouseId ? [warehouseId] : []);
	const setup = await enroll(user.browser, user.password);
	const entry = { ...user, backupCodes: setup.backupCodes, used: 0 };
	users.push(entry);
	return entry;
}
/** A second signed-in device of the same account (backup code instead of the TOTP). */
async function otherDevice(user: Staff) {
	const device = new BrowserSession(identity);
	assert.equal((await device.auth("/sign-in/email", { email: user.email, password: user.password })).status, 200);
	user.used += 1;
	assert.equal((await device.auth("/two-factor/verify-backup-code", { code: user.backupCodes[user.used] })).status, 200);
	return device;
}
async function open(user: Staff, viewport = { width: 1440, height: 1000 }, touch = false) {
	const context = await browser.newContext({ viewport, reducedMotion: "reduce", hasTouch: touch, isMobile: touch });
	await context.addCookies([...user.browser.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("request", (request) => assert.equal(new URL(request.url()).origin, origin, "No external browser request"));
	return { page, errors, context };
}

before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	mkdirSync(renders, { recursive: true });
});
after(async () => {
	try {
		await browser?.close();
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("S129 profile shows the caller's own account read-only and links to account security", async () => {
	const warehouse = randomUUID();
	await identity.sql`insert into app.warehouse (id,name,city) values (${warehouse},'Gudang Uji S129','Malang')`;
	const user = await staff(warehouse);
	await identity.sql`update app.role_grant set permissions=ARRAY['orders.history.read']::text[] where user_id=${user.id}`;
	for (const [width, height] of [
		[390, 844],
		[1440, 900],
	] as const) {
		const view = await open(user, { width, height }, width < 500);
		try {
			await view.page.goto(`${origin}/admin/akun/profil`);
			await expect(view.page.getByRole("heading", { name: "Profil", level: 1 })).toBeVisible();
			await expect(view.page.getByTestId("account-email")).toHaveText(user.email);
			await expect(view.page.getByTestId("account-roles")).toContainText("Layanan Pelanggan");
			await expect(view.page.getByTestId("account-grants")).toContainText("Riwayat pesanan");
			await expect(view.page.getByTestId("account-warehouses")).toContainText("Gudang Uji S129");
			// Read-only: no form control on the profile page apart from navigation.
			await expect(view.page.getByTestId("account-page").locator("input, textarea, select")).toHaveCount(0);
			assert.ok(await view.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal page scroll");
			await view.page.screenshot({ path: join(renders, `account-profile-${width}.png`), fullPage: true });
			assert.deepEqual(view.errors, []);
		} finally {
			await view.context.close();
		}
	}
	const view = await open(user);
	try {
		await view.page.goto(`${origin}/admin/akun/profil`);
		await view.page.getByTestId("account-security-link").click();
		await expect(view.page).toHaveURL(`${origin}/admin/akun/keamanan`);
		await expect(view.page.getByRole("heading", { name: "Keamanan akun", level: 1 })).toBeVisible();
	} finally {
		await view.context.close();
		await identity.sql`delete from app.warehouse_membership where warehouse_id=${warehouse}`;
		await identity.sql`delete from app.warehouse where id=${warehouse}`;
	}
});

test("S129 a signed-out visitor gets a sign-in prompt, not account data", async () => {
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await page.goto(`${origin}/admin/akun/profil`);
		await expect(page.getByTestId("account-signed-out")).toBeVisible();
		await expect(page.getByTestId("account-email")).toHaveCount(0);
	} finally {
		await context.close();
	}
});

test("S129 sessions: the list marks this device and ending other sessions needs the password", async () => {
	const user = await staff();
	const device = await otherDevice(user);
	for (const [width, height] of [
		[390, 844],
		[1440, 900],
	] as const) {
		const view = await open(user, { width, height }, width < 500);
		try {
			await view.page.goto(`${origin}/admin/akun/keamanan`);
			await expect(view.page.getByTestId("session-item")).toHaveCount(2);
			await expect(view.page.locator('[data-testid="session-item"][data-current="true"]')).toHaveCount(1);
			await expect(view.page.getByTestId("two-factor-status")).toContainText("Aktif");
			// Staff cannot switch two-step verification off from here.
			await expect(view.page.getByRole("button", { name: /matikan|nonaktifkan|disable/i })).toHaveCount(0);
			assert.ok(await view.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal page scroll");
			await view.page.screenshot({ path: join(renders, `account-security-${width}.png`), fullPage: true });
			assert.deepEqual(view.errors, []);
		} finally {
			await view.context.close();
		}
	}
	const view = await open(user);
	try {
		await view.page.goto(`${origin}/admin/akun/keamanan`);
		await view.page.getByTestId("terminate-others-open").click();
		await view.page.getByTestId("sessions-password").fill("kata-sandi-salah-123");
		await view.page.getByRole("button", { name: "Akhiri sesi lain", exact: true }).click();
		await expect(view.page.getByRole("alert")).toContainText("Kata sandi salah");
		assert.equal((await device.access("/me")).status, 200, "a wrong password ends nothing");

		await view.page.getByTestId("sessions-password").fill(user.password);
		await view.page.getByRole("button", { name: "Akhiri sesi lain", exact: true }).click();
		await expect(view.page.getByTestId("account-security-notice")).toContainText("Sesi di perangkat lain sudah berakhir");
		await expect(view.page.getByTestId("session-item")).toHaveCount(1);
		await expect(view.page.getByTestId("terminate-others-open")).toBeDisabled();
		assert.equal((await device.access("/me")).status, 401, "the other device is signed out");
		// This browser stays signed in.
		await view.page.reload();
		await expect(view.page.getByTestId("session-item")).toHaveCount(1);
		const [row] = await identity.sql`select count(*)::int as n from app.audit_event where actor_id=${user.id} and action='auth.sessions.terminate' and outcome='allowed'`;
		assert.equal(row.n, 1);
	} finally {
		await view.context.close();
	}
});

test("S129 backup codes are shown once after regeneration and never again", async () => {
	const user = await staff();
	const view = await open(user);
	try {
		await view.page.goto(`${origin}/admin/akun/keamanan`);
		await expect(view.page.getByTestId("backup-codes-remaining")).toContainText("10");
		await view.page.getByTestId("backup-codes-open").click();
		await view.page.getByTestId("backup-password").fill(user.password);
		await view.page.getByRole("button", { name: "Buat kode baru" }).click();
		const codes = view.page.getByTestId("backup-codes").locator("li");
		await expect(codes).toHaveCount(10);
		const shown = await codes.allTextContents();
		assert.ok(shown.every((code) => !user.backupCodes.includes(code)), "the old set is replaced");
		await view.page.screenshot({ path: join(renders, "account-backup-codes-1440.png") });
		await view.page.getByTestId("backup-codes-done").click();
		await expect(view.page.getByTestId("backup-codes")).toHaveCount(0);
		await view.page.reload();
		const body = (await view.page.locator("body").innerText()) + (await view.page.content());
		for (const code of shown) assert.ok(!body.includes(code), "codes are not on the page after the dialog closes");
		await expect(view.page.getByTestId("backup-codes-remaining")).toContainText("10");
		const [row] = await identity.sql`select count(*)::int as n from app.audit_event where actor_id=${user.id} and action='auth.backup_codes.regenerate' and outcome='allowed'`;
		assert.equal(row.n, 1);
	} finally {
		await view.context.close();
	}
});

test("S129 change password validates in the dialog, then ends other sessions and keeps this one", async () => {
	const user = await staff();
	const device = await otherDevice(user);
	const next = randomBytes(18).toString("base64url");
	const view = await open(user);
	try {
		await view.page.goto(`${origin}/admin/akun/keamanan`);
		await view.page.getByTestId("change-password-open").click();
		await view.page.getByTestId("password-current").fill(user.password);
		await view.page.getByTestId("password-new").fill("pendek");
		await view.page.getByTestId("password-repeat").fill("pendek");
		await view.page.getByRole("button", { name: "Ganti kata sandi", exact: true }).click();
		await expect(view.page.getByRole("alert")).toContainText("minimal 12 karakter");
		await view.page.getByTestId("password-new").fill(next);
		await view.page.getByTestId("password-repeat").fill(`${next}x`);
		await view.page.getByRole("button", { name: "Ganti kata sandi", exact: true }).click();
		await expect(view.page.getByRole("alert")).toContainText("tidak sama");
		await view.page.screenshot({ path: join(renders, "account-password-dialog-1440.png") });

		await view.page.getByTestId("password-repeat").fill(next);
		await view.page.getByRole("button", { name: "Ganti kata sandi", exact: true }).click();
		await expect(view.page.getByTestId("account-security-notice")).toContainText("Kata sandi diganti");
		assert.equal((await device.access("/me")).status, 401, "other session ended");
		// The replacement session keeps the second-factor state: the page still loads and lists one session.
		await view.page.reload();
		await expect(view.page.getByTestId("session-item")).toHaveCount(1);
		await expect(view.page.getByTestId("two-factor-status")).toContainText("Aktif");
		const [row] = await identity.sql`select count(*)::int as n from app.audit_event where actor_id=${user.id} and action='auth.password.change' and outcome='allowed'`;
		assert.equal(row.n, 1);
	} finally {
		await view.context.close();
	}
});
