import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect, type Page } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import { commerceActor } from "../../src/modules/checkout/access.ts";
import { createCart } from "../../src/modules/checkout/carts.ts";
import { releaseReservation } from "../../src/modules/inventory/reservations.ts";
import { seedCommerce } from "../../src/modules/local/commerce.ts";
import {
	advanceFixtureClock,
	readFixtureClock,
} from "../../src/modules/local/fixtures.ts";
import { prepareStorefront } from "../../src/modules/local/storefront.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { resetBrowserAuthLimits } from "../integration/storefront-http-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S126 / DEC-017 on the built web (127.0.0.1:3099) and the LOCAL database: the /akun "Lengkapi profil" card
// (progress, one reason per field, edit and delete), separate unticked WhatsApp/email promo opt-ins that grant
// and withdraw with an audit record, checkout prefilled from the main address, and the admin counts-only screen.
// Renders at 390 touch, 768 and 1440 with no horizontal scroll and no console errors. Synthetic users are removed.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
const renders = join(RENDERS, "s126");
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
let browser: Browser;
let owner: User;
let seeded: Awaited<ReturnType<typeof seedCommerce>>;
let curated: Awaited<ReturnType<typeof prepareStorefront>>;
let namespace: string;

async function open(
	user: User,
	viewport: { width: number; height: number },
	touch = false,
) {
	const context = await browser.newContext({
		viewport,
		hasTouch: touch,
		isMobile: touch,
		reducedMotion: "reduce",
	});
	await context.addCookies(
		[...user.browser.cookies].map(([name, value]) => ({
			name,
			value,
			domain: "127.0.0.1",
			path: "/",
		})),
	);
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	return { page, errors, close: () => context.close() };
}
const noOverflow = (page: Page) =>
	page.evaluate(
		() => document.documentElement.scrollWidth <= window.innerWidth,
	);
async function capture(page: Page, name: string) {
	mkdirSync(renders, { recursive: true });
	await page.screenshot({ path: join(renders, `${name}.png`), fullPage: true });
}

before(async () => {
	await resetBrowserAuthLimits();
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
	});
	owner = await actor(identity, "owner", []);
	users.push(owner);
	await enroll(owner.browser, owner.password);
	namespace = `s126-${randomUUID().slice(0, 8)}`;
	const request = () => owner.browser.request("/api/v1/admin/products");
	seeded = await seedCommerce(request(), identity, "local", namespace);
	curated = await prepareStorefront(
		request(),
		identity,
		"local",
		namespace,
		seeded,
	);
	const clock = await readFixtureClock("local", namespace);
	const seconds = Math.ceil((Date.now() - Date.parse(clock.now)) / 1000);
	if (seconds > 0)
		await advanceFixtureClock("local", namespace, seconds, clock.version);
});

after(async () => {
	try {
		await browser?.close();
		for (const reservation of Object.values(seeded?.reservations ?? {})) {
			await identity.sql
				.begin((tx) =>
					releaseReservation(tx, reservation, "S126 browser fixture finished"),
				)
				.catch(() => undefined);
		}
		for (const user of users) {
			await identity.sql`delete from app.marketing_consent where user_id=${user.id}`;
			await identity.sql`delete from app.buyer_address where user_id=${user.id}`;
			await identity.sql`delete from app.buyer_notification_preference where user_id=${user.id}`;
			await identity.sql`delete from app.buyer_profile where user_id=${user.id}`;
		}
		await cleanup(identity, users);
	} finally {
		await identity.sql.end();
	}
});

