import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S137 Staf & Peran (/admin/settings/staff) against the built web on the canonical origin. NOT run by the author:
// the coordinator runs it serially on 127.0.0.1:3099 (selector `--case=staff-roles` in browser mode).
// The owner finds an account by email, gives it roles with a real password proof, sees a stale version refused, resets
// a lost authenticator, steps down as a second owner exists, and pages the list; finance is denied; phone, tablet and
// desktop widths have no horizontal overflow. Every row of this file carries a 000-s137 name so it sorts first.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
const fakeIds: string[] = [];
let browser: Browser;
const renders = join(RENDERS, "s137");
const marker = randomUUID().slice(0, 8);
const name = (part: string) => `000-s137-${marker}-${part}`;

async function staff(role: Role, part: string, enrolled = true) {
	const user = await actor(identity, role, []);
	users.push(user);
	await identity.sql`update app.auth_user set name=${name(part)} where id=${user.id}`;
	if (enrolled) await enroll(user.browser, user.password);
	return user;
}
async function open(user: User, viewport = { width: 1440, height: 1000 }, touch = false) {
	const context = await browser.newContext({ viewport, reducedMotion: "reduce", hasTouch: touch, isMobile: touch });
	await context.addCookies([...user.browser.cookies].map(([cookie, value]) => ({ name: cookie, value, domain: "127.0.0.1", path: "/" })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("request", (request) => assert.equal(new URL(request.url()).origin, origin, "No external browser request"));
	return { page, errors, close: () => context.close() };
}
// Proof issuance is capped at five per minute and principal; each step of a test starts a fresh budget.
const freshBudget = (user: User) => identity.sql`delete from app.auth_rate_limit where key=${`access-proof:${user.id}`}`;

before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	mkdirSync(renders, { recursive: true });
	// 26 plain staff rows so the list has a second keyset page; no sign-in is needed for them.
	for (let index = 0; index < 26; index++) {
		const id = `s137-${marker}-${index}`;
		fakeIds.push(id);
		await identity.sql`insert into app.auth_user (id,name,email,email_verified) values (${id},${name(`pg-${String(index).padStart(2, "0")}`)},${`${id}@example.invalid`},true)`;
		await identity.sql`insert into app.role_grant (user_id,roles) values (${id},${["customer_service"]})`;
	}
});
after(async () => {
	try {
		await browser?.close();
	} finally {
		await cleanup(identity, users);
		if (fakeIds.length) await identity.sql`delete from app.auth_user where id in ${identity.sql(fakeIds)}`;
		await identity.sql.end();
	}
});

