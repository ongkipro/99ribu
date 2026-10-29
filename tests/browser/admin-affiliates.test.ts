import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
	type Browser,
	chromium,
	expect,
	type Request as PlaywrightRequest,
} from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { handleAccess } from "../../src/modules/access/routes.ts";
import { handleAffiliateProfile } from "../../src/modules/affiliates/profile.ts";
import { handleAffiliateRates } from "../../src/modules/affiliates/routes.ts";
import {
	actor,
	type BrowserSession,
	enroll,
} from "../contract/access-fixture.ts";
import { closeFulfillmentActor } from "../integration/fulfillment-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S132 Affiliates admin (/admin/afiliasi and /admin/afiliasi/[affiliateNo]) against the built server on
// 127.0.0.1:3099. NOT executed by the worker agent: the coordinator runs browser suites serially
// (`--case=admin-affiliates` in browser mode).
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
type User = {
	id: string;
	email: string;
	password: string;
	browser: BrowserSession;
};
const users: User[] = [];
let browser: Browser;
const renders = join(RENDERS, "s132");
const marker = randomUUID().slice(0, 8).toUpperCase();

async function staff(role: Role, enrolled = true) {
	const user = await actor(identity, role, []);
	users.push(user);
	if (enrolled) await enroll(user.browser, user.password);
	return user;
}

async function createAffiliate(suffix: string, displayName: string) {
	const user = await actor(identity, "affiliate", []);
	users.push(user);
	const req = user.browser.request("/api/v1/me/affiliate", {
		terms_version: "v1",
		referral_code: `S132B-${marker}-${suffix}`,
		display_name: displayName,
		beneficiary_bank_code: "BCA",
		beneficiary_account_number: "8877665544332211",
		beneficiary_account_holder: `Holder Canary ${marker}`,
	});
	req.headers.set("idempotency-key", randomUUID());
	const res = await handleAffiliateProfile(req, identity);
	assert.equal(res.status, 201);
	const body = (await res.json()) as { id: string };
	const [numbered] = await identity.sql`select admin_no::int as admin_no from app.affiliate_account where id = ${body.id}`;
	return { user, affiliateId: body.id, adminNo: Number(numbered.admin_no), code: `S132B-${marker}-${suffix}` };
}

async function open(
	user: User,
	viewport = { width: 1440, height: 1000 },
	touch = false,
) {
	const context = await browser.newContext({
		viewport,
		reducedMotion: "reduce",
		hasTouch: touch,
		isMobile: touch,
	});
	await context.addCookies(
		[...user.browser.cookies].map(([cookie, value]) => ({
			name: cookie,
			value,
			domain: "127.0.0.1",
			path: "/",
		})),
	);
	const page = await context.newPage();
	page.setDefaultTimeout(15000);
	const errors: string[] = [];
	page.on("pageerror", (error: Error) => errors.push(String(error)));
	page.on("request", (request: PlaywrightRequest) =>
		assert.equal(
			new URL(request.url()).origin,
			origin,
			"No external browser request",
		),
	);
	return { page, errors, close: () => context.close() };
}

before(async () => {
	browser = await chromium.launch({
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
	});
	mkdirSync(renders, { recursive: true });
});

after(async () => {
	try {
		await browser?.close();
	} finally {
		for (const who of users) {
			await closeFulfillmentActor(identity, who);
		}
		await identity.sql.end();
	}
});

