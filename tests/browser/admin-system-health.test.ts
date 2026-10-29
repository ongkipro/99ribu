import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect, type Route } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S136 Kesehatan Sistem against the built web on the canonical origin. Screen cases answer the health API from
// fixtures (route interception); one case reads the real API as the owner. Read-only: nothing is written.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;
const renders = join(RENDERS, "s136");

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
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const counts = (patch: Record<string, number> = {}) => ({ due: 0, scheduled: 0, leased: 0, lease_expired: 0, unknown: 0, failed: 0, dead: 0, completed: 0, ...patch });
const HEALTH = {
	as_of: "2026-10-27T03:00:00.000Z",
	totals: counts({ due: 4, scheduled: 2, leased: 1, lease_expired: 1, unknown: 2, failed: 3, dead: 1, completed: 40 }),
	kinds: [
		{ kind: "checkout.order.expire", registered: true, counts: counts({ completed: 30 }), oldest_due_at: null },
		{ kind: "payment.callback", registered: true, counts: counts({ due: 4, failed: 3, dead: 1, completed: 10 }), oldest_due_at: "2026-10-27T01:15:00.000Z" },
		{ kind: "shipping.create", registered: false, counts: counts({ scheduled: 2, leased: 1, lease_expired: 1, unknown: 2 }), oldest_due_at: null },
		{ kind: "cod.callback", registered: true, counts: counts(), oldest_due_at: null },
	],
	retention: {
		last_run_recorded: false,
		jobs: [
			{ name: "outbox.completed", table: "outbox_job" },
			{ name: "auth.session", table: "auth_session" },
		],
	},
};
const mock = (page: Awaited<ReturnType<typeof open>>["page"], respond: (route: Route) => Promise<void>) =>
	page.route((url) => url.origin === origin && url.pathname === "/api/v1/admin/system-health", respond);

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

test("S136 Kesehatan Sistem is shown to the owner only", async () => {
	const cs = await staff("customer_service");
	const denied = await open(cs);
	try {
		await denied.page.goto(`${origin}/admin/pengaturan/sistem`);
		await expect(denied.page.getByRole("heading", { name: "Akses Super Admin diperlukan" })).toBeVisible();
		await expect(denied.page.getByTestId("system-health-page")).toHaveCount(0);
	} finally {
		await denied.close();
	}
	const owner = await staff("owner");
	const allowed = await open(owner);
	try {
		// The real API: the owner reads live counts; nothing is mocked.
		await allowed.page.goto(`${origin}/admin/pengaturan/sistem`);
		await expect(allowed.page.getByRole("heading", { name: "Kesehatan Sistem", level: 1 })).toBeVisible();
		await expect(allowed.page.getByTestId("health-totals")).toBeVisible();
		await expect(allowed.page.getByTestId("health-retention-note")).toBeVisible();
		assert.deepEqual(allowed.errors, []);
	} finally {
		await allowed.close();
	}
});

test("S136 totals, kinds needing attention first, idle kinds hidden until asked, retention registry and its missing run time", async () => {
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner);
	try {
		await mock(page, (route) => json(route, HEALTH));
		await page.goto(`${origin}/admin/pengaturan/sistem`);
		await expect(page.getByTestId("health-total-value-due")).toHaveText("4");
		await expect(page.getByTestId("health-total-value-failed")).toHaveText("3");
		await expect(page.getByTestId("health-total-failed")).toHaveAttribute("data-tone", "attention");
		await expect(page.getByTestId("health-total-value-completed")).toHaveText("40");
		await expect(page.getByTestId("health-total-leased")).toHaveAttribute("data-tone", "neutral");
		await expect(page.getByTestId("health-as-of")).toContainText("WIB");
		// Kinds with failed/dead/lease_expired/unknown come first, alphabetically; the one with no rows is hidden.
		const rows = page.getByTestId("health-kinds-table").locator('[data-testid^="health-kind-"]');
		await expect(rows).toHaveCount(3);
		await expect(rows.nth(0)).toHaveAttribute("data-testid", "health-kind-payment.callback");
		await expect(rows.nth(1)).toHaveAttribute("data-testid", "health-kind-shipping.create");
		await expect(rows.nth(2)).toHaveAttribute("data-testid", "health-kind-checkout.order.expire");
		await expect(page.getByTestId("health-kind-cod.callback")).toHaveCount(0);
		await expect(page.getByTestId("health-kind-shipping.create")).toContainText("Adaptor berkunci atau jenis tak dikenal");
		await page.getByTestId("health-toggle-idle").click();
		await expect(page.getByTestId("health-kind-cod.callback")).toBeVisible();
		await expect(page.getByTestId("health-retention-note")).toContainText("belum dicatat");
		await expect(page.getByTestId("health-retention-jobs").getByRole("listitem")).toHaveCount(2);
		await page.screenshot({ path: join(renders, "system-health-owner-1440.png"), fullPage: true });
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("S136 shows an empty state, a retryable error and a denial for a refused read", async () => {
	const owner = await staff("owner");
	const { page, close } = await open(owner);
	try {
		let mode: "empty" | "error" | "denied" = "empty";
		await mock(page, (route) => {
			if (mode === "empty") return json(route, { ...HEALTH, totals: counts(), kinds: HEALTH.kinds.map((kind) => ({ ...kind, counts: counts(), oldest_due_at: null })) });
			if (mode === "error") return json(route, { type: "about:blank", title: "SERVICE_UNAVAILABLE", status: 503, code: "SERVICE_UNAVAILABLE", request_id: "00000000-0000-4000-8000-000000000000" }, 503);
			return json(route, { type: "about:blank", title: "FORBIDDEN", status: 403, code: "FORBIDDEN", request_id: "00000000-0000-4000-8000-000000000000" }, 403);
		});
		await page.goto(`${origin}/admin/pengaturan/sistem`);
		await expect(page.getByTestId("health-empty")).toBeVisible();
		mode = "error";
		await page.getByTestId("health-refresh").click();
		await expect(page.getByText("Layanan sedang tidak tersedia")).toBeVisible();
		mode = "empty";
		await page.getByRole("button", { name: "Coba lagi" }).click();
		await expect(page.getByTestId("health-empty")).toBeVisible();
		mode = "denied";
		await page.getByTestId("health-refresh").click();
		await expect(page.getByText("hanya untuk Super Admin")).toBeVisible();
	} finally {
		await close();
	}
});

test("S136 renders at 390 (touch) and 768 without sideways page scroll", async () => {
	const owner = await staff("owner");
	for (const [width, touch] of [
		[390, true],
		[768, false],
	] as const) {
		const { page, errors, close } = await open(owner, { width, height: 900 }, touch);
		try {
			await mock(page, (route) => json(route, HEALTH));
			await page.goto(`${origin}/admin/pengaturan/sistem`);
			await expect(page.getByTestId("health-kind-payment.callback")).toBeVisible();
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal page scroll");
			await page.screenshot({ path: join(renders, `system-health-owner-${width}.png`), fullPage: true });
			assert.deepEqual(errors, []);
		} finally {
			await close();
		}
	}
});
