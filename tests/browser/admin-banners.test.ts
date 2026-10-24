import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect, type Page, type Route } from "@playwright/test";
import { privateDirectory } from "../../src/config/local.ts";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S110 Banner Beranda against the built web on the canonical origin. The screen tests answer the banner API
// from fixtures (route interception), so no banner is written; the last test is the one end-to-end write:
// it creates a real banner, sees it replace the home rail's defaults, retires it and sees it gone.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
const storedImages: string[] = [];
let browser: Browser;
const renders = join(RENDERS, "s110");

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

const hour = 3_600_000;
function fixture(id: string, title: string, photo: string, patch: Record<string, unknown> = {}) {
	return {
		id,
		version: 2,
		version_id: randomUUID(),
		title,
		subtitle: "Setiap pilihan lengkap Rp99.000.",
		action_label: "Lihat pilihan",
		href: "/promo",
		tint: null,
		image: { sha256: `${photo}${"0".repeat(52)}`, width: 1080, height: 1080, alt: `Foto ${title}`, url: `/media/catalog/${photo}.webp` },
		starts_at: new Date(Date.now() - hour).toISOString(),
		ends_at: new Date(Date.now() + 30 * 24 * hour).toISOString(),
		position: 0,
		active: true,
		retired: false,
		recorded_by: "synthetic",
		recorded_by_name: "Super Admin",
		reason: "Kampanye",
		recorded_at: new Date(Date.now() - 2 * hour).toISOString(),
		phase: "live",
		...patch,
	};
}
const BANNERS = [
	fixture("6f9a0c1e-1d2b-4c3d-8e4f-5a6b7c8d9e01", "Paket campuran", "5e496b28d84b", { position: 0 }),
	fixture("6f9a0c1e-1d2b-4c3d-8e4f-5a6b7c8d9e02", "Rawat kendaraan sendiri", "c6f35ee579a6", { position: 1, tint: "slate", href: "/kategori/otomotif" }),
	fixture("6f9a0c1e-1d2b-4c3d-8e4f-5a6b7c8d9e03", "Gaya pria sehari-hari", "0f510b5d7bd5", {
		position: 2,
		href: "/kategori/fashion-pria",
		starts_at: new Date(Date.now() + 24 * hour).toISOString(),
		phase: "scheduled",
	}),
];
/** Answers the banner API from fixtures and records every write; the proof endpoint returns a synthetic proof. */
async function mockApi(page: Page) {
	const writes: { path: string; body: Record<string, unknown> }[] = [];
	await page.route(
		(url) => url.origin === origin && (url.pathname.startsWith("/api/v1/admin/home-banner") || url.pathname === "/api/v1/me/reauthentication-proofs"),
		async (route) => {
			const request = route.request();
			const path = new URL(request.url()).pathname;
			if (request.method() === "GET") {
				if (path.endsWith("/versions")) return json(route, { data: [BANNERS[0], { ...BANNERS[0], version: 1, reason: "Banner baru" }], pagination: { next_cursor: null } });
				return json(route, { configured: true, data: new URL(request.url()).searchParams.get("state") === "retired" ? [] : BANNERS });
			}
			if (path === "/api/v1/me/reauthentication-proofs") return json(route, { proof: "synthetic-proof", expires_at: new Date(Date.now() + 300000).toISOString() }, 201);
			if (path === "/api/v1/admin/home-banner-images")
				return json(route, { sha256: "a".repeat(64), width: 1080, height: 1350, byte_size: 2048, url: "/media/catalog/5e496b28d84b.webp" }, 201);
			writes.push({ path, body: JSON.parse(request.postData() ?? "{}") });
			return json(route, path.endsWith("/order") ? { configured: true, data: BANNERS } : { ...BANNERS[0], version: 3 }, 201);
		},
	);
	return writes;
}

before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	mkdirSync(renders, { recursive: true });
});
after(async () => {
	try {
		await browser?.close();
		for (const name of storedImages) await unlink(join(privateDirectory("catalog-media"), name)).catch(() => {});
	} finally {
		await cleanup(identity, users);
		await identity.sql.end();
	}
});

test("S110 Banner Beranda is gated to owner and ecommerce_admin", async () => {
	const cs = await staff("customer_service");
	const denied = await open(cs);
	try {
		await denied.page.goto(`${origin}/admin/banners`);
		await expect(denied.page.getByRole("heading", { name: "Akses konten toko diperlukan" })).toBeVisible();
		await expect(denied.page.getByTestId("banners-page")).toHaveCount(0);
	} finally {
		await denied.close();
	}
	const editor = await staff("ecommerce_admin");
	const allowed = await open(editor);
	try {
		await allowed.page.goto(`${origin}/admin/banners`);
		await expect(allowed.page.getByRole("heading", { name: "Banner Beranda", level: 1 })).toBeVisible();
		await expect(allowed.page.getByTestId("banners-list").or(allowed.page.getByTestId("banners-empty"))).toBeVisible();
		assert.deepEqual(allowed.errors, []);
	} finally {
		await allowed.close();
	}
});