test("S132 owner filters affiliate list, opens detail, sees stale version refused in dialog, and saves a prospective rate", async () => {
	const owner = await staff("owner");
	const partner = await createAffiliate("A", `Mitra Browser ${marker}`);
	const view = await open(owner);
	try {
		await view.page.goto(`${origin}/admin/afiliasi`);
		await expect(
			view.page.getByRole("heading", { name: "Afiliasi", level: 1 }),
		).toBeVisible();

		await view.page.getByTestId("affiliates-code").fill(partner.code);
		await view.page.getByTestId("affiliates-filter-submit").click();
		const row = view.page.getByTestId(`affiliate-row-${partner.affiliateId}`);
		await expect(row).toBeVisible();
		await expect(row).toContainText(partner.code);

		// Open detail page
		await view.page.getByTestId(`affiliate-open-${partner.affiliateId}`).click();
		await expect(view.page.getByTestId("affiliate-detail-page")).toBeVisible();
		// The console addresses the partner by its admin number, never the UUID.
		await expect(view.page).toHaveURL(`${origin}/admin/afiliasi/${partner.adminNo}`);
		await expect(view.page.getByTestId("affiliate-title")).toContainText(
			`Mitra Browser ${marker}`,
		);
		await expect(view.page.getByTestId("affiliate-rate-empty")).toBeVisible();

		// Open rate dialog (freezes expectedVersion = 0 on mount)
		await view.page.getByTestId("affiliate-rate-open").click();
		const dialog = view.page.getByRole("dialog");
		await expect(dialog).toBeVisible();

		// Wrong password -> refused
		await dialog.getByTestId("affiliate-rate-bps").fill("1250");
		await dialog
			.getByTestId("affiliate-rate-reason")
			.fill("Penyesuaian tarif mitra utama");
		await dialog
			.getByTestId("affiliate-rate-password")
			.fill("kata-sandi-salah");
		await dialog.getByRole("button", { name: "Simpan tarif" }).click();
		await expect(dialog.getByRole("alert")).toContainText("Kata sandi salah");

		// Valid save -> v1 created
		await identity.sql`delete from app.auth_rate_limit where key = ${`access-proof:${owner.id}`}`;
		await dialog.getByTestId("affiliate-rate-password").fill(owner.password);
		await dialog.getByRole("button", { name: "Simpan tarif" }).click();
		await expect(view.page.getByTestId("affiliate-rate-notice")).toContainText(
			"Tarif versi 1",
		);
		await expect(view.page.getByTestId("affiliate-rate-row-1")).toBeVisible();
		await expect(view.page.getByTestId("affiliate-rate-row-1")).toContainText(
			"12,5%",
		);

		// Open dialog again (freezes expectedVersion = 1 on mount), then advance rate_revision in DB behind its back:
		// first submit gets 409 VERSION_CONFLICT and reloads behind the dialog, and a second submit in the still-open
		// dialog STILL gets 409 VERSION_CONFLICT because capturedVersion stays frozen at 1.
		await view.page.getByTestId("affiliate-rate-open").click();
		await expect(dialog).toBeVisible();
		await identity.sql`delete from app.auth_rate_limit where key = ${`access-proof:${owner.id}`}`;
		const proofReq = owner.browser.request("/api/v1/me/reauthentication-proofs", {
			password: owner.password,
			action: "affiliate_rate.version",
			subject_id: partner.affiliateId,
		});
		proofReq.headers.set("idempotency-key", randomUUID());
		const proofRes = await handleAccess(proofReq, identity);
		assert.equal(proofRes.status, 201);
		const concurrentProof = String((await proofRes.json()).proof);
		const concurrentReq = owner.browser.request(`/api/v1/admin/affiliates/${partner.affiliateId}/rates`, {
			basis_points: 1400,
			effective_at: null,
			expected_version: 1,
			reason: "Perubahan paralel di luar dialog",
			reauthentication_proof: concurrentProof,
		});
		concurrentReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleAffiliateRates(concurrentReq, identity)).status, 201);

		await identity.sql`delete from app.auth_rate_limit where key = ${`access-proof:${owner.id}`}`;
		await dialog.getByTestId("affiliate-rate-bps").fill("1600");
		await dialog.getByTestId("affiliate-rate-reason").fill("Percobaan dari dialog lama");
		await dialog.getByTestId("affiliate-rate-password").fill(owner.password);
		await dialog.getByRole("button", { name: "Simpan tarif" }).click();
		await expect(dialog.getByRole("alert")).toContainText("VERSION_CONFLICT");

		// Clicking submit a second time without closing the dialog still sends capturedVersion = 1 and is refused
		await identity.sql`delete from app.auth_rate_limit where key = ${`access-proof:${owner.id}`}`;
		await dialog.getByRole("button", { name: "Simpan tarif" }).click();
		await expect(dialog.getByRole("alert")).toContainText("VERSION_CONFLICT");
		await dialog.getByRole("button", { name: "Batal" }).click();
		await expect(view.page.getByTestId("affiliate-rate-row-2")).toBeVisible();
		await view.page.screenshot({
			path: join(renders, "affiliates-detail-owner-1440.png"),
			fullPage: true,
		});
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});

