import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { type Browser, chromium, expect } from "@playwright/test";
import { createLocalAuth } from "../../src/modules/access/auth.ts";
import type { Role } from "../../src/modules/access/policy.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { RENDERS } from "../render-root.ts";

// S138 Akun Pembeli (/admin/customers, spec 17 B29) against the built web on the canonical origin and the local DB.
// Customer service looks up a seeded buyer by phone and by email through the real API: masked contact, ticket history,
// the order-access notice, no full phone/email anywhere in the page, the audit row; owner opens an account that has a
// real order (a demo-orders account: `npm run fixture -- demo-orders local` must have run); invalid, unknown, rate
// limited and failing answers have their own states; finance is denied; phone width has no horizontal overflow.
// Selectors: form `customer-form`, input `customer-input` (label "Nomor HP pembeli" / "Email pembeli"), submit
// `customer-submit`, kind chips `customer-kind-phone|email`, result region `customer-result`, one `customer-account` per
// account, `customer-order-row` / `customer-ticket-row` per history row, `customer-empty`, `customer-idle`,
// `customer-limited`.
const origin = "http://127.0.0.1:3099";
const identity = createLocalAuth("local");
type User = Awaited<ReturnType<typeof actor>>;
const users: User[] = [];
const buyers: User[] = [];
const conversations: string[] = [];
let browser: Browser;
const renders = join(RENDERS, "s138");
const stamp = String(randomInt(10_000_000, 99_999_999));
const tag = randomUUID().slice(0, 8);
const PHONE = `+6285${stamp}`;
const LOCAL_PHONE = `085${stamp}`;
const MASKED_PHONE = `${LOCAL_PHONE.slice(0, 2)}${"•".repeat(LOCAL_PHONE.length - 6)}${LOCAL_PHONE.slice(-4)}`;
const EMAIL = `lokal.${tag}@example.invalid`;
const MASKED_EMAIL = "l•••@example.invalid";
const STREET = `Jl. Rahasia Browser ${tag}`;
const CHAT = `Rekening BCA 55${stamp}1 untuk transfer`;
let buyer: User;

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
	const lookups: string[] = [];
	page.on("pageerror", (error) => errors.push(String(error)));
	page.on("request", (request) => {
		assert.equal(new URL(request.url()).origin, origin, "No external browser request");
		if (new URL(request.url()).pathname === "/api/v1/admin/customers/lookup") lookups.push(request.url());
	});
	return { page, errors, lookups, close: () => context.close() };
}
type View = Awaited<ReturnType<typeof open>>;
async function search(view: View, kind: "phone" | "email", value: string) {
	await view.page.getByTestId(`customer-kind-${kind}`).click();
	await view.page.getByTestId("customer-input").fill(value);
	await view.page.getByTestId("customer-submit").click();
}
const noOverflow = (view: View) =>
	view.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

before(async () => {
	browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
	mkdirSync(renders, { recursive: true });
	// One buyer with a profile (verified phone, own contact email), an address-book entry and two tickets whose message
	// text carries a bank account number: none of it may reach the screen except the masked contact.
	buyer = await actor(identity, "buyer", []);
	buyers.push(buyer);
	await identity.sql`update app.auth_user set name='Lokal Pembeli',email_verified=true where id=${buyer.id}`;
	await identity.sql`insert into app.buyer_profile (user_id,display_name,phone,phone_verified_at,email)
		values (${buyer.id},'Lokal Pembeli',${PHONE},clock_timestamp(),${EMAIL})`;
	await identity.sql`insert into app.buyer_address (user_id,label,recipient_name,phone,street,province,city,district,subdistrict,postcode,destination_code)
		values (${buyer.id},'Rumah','Penerima Browser',${`+62877${stamp}`},${STREET},'Jawa Timur','Malang','Klojen','Kauman','65119','BROWSER-DEST')`;
	for (const [status, priority] of [
		["open", "high"],
		["waiting_customer", "normal"],
	] as const) {
		const [row] = await identity.sql`insert into app.support_conversation (buyer_user_id,status,priority,public_sequence,last_public_message_at)
			values (${buyer.id},${status},${priority},1,clock_timestamp()) returning id`;
		conversations.push(String(row.id));
		await identity.sql`insert into app.support_message (conversation_id,public_sequence,sender_side,sender_user_id,client_message_id,request_hash,body)
			values (${row.id},1,'buyer',${buyer.id},${randomUUID()},${"0".repeat(64)},${CHAT})`;
	}
});
after(async () => {
	try {
		await browser?.close();
	} finally {
		try {
			for (const id of conversations) {
				await identity.sql`delete from app.support_message where conversation_id=${id}`;
				await identity.sql`delete from app.support_conversation where id=${id}`;
			}
			for (const user of buyers) {
				await identity.sql`delete from app.buyer_address where user_id=${user.id}`;
				await identity.sql`delete from app.buyer_profile where user_id=${user.id}`;
			}
			if (users.length > 0)
				await identity.sql`delete from app.auth_rate_limit where key in ${identity.sql(users.map((u) => `rl:customer-lookup:${u.id}`))}`;
		} finally {
			await cleanup(identity, [...users, ...buyers]);
			await identity.sql.end();
		}
	}
});

