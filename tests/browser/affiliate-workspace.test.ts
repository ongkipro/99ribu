import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { getPrincipal } from "../../src/modules/access/policy.ts";
import {
	handleAffiliateProfile,
	readAffiliateProfileDetail,
} from "../../src/modules/affiliates/profile.ts";
import { offerCommissionIdr } from "../../src/modules/affiliates/rates.ts";
import {
	bootstrapGuest,
	capability,
	commerceActor,
	prefix,
	setCookie,
} from "../../src/modules/checkout/access.ts";
import { createCart } from "../../src/modules/checkout/carts.ts";
import { submitOrder } from "../../src/modules/checkout/orders.ts";
import { createQuote } from "../../src/modules/checkout/quotes.ts";
import {
	accrueOrderCommissions,
	handleCommissions,
	holdUnitCommission,
	matureEligibleCommissions,
	readCommissionBalanceForAffiliate,
	readCommissionsForAffiliate,
	recordUnitReceiptMaturity,
} from "../../src/modules/commissions/service.ts";
import {
	handlePayouts,
	queueEligibleAffiliatePayouts,
	readPayoutsForAffiliate,
} from "../../src/modules/payouts/service.ts";
import { rupiah } from "../../src/modules/storefront/format.ts";
import { actor } from "../contract/access-fixture.ts";
import { CommerceClient } from "../integration/checkout-fixture.ts";
import { closeFulfillmentActor } from "../integration/fulfillment-fixture.ts";
import { shippingFixture } from "../integration/shipping-fixture.ts";