test("/akun Lengkapi profil: progress, reasons, edit and delete each field, unticked promo opt-ins that grant and withdraw", {
	timeout: 120_000,
}, async () => {
	const buyer = await actor(identity, "buyer", []);
	users.push(buyer);
	const { page, errors, close } = await open(
		buyer,
		{ width: 390, height: 844 },
		true,
	);
	try {
		await page.goto(`${origin}/akun`);
		const card = page.getByTestId("profile-completion");
		await card.getByRole("heading", { name: "Lengkapi profil" }).waitFor();
		await expect(card.getByTestId("completion-count")).toHaveText(
			"0 dari 5 terisi",
		);
		for (const reason of [
			"Checkout langsung terisi",
			"Untuk kabar pesanan",
			"Untuk voucher ulang tahun",
			"Untuk rekomendasi produk",
			"Untuk promo kategori",
		]) {
			assert.equal(
				await card.getByText(reason, { exact: false }).count(),
				1,
				`One reason: ${reason}`,
			);
		}
		await expect(card.getByTestId("profile-programs")).toContainText(
			"Doorprize: segera.",
		);

		// Promo consent: both unticked; WhatsApp needs a number first; nothing is recorded by opening the page.
		const consents = page.getByTestId("promo-consents");
		await expect(consents.getByTestId("consent-whatsapp")).not.toBeChecked();
		await expect(consents.getByTestId("consent-email")).not.toBeChecked();
		await expect(consents.getByTestId("consent-whatsapp")).toBeDisabled();
		await expect(consents.getByTestId("consent-email")).toBeEnabled();
		assert.equal(
			(
				await identity.sql`select count(*)::int n from app.marketing_consent where user_id=${buyer.id}`
			)[0].n,
			0,
		);

		// Birthday without a year.
		await card.getByTestId("completion-birthday").locator("summary").click();
		await card.getByTestId("birthday-save").click();
		await expect(page.getByTestId("account-status-banner")).toHaveText(
			"Pilih tanggal dan bulan lahir.",
		);
		await card.getByTestId("birth-day").selectOption("17");
		await card.getByTestId("birth-month").selectOption("8");
		await card.getByTestId("birthday-save").click();
		await expect(page.getByTestId("account-status-banner")).toHaveText(
			"Tanggal lahir disimpan.",
		);
		await expect(card.getByTestId("completion-state-birthday")).toHaveText(
			"Terisi",
		);
		await expect(card.getByTestId("completion-count")).toHaveText(
			"1 dari 5 terisi",
		);

		// Gender: the explicit "Tidak ingin menyebutkan" answer counts as filled.
		await card.getByTestId("completion-gender").locator("summary").click();
		await card.getByLabel("Tidak ingin menyebutkan").check();
		await card.getByTestId("gender-save").click();
		await expect(card.getByTestId("completion-state-gender")).toHaveText(
			"Terisi",
		);

		// Favourite categories from the live catalog.
		await card.getByTestId("completion-categories").locator("summary").click();
		const boxes = card
			.getByTestId("completion-categories")
			.getByRole("checkbox");
		assert.ok((await boxes.count()) > 0, "Public departments are offered");
		await boxes.first().check();
		await card.getByTestId("categories-save").click();
		await expect(
			card.getByTestId("completion-state-favourite_categories"),
		).toHaveText("Terisi");

		// Main address through the address book.
		await card
			.getByTestId("completion-main-address")
			.locator("summary")
			.click();
		const form = card.getByTestId("main-address-form");
		await form.getByLabel("Nomor HP penerima").fill("+62 812-3456-0010");
		await expect(form.getByLabel("Nomor HP penerima")).toHaveValue(
			"081234560010",
		);
		await form
			.getByTestId("main-address-destination")
			.selectOption("test-malang");
		await form
			.getByTestId("main-address-street")
			.fill("Jl. Contoh No. 26 RT 01");
		await form.getByTestId("main-address-save").click();
		await expect(page.getByTestId("account-status-banner")).toHaveText(
			"Alamat utama disimpan.",
		);
		await expect(card.getByTestId("completion-state-main_address")).toHaveText(
			"Terisi",
		);
		await expect(card.getByTestId("completion-count")).toHaveText(
			"4 dari 5 terisi",
		);
		await expect(page.getByTestId("address-book-list")).toContainText(
			"Jl. Contoh No. 26 RT 01",
		);
		const [details] =
			await identity.sql`select birth_day, birth_month, birth_year, gender, cardinality(favourite_category_ids)::int as n from app.buyer_profile where user_id=${buyer.id}`;
		assert.deepEqual(
			{ ...details },
			{
				birth_day: 17,
				birth_month: 8,
				birth_year: null,
				gender: "undisclosed",
				n: 1,
			},
		);

		// Email promo: tick grants (with policy version), untick withdraws; both leave records.
		await consents.getByTestId("consent-email").check();
		await expect(consents.getByTestId("consent-email-state")).toContainText(
			"Disetujui",
		);
		await expect(consents.getByTestId("consent-email-state")).toContainText(
			"local-privacy-v1",
		);
		assert.ok(await noOverflow(page), "390 touch: no horizontal page scroll");
		await capture(page, "akun-profile-390-touch");
		await consents.getByTestId("consent-email").uncheck();
		await expect(consents.getByTestId("consent-email-state")).toHaveText(
			"Belum disetujui.",
		);
		const records =
			await identity.sql`select channel, policy_version, source, withdrawn_at is not null as withdrawn from app.marketing_consent where user_id=${buyer.id}`;
		assert.deepEqual(
			records.map((r) => ({ ...r })),
			[
				{
					channel: "email",
					policy_version: "local-privacy-v1",
					source: "account",
					withdrawn: true,
				},
			],
		);
		await consents.getByTestId("consent-history").locator("summary").click();
		await expect(consents.getByTestId("consent-history")).toContainText(
			"dibatalkan",
		);

		// Delete: one field, then everything optional; reload keeps the result.
		await card.getByTestId("birthday-delete").click();
		await expect(card.getByTestId("completion-state-birthday")).toHaveText(
			"Belum diisi",
		);
		await card.getByTestId("profile-details-delete-all").click();
		await expect(page.getByTestId("account-status-banner")).toHaveText(
			"Tanggal lahir, jenis kelamin, dan kategori favorit dihapus.",
		);
		await page.reload();
		await expect(page.getByTestId("completion-count")).toHaveText(
			"1 dari 5 terisi",
		);
		assert.deepEqual(errors, []);
	} finally {
		await close();
	}
});