test("S138 customer service finds a buyer by phone and email: masked contact, tickets, no leak, audited", async () => {
	const cs = await staff("customer_service");
	const view = await open(cs);
	try {
		await view.page.goto(`${origin}/admin/customers`);
		await expect(view.page.getByRole("heading", { name: "Akun Pembeli", level: 1 })).toBeVisible();
		await expect(view.page.getByTestId("customer-idle")).toBeVisible();
		await search(view, "phone", LOCAL_PHONE);
		const card = view.page.getByTestId("customer-account");
		await expect(card).toHaveCount(1);
		await expect(card.getByRole("heading", { name: "Lokal Pembeli" })).toBeVisible();
		await expect(card).toContainText(MASKED_PHONE);
		await expect(card).toContainText(MASKED_EMAIL);
		await expect(card.getByText("Terverifikasi").first()).toBeVisible();
		await expect(view.page.getByTestId("customer-ticket-row")).toHaveCount(2);
		await expect(view.page.getByTestId("customer-tickets-table")).toContainText("Terbuka");
		await expect(view.page.getByTestId("customer-tickets-table")).toContainText("Menunggu pembeli");
		// No order-history grant: the list says why it is empty instead of looking like "no orders".
		await expect(view.page.getByTestId("customer-orders-empty")).toContainText("belum memegang akses riwayat pesanan");
		await expect(card.getByRole("link", { name: "Buka Kotak Masuk" })).toHaveAttribute("href", "/admin/support");

		// The search input still holds the typed LOCAL_PHONE; the result area must not carry it, and nothing else in the page may carry any secret.
		const resultHtml = await view.page.getByTestId("customer-result").innerHTML();
		assert.ok(!resultHtml.includes(LOCAL_PHONE), `result carries ${LOCAL_PHONE}`);
		const html = await view.page.content();
		for (const secret of [PHONE, EMAIL, STREET, CHAT, `55${stamp}1`, "BROWSER-DEST", "Penerima Browser"])
			assert.ok(!html.includes(secret), `page carries ${secret}`);
		assert.ok(!view.page.url().includes(stamp), "what was searched never enters the address bar");
		assert.ok(view.lookups.every((url) => !url.includes("?")), "the value travels in the body, not the URL");

		// The same account by email, any letter case.
		await search(view, "email", EMAIL.toUpperCase());
		await expect(view.page.getByTestId("customer-account")).toContainText(MASKED_EMAIL);
		await expect(view.page.getByTestId("customer-input")).toHaveValue(EMAIL.toUpperCase());
		await view.page.screenshot({ path: join(renders, "customers-cs-1440.png"), fullPage: true });

		const audits = await identity.sql`select subject_id,details,reason from app.audit_event where actor_id=${cs.id} and action='support.customer_lookup' order by created_at`;
		assert.equal(audits.length, 2, "one audit row per lookup");
		assert.deepEqual(audits[0].details, { kind: "phone", matches: 1, account_ids: [buyer.id] });
		assert.deepEqual(audits[1].details, { kind: "email", matches: 1, account_ids: [buyer.id] });
		const stored = JSON.stringify(audits);
		assert.ok(![stamp, "example.invalid", "lokal."].some((fragment) => stored.includes(fragment)), "the searched value is not stored");
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});

test("S138 invalid, unknown, throttled and failing lookups each have their own state", async () => {
	const cs = await staff("customer_service");
	const view = await open(cs);
	try {
		await view.page.goto(`${origin}/admin/customers`);
		// A fragment is refused on the screen before any request: there is no partial search.
		await search(view, "phone", LOCAL_PHONE.slice(0, 8));
		await expect(view.page.getByText("Pencarian sebagian tidak tersedia").first()).toBeVisible();
		await view.page.getByTestId("customer-kind-email").click();
		await view.page.getByTestId("customer-input").fill("lokal");
		await view.page.getByTestId("customer-submit").click();
		await expect(view.page.getByText("Masukkan alamat email lengkap").first()).toBeVisible();
		assert.equal(view.lookups.length, 0, "no request for an incomplete value");

		// Unknown values answer an empty state that does not echo the value.
		await search(view, "phone", `0899${stamp}`);
		await expect(view.page.getByTestId("customer-empty")).toContainText("Tidak ada akun yang cocok");
		await expect(view.page.getByTestId("customer-account")).toHaveCount(0);
		assert.ok(!(await view.page.getByTestId("customer-result").innerText()).includes(`0899${stamp}`));
		await search(view, "email", `tidak-ada-${tag}@example.invalid`);
		await expect(view.page.getByTestId("customer-empty")).toBeVisible();
		// Switching the kind clears the field and the previous result.
		await view.page.getByTestId("customer-kind-phone").click();
		await expect(view.page.getByTestId("customer-input")).toHaveValue("");
		await expect(view.page.getByTestId("customer-idle")).toBeVisible();

		// Throttled (429 + Retry-After) and failing answers, from the screen's point of view.
		let mode: "limited" | "fail" = "limited";
		await view.page.route(
			(url) => url.origin === origin && url.pathname === "/api/v1/admin/customers/lookup",
			(route) =>
				mode === "limited"
					? route.fulfill({ status: 429, contentType: "application/problem+json", headers: { "retry-after": "42" }, body: JSON.stringify({ code: "RATE_LIMITED" }) })
					: route.fulfill({ status: 503, contentType: "application/problem+json", body: JSON.stringify({ code: "SERVICE_UNAVAILABLE" }) }),
		);
		await search(view, "phone", `0899${stamp}`);
		await expect(view.page.getByTestId("customer-limited")).toContainText("Coba lagi dalam 42 detik");
		mode = "fail";
		await view.page.getByTestId("customer-submit").click();
		await expect(view.page.getByText("Layanan sedang tidak tersedia")).toBeVisible();
		await expect(view.page.getByRole("button", { name: "Coba lagi" })).toBeVisible();
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});

test("S138 owner opens an account with a real order: the order links to the order screen", async () => {
	const owner = await staff("owner");
	const [seeded] = await identity.sql`select o.id,o.number,u.email from app.commerce_order o join app.auth_user u on u.id=o.owner_user_id
		where o.revision>0 order by o.created_at desc limit 1`;
	assert.ok(seeded, "needs an account-owned order: run `npm run fixture -- demo-orders local`");
	const view = await open(owner);
	try {
		await view.page.goto(`${origin}/admin/customers`);
		await search(view, "email", String(seeded.email));
		const card = view.page.getByTestId("customer-account").filter({ hasText: String(seeded.number) });
		await expect(card).toHaveCount(1);
		const row = card.getByTestId("customer-order-row").filter({ hasText: String(seeded.number) });
		const [seededNo] = await identity.sql`select admin_no::int as n from app.commerce_order where id = ${seeded.id}`;
		await expect(row.getByRole("link", { name: String(seeded.number) })).toHaveAttribute("href", `/admin/orders/${seededNo.n}`);
		await expect(card).not.toContainText(String(seeded.email));
		await view.page.screenshot({ path: join(renders, "customers-owner-1440.png"), fullPage: true });
		await row.getByRole("link", { name: String(seeded.number) }).click();
		await expect(view.page).toHaveURL(new RegExp(`/admin/orders/${seededNo.n}$`));
		assert.deepEqual(view.errors, []);
	} finally {
		await view.close();
	}
});

test("S138 finance and ecommerce_admin get the denied screen", async () => {
	for (const role of ["finance", "ecommerce_admin"] as const) {
		const user = await staff(role);
		const view = await open(user);
		try {
			await view.page.goto(`${origin}/admin/customers`);
			await expect(view.page.getByRole("heading", { name: "Akses layanan pelanggan diperlukan" })).toBeVisible();
			await expect(view.page.getByTestId("customers-page")).toHaveCount(0);
			await expect(view.page.getByTestId("customer-form")).toHaveCount(0);
			assert.equal(view.lookups.length, 0);
			assert.deepEqual(view.errors, []);
		} finally {
			await view.close();
		}
	}
});

test("S138 phone and tablet widths: no horizontal overflow, history rows stack as cards", async () => {
	const cs = await staff("customer_service");
	for (const [name, viewport, touch] of [
		["390", { width: 390, height: 844 }, true],
		["768", { width: 768, height: 1024 }, false],
	] as const) {
		const view = await open(cs, viewport, touch);
		try {
			await view.page.goto(`${origin}/admin/customers`);
			await expect(view.page.getByTestId("customer-input")).toBeVisible();
			assert.ok((await noOverflow(view)) <= 0, `idle overflow at ${name}`);
			await search(view, "phone", LOCAL_PHONE);
			await expect(view.page.getByTestId("customer-ticket-row")).toHaveCount(2);
			await expect(view.page.getByTestId("customer-account")).toContainText(MASKED_PHONE);
			const overflow = await noOverflow(view);
			assert.ok(overflow <= 0, `horizontal overflow ${overflow}px at ${name}`);
			if (name === "390") {
				const submit = await view.page.getByTestId("customer-submit").boundingBox();
				assert.ok(submit && submit.height >= 44 - 1, "touch target at least 44px");
			}
			await view.page.screenshot({ path: join(renders, `customers-cs-${name}.png`), fullPage: true });
			assert.deepEqual(view.errors, []);
		} finally {
			await view.close();
		}
	}
});
