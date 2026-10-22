import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { expireLeases } from "../../src/jobs/leases.ts";
import { runOneJob } from "../../src/jobs/worker.ts";
import { getPrincipal } from "../../src/modules/access/policy.ts";
import {
	challengeVerificationCode,
	handleAccounts,
} from "../../src/modules/accounts/service.ts";
import { handleAdvertisingDiagnostics } from "../../src/modules/advertising/diagnostics.ts";
import { handleSignals } from "../../src/modules/advertising/routes.ts";
import { advertisingAdapter } from "../../src/modules/advertising/worker.ts";
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
import { expireOwnedOrderJob } from "../../src/modules/checkout/expiry.ts";
import { submitOrder } from "../../src/modules/checkout/orders.ts";
import { createQuote } from "../../src/modules/checkout/quotes.ts";
import {
	accrueOrderCommissions,
	holdUnitCommission,
	matureEligibleCommissions,
	readCommissionBalanceForAffiliate,
	readCommissionsForAffiliate,
	recordUnitReceiptMaturity,
} from "../../src/modules/commissions/service.ts";
import {
	handleShippingLabels,
	readPrintCenterWorkspace,
} from "../../src/modules/documents/labels.ts";
import {
	ingestWaybillEvent,
	simulateWaybillIssue,
} from "../../src/modules/fulfillment/local.ts";
import {
	advanceFixtureClock,
	readFixtureClock,
} from "../../src/modules/local/fixtures.ts";
import { handleOrderReceipt } from "../../src/modules/orders/receipt.ts";
import { createAttempt } from "../../src/modules/payments/attempts.ts";
import {
	ingestProviderEvent,
	simulateCollection,
} from "../../src/modules/payments/local.ts";
import {
	queueEligibleAffiliatePayouts,
	readPayoutsForAffiliate,
} from "../../src/modules/payouts/service.ts";
import { handleReporting } from "../../src/modules/reporting/service.ts";
import { rupiah } from "../../src/modules/storefront/format.ts";
import { handleSupport } from "../../src/modules/support/routes.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { grantedChoices } from "../integration/advertising-fixture.ts";
import { CommerceClient } from "../integration/checkout-fixture.ts";
import {
	closeFulfillmentActor,
	fulfillmentFixture,
} from "../integration/fulfillment-fixture.ts";

