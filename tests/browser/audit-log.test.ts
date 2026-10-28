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

// S135 Log Audit (/admin/settings/audit) against the built web on the canonical origin: the owner filters real
// rows through the real API, loads the next keyset page without a repeat, reads a redacted detail; finance sees only
// money actions; customer service gets the denied screen; phone width has no horizontal overflow.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;
const renders = join(RENDERS, "s135");
const marker = `s135-${randomUUID()}`;
const SECRET = "483920-otp-code-must-not-render";

async function staff(role: Role) {
	const user = await actor(identity, role, []);
	users.push(user);
	await enroll(user.browser, user.password);
	return user;
}
async function open(user: User, viewport = { width: 1440, height: 1000 }, touch = false) {
	const context = await browser.newContext({ viewport, reducedMotion: "reduce", hasTouch: touch, isMobile: touch });
	await context.addCookies([...user.browser.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("request", (request) => assert.equal(new URL(request.url()).origin, origin, "No external browser request"));
	return { page, errors, close: () => context.close() };
}

before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	mkdirSync(renders, { recursive: true });
	// 30 rows for one actor marker: alternating money (finance.reconcile) and owner-only (staff_roles.replace),
	// one timestamp shared by all so paging has to break ties by id; one row carries a secret that has no policy key.
	for (let index = 0; index < 30; index++) {
		await identity.sql`insert into app.audit_event (actor_id,action,subject_id,outcome,reason,details,created_at)
			values (${marker},${index % 2 === 0 ? "finance.reconcile" : "staff_roles.replace"},${`obj-${index}`},'allowed','Seeded for S135 browser',
			${JSON.stringify({ operation_id: `op-${index}`, version: index, otp: SECRET })}::jsonb,'2026-01-15 10:00:00.123456+00')`;
	}
});
after(async () => {
	try {
		await browser?.close();
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("S135 owner filters, pages and reads redacted details", async () => {
	const owner = await staff("owner");
	const view = await open(owner);
	try {
		await view.page.goto(`${origin}/admin/settings/audit`);
		await expect(view.page.getByRole("heading", { name: "Log Audit", level: 1 })).toBeVisible();
		await view.page.getByLabel("Pelaku (ID akun)").fill(marker);
		await view.page.getByRole("button", { name: "Terapkan" }).click();
		const rows = view.page.getByTestId("audit-row");
		await expect(rows).toHaveCount(25);
		await view.page.getByTestId("audit-more").click();
		await expect(rows).toHaveCount(30);
		const subjects = await rows.locator("td:nth-child(4)").allInnerTexts();
		assert.equal(new Set(subjects).size, 30, "Each row once across pages");
		await expect(view.page.getByTestId("audit-more")).toHaveCount(0);
		await rows.first().getByText(/^Rincian/).click();
		await expect(view.page.getByText(SECRET)).toHaveCount(0);
		await expect(view.page.getByText("Sebagian data disembunyikan").first()).toBeVisible();
		// Narrow to one action family and an empty period.
		await view.page.getByLabel("Jenis tindakan").selectOption("staff_roles.");
		await view.page.getByRole("button", { name: "Terapkan" }).click();
		await expect(view.page.getByTestId("audit-row")).toHaveCount(15);
		await view.page.getByLabel("Dari tanggal (WIB)").fill("2030-01-01");
		await view.page.getByRole("button", { name: "Terapkan" }).click();
		await expect(view.page.getByTestId("audit-empty")).toContainText("Tidak ada catatan yang cocok");
		await view.page.getByLabel("Sampai tanggal (WIB)").fill("2029-01-01");
		await view.page.getByRole("button", { name: "Terapkan" }).click();
		await expect(view.page.getByText("Tanggal akhir tidak boleh sebelum tanggal awal.")).toBeVisible();
		await view.page.screenshot({ path: join(renders, "audit-owner-1440.png"), fullPage: true });
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});

test("S135 finance sees money actions only; customer service is denied", async () => {
	const finance = await staff("finance");
	// Finance reads the reconciliation actions only with the matching permission (spec 07).
	await identity.sql`update app.role_grant set permissions=${["finance.reconciliation.read"]} where user_id=${finance.id}`;
	const cs = await staff("customer_service");
	const view = await open(finance);
	const denied = await open(cs);
	try {
		await view.page.goto(`${origin}/admin/settings/audit`);
		await view.page.getByLabel("Pelaku (ID akun)").fill(marker);
		await view.page.getByRole("button", { name: "Terapkan" }).click();
		await expect(view.page.getByTestId("audit-row")).toHaveCount(15);
		await expect(view.page.getByText("staff_roles.replace")).toHaveCount(0);
		await expect(view.page.getByLabel("Jenis tindakan").locator("option", { hasText: "Peran staf" })).toHaveCount(0);
		await denied.page.goto(`${origin}/admin/settings/audit`);
		await expect(denied.page.getByRole("heading", { name: "Akses log audit diperlukan" })).toBeVisible();
		await expect(denied.page.getByTestId("audit-page")).toHaveCount(0);
		assert.deepEqual([...view.errors, ...denied.errors], []);
	} finally {
		await view.close();
		await denied.close();
	}
});

test("S135 phone width: no horizontal overflow, cards stack", async () => {
	const owner = await staff("owner");
	const view = await open(owner, { width: 390, height: 844 }, true);
	try {
		await view.page.goto(`${origin}/admin/settings/audit`);
		await view.page.getByLabel("Pelaku (ID akun)").fill(marker);
		await view.page.getByRole("button", { name: "Terapkan" }).click();
		await expect(view.page.getByTestId("audit-row")).toHaveCount(25);
		const overflow = await view.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
		assert.ok(overflow <= 0, `horizontal overflow ${overflow}px`);
		await view.page.screenshot({ path: join(renders, "audit-owner-390.png"), fullPage: false });
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});