test("S137 owner finds an account, validates, is refused a wrong password and a stale version, then grants roles", async () => {
	const owner = await staff("owner", "owner");
	const target = await actor(identity, "buyer", []);
	users.push(target);
	await identity.sql`update app.auth_user set name=${name("a-target")} where id=${target.id}`;
	const view = await open(owner);
	try {
		await view.page.goto(`${origin}/admin/settings/staff`);
		await expect(view.page.getByRole("heading", { name: "Staf & Peran", level: 1 })).toBeVisible();
		const ownerRow = view.page.getByTestId("staff-row").filter({ hasText: owner.email });
		await expect(ownerRow).toContainText("(Anda)");
		await expect(ownerRow.getByTestId("staff-reset")).toHaveCount(0);
		await expect(ownerRow.getByTestId("staff-edit")).toContainText("Turunkan");

		// Lookup: exact email only.
		await view.page.getByTestId("staff-lookup-email").fill("tidak-ada@example.invalid");
		await view.page.getByTestId("staff-lookup-submit").click();
		await expect(view.page.getByText("Tidak ada akun dengan email itu")).toBeVisible();
		await view.page.getByTestId("staff-lookup-email").fill(target.email.slice(0, 14));
		await view.page.getByTestId("staff-lookup-submit").click();
		await expect(view.page.getByText("Isi alamat email lengkap")).toBeVisible();
		await view.page.getByTestId("staff-lookup-email").fill(target.email);
		await view.page.getByTestId("staff-lookup-submit").click();
		await expect(view.page.getByTestId("staff-lookup-result")).toContainText(target.email);
		await view.page.getByTestId("staff-lookup-open").click();
		const dialog = view.page.getByRole("dialog");
		await expect(dialog.getByRole("heading", { name: `Atur peran ${name("a-target")}` })).toBeVisible();

		// Client-side rules mirror the API: warehouse needs a warehouse, finance permissions need the finance role.
		await dialog.getByTestId("staff-role-warehouse").check();
		await dialog.getByTestId("staff-reason").fill("Staf baru");
		await dialog.getByTestId("staff-password").fill(target.password);
		await dialog.getByRole("button", { name: "Simpan peran" }).click();
		await expect(dialog.getByRole("alert")).toContainText("Peran Gudang membutuhkan minimal satu gudang");
		await dialog.getByTestId("staff-role-warehouse").uncheck();
		await expect(dialog.getByTestId("staff-perm-finance.costs.read")).toBeDisabled();
		await dialog.getByTestId("staff-role-finance").check();
		await expect(dialog.getByTestId("staff-perm-finance.costs.read")).toBeEnabled();
		await dialog.getByTestId("staff-perm-finance.costs.read").check();
		await dialog.getByTestId("staff-role-finance").uncheck();
		await expect(dialog.getByTestId("staff-perm-finance.costs.read")).not.toBeChecked();
		await dialog.getByTestId("staff-role-customer_service").check();
		await dialog.getByTestId("staff-perm-exports.read").check();

		// A wrong password is refused and changes nothing.
		await dialog.getByTestId("staff-password").fill("kata-sandi-salah-sekali");
		await dialog.getByRole("button", { name: "Simpan peran" }).click();
		await expect(dialog.getByRole("alert")).toContainText("Kata sandi salah");
		assert.deepEqual((await identity.sql`select roles from app.role_grant where user_id=${target.id}`)[0].roles, ["buyer"]);

		// Another change lands first (stale version): the dialog says so and nothing is overwritten.
		await freshBudget(owner);
		await identity.sql`update app.role_grant set revision=revision+1 where user_id=${target.id}`;
		await dialog.getByTestId("staff-password").fill(owner.password);
		await dialog.getByRole("button", { name: "Simpan peran" }).click();
		await expect(dialog.getByRole("alert")).toContainText("sudah berubah di tempat lain");
		await dialog.getByRole("button", { name: "Batal" }).click();

		// Reopen with the current version and save.
		await freshBudget(owner);
		await view.page.getByTestId("staff-lookup-submit").click();
		await view.page.getByTestId("staff-lookup-open").click();
		await dialog.getByTestId("staff-role-customer_service").check();
		await dialog.getByTestId("staff-perm-exports.read").check();
		await dialog.getByTestId("staff-reason").fill("Staf layanan pelanggan baru");
		await dialog.getByTestId("staff-password").fill(owner.password);
		await dialog.getByRole("button", { name: "Simpan peran" }).click();
		await expect(view.page.getByTestId("staff-notice")).toContainText("tersimpan");
		await expect(dialog).toHaveCount(0);
		const [grant] = await identity.sql`select roles,permissions from app.role_grant where user_id=${target.id}`;
		assert.deepEqual(grant.roles, ["buyer", "customer_service"]);
		assert.deepEqual(grant.permissions, ["exports.read"]);
		const [{ n }] = await identity.sql`select count(*)::int as n from app.audit_event where actor_id=${owner.id} and subject_id=${target.id} and action='staff_roles.replace' and outcome='allowed'`;
		assert.equal(n, 1);
		await expect(view.page.getByTestId("staff-row").filter({ hasText: target.email })).toContainText("Layanan Pelanggan");
		await view.page.screenshot({ path: join(renders, "staff-owner-1440.png"), fullPage: true });
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});

test("S137 owner pages the list and resets a lost authenticator", async () => {
	const owner = await staff("owner", "owner-b");
	const member = await staff("finance", "member");
	const view = await open(owner);
	try {
		await view.page.goto(`${origin}/admin/settings/staff`);
		const rows = view.page.getByTestId("staff-row");
		await expect(rows).toHaveCount(25);
		await view.page.getByTestId("staff-more").click();
		await expect.poll(() => rows.count()).toBeGreaterThan(25);
		const emails = await rows.locator("td:nth-child(1)").allInnerTexts();
		assert.equal(new Set(emails).size, emails.length, "Each row once across pages");

		const row = rows.filter({ hasText: member.email });
		await expect(row).toContainText("Aktif");
		await row.getByTestId("staff-reset").click();
		const dialog = view.page.getByRole("dialog");
		await expect(dialog.getByRole("heading", { name: `Reset verifikasi dua langkah ${name("member")}` })).toBeVisible();
		await dialog.getByRole("button", { name: "Reset verifikasi" }).click();
		await expect(dialog.getByRole("alert")).toContainText("Isi alasan reset");
		await dialog.getByTestId("staff-reset-reason").fill("Ponsel hilang");
		await dialog.getByTestId("staff-reset-password").fill("kata-sandi-salah-sekali");
		await dialog.getByRole("button", { name: "Reset verifikasi" }).click();
		await expect(dialog.getByRole("alert")).toContainText("Kata sandi salah");
		assert.equal((await identity.sql`select count(*)::int as n from app.auth_two_factor where user_id=${member.id}`)[0].n, 1);
		await freshBudget(owner);
		await dialog.getByTestId("staff-reset-password").fill(owner.password);
		await dialog.getByRole("button", { name: "Reset verifikasi" }).click();
		await expect(view.page.getByTestId("staff-notice")).toContainText("direset");
		assert.equal((await identity.sql`select count(*)::int as n from app.auth_two_factor where user_id=${member.id}`)[0].n, 0);
		assert.equal((await identity.sql`select count(*)::int as n from app.auth_session where user_id=${member.id}`)[0].n, 0);
		await expect(rows.filter({ hasText: member.email })).toContainText("Belum aktif");
		await expect(rows.filter({ hasText: member.email }).getByTestId("staff-reset")).toHaveCount(0);
		const [event] = await identity.sql`select actor_id,reason from app.audit_event where action='staff_mfa.reset' and subject_id=${member.id}`;
		assert.equal(event.actor_id, owner.id);
		assert.equal(event.reason, "Ponsel hilang");
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});

test("S137 an owner steps down while another owner exists and is signed out", async () => {
	const owner = await staff("owner", "owner-c");
	const keeper = await staff("owner", "owner-d");
	assert.ok(keeper.id);
	const view = await open(owner);
	try {
		await view.page.goto(`${origin}/admin/settings/staff`);
		const row = view.page.getByTestId("staff-row").filter({ hasText: owner.email });
		await row.getByTestId("staff-edit").click();
		const dialog = view.page.getByRole("dialog");
		await expect(dialog.getByTestId("staff-owner-warning")).toContainText("Ini akun Anda");
		await dialog.getByTestId("staff-reason").fill("Serah terima Super Admin");
		await dialog.getByTestId("staff-password").fill(owner.password);
		await dialog.getByRole("button", { name: "Turunkan dan simpan" }).click();
		await expect(view.page.getByTestId("staff-ended")).toContainText("tidak lagi Super Admin");
		await expect(view.page.getByRole("link", { name: "Masuk lagi" })).toBeVisible();
		assert.deepEqual((await identity.sql`select roles from app.role_grant where user_id=${owner.id}`)[0].roles, ["buyer"]);
		assert.equal((await identity.sql`select count(*)::int as n from app.auth_session where user_id=${owner.id}`)[0].n, 0);
		assert.deepEqual((await identity.sql`select roles from app.role_grant where user_id=${keeper.id}`)[0].roles, ["owner"]);
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});

test("S137 finance is denied on the page and by the API", async () => {
	const finance = await staff("finance", "finance");
	const view = await open(finance);
	try {
		await view.page.goto(`${origin}/admin/settings/staff`);
		await expect(view.page.getByRole("heading", { name: "Akses Super Admin diperlukan" })).toBeVisible();
		await expect(view.page.getByTestId("staff-page")).toHaveCount(0);
		const response = await view.page.request.get(`${origin}/api/v1/admin/staff`);
		assert.equal(response.status(), 403);
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});

test("S137 phone, tablet and desktop: no horizontal overflow, dialog fits", async () => {
	const owner = await staff("owner", "owner-e");
	for (const [label, viewport, touch] of [
		["390", { width: 390, height: 844 }, true],
		["768", { width: 768, height: 1024 }, false],
		["1440", { width: 1440, height: 1000 }, false],
	] as const) {
		const view = await open(owner, viewport, touch);
		try {
			await view.page.goto(`${origin}/admin/settings/staff`);
			await expect(view.page.getByTestId("staff-row").first()).toBeVisible();
			const overflow = () => view.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
			assert.ok((await overflow()) <= 0, `${label}: horizontal overflow ${await overflow()}px`);
			await view.page.screenshot({ path: join(renders, `staff-list-${label}.png`), fullPage: false });
			await view.page.getByTestId("staff-row").filter({ hasText: owner.email }).getByTestId("staff-edit").click();
			const dialog = view.page.getByRole("dialog");
			await expect(dialog).toBeVisible();
			const box = await dialog.boundingBox();
			assert.ok(box && box.width <= viewport.width && box.x >= 0, `${label}: dialog inside the viewport`);
			assert.ok((await overflow()) <= 0, `${label}: horizontal overflow with the dialog open`);
			await view.page.screenshot({ path: join(renders, `staff-dialog-${label}.png`), fullPage: false });
			assert.deepEqual(view.errors, []);
		} finally {
			await view.close();
		}
	}
});