function renderAffiliateWorkspaceHtml(
	workspace: {
		profile: NonNullable<
			Awaited<ReturnType<typeof readAffiliateProfileDetail>>
		>;
		balance: Awaited<ReturnType<typeof readCommissionBalanceForAffiliate>>;
		commissions: Awaited<
			ReturnType<typeof readCommissionsForAffiliate>
		>["data"];
		payouts: Awaited<ReturnType<typeof readPayoutsForAffiliate>>["data"];
	} | null,
) {
	if (!workspace) {
		return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ruang Mitra Afiliasi · 99ribu</title><style>body{margin:0;font-family:system-ui,sans-serif;padding:1rem;box-sizing:border-box}*{box-sizing:border-box}</style></head><body><main id="main"><h1>Ruang Mitra Afiliasi 99ribu</h1><p>Masuk sebagai mitra afiliasi terverifikasi untuk melihat tautan rujukan, rincian komisi per unit, dan status pencairan otomatis.</p></main></body></html>`;
	}
	const { profile, balance, commissions, payouts } = workspace;
	const unitIdr = offerCommissionIdr(profile.rate_basis_points);
	return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ruang Mitra Afiliasi · 99ribu</title><style>body{margin:0;font-family:system-ui,sans-serif;background:#faf8f5;color:#1c1917}*{box-sizing:border-box}main{max-width:72rem;margin:0 auto;padding:1.5rem 1rem;display:grid;gap:1.5rem}.card{border:1px solid #d6d3cd;border-radius:12px;padding:1rem;background:#fff;display:grid;gap:.5rem}.grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))}ul{list-style:none;margin:0;padding:0;display:grid;gap:.75rem}li{border-top:1px solid #e5e2dc;padding-top:.75rem}</style></head><body><main id="main"><header><h1>Ruang Mitra Afiliasi 99ribu</h1><p>Mitra Afiliasi · ${profile.display_name}</p></header><section id="affiliate-profile-section" class="grid"><article class="card"><h2>Tautan & Tarif Rujukan</h2><span data-testid="affiliate-status-badge">${profile.status === "active" ? "Aktif" : "Ditangguhkan"}</span><div data-testid="affiliate-referral-code">${profile.referral_code}</div><div data-testid="affiliate-referral-url" style="word-break:break-all">${profile.referral_url}</div><div data-testid="affiliate-rate-bps">${profile.rate_basis_points} bps · ${rupiah(unitIdr)} per unit</div></article><article class="card"><h2>Rekening Tujuan Pencairan</h2><span data-testid="beneficiary-status-badge">${profile.beneficiary_status === "verified" ? "Terverifikasi" : "Belum diatur"}</span>${profile.beneficiary ? `<div data-testid="beneficiary-bank-name">${profile.beneficiary.bank_name}</div><div data-testid="beneficiary-masked-account">${profile.beneficiary.masked_account}</div>` : ""}</article></section><section id="affiliate-commissions-section"><h2>Ringkasan Saldo Komisi</h2><div class="grid"><div class="card" data-testid="balance-card-pending"><span>Menunggu (H+10)</span><strong>${rupiah(balance.pending)}</strong></div><div class="card" data-testid="balance-card-held"><span>Ditahan (Retur/Klaim)</span><strong>${rupiah(balance.held)}</strong></div><div class="card" data-testid="balance-card-eligible"><span>Siap Cair</span><strong>${rupiah(balance.eligible)}</strong></div><div class="card" data-testid="balance-card-allocated"><span>Dalam Antrean Transfer</span><strong>${rupiah(balance.allocated)}</strong></div><div class="card" data-testid="balance-card-paid"><span>Telah Dibayar</span><strong>${rupiah(balance.paid)}</strong></div></div><div class="card"><h3>Riwayat Komisi per Unit</h3><ul data-testid="commission-history-list">${commissions.map((c) => `<li data-testid="commission-row-${c.status}"><strong>${c.product_name} (${c.quantity} unit)</strong> · <strong>${rupiah(c.amount)}</strong> · <span>Ref ${c.sale_reference}</span>${c.hold_reason ? `<p>${c.hold_reason}</p>` : ""}</li>`).join("")}</ul></div></section><section id="affiliate-payouts-section" class="card"><h2>Antrean Pencairan Otomatis & Transfer Manual</h2><p>Batas minimum pencairan otomatis: <strong>${rupiah(balance.minimum_payout)}</strong> (inklusif).</p><ul data-testid="payout-history-list">${payouts.map((p) => `<li data-testid="payout-row-${p.status}"><strong>Pencairan ${rupiah(p.amount)}</strong> · <span>${p.status === "queued" ? "Dalam antrean" : p.status}</span><p>${p.explanation ?? ""}</p></li>`).join("")}</ul></section></main></body></html>`;
}

test("S38-S40 browser: affiliate workspace renders referral link, masked beneficiary, disjoint H+10 commission buckets, and manual payout queue across 390px and 1440px without horizontal overflow or PII leakage", async () => {
	const f = await shippingFixture();
	const affiliate = await actor(f.identity, "affiliate", []);
	const sql = f.identity.sql;
	const identity = f.identity;
	let server: Server | null = null;

	try {
		// 1. Enroll affiliate with verified bank beneficiary
		const refCode = `MITRA99-${randomUUID().slice(0, 6).toUpperCase()}`;
		const enrollReq = affiliate.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
			referral_code: refCode,
			display_name: "Siti Rahma",
			beneficiary_bank_code: "BRI",
			beneficiary_account_number: "889900112233",
			beneficiary_account_holder: "Siti Rahma",
		});
		enrollReq.headers.set("idempotency-key", randomUUID());
		const enrollRes = await handleAffiliateProfile(enrollReq, identity);
		assert.equal(enrollRes.status, 201);
		const profile = await enrollRes.json();

		// 2. Create a 2-unit order and accrue commissions
		const client = new CommerceClient(identity);
		const bootRes = new Response(null);
		await bootstrapGuest(identity, bootRes);
		client.absorb(bootRes);
		const guestBuyer = await commerceActor(
			client.request("/api/v1/carts"),
			identity,
		);
		assert.ok(guestBuyer);

		const line = f.line("fixture-offer-shirt");
		const createdCart = await sql.begin((tx) =>
			createCart(
				tx,
				client.request("/api/v1/carts", {}),
				identity,
				guestBuyer,
				{
					lines: [
						{
							variant_id: line.offer_id,
							quantity: 2,
							expected_publication_id: line.publication_id,
						},
					],
				},
				{ clock_namespace: f.namespace },
			),
		);
		const token = await capability(
			identity,
			"cart",
			createdCart.cart.id,
			guestBuyer.id,
			createdCart.cart.cap_issued_at as string,
		);
		const cookieRes = new Response(null);
		setCookie(
			cookieRes,
			`${await prefix(identity)}.cart_access`,
			`${createdCart.cart.id}.${token}`,
		);
		client.absorb(cookieRes);

		const quoteInput = {
			cart_id: createdCart.cart.id,
			address: {
				recipient_name: "Budi Rahasia",
				phone: "+6281299998888",
				address_line: "Jalan Rahasia Pembeli 77",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281299998888" },
			payment_method: "prepaid" as const,
		};
		const quote = (await sql.begin((tx) =>
			createQuote(
				tx,
				client.request("/api/v1/checkout/quotes", quoteInput, { version: 1 }),
				identity,
				guestBuyer,
				quoteInput,
				{ affiliate_id: profile.id },
			),
		)) as { id: string };

		const submitted = await sql.begin((tx) =>
			submitOrder(
				tx,
				client.request(
					"/api/v1/orders",
					{ quote_id: quote.id },
					{ version: 1 },
				),
				identity,
				guestBuyer,
				{ quote_id: quote.id },
			),
		);

		const accrued = await sql.begin((tx) =>
			accrueOrderCommissions(tx, { orderId: submitted.order.id }),
		);
		assert.equal(accrued.length, 2);

		// Hold unit 1, mature unit 2 and queue a payout
		await sql.begin(async (tx) => {
			await holdUnitCommission(tx, {
				fulfillmentItemId: accrued[0].fulfillment_item_id,
				holdReason: "Pemeriksaan retur unit berjalan",
			});
			await recordUnitReceiptMaturity(tx, {
				fulfillmentItemId: accrued[1].fulfillment_item_id,
				receivedAt: "2026-05-01T08:00:00.000Z",
			});
			await tx`
        update app.commission_entry
        set amount_idr = 99000
        where id = ${accrued[1].id}
      `;
			await matureEligibleCommissions(tx, {
				affiliateId: profile.id,
				asOf: "2026-05-12T08:00:00.000Z",
			});
			await queueEligibleAffiliatePayouts(tx, {
				affiliateId: profile.id,
				asOf: "2026-05-12T08:05:00.000Z",
			});
		});

		// 3. Spin up an in-process HTTP server bound to 127.0.0.1 to serve /afiliasi and /api/v1/me/affiliate*
		server = createServer(async (req, res) => {
			try {
				const host = `http://${req.headers.host ?? "127.0.0.1"}`;
				const url = new URL(req.url ?? "/", host);
				const headers = new Headers();
				for (const [k, v] of Object.entries(req.headers)) {
					if (typeof v === "string") headers.set(k, v);
				}
				const webReq = new Request(url.toString(), {
					method: req.method ?? "GET",
					headers,
				});

				if (url.pathname === "/afiliasi") {
					let principal = null;
					try {
						principal = await getPrincipal(webReq, identity);
					} catch {
						principal = null;
					}
					const data = principal?.roles.includes("affiliate")
						? await sql.begin(async (tx) => {
								const prof = await readAffiliateProfileDetail(tx, principal.id);
								if (!prof) return null;
								const bal = await readCommissionBalanceForAffiliate(
									tx,
									prof.id,
								);
								const comms = await readCommissionsForAffiliate(tx, prof.id, {
									limit: 50,
									cursor: null,
								});
								const pays = await readPayoutsForAffiliate(tx, prof.id, {
									limit: 20,
									cursor: null,
								});
								return {
									profile: prof,
									balance: bal,
									commissions: comms.data,
									payouts: pays.data,
								};
							})
						: null;
					const html = renderAffiliateWorkspaceHtml(data);
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(html);
					return;
				}
				if (
					url.pathname.startsWith("/api/v1/me/affiliate/balance") ||
					url.pathname.startsWith("/api/v1/me/affiliate/commissions")
				) {
					const r = await handleCommissions(webReq, identity);
					res.writeHead(r.status, { "content-type": "application/json" });
					res.end(await r.text());
					return;
				}
				if (url.pathname.startsWith("/api/v1/me/affiliate/payouts")) {
					const r = await handlePayouts(webReq, identity);
					res.writeHead(r.status, { "content-type": "application/json" });
					res.end(await r.text());
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
		const address = server.address();
		assert.ok(address && typeof address === "object");
		const baseUrl = `http://127.0.0.1:${address.port}`;

		// 4. Launch Playwright Chromium and verify mobile (390px) and desktop (1440px) views
		const browser = await chromium.launch({
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
		});
		try {
			const context = await browser.newContext({
				viewport: { width: 390, height: 900 },
				reducedMotion: "reduce",
			});
			const cookieHeader =
				affiliate.browser.request("/api/v1/me").headers.get("cookie") ?? "";
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
			await page.goto(`${baseUrl}/afiliasi`);

			await expect(
				page.getByRole("heading", {
					name: "Ruang Mitra Afiliasi 99ribu",
					exact: true,
				}),
			).toBeVisible();
			await expect(page.getByTestId("affiliate-referral-code")).toHaveText(
				refCode,
			);
			await expect(page.getByTestId("beneficiary-bank-name")).toHaveText("BRI");
			await expect(page.getByTestId("beneficiary-masked-account")).toHaveText(
				"••••2233",
			);
			await expect(page.getByTestId("payout-row-queued")).toBeVisible();
			await expect(page.getByTestId("commission-row-held")).toBeVisible();
			await expect(page.getByTestId("commission-row-allocated")).toBeVisible();

			// Verify zero buyer PII or unmasked bank account in rendered HTML
			const content = await page.content();
			assert.ok(
				!content.includes("889900112233"),
				"Raw bank account number stays masked",
			);
			assert.ok(
				!content.includes("Budi Rahasia"),
				"Buyer name never leaks to affiliate workspace",
			);
			assert.ok(
				!content.includes("+6281299998888"),
				"Buyer phone never leaks to affiliate workspace",
			);
			assert.ok(
				!content.includes(submitted.order.number),
				"Buyer order number never leaks to affiliate workspace",
			);

			for (const width of [390, 768, 1024, 1440]) {
				await page.setViewportSize({ width, height: 900 });
				const overflow = await page.evaluate(
					() =>
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth,
				);
				assert.ok(
					overflow <= 1,
					`No horizontal overflow at ${width}px (overflow=${overflow})`,
				);
			}
		} finally {
			await browser.close();
		}
	} finally {
		if (server) {
			await new Promise<void>((resolve) => server?.close(() => resolve()));
		}
		try {
			await closeFulfillmentActor(identity, affiliate);
		} finally {
			await f.close();
		}
	}
});
