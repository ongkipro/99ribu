import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect, type Page, type Route } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { readStaticPage, STATIC_PAGES, type StaticSlug } from "../../src/modules/storefront/static-pages.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S-C1 Halaman Toko against the built web on the canonical origin. The admin screen answers the static-pages API
// from fixtures (route interception), so no version is written (versions are immutable); the storefront check reads
// the local database's current version of each page and expects the page or the noindex placeholder to match it.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;
const renders = join(RENDERS, "s-c1");

async function staff(role: Role) {
	const user = await actor(identity, role, []);
	users.push(user);
	await enroll(user.browser, user.password);
	return user;
}
async function open(user: User | null, viewport = { width: 1440, height: 1000 }) {
	const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
	if (user) await context.addCookies([...user.browser.cookies].map(([name, value]) => ({ name, value, domain: "127.0.0.1", path: "/" })));
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	return { page, errors, close: () => context.close() };
}
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

const now = new Date().toISOString();
const ROWS = (Object.keys(STATIC_PAGES) as StaticSlug[]).map((slug, i) => ({
	slug, path: `/${slug}`, default_title: STATIC_PAGES[slug], version: i === 0 ? 2 : 0, title: i === 0 ? "Tentang 99ribu" : null, updated_at: i === 0 ? now : null, actor_name: i === 0 ? "Synthetic Admin" : null,
}));
async function mockApi(page: Page, conflict = false) {
	const writes: { key: string | null; body: Record<string, unknown> }[] = [];
	await page.route(`${origin}/api/v1/admin/static-pages**`, async (route) => {
		const request = route.request();
		const path = new URL(request.url()).pathname;
		if (request.method() === "GET" && path.endsWith("/static-pages")) return json(route, { data: ROWS });
		if (request.method() === "GET" && path.endsWith("/tentang"))
			return json(route, { slug: "tentang", path: "/tentang", default_title: "Tentang kami", current: { version: 2, title: "Tentang 99ribu", body: "Paragraf lama." },
				versions: [{ version: 2, title: "Tentang 99ribu", reason: "Alamat baru", updated_at: now, actor_name: "Synthetic Admin" }, { version: 1, title: "Tentang kami", reason: "Pertama", updated_at: now, actor_name: null }] });
		if (request.method() === "POST" && path.endsWith("/tentang/versions")) {
			writes.push({ key: request.headers()["idempotency-key"] ?? null, body: request.postDataJSON() });
			if (conflict) return json(route, { type: "about:blank", title: "Conflict", status: 409, code: "VERSION_CONFLICT" }, 409);
			return json(route, { slug: "tentang", path: "/tentang", version: 3, title: "Tentang 99ribu", updated_at: now }, 201);
		}
		return route.fulfill({ status: 404, body: "{}" });
	});
	return writes;
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

test("S-C1 Halaman Toko is gated to owner and ecommerce_admin", async () => {
	const denied = await open(await staff("customer_service"));
	try {
		await denied.page.goto(`${origin}/admin/halaman`);
		await expect(denied.page.getByRole("heading", { name: "Akses konten toko diperlukan" })).toBeVisible();
		await expect(denied.page.getByTestId("static-page-edit-tentang")).toHaveCount(0);
	} finally {
		await denied.close();
	}
});

test("S-C1 list, edit and save send one versioned write; a version conflict reads in Indonesian", async () => {
	const editor = await staff("ecommerce_admin");
	for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
		const { page, errors, close } = await open(editor, viewport);
		try {
			const writes = await mockApi(page);
			await page.goto(`${origin}/admin/halaman`);
			await expect(page.getByRole("heading", { name: "Halaman Toko", level: 1 })).toBeVisible();
			for (const row of ROWS) await expect(page.getByTestId(`static-page-edit-${row.slug}`)).toBeVisible();
			await page.screenshot({ path: join(renders, `halaman-list-${viewport.width}.png`), fullPage: true });
			await page.getByTestId("static-page-edit-tentang").click();
			await expect(page.getByTestId("static-page-body")).toHaveValue("Paragraf lama.");
			await page.getByTestId("static-page-body").fill("## Siapa kami\nToko daring paket lengkap Rp99.000.\n\n- Kirim dari banyak gudang");
			await page.getByTestId("static-page-reason").fill("Isi pertama");
			await page.screenshot({ path: join(renders, `halaman-edit-${viewport.width}.png`) });
			await page.getByRole("button", { name: "Simpan dan tayangkan" }).click();
			await expect(page.getByTestId("static-page-notice")).toContainText("versi 3");
			assert.equal(writes.length, 1);
			assert.match(writes[0].key ?? "", /^[A-Za-z0-9_-]{16,200}$/);
			assert.deepEqual(writes[0].body, { expected_version: 2, title: "Tentang 99ribu", body: "## Siapa kami\nToko daring paket lengkap Rp99.000.\n\n- Kirim dari banyak gudang", reason: "Isi pertama" });
			assert.deepEqual(errors, []);
		} finally {
			await close();
		}
	}
	const { page, close } = await open(editor);
	try {
		await mockApi(page, true);
		await page.goto(`${origin}/admin/halaman`);
		await page.getByTestId("static-page-edit-tentang").click();
		await page.getByTestId("static-page-reason").fill("Isi kedua");
		await page.getByRole("button", { name: "Simpan dan tayangkan" }).click();
		await expect(page.getByText("Halaman ini baru diubah orang lain.")).toBeVisible();
	} finally {
		await close();
	}
});

test("S-C1 storefront pages show the latest version, or the noindex placeholder, and set no cookie", async () => {
	for (const slug of Object.keys(STATIC_PAGES) as StaticSlug[]) {
		const stored = await readStaticPage(identity.sql, slug);
		const response = await fetch(`${origin}/${slug}`);
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("set-cookie"), null, `${slug} sets no cookie`);
		const { page, errors, close } = await open(null, { width: 390, height: 844 });
		try {
			await page.goto(`${origin}/${slug}`);
			const robots = await page.locator('meta[name="robots"]').getAttribute("content").catch(() => null);
			if (stored) {
				await expect(page.getByRole("heading", { name: stored.title, level: 1 })).toBeVisible();
				assert.ok(!robots?.includes("noindex"), `${slug} is indexable`);
			} else {
				await expect(page.getByRole("heading", { name: STATIC_PAGES[slug], level: 1 })).toBeVisible();
				await expect(page.getByText("Halaman ini sedang disiapkan.")).toBeVisible();
				assert.ok(robots?.includes("noindex"), `${slug} placeholder is noindex`);
			}
			assert.deepEqual(errors, []);
		} finally {
			await close();
		}
	}
});