test("S132 finance reads affiliate list and detail read-only without edit button; ecommerce_admin is denied", async () => {
	const finance = await staff("finance");
	const ecommerce = await staff("ecommerce_admin");
	const partner = await createAffiliate("F", `Mitra Keuangan ${marker}`);

	const finView = await open(finance);
	try {
		// An old UUID link redirects once to the numeric URL.
		await finView.page.goto(
			`${origin}/admin/afiliasi/${partner.affiliateId}`,
		);
		await expect(
			finView.page.getByTestId("affiliate-detail-page"),
		).toBeVisible();
		await expect(finView.page).toHaveURL(`${origin}/admin/afiliasi/${partner.adminNo}`);
		await finView.page.goto(`${origin}/admin/afiliasi/${partner.adminNo}`);
		await expect(
			finView.page.getByTestId("affiliate-detail-page"),
		).toBeVisible();
		await expect(
			finView.page.getByTestId("affiliate-rate-readonly"),
		).toBeVisible();
		await expect(finView.page.getByTestId("affiliate-rate-open")).toHaveCount(
			0,
		);
		// Anything that is neither a canonical number nor a UUID is not found.
		await finView.page.goto(`${origin}/admin/afiliasi/007`);
		await expect(finView.page.getByTestId("affiliate-detail-page")).toHaveCount(0);
		await expect(finView.page.getByTestId("affiliate-missing")).toHaveCount(0);
		assert.deepEqual(finView.errors, []);
	} finally {
		await finView.close();
	}

	const ecoView = await open(ecommerce);
	try {
		await ecoView.page.goto(`${origin}/admin/afiliasi`);
		await expect(
			ecoView.page.getByRole("heading", { name: "Akses afiliasi diperlukan" }),
		).toBeVisible();
		await expect(ecoView.page.getByTestId("affiliates-page")).toHaveCount(0);
		// A valid number (or the old UUID) is denied exactly like the list: no lookup, no redirect, no row.
		for (const target of [partner.adminNo, partner.affiliateId]) {
			await ecoView.page.goto(`${origin}/admin/afiliasi/${target}`);
			await expect(
				ecoView.page.getByRole("heading", { name: "Akses afiliasi diperlukan" }),
			).toBeVisible();
			await expect(ecoView.page.getByTestId("affiliate-detail-page")).toHaveCount(0);
		}
		assert.deepEqual(ecoView.errors, []);
	} finally {
		await ecoView.close();
	}
});

test("S132 phone, tablet and desktop viewports: zero horizontal overflow on list and detail", async () => {
	const owner = await staff("owner");
	const partner = await createAffiliate("V", `Mitra Viewport ${marker}`);
	for (const [label, viewport, touch] of [
		["390", { width: 390, height: 844 }, true],
		["768", { width: 768, height: 1024 }, false],
		["1440", { width: 1440, height: 1000 }, false],
	] as const) {
		const view = await open(owner, viewport, touch);
		try {
			await view.page.goto(`${origin}/admin/afiliasi`);
			await expect(view.page.getByTestId("affiliates-page")).toBeVisible();
			const overflow = () =>
				view.page.evaluate(
					() =>
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth,
				);
			assert.ok(
				(await overflow()) <= 0,
				`list ${label}: horizontal overflow ${await overflow()}px`,
			);
			await view.page.screenshot({
				path: join(renders, `affiliates-list-${label}.png`),
				fullPage: false,
			});

			await view.page.goto(
				`${origin}/admin/afiliasi/${partner.adminNo}`,
			);
			await expect(
				view.page.getByTestId("affiliate-detail-page"),
			).toBeVisible();
			assert.ok(
				(await overflow()) <= 0,
				`detail ${label}: horizontal overflow ${await overflow()}px`,
			);
			await view.page.screenshot({
				path: join(renders, `affiliates-detail-${label}.png`),
				fullPage: false,
			});
			assert.deepEqual(view.errors, []);
		} finally {
			await view.close();
		}
	}
});
