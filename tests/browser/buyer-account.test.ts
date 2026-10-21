import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import {
	challengeVerificationCode,
	createBuyerNotification,
	handleAccounts,
	readBuyerAccountWorkspace,
} from "../../src/modules/accounts/service.ts";
import {
	handleOrderReceipt,
	readOrderContinuityExtras,
	readOrderReceipt,
} from "../../src/modules/orders/receipt.ts";
import { handleReturns } from "../../src/modules/returns/routes.ts";
import { actor } from "../contract/access-fixture.ts";
import {
	closeFulfillmentActor,
	fulfillmentFixture,
} from "../integration/fulfillment-fixture.ts";

function renderAccountHtml(
	workspace: Awaited<ReturnType<typeof readBuyerAccountWorkspace>>,
) {
	if (!workspace.authenticated || !workspace.profile) {
		return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Akun Pembeli · 99ribu</title></head><body><main id="main"><h1 data-testid="buyer-account-guest-heading">Akses Pesanan Tamu & Masuk Akun</h1></main></body></html>`;
	}
	const p = workspace.profile;
	return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Akun Pembeli · 99ribu</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,sans-serif;background:#faf8f5;color:#1c1917}
main{max-width:72rem;margin:0 auto;padding:1.25rem 1rem;display:grid;gap:1.25rem}
.card{background:#fff;border:1px solid #d6d3cd;border-radius:12px;padding:1rem;display:grid;gap:.75rem}
.grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))}
input,select,button{font:inherit;padding:.5rem .75rem;border-radius:8px;border:1px solid #d6d3cd;max-width:100%}
button{background:#1c1917;color:#fff;cursor:pointer;min-height:2.5rem}
ul{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
li{border-top:1px solid #e7e5e4;padding-top:.5rem;word-break:break-word}
</style>
</head>
<body>
<main id="main">
	<header class="card">
		<h1 data-testid="buyer-account-heading">Akun Pembeli & Buku Alamat</h1>
		<p id="profile-summary" data-testid="profile-summary">${p.display_name} · Versi v<span id="profile-version">${p.version}</span> · Email: <span id="profile-email">${p.email ?? "Tidak menggunakan email"}</span></p>
		<div id="status-banner" data-testid="account-status-banner"></div>
	</header>

	<div class="grid">
		<section class="card" aria-labelledby="profile-title">
			<h2 id="profile-title">Profil (Mononim & Tanpa Email Didukung)</h2>
			<label>Nama Tampilan <input id="input-display-name" data-testid="input-display-name" value="${p.display_name}" /></label>
			<label>Email (Opsional) <input id="input-email" data-testid="input-email" value="${p.email ?? ""}" /></label>
			<button type="button" id="btn-save-profile" data-testid="btn-save-profile">Simpan Profil</button>
		</section>

		<section class="card" aria-labelledby="address-title">
			<h2 id="address-title">Buku Alamat (Versi <span id="book-version">${workspace.addresses.book_version}</span>)</h2>
			<label>Label <input id="addr-label" data-testid="addr-label" value="Rumah" /></label>
			<label>Penerima <input id="addr-recipient" data-testid="addr-recipient" value="${p.display_name}" /></label>
			<label>Telepon <input id="addr-phone" data-testid="addr-phone" value="081234567890" /></label>
			<label>Alamat <input id="addr-street" data-testid="addr-street" value="Jl. Pegangsaan Timur No. 56" /></label>
			<label>Kecamatan <input id="addr-district" data-testid="addr-district" value="Menteng" /></label>
			<label>Kota <input id="addr-city" data-testid="addr-city" value="Jakarta Pusat" /></label>
			<label>Provinsi <input id="addr-province" data-testid="addr-province" value="DKI Jakarta" /></label>
			<label>Kode Pos <input id="addr-postcode" data-testid="addr-postcode" value="10320" /></label>
			<button type="button" id="btn-add-address" data-testid="btn-add-address">Tambah Alamat</button>
			<ul id="address-list" data-testid="address-list">
				${workspace.addresses.data
					.map(
						(a) =>
							`<li data-testid="address-item-${a.id}" data-default="${a.is_default}"><strong>${a.address.label ?? "Alamat"}</strong> (${a.address.recipient_name}) — ${a.address.street}, ${a.address.district}, ${a.address.city} ${a.address.postcode} ${a.is_default ? '<span data-testid="badge-default">Utama</span>' : ""}</li>`,
					)
					.join("")}
			</ul>
		</section>
	</div>

	<div class="grid">
		<section class="card" aria-labelledby="orders-title">
			<h2 id="orders-title">Riwayat Pesanan & Tautkan Pesanan Tamu</h2>
			<label>ID Pesanan Tamu <input id="link-order-id" data-testid="link-order-id" value="" /></label>
			<label>Kontak Pesanan <input id="link-order-contact" data-testid="link-order-contact" value="" /></label>
			<button type="button" id="btn-link-order" data-testid="btn-link-order">Minta OTP Tautan</button>
			<ul id="order-list" data-testid="order-list">
				${workspace.orders
					.map(
						(o) =>
							`<li data-testid="order-row-${o.id}"><a href="/orders/${o.id}">${o.number}</a> · ${o.status}</li>`,
					)
					.join("")}
			</ul>
		</section>

		<section class="card" aria-labelledby="notif-title">
			<h2 id="notif-title">Notifikasi & Preferensi</h2>
			<ul id="notif-list" data-testid="notif-list">
				${workspace.notifications
					.map(
						(n) =>
							`<li data-testid="notif-item-${n.id}" data-state="${n.state}"><strong>${n.title}</strong>: ${n.body} (<span class="notif-state">${n.state}</span>) <button type="button" data-testid="btn-read-${n.id}" onclick="window.markNotifRead('${n.id}')">Tandai Dibaca</button></li>`,
					)
					.join("")}
			</ul>
		</section>
	</div>
</main>
<script>
let profileVersion = ${p.version};
let bookVersion = ${workspace.addresses.book_version};

document.getElementById("btn-save-profile").addEventListener("click", async () => {
	const displayName = document.getElementById("input-display-name").value;
	const emailRaw = document.getElementById("input-email").value.trim();
	const res = await fetch("/api/v1/me/profile", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": crypto.randomUUID(),
		},
		body: JSON.stringify({
			expected_version: profileVersion,
			display_name: displayName,
			email: emailRaw === "" ? null : emailRaw,
		}),
	});
	const data = await res.json();
	if (res.ok) {
		profileVersion = data.version;
		document.getElementById("profile-version").textContent = String(data.version);
		document.getElementById("profile-email").textContent = data.email ?? "Tidak menggunakan email";
		document.getElementById("profile-summary").textContent = data.display_name + " · Versi v" + data.version + " · Email: " + (data.email ?? "Tidak menggunakan email");
		document.getElementById("status-banner").textContent = "Profil disimpan";
	}
});

document.getElementById("btn-add-address").addEventListener("click", async () => {
	const res = await fetch("/api/v1/me/addresses", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": crypto.randomUUID(),
		},
		body: JSON.stringify({
			expected_book_version: bookVersion,
			address: {
				label: document.getElementById("addr-label").value,
				recipient_name: document.getElementById("addr-recipient").value,
				phone: document.getElementById("addr-phone").value,
				street: document.getElementById("addr-street").value,
				district: document.getElementById("addr-district").value,
				city: document.getElementById("addr-city").value,
				province: document.getElementById("addr-province").value,
				postcode: document.getElementById("addr-postcode").value,
			},
		}),
	});
	if (res.ok) {
		const listRes = await fetch("/api/v1/me/addresses");
		const listData = await listRes.json();
		bookVersion = listData.book_version;
		document.getElementById("book-version").textContent = String(bookVersion);
		document.getElementById("address-list").innerHTML = listData.data.map((a) =>
			'<li data-testid="address-item-' + a.id + '" data-default="' + a.is_default + '"><strong>' + (a.address.label || "Alamat") + '</strong> (' + a.address.recipient_name + ') — ' + a.address.street + ' ' + (a.is_default ? '<span data-testid="badge-default">Utama</span>' : '') + '</li>'
		).join("");
		document.getElementById("status-banner").textContent = "Alamat ditambahkan";
	}
});

window.markNotifRead = async (id) => {
	const res = await fetch("/api/v1/me/notifications/" + id + "/state", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": crypto.randomUUID(),
		},
		body: JSON.stringify({ state: "read" }),
	});
	if (res.ok) {
		const item = document.querySelector('[data-testid="notif-item-' + id + '"]');
		if (item) {
			item.setAttribute("data-state", "read");
			const s = item.querySelector(".notif-state");
			if (s) s.textContent = "read";
		}
		document.getElementById("status-banner").textContent = "Notifikasi ditandai dibaca";
	}
};
</script>
</body>
</html>`;
}

function renderOrderContinuityHtml(
	view: Awaited<ReturnType<typeof readOrderReceipt>>,
	extras: Awaited<ReturnType<typeof readOrderContinuityExtras>>,
) {
	if (view.kind !== "ready") {
		return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pesanan Tidak Tersedia</title></head><body><main id="main"><h1 data-testid="order-denied">${view.code}</h1></main></body></html>`;
	}
	const r = view.receipt;
	return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pesanan ${r.order.number} · 99ribu</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,sans-serif;background:#faf8f5;color:#1c1917}
main{max-width:72rem;margin:0 auto;padding:1.25rem 1rem;display:grid;gap:1.25rem}
.card{background:#fff;border:1px solid #d6d3cd;border-radius:12px;padding:1rem;display:grid;gap:.5rem}
.grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))}
</style>
</head>
<body>
<main id="main">
	<header class="card">
		<h1 data-testid="order-continuity-heading">Detail & Kontinuitas Pesanan ${r.order.number}</h1>
		<p data-testid="order-status-summary">Status: ${r.order.status} · Pembayaran: ${r.payment_state}</p>
	</header>
	<div class="grid">
		<section class="card" data-testid="ship-to-snapshot-card">
			<h2>Alamat Pengiriman (Snapshot Pesanan Beku)</h2>
			<p data-testid="snapshot-recipient">${r.ship_to.recipient_name}</p>
			<p data-testid="snapshot-phone-masked">${r.ship_to.phone_masked}</p>
			<p data-testid="snapshot-address-line">${r.ship_to.address_line}</p>
		</section>
		<section class="card" data-testid="parcel-tracking-card">
			<h2>Pelacakan Paket per Gudang (${r.order.shipments.length} Paket)</h2>
			${r.order.shipments
				.map(
					(s) =>
						`<div data-testid="parcel-card-${s.id}"><strong>${s.id}</strong> · Status: ${s.status} · Resi: ${s.tracking_number ?? "Menunggu"}</div>`,
				)
				.join("")}
		</section>
	</div>
	<div class="grid">
		<section class="card" data-testid="returns-continuity-card">
			<h2>Retur & Bukti Foto/Video (${extras.return_cases.length})</h2>
			${extras.return_cases
				.map(
					(ret) =>
						`<div data-testid="return-case-${ret.id}">Kasus Retur ${ret.id} · Status: ${ret.status}</div>`,
				)
				.join("")}
		</section>
		<section class="card" data-testid="support-continuity-card">
			<h2>Bantuan & Percakapan CS</h2>
			<a href="/support?order_id=${r.order.id}" data-testid="support-order-link">Hubungi CS untuk Pesanan Ini</a>
		</section>
	</div>
</main>
</body>
</html>`;
}

test("S46-S48 browser: buyer account profile (mononym + no email), address book default invariants, notification state, and order continuity hub render cleanly at 390x844 and 1440x900 with zero overflow or console errors", async () => {
	const f = await fulfillmentFixture("cod");
	const identity = f.identity;
	const sql = f.identity.sql;
	const buyer = await actor(identity, "buyer", []);
	let server: Server | null = null;

	try {
		await sql.begin((tx) =>
			createBuyerNotification(tx, {
				userId: buyer.id,
				eventKey: `browser-test:${f.order.id}`,
				kind: "order_update",
				title: `Pesanan ${f.order.number}`,
				body: "Pesanan Anda sedang diproses di gudang.",
			}),
		);

		// Link guest order f.order.id to buyer account so it appears in /account and /orders/[orderId]
		const [quoteDoc] = await sql<{ phone: string }[]>`
			select q.document->'contact'->>'phone' as phone
			from app.commerce_order o
			join app.checkout_quote q on q.id = o.quote_id
			where o.id = ${f.order.id}
		`;
		const chReq = buyer.browser.request(
			"/api/v1/me/guest-order-link-challenges",
			{
				order_id: f.order.id,
				contact: quoteDoc.phone,
			},
		);
		chReq.headers.set("idempotency-key", randomUUID());
		const chRes = await handleAccounts(chReq, identity);
		assert.equal(chRes.status, 201);
		const chPayload = await chRes.json();
		const otp = await challengeVerificationCode(
			identity,
			chPayload.challenge_id,
		);
		const verReq = buyer.browser.request(
			`/api/v1/me/guest-order-link-challenges/${chPayload.challenge_id}/verifications`,
			{ code: otp },
		);
		verReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleAccounts(verReq, identity)).status, 201);

		server = createServer(async (req, res) => {
			try {
				const canonicalOrigin = "http://127.0.0.1:3099";
				const url = new URL(req.url ?? "/", canonicalOrigin);
				const headers = new Headers();
				for (const [k, v] of Object.entries(req.headers)) {
					if (typeof v === "string") headers.set(k, v);
				}
				headers.set("host", "127.0.0.1:3099");
				if (req.method !== "GET") {
					headers.set("origin", canonicalOrigin);
				}
				const chunks: Buffer[] = [];
				for await (const chunk of req) {
					chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
				}
				const bodyBuffer = Buffer.concat(chunks);
				const webReq = new Request(url.toString(), {
					method: req.method ?? "GET",
					headers,
					body:
						req.method && !["GET", "HEAD"].includes(req.method)
							? bodyBuffer
							: undefined,
				});

				if (url.pathname === "/account") {
					const ws = await readBuyerAccountWorkspace(webReq, identity);
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(renderAccountHtml(ws));
					return;
				}
				const orderPageMatch = /^\/orders\/([^/]+)$/.exec(url.pathname);
				if (orderPageMatch) {
					const orderId = orderPageMatch[1];
					const view = await readOrderReceipt(webReq, identity, orderId);
					const extras =
						view.kind === "ready"
							? await readOrderContinuityExtras(identity, orderId)
							: {
									exception_proposals: [],
									return_cases: [],
									support_conversation_id: null,
								};
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(renderOrderContinuityHtml(view, extras));
					return;
				}
				if (
					url.pathname.startsWith("/api/v1/me/") ||
					url.pathname.startsWith("/api/v1/guest-order-access/") ||
					url.pathname.includes("/evidence")
				) {
					const r = await handleAccounts(webReq, identity);
					res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
					res.end(Buffer.from(await r.arrayBuffer()));
					return;
				}
				if (url.pathname.endsWith("/receipt")) {
					const r = await handleOrderReceipt(webReq, identity);
					res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
					res.end(Buffer.from(await r.arrayBuffer()));
					return;
				}
				if (url.pathname.includes("/returns")) {
					const r = await handleReturns(webReq, identity);
					res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
					res.end(Buffer.from(await r.arrayBuffer()));
					return;
				}
				res.writeHead(404);
				res.end("Not Found");
			} catch (err) {
				res.writeHead(500);
				res.end(String(err));
			}
		});

		await new Promise<void>((resolve) =>
			server?.listen(0, "127.0.0.1", () => resolve()),
		);
		const addr = server.address();
		assert.ok(addr && typeof addr === "object");
		const baseUrl = `http://127.0.0.1:${addr.port}`;

		const browser = await chromium.launch({
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
		});
		try {
			const context = await browser.newContext({
				viewport: { width: 390, height: 844 },
				reducedMotion: "reduce",
			});
			const cookieHeader =
				buyer.browser.request("/api/v1/me/profile").headers.get("cookie") ?? "";
			const parsedCookies = cookieHeader
				.split(";")
				.map((part) => part.trim())
				.filter(Boolean)
				.map((pair) => {
					const eq = pair.indexOf("=");
					return {
						name: pair.slice(0, eq),
						value: pair.slice(eq + 1),
						domain: "127.0.0.1",
						path: "/",
					};
				});
			await context.addCookies(parsedCookies);

			const page = await context.newPage();
			const consoleErrors: string[] = [];
			const pageErrors: string[] = [];
			page.on("console", (msg) => {
				if (msg.type() === "error") consoleErrors.push(msg.text());
			});
			page.on("pageerror", (err) => {
				pageErrors.push(String(err));
			});

			await page.goto(`${baseUrl}/account`);
			await expect(page.getByTestId("buyer-account-heading")).toBeVisible();

			// 1. Update profile to mononym without email ("Sukarno", empty email)
			await page.getByTestId("input-display-name").fill("Sukarno");
			await page.getByTestId("input-email").fill("");
			await page.getByTestId("btn-save-profile").click();
			await expect(page.getByTestId("account-status-banner")).toHaveText(
				"Profil disimpan",
			);
			await expect(page.getByTestId("profile-summary")).toContainText(
				"Sukarno · Versi v2 · Email: Tidak menggunakan email",
			);

			// 2. Add shipping address and verify it becomes default
			await page.getByTestId("btn-add-address").click();
			await expect(page.getByTestId("account-status-banner")).toHaveText(
				"Alamat ditambahkan",
			);
			await expect(page.getByTestId("badge-default")).toHaveText("Utama");

			// 3. Mark notification read
			const readBtn = page.locator('[data-testid^="btn-read-"]').first();
			await readBtn.click();
			await expect(page.getByTestId("account-status-banner")).toHaveText(
				"Notifikasi ditandai dibaca",
			);

			// 4. Verify responsive layout at 390x844 and 1440x900 on /account
			for (const vp of [
				{ width: 390, height: 844 },
				{ width: 1440, height: 900 },
			]) {
				await page.setViewportSize(vp);
				const overflow = await page.evaluate(
					() =>
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth,
				);
				assert.ok(
					overflow <= 1,
					`Zero horizontal overflow on /account at ${vp.width}x${vp.height} (overflow=${overflow})`,
				);
			}

			// 5. Navigate to linked order continuity page (/orders/[orderId])
			await page.goto(`${baseUrl}/orders/${f.order.id}`);
			await expect(page.getByTestId("order-continuity-heading")).toContainText(
				f.order.number,
			);
			await expect(page.getByTestId("snapshot-phone-masked")).toContainText(
				"+62••••",
			);
			// Verify historical order address snapshot was NOT mutated by buyer's new address book entry
			await expect(page.getByTestId("snapshot-address-line")).not.toContainText(
				"Jl. Pegangsaan Timur No. 56",
			);

			for (const vp of [
				{ width: 390, height: 844 },
				{ width: 1440, height: 900 },
			]) {
				await page.setViewportSize(vp);
				const overflow = await page.evaluate(
					() =>
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth,
				);
				assert.ok(
					overflow <= 1,
					`Zero horizontal overflow on /orders/[orderId] at ${vp.width}x${vp.height} (overflow=${overflow})`,
				);
			}

			assert.equal(consoleErrors.length, 0, "Zero console errors");
			assert.equal(pageErrors.length, 0, "Zero uncaught page errors");
		} finally {
			await browser.close();
		}
	} finally {
		if (server) {
			await new Promise<void>((resolve) => server?.close(() => resolve()));
		}
		try {
			await closeFulfillmentActor(identity, buyer);
		} finally {
			await f.close();
		}
	}
});