test("S110 list, preview, reorder, create (WIB schedule, link check, upload) and retire send the right writes", async () => {
	const owner = await staff("owner");
	const { page, errors, close } = await open(owner);
	try {
		const writes = await mockApi(page);
		await page.goto(`${origin}/admin/banners`);
		for (const b of BANNERS) await expect(page.getByTestId(`banner-row-${b.id}`)).toBeVisible();
		await expect(page.getByTestId(`banner-phase-${BANNERS[0].id}`)).toHaveText("Tayang");
		await expect(page.getByTestId(`banner-phase-${BANNERS[2].id}`)).toHaveText("Terjadwal");
		// The preview is the storefront rail with only the banners live now, inert.
		const preview = page.getByTestId("banners-preview");
		await expect(preview.locator(".banner-card")).toHaveCount(2);
		await expect(preview.getByText("Gaya pria sehari-hari")).toHaveCount(0);
		await expect(preview.locator("[inert]")).toHaveCount(1);
		await page.screenshot({ path: join(renders, "banners-owner-1440.png"), fullPage: true });

		// Reorder: move the first banner down, save once with a password.
		await expect(page.getByTestId(`banner-up-${BANNERS[0].id}`)).toBeDisabled();
		await page.getByTestId(`banner-down-${BANNERS[0].id}`).click();
		// Keyboard: at the list edge the pressed arrow disables, so focus moves to the row's other arrow; moves are announced.
		await page.getByTestId(`banner-down-${BANNERS[0].id}`).press("Enter");
		await expect(page.getByTestId(`banner-up-${BANNERS[0].id}`)).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(page.getByTestId("banners-moved")).toHaveText(`${BANNERS[0].title} di urutan 2 dari 3.`);
		await expect(page.getByTestId("banners-order-save")).toBeVisible();
		await expect(page.getByTestId("banners-create")).toBeDisabled();
		await page.getByTestId("banners-order-save").click();
		await page.getByTestId("banner-dialog-reason").fill("Urutan November");
		await page.getByTestId("banner-dialog-password").fill(owner.password);
		await page.getByRole("button", { name: "Simpan urutan" }).last().click();
		await expect(page.getByTestId("banners-notice")).toHaveText(/Urutan banner disimpan/);
		const order = writes.at(-1);
		assert.ok(order);
		assert.equal(order.path, "/api/v1/admin/home-banners/order");
		assert.deepEqual(
			(order.body.banners as { id: string }[]).map((b) => b.id),
			[BANNERS[1].id, BANNERS[0].id, BANNERS[2].id],
		);
		assert.equal(order.body.reauthentication_proof, "synthetic-proof");

		// Create: the WIB wall-clock window becomes absolute instants; an external link is refused before sending.
		await page.getByTestId("banners-create").click();
		const form = page.getByTestId("banner-form");
		await expect(form).toBeVisible();
		await page.getByTestId("banner-image-input").setInputFiles({ name: "banner.webp", mimeType: "image/webp", buffer: randomBytes(64) });
		await expect(form.getByText("1080 × 1350 px")).toBeVisible();
		await page.getByTestId("banner-alt").fill("Pengharum ruangan di atas meja");
		await page.getByTestId("banner-title").fill("Wangi rumah");
		await page.getByTestId("banner-subtitle").fill("Pengharum ruangan, setiap pilihan lengkap Rp99.000.");
		await page.getByTestId("banner-href").fill("https://evil.example/promo");
		await expect(page.getByTestId("banner-href")).toHaveAttribute("aria-invalid", "true");
		await page.getByTestId("banner-href").fill("/cari?q=pengharum ruangan");
		await page.getByTestId("banner-starts").fill("2026-12-01T00:00");
		await page.getByTestId("banner-ends").fill("2026-12-08T00:00");
		await page.getByTestId("banner-reason").fill("Kampanye Desember");
		await page.getByTestId("banner-password").fill(owner.password);
		await expect(page.getByTestId("banner-preview").locator(".banner-card")).toContainText("Wangi rumah");
		await page.screenshot({ path: join(renders, "banners-editor-1440.png") });
		await page.getByRole("button", { name: "Simpan banner" }).click();
		await expect(page.getByTestId("banners-notice")).toHaveText(/dibuat/);
		const create = writes.at(-1);
		assert.equal(create?.path, "/api/v1/admin/home-banners");
		assert.equal(create?.body.starts_at, "2026-11-30T17:00:00.000Z");
		assert.equal(create?.body.ends_at, "2026-12-07T17:00:00.000Z");
		assert.equal(create?.body.href, "/cari?q=pengharum+ruangan");
		assert.equal(create?.body.image_sha256, "a".repeat(64));
		assert.equal(create?.body.subtitle, "Pengharum ruangan, setiap pilihan lengkap Rp99.000.");

		// Retire with reason and password.
		await page.getByTestId(`banner-retire-${BANNERS[1].id}`).click();
		await page.getByTestId("banner-dialog-reason").fill("Kampanye selesai");
		await page.getByTestId("banner-dialog-password").fill(owner.password);
		await page.getByRole("button", { name: "Arsipkan banner" }).click();
		await expect(page.getByTestId("banners-notice")).toHaveText(/diarsipkan/);
		assert.equal(writes.at(-1)?.path, `/api/v1/admin/home-banners/${BANNERS[1].id}/retirements`);
		assert.equal(writes.at(-1)?.body.expected_version, 2);

		await page.getByTestId(`banner-history-${BANNERS[0].id}`).click();
		await expect(page.getByTestId("banner-version-1")).toBeVisible();
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("S110 Banner Beranda renders at 390 (touch) and 768 with 44 px targets and no page scroll sideways", async () => {
	const owner = await staff("owner");
	for (const [width, touch] of [
		[390, true],
		[768, false],
	] as const) {
		const { page, errors, close } = await open(owner, { width, height: 900 }, touch);
		try {
			await mockApi(page);
			await page.goto(`${origin}/admin/banners`);
			await expect(page.getByTestId(`banner-row-${BANNERS[0].id}`)).toBeVisible();
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "no horizontal page scroll");
			if (touch) {
				const box = await page.getByTestId(`banner-down-${BANNERS[0].id}`).boundingBox();
				assert.ok(box && box.height >= 44 && box.width >= 44, "reorder buttons are 44 px touch targets");
			}
			await page.screenshot({ path: join(renders, `banners-owner-${width}.png`), fullPage: true });
			assert.deepEqual(errors, []);
		} finally {
			await close();
		}
	}
});

test("S110 a real banner replaces the home rail defaults while current and disappears when retired", async () => {
	const owner = await staff("owner");
	const { page, close } = await open(owner);
	try {
		await page.goto(`${origin}/admin/banners`);
		const title = `Synthetic banner ${randomUUID().slice(0, 8)}`;
		// A unique synthetic WebP (VP8X header, 1080x1350) uploaded and used through the real API.
		const bytes = Buffer.concat([Buffer.alloc(30), randomBytes(512)]);
		bytes.write("RIFF", 0, "latin1");
		bytes.writeUInt32LE(bytes.length - 8, 4);
		bytes.write("WEBPVP8X", 8, "latin1");
		bytes.writeUInt32LE(10, 16);
		bytes.writeUIntLE(1079, 24, 3);
		bytes.writeUIntLE(1349, 27, 3);
		const result = await page.evaluate(
			async ({ bytes, title, password }) => {
				const post = async (path: string, body: BodyInit, type = "application/json") => {
					const response = await fetch(path, { method: "POST", headers: { "content-type": type, "idempotency-key": crypto.randomUUID() }, body });
					return { status: response.status, body: await response.json() };
				};
				const proof = async () => (await post("/api/v1/me/reauthentication-proofs", JSON.stringify({ password, action: "home_banner.write", subject_id: "home-banners" }))).body.proof;
				const image = await post("/api/v1/admin/home-banner-images", new Uint8Array(bytes), "image/webp");
				const now = Date.now();
				const created = await post(
					"/api/v1/admin/home-banners",
					JSON.stringify({
						title,
						subtitle: null,
						action_label: "Lihat pilihan",
						href: "/promo",
						image_sha256: image.body.sha256,
						image_alt: "Synthetic",
						tint: null,
						starts_at: new Date(now - 60000).toISOString(),
						ends_at: new Date(now + 3600000).toISOString(),
						active: true,
						reason: "Synthetic end-to-end",
						reauthentication_proof: await proof(),
					}),
				);
				return { image, created, proof: await proof() };
			},
			{ bytes: [...bytes], title, password: owner.password },
		);
		assert.equal(result.image.status, 201);
		storedImages.push(`${result.image.body.sha256}.webp`);
		assert.equal(result.created.status, 201, JSON.stringify(result.created.body));
		const home = await browser.newPage();
		try {
			await home.goto(origin);
			const rail = home.locator(".home-banners");
			await expect(rail.getByText(title)).toBeVisible();
			await expect(rail.getByRole("link", { name: new RegExp(title) })).toHaveAttribute("href", "/promo");
			const retired = await page.evaluate(
				async ({ id, version, proof }) => {
					const response = await fetch(`/api/v1/admin/home-banners/${id}/retirements`, {
						method: "POST",
						headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
						body: JSON.stringify({ expected_version: version, reason: "Synthetic end-to-end done", reauthentication_proof: proof }),
					});
					return response.status;
				},
				{ id: result.created.body.id, version: result.created.body.version, proof: result.proof },
			);
			assert.equal(retired, 201);
			await home.reload();
			await expect(home.getByText(title)).toHaveCount(0);
		} finally {
			await home.close();
		}
	} finally {
		await close();
	}
});