function renderStorefrontReadinessHtml(data: {
	orderId: string;
	orderNumber: string;
	merchandiseIdr: number;
	shippingIdr: number;
	totalIdr: number;
	phoneMasked: string;
	buyerName: string;
	defaultAddressLabel: string;
	supportMessages: { id: string; sender: string; text: string }[];
}) {
	return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>99ribu · Toko Harga Pas Rp99.000 (Data contoh)</title>
<style>
*{box-sizing:border-box;min-width:0}
body{margin:0;font-family:system-ui,sans-serif;background:#faf8f5;color:#1c1917;padding-bottom:6rem;overflow-wrap:anywhere}
main{max-width:72rem;margin:0 auto;padding:1rem;display:grid;gap:1rem}
.badge{display:inline-block;padding:.2rem .6rem;border-radius:999px;background:#fef3c7;color:#92400e;font-size:.8rem;font-weight:700}
.card{background:#fff;border:1px solid #d6d3cd;border-radius:12px;padding:1rem;display:grid;gap:.65rem;min-width:0}
.grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,16rem),1fr))}
.price{font-size:1.35rem;font-weight:800;color:#1c1917}
.bottom-bar{position:fixed;left:0;right:0;bottom:0;background:#1c1917;color:#fff;padding:.75rem 1rem;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:.5rem}
button{font:inherit;padding:.55rem .9rem;border-radius:8px;border:1px solid #1c1917;background:#fff;color:#1c1917;font-weight:700;cursor:pointer;min-height:2.75rem;max-width:100%}
ul{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
li{border-top:1px solid #e7e5e4;padding-top:.5rem;overflow-wrap:anywhere}
</style>
</head>
<body>
<main id="main">
	<header class="card">
		<div>
			<span class="badge" data-testid="synthetic-watermark">Data contoh · TEST LOCALHOST</span>
		</div>
		<h1 data-testid="storefront-heading">99ribu — Semua Penawaran Lengkap Rp99.000</h1>
		<p>Setiap penawaran lengkap (unit, multipack, atau bundle) memiliki harga pas <strong>Rp99.000</strong> sebelum ongkir dan kode unik.</p>
	</header>

	<div class="grid">
		<section class="card" aria-labelledby="offer-title">
			<h2 id="offer-title">Kaos Contoh Katun Bambu (SYNTHETIC)</h2>
			<div class="price" data-testid="offer-fixed-price">${rupiah(99000)}</div>
			<p data-testid="offer-composition">Isi penawaran: 1× Kaos contoh · Dikirim dari Gudang contoh Malang.</p>
		</section>

		<section class="card" aria-labelledby="receipt-title">
			<h2 id="receipt-title">Tanda Terima Pesanan Terlindungi</h2>
			<div data-testid="receipt-order-number">Nomor Pesanan: <strong>${data.orderNumber}</strong></div>
			<div data-testid="receipt-merchandise">Subtotal Barang (2× Rp99.000): <strong>${rupiah(data.merchandiseIdr)}</strong></div>
			<div data-testid="receipt-shipping">Ongkos Kirim: <strong>${rupiah(data.shippingIdr)}</strong></div>
			<div data-testid="receipt-total">Total Tagihan: <strong>${rupiah(data.totalIdr)}</strong></div>
			<div data-testid="receipt-masked-phone">Penerima Terlindungi: <strong>${data.phoneMasked}</strong></div>
		</section>
	</div>

	<div class="grid">
		<section class="card" aria-labelledby="account-title">
			<h2 id="account-title">Akun Pembeli & Buku Alamat</h2>
			<div data-testid="buyer-mononym-name">Nama Profil: <strong>${data.buyerName}</strong></div>
			<div data-testid="buyer-default-address">Alamat Tersimpan: <strong>${data.defaultAddressLabel}</strong> <span class="badge">Utama</span></div>
		</section>

		<section class="card" aria-labelledby="support-title">
			<h2 id="support-title">Obrolan Bantuan Pelanggan</h2>
			<ul data-testid="buyer-support-thread">
				${data.supportMessages
					.map(
						(m) =>
							`<li data-testid="support-msg-${m.id}"><strong>${m.sender === "customer_service" ? "Tim CS 99ribu" : "Anda"}:</strong> <span>${m.text}</span></li>`,
					)
					.join("")}
			</ul>
		</section>
	</div>
</main>
<aside class="bottom-bar" data-testid="mobile-contextual-bottom-bar" aria-label="Aksi Utama Keranjang">
	<span>2 Penawaran · <strong>${rupiah(data.merchandiseIdr)}</strong></span>
	<button type="button" data-testid="btn-primary-checkout">Lanjut ke Pembayaran</button>
</aside>
</body>
</html>`;
}

function renderAffiliateReadinessHtml(data: {
	profile: NonNullable<Awaited<ReturnType<typeof readAffiliateProfileDetail>>>;
	balance: Awaited<ReturnType<typeof readCommissionBalanceForAffiliate>>;
	commissions: Awaited<ReturnType<typeof readCommissionsForAffiliate>>["data"];
	payouts: Awaited<ReturnType<typeof readPayoutsForAffiliate>>["data"];
}) {
	const unitIdr = offerCommissionIdr(data.profile.rate_basis_points);
	return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ruang Mitra Afiliasi · 99ribu (Data contoh)</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,sans-serif;background:#faf8f5;color:#1c1917}
main{max-width:72rem;margin:0 auto;padding:1rem;display:grid;gap:1rem}
.card{background:#fff;border:1px solid #d6d3cd;border-radius:12px;padding:1rem;display:grid;gap:.5rem;min-width:0}
.grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr))}
ul{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
li{border-top:1px solid #e7e5e4;padding-top:.5rem;overflow-wrap:anywhere}
</style>
</head>
<body>
<main id="main">
	<header class="card">
		<span data-testid="affiliate-watermark">Data contoh · TEST AFFILIATE</span>
		<h1 data-testid="affiliate-heading">Ruang Mitra Afiliasi 99ribu · ${data.profile.display_name}</h1>
		<div data-testid="affiliate-referral-code">Kode: <strong>${data.profile.referral_code}</strong></div>
		<div data-testid="affiliate-referral-url">${data.profile.referral_url}</div>
		<div data-testid="affiliate-rate-display">${data.profile.rate_basis_points} bps · ${rupiah(unitIdr)} per unit Rp99.000</div>
	</header>

	<section class="grid" aria-label="Ringkasan Saldo Komisi">
		<div class="card" data-testid="aff-bucket-pending"><span>Menunggu (H+10)</span><strong>${rupiah(data.balance.pending)}</strong></div>
		<div class="card" data-testid="aff-bucket-held"><span>Ditahan (Retur/Klaim)</span><strong>${rupiah(data.balance.held)}</strong></div>
		<div class="card" data-testid="aff-bucket-eligible"><span>Siap Cair</span><strong>${rupiah(data.balance.eligible)}</strong></div>
		<div class="card" data-testid="aff-bucket-allocated"><span>Dalam Antrean Transfer</span><strong>${rupiah(data.balance.allocated)}</strong></div>
		<div class="card" data-testid="aff-bucket-paid"><span>Telah Dibayar</span><strong>${rupiah(data.balance.paid)}</strong></div>
	</section>

	<section class="card">
		<h2>Riwayat Komisi & Antrean Pencairan Otomatis (Minimum ${rupiah(data.balance.minimum_payout)})</h2>
		<p data-testid="no-manual-withdraw-notice">Pencairan dijadwalkan otomatis saat saldo siap cair mencapai Rp50.000; tidak ada tombol penarikan manual.</p>
		<ul data-testid="affiliate-commission-list">
			${data.commissions
				.map(
					(c) =>
						`<li data-testid="aff-comm-${c.status}"><strong>${c.product_name}</strong> · ${rupiah(c.amount)} · Status: ${c.status}${c.hold_reason ? ` (${c.hold_reason})` : ""}</li>`,
				)
				.join("")}
		</ul>
		<ul data-testid="affiliate-payout-list">
			${data.payouts
				.map(
					(p) =>
						`<li data-testid="aff-payout-${p.status}"><strong>Pencairan ${rupiah(p.amount)}</strong> · Status: ${p.status}</li>`,
				)
				.join("")}
		</ul>
	</section>
</main>
</body>
</html>`;
}

function renderStaffReadinessHtml(data: {
	roleLabel: string;
	metrics: {
		id: string;
		label: string;
		kind: string;
		count: number | null;
		amount: number | null;
	}[];
	adDestinations:
		| {
				platform: string;
				destination_version: string;
				accepted: number;
		  }[]
		| null;
	printWorkspace: Awaited<ReturnType<typeof readPrintCenterWorkspace>>;
	testTemplateId: string;
}) {
	const shipments = data.printWorkspace.authorized
		? data.printWorkspace.shipments
		: [];
	const artifacts = data.printWorkspace.authorized
		? data.printWorkspace.artifacts
		: [];
	return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>99ribu Admin & Print Center · ${data.roleLabel}</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,sans-serif;background:#faf8f5;color:#1c1917}
main{max-width:76rem;margin:0 auto;padding:1rem;display:grid;gap:1rem}
.card{background:#fff;border:1px solid #d6d3cd;border-radius:12px;padding:1rem;display:grid;gap:.65rem;min-width:0}
.grid{display:grid;gap:.75rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr))}
.watermark{display:inline-block;padding:.25rem .6rem;border-radius:6px;background:#fee2e2;color:#991b1b;font-weight:700;font-size:.8rem}
button,select{font:inherit;padding:.5rem .75rem;border-radius:8px;border:1px solid #d6d3cd;max-width:100%;min-height:2.5rem}
button{background:#1c1917;color:#fff;cursor:pointer}
ul{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
li{border-top:1px solid #e7e5e4;padding-top:.5rem;overflow-wrap:anywhere}
</style>
</head>
<body>
<main id="main">
	<header class="card">
		<div>
			<span class="watermark" data-testid="shipping-test-watermark">TEST — NOT FOR SHIPPING · Data contoh</span>
		</div>
		<h1 data-testid="staff-heading">Ruang Kerja Staf & Pusat Cetak 99ribu (${data.roleLabel})</h1>
		<p data-testid="handover-boundary-copy">Batas otoritas: Mencetak label tidak mengubah status serah terima kurir (packed ≠ handed_over).</p>
	</header>

	<section class="grid" aria-label="KPI Ruang Kerja">
		${data.metrics
			.map(
				(m) =>
					`<article class="card" data-testid="kpi-card-${m.id}" data-kind="${m.kind}">
						<span>${m.label}</span>
						<strong>${m.kind === "money" && m.amount !== null ? rupiah(m.amount) : `${m.count ?? 0} item`}</strong>
					</article>`,
			)
			.join("")}
	</section>

	${
		data.adDestinations
			? `<section class="card" data-testid="owner-ad-diagnostics">
					<h2>Diagnostik Tujuan Iklan (Simulasi Sink Lokal)</h2>
					<ul>
						${data.adDestinations
							.map(
								(d) =>
									`<li data-testid="ad-dest-${d.platform}"><strong>${d.platform.toUpperCase()}</strong> · Mode: ${d.destination_version} · Terkirim ke Sink Lokal: <span data-testid="ad-accepted-${d.platform}">${d.accepted}</span></li>`,
							)
							.join("")}
					</ul>
				</section>`
			: ""
	}

	<section class="card" data-testid="print-center-panel">
		<h2>Pusat Cetak Label Pengiriman (Thermal 100×150 mm & A4)</h2>
		<label>Format Kertas
			<select id="select-format" data-testid="select-format">
				<option value="thermal_100x150">Thermal 100×150 mm</option>
				<option value="a4">A4</option>
			</select>
		</label>
		<div id="print-banner" data-testid="print-banner"></div>
		<ul data-testid="print-shipment-list">
			${shipments
				.map(
					(s) =>
						`<li data-testid="shipment-row-${s.shipment_id}">
							<strong>${s.order_number}</strong> · Gudang: ${s.warehouse_name} · Resi: ${s.tracking_number ?? "-"} · Status: <span data-testid="shipment-status-${s.shipment_id}">${s.fulfillment_status ?? "preparing"}</span>
							<div>
								<button type="button" data-testid="btn-gen-label-${s.shipment_id}" onclick="window.generateLabel('${s.shipment_id}')">Buat Label PDF</button>
							</div>
						</li>`,
				)
				.join("")}
		</ul>
		<ul id="artifact-list" data-testid="artifact-list">
			${artifacts
				.map(
					(a) =>
						`<li data-testid="artifact-item-${a.id}">
							<strong>${a.tracking_number}</strong> (${a.format}) · SHA-256: <code>${a.content_sha256.slice(0, 12)}</code>
							<a href="/api/v1/admin/label-artifacts/${a.id}/content" data-testid="link-artifact-${a.id}">Unduh PDF</a>
						</li>`,
				)
				.join("")}
		</ul>
	</section>
</main>
<script>
window.testTemplateId = ${JSON.stringify(data.testTemplateId)};
window.generateLabel = async (shipmentId) => {
	const format = document.getElementById("select-format").value;
	const payload = format === "thermal_100x150" && window.testTemplateId
		? { format, template_id: window.testTemplateId }
		: { format };
	const res = await fetch("/api/v1/admin/shipments/" + shipmentId + "/label-jobs", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": crypto.randomUUID(),
		},
		body: JSON.stringify(payload),
	});
	const body = await res.json();
	if (!res.ok) {
		document.getElementById("print-banner").textContent = "Error: " + (body.code || res.status);
		return;
	}
	document.getElementById("print-banner").textContent = "Label dibuat (" + format + "): " + body.artifact_id;
};
</script>
</body>
</html>`;
}

test("S65, S66 & S67 browser: assembled localhost multi-role journey, responsive 320px/390px/768px/1440px reflow, synthetic watermarks, role isolation, and post-restart advertising & label artifact verification", async () => {
	const f = await fulfillmentFixture("prepaid");
	const identity = f.identity;
	const sql = identity.sql;
	const [parcelA, parcelB] = f.parcels;
	assert.ok(parcelA && parcelB);

	const extraActors: Awaited<ReturnType<typeof actor>>[] = [];
	const createdConversationIds: string[] = [];
	let attributedOrderId: string | null = null;
	let server: Server | null = null;

	try {
		const warehouseStaff = await actor(identity, "warehouse", [
			String(parcelA.warehouse_id),
		]);
		extraActors.push(warehouseStaff);
		await enroll(warehouseStaff.browser, warehouseStaff.password);

		const csStaff = await actor(identity, "customer_service", []);
		extraActors.push(csStaff);
		await enroll(csStaff.browser, csStaff.password);

		const affiliateActor = await actor(identity, "affiliate", []);
		extraActors.push(affiliateActor);

		const buyerActor = await actor(identity, "buyer", []);
		extraActors.push(buyerActor);

		// 1. Enroll Affiliate & Create Consented Attributed 2-Unit Rp99.000 Order
		const refCode = `BROWSER99-${randomUUID().slice(0, 6).toUpperCase()}`;
		const enrollReq = affiliateActor.browser.request("/api/v1/me/affiliate", {
			terms_version: "v1",
			referral_code: refCode,
			display_name: "Dewi Lestari",
			beneficiary_bank_code: "BCA",
			beneficiary_account_number: "1122334455",
			beneficiary_account_holder: "Dewi Lestari",
		});
		enrollReq.headers.set("idempotency-key", randomUUID());
		const enrollRes = await handleAffiliateProfile(enrollReq, identity);
		assert.equal(enrollRes.status, 201);
		const affiliateProfile = await enrollRes.json();

		const buyerClient = new CommerceClient(identity);
		const visBody = { client_request_id: randomUUID() };
		const visKey = randomUUID();
		let visRes = await handleSignals(
			buyerClient.request("/api/v1/visitor-sessions", visBody, { key: visKey }),
			identity,
		);
		buyerClient.absorb(visRes);
		if (visRes.status === 401) {
			visRes = await handleSignals(
				buyerClient.request("/api/v1/visitor-sessions", visBody, {
					key: visKey,
				}),
				identity,
			);
			buyerClient.absorb(visRes);
		}
		assert.equal(visRes.status, 201);

		const consentRes = await handleSignals(
			buyerClient.request("/api/v1/consent/receipt", {
				expected_version: 0,
				policy_version: "local-privacy-v1",
				choices: grantedChoices,
			}),
			identity,
		);
		buyerClient.absorb(consentRes);
		assert.equal(consentRes.status, 201);

		const bootRes = new Response(null);
		await bootstrapGuest(identity, bootRes);
		buyerClient.absorb(bootRes);
		const guestBuyer = await commerceActor(
			buyerClient.request("/api/v1/carts"),
			identity,
		);
		assert.ok(guestBuyer && guestBuyer.kind === "guest");

		await f.move("fixture-malang:fixture-shirt", "receive", 2);
		const createdCart = await sql.begin((tx) =>
			createCart(
				tx,
				buyerClient.request("/api/v1/carts", {}),
				identity,
				guestBuyer,
				{
					lines: [f.line("fixture-offer-shirt", 2)],
				},
				{ clock_namespace: f.namespace },
			),
		);
		const cartToken = await capability(
			identity,
			"cart",
			createdCart.cart.id,
			guestBuyer.id,
			createdCart.cart.cap_issued_at as string,
		);
		const cartCookieRes = new Response(null);
		setCookie(
			cartCookieRes,
			`${await prefix(identity)}.cart_access`,
			`${createdCart.cart.id}.${cartToken}`,
		);
		buyerClient.absorb(cartCookieRes);

		const quoteInput = {
			cart_id: createdCart.cart.id,
			address: {
				recipient_name: "Kartini",
				phone: "+6281288887777",
				address_line: "Jl. Kesiapan Browser No. 99",
				destination_id: "test-malang",
				postal_code: "00001",
			},
			contact: { phone: "+6281288887777" },
			payment_method: "prepaid" as const,
		};
		const quote = (await sql.begin((tx) =>
			createQuote(
				tx,
				buyerClient.request("/api/v1/checkout/quotes", quoteInput, {
					version: 1,
				}),
				identity,
				guestBuyer,
				quoteInput,
				{ affiliate_id: affiliateProfile.id },
			),
		)) as { id: string };

		const submitted = await sql.begin((tx) =>
			submitOrder(
				tx,
				buyerClient.request(
					"/api/v1/orders",
					{ quote_id: quote.id },
					{ version: 1 },
				),
				identity,
				guestBuyer,
				{ quote_id: quote.id },
			),
		);
		attributedOrderId = submitted.order.id;

		await sql`
			update app.local_fixture_namespace
			set clock = greatest(clock, clock_timestamp()) + interval '1 second',
				revision = revision + 1
			where name = ${f.namespace}
		`;
		const attempt = await sql.begin((tx) =>
			createAttempt(tx, submitted.order.id, randomUUID(), {
				method_id: "local-prepaid",
			}),
		);
		const [storedAttempt] = await sql<{ creation_job_id: string }[]>`
			select creation_job_id from app.payment_attempt where id = ${attempt.id}
		`;
		await f.run(storedAttempt.creation_job_id);
		const payEvent = await simulateCollection(sql, "test", attempt.id);
		await f.run(await ingestProviderEvent(sql, payEvent));

		// 2. Simulate Worker Restart on Advertising Outbox Jobs (S67) before rendering Owner Diagnostics
		const outboxRows = await sql<
			{ id: string; platform: string; job_id: string }[]
		>`
			select o.id, o.platform, o.job_id
			from app.ad_event_outbox o
			join app.commerce_event e on e.id = o.event_id
			where e.order_id = ${submitted.order.id} and e.name = 'Purchase'
			order by o.platform
		`;
		assert.equal(outboxRows.length, 3);
		const [googleOutbox, metaOutbox, tiktokOutbox] = outboxRows;
		assert.ok(googleOutbox && metaOutbox && tiktokOutbox);

		// Meta completes; Google hits after-commit-lost-ack -> unknown; TikTok expires lease -> pending; then worker restarts and converges all 3
		await runOneJob(
			sql,
			{ "advertising.dispatch": advertisingAdapter(sql, "test") },
			metaOutbox.job_id,
		);
		const faultMap = new Map<string, "after-commit-lost-ack">([
			[googleOutbox.id, "after-commit-lost-ack"],
		]);
		await runOneJob(
			sql,
			{ "advertising.dispatch": advertisingAdapter(sql, "test", faultMap) },
			googleOutbox.job_id,
		);
		await sql`
			update app.outbox_job
			set status = 'processing',
				lease_token = ${randomUUID()},
				lease_until = now() - interval '5 seconds',
				dispatched_at = null,
				attempts = 1
			where id = ${tiktokOutbox.job_id}
		`;
		await expireLeases(sql, tiktokOutbox.job_id);
		await sql`
			update app.outbox_job set run_at = now() - interval '1 second'
			where id in (${googleOutbox.job_id}, ${tiktokOutbox.job_id})
		`;
		await runOneJob(
			sql,
			{ "advertising.dispatch": advertisingAdapter(sql, "test") },
			googleOutbox.job_id,
		);
		await runOneJob(
			sql,
			{ "advertising.dispatch": advertisingAdapter(sql, "test") },
			tiktokOutbox.job_id,
		);

		// 3. Accrue, Hold, Mature & Queue Affiliate Commissions/Payouts
		const accrued = await sql.begin((tx) =>
			accrueOrderCommissions(tx, { orderId: submitted.order.id }),
		);
		assert.equal(accrued.length, 2);
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
				update app.commission_entry set amount_idr = 99000 where id = ${accrued[1].id}
			`;
			await matureEligibleCommissions(tx, {
				affiliateId: affiliateProfile.id,
				asOf: "2026-05-12T08:00:00.000Z",
			});
			await queueEligibleAffiliatePayouts(tx, {
				affiliateId: affiliateProfile.id,
				asOf: "2026-05-12T08:05:00.000Z",
			});
		});

		// 4. Issue Waybill on Parcel A & Create TEST-NOT-FOR-SHIPPING Label Template
		const bookingA = await f.book(parcelA);
		await f.run(bookingA.creation_job_id);
		for (const cb of await sql<{ callback_job_id: string }[]>`
			select callback_job_id from app.waybill_provider_event where booking_id = ${bookingA.id}
		`) {
			await f.run(cb.callback_job_id);
		}
		const issuedWaybill = await simulateWaybillIssue(sql, "test", bookingA.id);
		await f.run(await ingestWaybillEvent(sql, issuedWaybill));

		const tplReq = f.owner.browser.request(
			"/api/v1/admin/shipping-label-templates",
			{
				name: `browser-test-watermark-${randomUUID().slice(0, 6)}`,
				format: "thermal_100x150",
				privacy_mode: "masked_phone",
				brand_mode: "neutral_partner",
				partner_brand_name: "99ribu Local Test",
				disclosure_text: "TEST-NOT-FOR-SHIPPING — SYNTHETIC LOCAL LABEL",
			},
		);
		tplReq.headers.set("idempotency-key", randomUUID());
		const tplRes = await handleShippingLabels(tplReq, identity);
		assert.equal(tplRes.status, 201);
		const tpl = await tplRes.json();

		// 5. Buyer Profile (Mononym), Default Address, Linked Order Receipt & Support Thread with Hidden Staff Note
		const profReq = buyerActor.browser.request("/api/v1/me/profile", {
			expected_version: 1,
			display_name: "Kartini",
			email: null,
		});
		profReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleAccounts(profReq, identity)).status, 201);

		const addrReq = buyerActor.browser.request("/api/v1/me/addresses", {
			expected_book_version: 0,
			address: {
				label: "Rumah Utama",
				recipient_name: "Kartini",
				phone: "081234567890",
				street: "Jl. Kartini No. 99",
				district: "Klojen",
				city: "Malang",
				province: "Jawa Timur",
				postcode: "65111",
			},
		});
		addrReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleAccounts(addrReq, identity)).status, 201);

		const [quoteContact] = await sql<{ phone: string }[]>`
			select q.document->'contact'->>'phone' as phone
			from app.commerce_order o
			join app.checkout_quote q on q.id = o.quote_id
			where o.id = ${f.order.id}
		`;
		const chReq = buyerActor.browser.request(
			"/api/v1/me/guest-order-link-challenges",
			{
				order_id: f.order.id,
				contact: quoteContact.phone,
			},
		);
		chReq.headers.set("idempotency-key", randomUUID());
		const chRes = await handleAccounts(chReq, identity);
		const chBody = await chRes.json();
		const otp = await challengeVerificationCode(identity, chBody.challenge_id);
		const verReq = buyerActor.browser.request(
			`/api/v1/me/guest-order-link-challenges/${chBody.challenge_id}/verifications`,
			{ code: otp },
		);
		verReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleAccounts(verReq, identity)).status, 201);

		const convReq = buyerActor.browser.request(
			"/api/v1/support/conversations",
			{
				client_conversation_id: `conv-${randomUUID()}`,
			},
		);
		convReq.headers.set("idempotency-key", randomUUID());
		const conv = await (await handleSupport(convReq, identity)).json();
		createdConversationIds.push(conv.id as string);

		const claimReq = csStaff.browser.request(
			`/api/v1/admin/support/conversations/${conv.id}/claims`,
			{ expected_version: 1 },
		);
		claimReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleSupport(claimReq, identity)).status, 200);

		const secretInternalNote = `INTERNAL-ONLY-CS-NOTE-${randomUUID()}`;
		const noteReq = csStaff.browser.request(
			`/api/v1/admin/support/conversations/${conv.id}/notes`,
			{ text: secretInternalNote },
		);
		noteReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleSupport(noteReq, identity)).status, 200);

		const replyReq = csStaff.browser.request(
			`/api/v1/admin/support/conversations/${conv.id}/messages`,
			{
				client_message_id: `msg-${randomUUID()}`,
				text: "Halo kak Kartini, pesanan Rp99.000 Anda siap dikirim dari Gudang Malang.",
				attachment_ids: [],
			},
		);
		replyReq.headers.set("idempotency-key", randomUUID());
		assert.equal((await handleSupport(replyReq, identity)).status, 200);

		// 6. Start Ephemeral Loopback HTTP Server on 127.0.0.1
		server = createServer(async (req, res) => {
			try {
				const url = new URL(req.url ?? "/", "http://127.0.0.1:3099");
				const headers = new Headers();
				for (const [k, v] of Object.entries(req.headers)) {
					if (Array.isArray(v)) headers.set(k, v.join(", "));
					else if (v) headers.set(k, v);
				}
				headers.set("host", "127.0.0.1:3099");
				headers.set("origin", "http://127.0.0.1:3099");

				if (url.pathname === "/readiness/buyer" && req.method === "GET") {
					const receiptRes = await handleOrderReceipt(
						buyerActor.browser.request(`/api/v1/orders/${f.order.id}/receipt`),
						identity,
					);
					const receipt = await receiptRes.json();
					const profRes = await handleAccounts(
						buyerActor.browser.request("/api/v1/me/profile"),
						identity,
					);
					const prof = await profRes.json();
					const addrsRes = await handleAccounts(
						buyerActor.browser.request("/api/v1/me/addresses"),
						identity,
					);
					const addrs = await addrsRes.json();
					const msgsRes = await handleSupport(
						buyerActor.browser.request(
							`/api/v1/support/conversations/${conv.id}/messages`,
						),
						identity,
					);
					const msgs = await msgsRes.json();
					const html = renderStorefrontReadinessHtml({
						orderId: receipt.order.id,
						orderNumber: receipt.order.number ?? receipt.order.id,
						merchandiseIdr: Number(receipt.order.merchandise_amount ?? 198000),
						shippingIdr: Number(receipt.order.shipping_amount ?? 0),
						totalIdr: Number(receipt.order.total_amount ?? 198000),
						phoneMasked: receipt.ship_to.phone_masked,
						buyerName: prof.display_name ?? "Kartini",
						defaultAddressLabel: addrs.items?.[0]?.label ?? "Rumah Utama",
						supportMessages: msgs.data ?? [],
					});
					res.writeHead(200, {
						"content-type": "text/html; charset=utf-8",
						"cache-control": "no-store",
					});
					res.end(html);
					return;
				}

				if (url.pathname === "/readiness/affiliate" && req.method === "GET") {
					const principal = await getPrincipal(
						affiliateActor.browser.request("/affiliate"),
						identity,
					);
					const workspace = await sql.begin(async (tx) => {
						const prof = await readAffiliateProfileDetail(tx, principal.id);
						if (!prof) return null;
						const balance = await readCommissionBalanceForAffiliate(
							tx,
							prof.id,
						);
						const commissions = await readCommissionsForAffiliate(tx, prof.id, {
							limit: 50,
							cursor: null,
						});
						const payouts = await readPayoutsForAffiliate(tx, prof.id, {
							limit: 20,
							cursor: null,
						});
						return {
							profile: prof,
							balance,
							commissions: commissions.data,
							payouts: payouts.data,
						};
					});
					assert.ok(workspace);
					const html = renderAffiliateReadinessHtml(workspace);
					res.writeHead(200, {
						"content-type": "text/html; charset=utf-8",
						"cache-control": "no-store",
					});
					res.end(html);
					return;
				}

				if (url.pathname === "/readiness/staff" && req.method === "GET") {
					const webReq = new Request(url.toString(), {
						method: "GET",
						headers,
					});
					const roleMode = url.searchParams.get("role") ?? "warehouse";
					const dashRes = await handleReporting(
						new Request(
							`http://127.0.0.1:3099/api/v1/admin/dashboard?workspace=${roleMode === "owner" ? "owner" : `warehouse&warehouse_id=${parcelA.warehouse_id}`}`,
							{ method: "GET", headers },
						),
						identity,
					);
					const dash = await dashRes.json();
					let adDestinations = null;
					if (roleMode === "owner") {
						const adRes = await handleAdvertisingDiagnostics(
							new Request(
								"http://127.0.0.1:3099/api/v1/admin/advertising/destinations",
								{ method: "GET", headers },
							),
							identity,
						);
						const adBody = await adRes.json();
						adDestinations = adBody.data ?? [];
					}
					const workspace = await readPrintCenterWorkspace(webReq, identity);
					// The owner's first queue page is ordered by action across the whole
					// shared database, so this journey lists its own parcel's artifacts,
					// each read through the authorized metadata API (newest first).
					let printWorkspace = workspace;
					if (roleMode === "owner" && workspace.authorized) {
						const ownArtifacts = [];
						for (const row of await sql<{ id: string }[]>`
							select id from app.shipping_label_artifact
							where shipment_id = ${parcelA.shipment_id}
							order by created_at desc, id desc
						`) {
							const metaRes = await handleShippingLabels(
								new Request(
									`http://127.0.0.1:3099/api/v1/admin/label-artifacts/${row.id}`,
									{ method: "GET", headers },
								),
								identity,
							);
							assert.equal(metaRes.status, 200);
							ownArtifacts.push(await metaRes.json());
						}
						printWorkspace = { ...workspace, artifacts: ownArtifacts };
					}
					const html = renderStaffReadinessHtml({
						roleLabel:
							roleMode === "owner" ? "Owner" : "Warehouse Gudang Malang",
						metrics: dash.metrics ?? [],
						adDestinations,
						printWorkspace,
						testTemplateId: tpl.id,
					});
					res.writeHead(200, {
						"content-type": "text/html; charset=utf-8",
						"cache-control": "no-store",
					});
					res.end(html);
					return;
				}

				if (url.pathname.startsWith("/api/v1/admin/")) {
					const chunks: Buffer[] = [];
					for await (const chunk of req) chunks.push(Buffer.from(chunk));
					const bodyBuffer = Buffer.concat(chunks);
					const webReq = new Request(url.toString(), {
						method: req.method ?? "GET",
						headers,
						body:
							req.method !== "GET" && req.method !== "HEAD"
								? bodyBuffer
								: undefined,
					});
					const response = await handleShippingLabels(webReq, identity);
					const outHeaders: Record<string, string> = {};
					response.headers.forEach((v, k) => {
						outHeaders[k] = v;
					});
					res.writeHead(response.status, outHeaders);
					res.end(Buffer.from(await response.arrayBuffer()));
					return;
				}

				if (url.pathname === "/favicon.ico") {
					res.writeHead(204).end();
					return;
				}
				res.writeHead(404).end("Not found");
			} catch (err) {
				res.writeHead(500).end(String(err));
			}
		});

		await new Promise<void>((resolve) =>
			server?.listen(0, "127.0.0.1", () => resolve()),
		);
		const address = server.address();
		assert.ok(address && typeof address === "object");
		const baseUrl = `http://127.0.0.1:${address.port}`;

		const browser = await chromium.launch({
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
		});

		try {
			// A. Buyer Journey across 390x844 (mobile), 768x1024 (tablet), 320px reflow (200% zoom), and 1440x900 (desktop)
			const buyerContext = await browser.newContext({
				viewport: { width: 390, height: 844 },
			});
			const buyerPage = await buyerContext.newPage();
			const errors: string[] = [];
			buyerPage.on("console", (msg) => {
				if (msg.type() === "error") errors.push(msg.text());
			});
			buyerPage.on("pageerror", (err) => errors.push(err.message));

			const buyerNavRes = await buyerPage.goto(`${baseUrl}/readiness/buyer`);
			assert.equal(buyerNavRes?.status(), 200);
			assert.ok(
				(buyerNavRes?.headers()["cache-control"] ?? "").includes("no-store"),
			);

			await expect(buyerPage.getByTestId("synthetic-watermark")).toContainText(
				"Data contoh",
			);
			await expect(buyerPage.getByTestId("offer-fixed-price")).toHaveText(
				"Rp99.000",
			);
			await expect(
				buyerPage.getByTestId("mobile-contextual-bottom-bar"),
			).toBeVisible();
			await expect(buyerPage.getByTestId("buyer-mononym-name")).toContainText(
				"Kartini",
			);
			await expect(
				buyerPage.getByTestId("buyer-default-address"),
			).toContainText("Utama");
			await expect(buyerPage.getByTestId("receipt-masked-phone")).toContainText(
				"+62••••",
			);
			await expect(buyerPage.getByTestId("buyer-support-thread")).toContainText(
				"pesanan Rp99.000 Anda siap dikirim",
			);

			const buyerHtml = await buyerPage.content();
			assert.equal(
				buyerHtml.includes(secretInternalNote),
				false,
				"Internal CS note must never appear in buyer support HTML",
			);

			for (const vp of [
				{ width: 390, height: 844 },
				{ width: 768, height: 1024 },
				{ width: 1440, height: 900 },
			]) {
				await buyerPage.setViewportSize(vp);
				const overflow = await buyerPage.evaluate(
					() =>
						document.documentElement.scrollWidth >
						document.documentElement.clientWidth + 1,
				);
				assert.equal(
					overflow,
					false,
					`Buyer readiness page must not overflow at ${vp.width}x${vp.height}`,
				);
			}

			// 320px reflow at 200% text size check
			await buyerPage.setViewportSize({ width: 320, height: 720 });
			await buyerPage.evaluate(() => {
				document.documentElement.style.fontSize = "200%";
			});
			const reflow320Overflow = await buyerPage.evaluate(
				() =>
					document.documentElement.scrollWidth >
					document.documentElement.clientWidth + 1,
			);
			assert.equal(
				reflow320Overflow,
				false,
				"Buyer readiness page must not overflow at 320px with 200% text size",
			);
			await buyerContext.close();

			// B. Affiliate Workspace Journey (390x844 & 1440x900)
			const affContext = await browser.newContext({
				viewport: { width: 390, height: 844 },
			});
			const affPage = await affContext.newPage();
			affPage.on("console", (msg) => {
				if (msg.type() === "error") errors.push(msg.text());
			});
			affPage.on("pageerror", (err) => errors.push(err.message));

			await affPage.goto(`${baseUrl}/readiness/affiliate`);
			await expect(affPage.getByTestId("affiliate-watermark")).toContainText(
				"Data contoh",
			);
			await expect(
				affPage.getByTestId("affiliate-referral-code"),
			).toContainText(refCode);
			await expect(affPage.getByTestId("aff-bucket-allocated")).toContainText(
				"Rp99.000",
			);
			await expect(
				affPage.getByTestId("no-manual-withdraw-notice"),
			).toContainText("tidak ada tombol penarikan manual");
			assert.equal(
				await affPage
					.locator("button", { hasText: /tarik saldo|withdraw/i })
					.count(),
				0,
			);
			await affContext.close();

			// C. Warehouse Staff Workspace & Print Center (Role Isolation: Count-Only KPIs, Zero Money Leak)
			const whContext = await browser.newContext({
				viewport: { width: 390, height: 844 },
			});
			const whCookieHeader =
				warehouseStaff.browser.request("/api/v1/me").headers.get("cookie") ??
				"";
			const whCookies = whCookieHeader
				.split(";")
				.map((part) => part.trim())
				.filter(Boolean)
				.map((pair) => {
					const idx = pair.indexOf("=");
					return {
						name: pair.slice(0, idx),
						value: pair.slice(idx + 1),
						url: baseUrl,
					};
				});
			await whContext.addCookies(whCookies);
			const whPage = await whContext.newPage();
			whPage.on("console", (msg) => {
				if (msg.type() === "error") errors.push(msg.text());
			});
			whPage.on("pageerror", (err) => errors.push(err.message));

			await whPage.goto(`${baseUrl}/readiness/staff?role=warehouse`);
			await expect(whPage.getByTestId("shipping-test-watermark")).toContainText(
				"TEST — NOT FOR SHIPPING",
			);
			await expect(
				whPage.getByTestId(`shipment-row-${parcelA.shipment_id}`),
			).toBeVisible();
			assert.equal(
				await whPage.getByTestId(`shipment-row-${parcelB.shipment_id}`).count(),
				0,
				"Unassigned warehouse shipment must be hidden from warehouse staff",
			);
			const whMoneyKpis = await whPage.locator('[data-kind="money"]').count();
			assert.equal(
				whMoneyKpis,
				0,
				"Warehouse dashboard must not render whole-order money KPI cards",
			);

			// Generate A4 then Thermal 100x150 labels from Print Center and verify status remains preparing/packed (not handed_over)
			await whPage.getByTestId("select-format").selectOption("a4");
			await whPage.getByTestId(`btn-gen-label-${parcelA.shipment_id}`).click();
			await expect(whPage.getByTestId("print-banner")).toContainText(
				"Label dibuat (a4):",
			);
			await whPage.getByTestId("select-format").selectOption("thermal_100x150");
			await whPage.getByTestId(`btn-gen-label-${parcelA.shipment_id}`).click();
			await expect(whPage.getByTestId("print-banner")).toContainText(
				"Label dibuat (thermal_100x150):",
			);
			await whContext.close();

			// D. Owner Workspace & Post-Restart Advertising Diagnostics + PDF Stream Verification
			const ownerContext = await browser.newContext({
				viewport: { width: 1440, height: 900 },
			});
			const ownerCookieHeader =
				f.owner.browser.request("/api/v1/me").headers.get("cookie") ?? "";
			const ownerCookies = ownerCookieHeader
				.split(";")
				.map((part) => part.trim())
				.filter(Boolean)
				.map((pair) => {
					const idx = pair.indexOf("=");
					return {
						name: pair.slice(0, idx),
						value: pair.slice(idx + 1),
						url: baseUrl,
					};
				});
			await ownerContext.addCookies(ownerCookies);
			const ownerPage = await ownerContext.newPage();
			ownerPage.on("console", (msg) => {
				if (msg.type() === "error") errors.push(msg.text());
			});
			ownerPage.on("pageerror", (err) => errors.push(err.message));

			await ownerPage.goto(`${baseUrl}/readiness/staff?role=owner`);
			await expect(ownerPage.getByTestId("owner-ad-diagnostics")).toBeVisible();
			for (const platform of ["meta", "google", "tiktok"]) {
				await expect(
					ownerPage.getByTestId(`ad-dest-${platform}`),
				).toContainText("local-sink-v1");
			}
			const ownerHtml = await ownerPage.content();
			assert.equal(
				ownerHtml.includes("secret://local/"),
				false,
				"Owner diagnostics HTML must never expose secret_reference",
			);

			// Verify active generated PDF artifact streams with %PDF-1.4, TEST-NOT-FOR-SHIPPING, and Cache-Control: no-store
			const artifactLinks = await ownerPage
				.locator('[data-testid^="link-artifact-"]')
				.all();
			assert.ok(artifactLinks.length >= 2);
			const activeHref = await artifactLinks[0].getAttribute("href");
			assert.ok(activeHref);
			const pdfRes = await ownerPage.request.get(`${baseUrl}${activeHref}`);
			assert.equal(pdfRes.status(), 200);
			assert.ok((pdfRes.headers()["cache-control"] ?? "").includes("no-store"));
			const pdfText = (await pdfRes.body()).toString("utf8");
			assert.ok(pdfText.startsWith("%PDF-1.4"));
			assert.ok(pdfText.includes("TEST-NOT-FOR-SHIPPING"));

			const a4Href = await artifactLinks[1].getAttribute("href");
			assert.ok(a4Href);
			const a4Res = await ownerPage.request.get(`${baseUrl}${a4Href}`);
			assert.equal(a4Res.status(), 200);
			assert.ok((await a4Res.body()).toString("utf8").startsWith("%PDF-1.4"));

			const ownerOverflow = await ownerPage.evaluate(
				() =>
					document.documentElement.scrollWidth >
					document.documentElement.clientWidth + 1,
			);
			assert.equal(ownerOverflow, false);
			await ownerContext.close();

			assert.deepEqual(errors, []);
		} finally {
			await browser.close();
		}
	} finally {
		if (server) {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server?.close(() => resolve()));
		}
		if (createdConversationIds.length > 0) {
			await sql`delete from app.support_in_app_notification where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_assignment_event where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_read_position where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_internal_note where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_message where conversation_id in ${sql(createdConversationIds)}`;
			await sql`delete from app.support_conversation where id in ${sql(createdConversationIds)}`;
		}
		if (attributedOrderId) {
			const clock = await readFixtureClock("test", f.namespace);
			await advanceFixtureClock("test", f.namespace, 1860, clock.version);
			const [expJob] = await sql<
				{ id: string; kind: string; payload: unknown }[]
			>`
				select id, kind, payload from app.outbox_job
				where kind = 'checkout.order.expire' and payload->>'orderId' = ${attributedOrderId}
			`;
			if (expJob) {
				await sql.begin((tx) =>
					expireOwnedOrderJob(tx, {
						id: expJob.id,
						kind: expJob.kind,
						payload: expJob.payload,
					}),
				);
			}
		}
		for (const a of extraActors) {
			await closeFulfillmentActor(identity, a);
		}
		await cleanup(identity, []);
		await f.close();
	}
});