test("checkout starts from the profile's main address", {
	timeout: 120_000,
}, async () => {
	const buyer = await actor(identity, "buyer", []);
	users.push(buyer);
	const address = {
		label: "Rumah",
		recipient_name: "Penerima Profil",
		phone: "081234560020",
		street: "Jl. Prefill No. 7",
		district: "Kecamatan Contoh A",
		city: "Malang",
		province: "Jawa Timur",
		postcode: "00001",
		destination_code: "test-malang",
	};
	const { handleAccounts } = await import(
		"../../src/modules/accounts/service.ts"
	);
	const add = buyer.browser.request("/api/v1/me/addresses", {
		address,
		make_default: true,
	});
	add.headers.set("idempotency-key", randomUUID());
	assert.equal((await handleAccounts(add, identity)).status, 201);
	const product = curated.products["shirt-cream"];
	assert.ok(product.publication_id);
	const body = {
		lines: [
			{
				variant_id: product.offer_id,
				quantity: 1,
				expected_publication_id: product.publication_id,
			},
		],
	};
	const cartRequest = buyer.browser.request("/api/v1/carts", body);
	const user = await commerceActor(cartRequest, identity);
	assert.equal(user?.kind, "user");
	if (user)
		await identity.sql.begin((tx) =>
			createCart(tx, cartRequest, identity, user, body, {
				clock_namespace: namespace,
			}),
		);
	for (const [viewport, touch, name] of [
		[{ width: 390, height: 844 }, true, "checkout-prefill-390-touch"],
		[{ width: 1440, height: 900 }, false, "checkout-prefill-1440"],
	] as const) {
		const { page, errors, close } = await open(buyer, viewport, touch);
		try {
			await page.goto(`${origin}/checkout`);
			await expect(page.locator("#checkout-recipient_name")).toHaveValue(
				"Penerima Profil",
			);
			await expect(page.locator("#checkout-phone")).toHaveValue("081234560020");
			await expect(page.locator("#checkout-email")).toHaveValue(buyer.email);
			await expect(page.locator("#checkout-destination_id")).toHaveValue(
				"test-malang",
			);
			await expect(page.locator("#checkout-address_line")).toHaveValue(
				"Jl. Prefill No. 7",
			);
			assert.ok(await noOverflow(page), `${name}: no horizontal page scroll`);
			await capture(page, name);
			assert.deepEqual(errors, []);
		} finally {
			await close();
		}
	}
});

test("/akun and admin Segmen Pembeli render at 390 touch, 768 and 1440 without overflow; counts only", {
	timeout: 120_000,
}, async () => {
	const buyer = await actor(identity, "buyer", []);
	users.push(buyer);
	const cs = await actor(identity, "customer_service", []);
	users.push(cs);
	await enroll(cs.browser, cs.password);
	for (const [viewport, touch, suffix] of [
		[{ width: 390, height: 844 }, true, "390-touch"],
		[{ width: 768, height: 1024 }, false, "768"],
		[{ width: 1440, height: 900 }, false, "1440"],
	] as const) {
		const account = await open(buyer, viewport, touch);
		try {
			await account.page.goto(`${origin}/akun`);
			await account.page.getByTestId("profile-completion").waitFor();
			await account.page
				.getByTestId("completion-birthday")
				.locator("summary")
				.click();
			assert.ok(
				await noOverflow(account.page),
				`akun ${suffix}: no horizontal page scroll`,
			);
			await capture(account.page, `akun-${suffix}`);
			assert.deepEqual(account.errors, []);
		} finally {
			await account.close();
		}
		const admin = await open(owner, viewport, touch);
		try {
			await admin.page.goto(`${origin}/admin/buyer-segments`);
			await admin.page
				.getByRole("heading", { level: 1, name: "Segmen Pembeli" })
				.waitFor();
			for (const id of [
				"segment-consent",
				"segment-programs",
				"segment-birth-months",
				"segment-categories",
			]) {
				await expect(admin.page.getByTestId(id)).toBeVisible();
			}
			await expect(
				admin.page.getByTestId("segment-birth-months").getByRole("row"),
			).toHaveCount(13);
			await expect(admin.page.getByTestId("segment-programs")).toContainText(
				"Doorprize",
			);
			const text = (await admin.page.locator("main").textContent()) ?? "";
			assert.doesNotMatch(
				text,
				/@example|\+62|08\d{8}/,
				"No buyer contact on the screen",
			);
			assert.ok(
				await noOverflow(admin.page),
				`admin ${suffix}: no horizontal page scroll`,
			);
			await capture(admin.page, `admin-segments-${suffix}`);
			assert.deepEqual(admin.errors, []);
		} finally {
			await admin.close();
		}
	}
	const denied = await open(cs, { width: 1440, height: 900 });
	try {
		await denied.page.goto(`${origin}/admin/buyer-segments`);
		await denied.page
			.getByRole("heading", { name: "Akses pemasaran diperlukan" })
			.waitFor();
		assert.equal(
			await denied.page.getByTestId("buyer-segments-page").count(),
			0,
		);
	} finally {
		await denied.close();
	}
});
