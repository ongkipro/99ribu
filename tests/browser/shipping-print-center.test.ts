import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import {
	handleShippingLabels,
	readPrintCenterWorkspace,
} from "../../src/modules/documents/labels.ts";
import {
	ingestWaybillEvent,
	simulateWaybillIssue,
} from "../../src/modules/fulfillment/local.ts";
import { fulfillmentFixture } from "../integration/fulfillment-fixture.ts";

function renderPrintCenterHtml(
	workspace: Awaited<ReturnType<typeof readPrintCenterWorkspace>>,
) {
	if (!workspace.authorized) {
		return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Print Center · 99ribu</title></head><body><main id="main"><h1 data-testid="print-center-denied">${workspace.code}</h1></main></body></html>`;
	}
	return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pusat Cetak Label Pengiriman · 99ribu Admin</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,sans-serif;background:#faf8f5;color:#1c1917}
main{max-width:76rem;margin:0 auto;padding:1.25rem 1rem;display:grid;gap:1.25rem}
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
		<h1 data-testid="print-center-heading">Pusat Cetak Label Pengiriman (Thermal 100×150 & A4)</h1>
		<p>Batas otoritas: Mencetak atau mencetak ulang label tidak memajukan status serah terima kurir (packed ≠ handed_over).</p>
		<div id="print-status-banner" data-testid="print-status-banner"></div>
	</header>

	<div class="grid">
		<section class="card" aria-labelledby="shipments-title">
			<h2 id="shipments-title">Antrean Paket Gudang & Cetak Massal</h2>
			<label>Format Label
				<select id="select-format" data-testid="select-format">
					<option value="thermal_100x150">Thermal 100×150 mm</option>
					<option value="a4">A4</option>
				</select>
			</label>
			<button type="button" id="btn-batch-generate" data-testid="btn-batch-generate">Buat Batch Label Semua Paket</button>
			<div id="batch-summary" data-testid="batch-summary"></div>
			<ul id="shipment-list" data-testid="shipment-list">
				${workspace.shipments
					.map(
						(s) =>
							`<li data-testid="shipment-row-${s.shipment_id}" data-shipment-id="${s.shipment_id}">
								<strong>${s.order_number} (${s.parcel_id})</strong> · Gudang: ${s.warehouse_name} · Resi: <span>${s.tracking_number ?? "Belum terbit"}</span> · Status: ${s.fulfillment_status ?? "preparing"}
								<div>
									<button type="button" data-testid="btn-gen-${s.shipment_id}" onclick="window.generateSingleLabel('${s.shipment_id}')">Buat Label PDF</button>
								</div>
							</li>`,
					)
					.join("")}
			</ul>
		</section>

		<section class="card" aria-labelledby="artifacts-title">
			<h2 id="artifacts-title">Artefak Label PDF & Tata Kelola Cetak Ulang</h2>
			<label>Alasan Cetak Ulang (Wajib untuk Reprint)
				<input id="input-reprint-reason" data-testid="input-reprint-reason" placeholder="Contoh: Kertas thermal kusut" value="" />
			</label>
			<ul id="artifact-list" data-testid="artifact-list">
				${workspace.artifacts
					.map(
						(a) =>
							`<li data-testid="artifact-row-${a.id}">
								<strong>${a.tracking_number}</strong> (${a.format}, v${a.template_version}) · Status: <span data-testid="artifact-status-${a.id}">${a.status}</span> · SHA-256: <code>${a.content_sha256.slice(0, 12)}</code>
								<div>
									<a href="/api/v1/admin/label-artifacts/${a.id}/content" target="_blank" data-testid="link-pdf-${a.id}">Buka PDF</a>
									<button type="button" data-testid="btn-initial-print-${a.id}" onclick="window.recordPrint('${a.shipment_id}','${a.id}','initial_print')">Catat Cetak Awal</button>
									<button type="button" data-testid="btn-reprint-${a.id}" onclick="window.recordPrint('${a.shipment_id}','${a.id}','reprint')">Catat Cetak Ulang</button>
								</div>
							</li>`,
					)
					.join("")}
			</ul>
			<h3>Riwayat Cetak & Cetak Ulang</h3>
			<ul id="attempt-list" data-testid="attempt-list">
				${workspace.attempts
					.map(
						(att) =>
							`<li data-testid="attempt-row-${att.id}">${att.kind} (${att.outcome}) ${att.reason ? `— ${att.reason}` : ""}</li>`,
					)
					.join("")}
			</ul>
		</section>
	</div>

	<section class="card" aria-labelledby="templates-title">
		<h2 id="templates-title">Tata Kelola Template Label (99ribu & Neutral Partner)</h2>
		<div class="grid">
			<label>Nama Template <input id="tpl-name" data-testid="tpl-name" value="partner-thermal-v1" /></label>
			<label>Mode Brand
				<select id="tpl-brand-mode" data-testid="tpl-brand-mode">
					<option value="99ribu">99ribu</option>
					<option value="neutral_partner">neutral_partner</option>
				</select>
			</label>
			<label>Mode Privasi Telepon
				<select id="tpl-privacy-mode" data-testid="tpl-privacy-mode">
					<option value="masked_phone">masked_phone</option>
					<option value="carrier_required_full_phone">carrier_required_full_phone</option>
				</select>
			</label>
			<label>Nama Mitra / Bukti Izin <input id="tpl-partner-name" data-testid="tpl-partner-name" value="" /></label>
			<label>Teks Pengungkapan (Disclosure) <input id="tpl-disclosure" data-testid="tpl-disclosure" value="" /></label>
		</div>
		<button type="button" id="btn-create-template" data-testid="btn-create-template">Simpan Template Baru</button>
		<ul id="template-list" data-testid="template-list">
			${workspace.templates
				.map(
					(t) =>
						`<li data-testid="tpl-row-${t.id}"><strong>${t.name}</strong> (${t.format}, ${t.brand_mode}, ${t.privacy_mode}, v${t.active_version})</li>`,
				)
				.join("")}
		</ul>
	</section>
</main>
<script>
const shipmentIds = ${JSON.stringify(workspace.shipments.map((s) => s.shipment_id))};

window.generateSingleLabel = async (shipmentId) => {
	const format = document.getElementById("select-format").value;
	const res = await fetch("/api/v1/admin/shipments/" + shipmentId + "/label-jobs", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": crypto.randomUUID(),
		},
		body: JSON.stringify({ format }),
	});
	const data = await res.json();
	if (!res.ok) {
		document.getElementById("print-status-banner").textContent = "Gagal: " + (data.code || res.status);
		return;
	}
	const artRes = await fetch("/api/v1/admin/label-artifacts/" + data.artifact_id);
	const art = await artRes.json();
	const list = document.getElementById("artifact-list");
	const li = document.createElement("li");
	li.setAttribute("data-testid", "artifact-row-" + art.id);
	li.innerHTML = '<strong>' + art.tracking_number + '</strong> (' + art.format + ', v' + art.template_version + ') · Status: <span data-testid="artifact-status-' + art.id + '">' + art.status + '</span> · SHA-256: <code>' + art.content_sha256.slice(0, 12) + '</code>' +
		'<div><a href="/api/v1/admin/label-artifacts/' + art.id + '/content" target="_blank" data-testid="link-pdf-' + art.id + '">Buka PDF</a> ' +
		'<button type="button" data-testid="btn-initial-print-' + art.id + '" onclick="window.recordPrint(\\'' + art.shipment_id + '\\',\\'' + art.id + '\\',\\'initial_print\\')">Catat Cetak Awal</button> ' +
		'<button type="button" data-testid="btn-reprint-' + art.id + '" onclick="window.recordPrint(\\'' + art.shipment_id + '\\',\\'' + art.id + '\\',\\'reprint\\')">Catat Cetak Ulang</button></div>';
	list.prepend(li);
	document.getElementById("print-status-banner").textContent = "Label siap: " + art.id;
};

window.recordPrint = async (shipmentId, artifactId, kind) => {
	const reason = document.getElementById("input-reprint-reason").value.trim();
	if (kind === "reprint" && !reason) {
		document.getElementById("print-status-banner").textContent = "Gagal cetak: REPRINT_REASON_REQUIRED";
		return;
	}
	const res = await fetch("/api/v1/admin/shipments/" + shipmentId + "/print-attempts", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": crypto.randomUUID(),
		},
		body: JSON.stringify({
			artifact_id: artifactId,
			kind,
			outcome: "completed",
			...(reason ? { reason } : {}),
		}),
	});
	const data = await res.json();
	if (!res.ok) {
		document.getElementById("print-status-banner").textContent = "Gagal cetak: " + (data.code || res.status);
		return;
	}
	const list = document.getElementById("attempt-list");
	const li = document.createElement("li");
	li.setAttribute("data-testid", "attempt-row-" + data.id);
	li.textContent = data.kind + " (" + data.outcome + ")" + (data.reason ? " — " + data.reason : "");
	list.prepend(li);
	document.getElementById("print-status-banner").textContent = "Cetak tercatat: " + data.kind;
};

document.getElementById("btn-batch-generate").addEventListener("click", async () => {
	const format = document.getElementById("select-format").value;
	const res = await fetch("/api/v1/admin/label-batches", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": crypto.randomUUID(),
		},
		body: JSON.stringify({
			shipment_ids: shipmentIds,
			format,
		}),
	});
	const data = await res.json();
	if (res.ok) {
		document.getElementById("batch-summary").textContent =
			"Batch " + data.status + ": " + data.items.map((i) => i.status + (i.failure_code ? "(" + i.failure_code + ")" : "")).join(", ");
		document.getElementById("print-status-banner").textContent = "Batch selesai: " + data.status;
	}
});

document.getElementById("btn-create-template").addEventListener("click", async () => {
	const name = document.getElementById("tpl-name").value.trim();
	const brandMode = document.getElementById("tpl-brand-mode").value;
	const privacyMode = document.getElementById("tpl-privacy-mode").value;
	const partnerName = document.getElementById("tpl-partner-name").value.trim();
	const disclosure = document.getElementById("tpl-disclosure").value.trim();
	if (brandMode === "neutral_partner" && (!partnerName || !disclosure)) {
		document.getElementById("print-status-banner").textContent = "Template ditolak: PARTNER_BRAND_GOVERNANCE_REQUIRED";
		return;
	}
	const res = await fetch("/api/v1/admin/shipping-label-templates", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"idempotency-key": crypto.randomUUID(),
		},
		body: JSON.stringify({
			name,
			format: "thermal_100x150",
			brand_mode: brandMode,
			privacy_mode: privacyMode,
			...(partnerName ? { partner_brand_name: partnerName } : {}),
			...(disclosure ? { disclosure_text: disclosure } : {}),
		}),
	});
	const data = await res.json();
	if (!res.ok) {
		document.getElementById("print-status-banner").textContent = "Template ditolak: " + (data.code || res.status);
		return;
	}
	const list = document.getElementById("template-list");
	const li = document.createElement("li");
	li.setAttribute("data-testid", "tpl-row-" + data.id);
	li.textContent = data.name + " (" + data.format + ", " + data.brand_mode + ", " + data.privacy_mode + ", v" + data.active_version + ")";
	list.prepend(li);
	document.getElementById("print-status-banner").textContent = "Template dibuat: " + data.name;
});
</script>
</body>
</html>`;
}

test("S55 browser: admin shipping print center renders thermal/A4 label generation, batch partial-failure reporting, reprint reason governance, and neutral_partner template governance at 390x844 and 1440x900 with zero overflow or console errors", async () => {
	const f = await fulfillmentFixture("cod");
	const identity = f.identity;
	const sql = f.identity.sql;
	const [parcelA, parcelB] = f.parcels;
	assert.ok(parcelA && parcelB);
	let server: Server | null = null;

	try {
		// Issue waybill for parcelA so it is ready to print, while parcelB remains unbooked
		const bookingA = await f.book(parcelA);
		await f.run(bookingA.creation_job_id);
		for (const callback of await sql`
			select callback_job_id from app.waybill_provider_event where booking_id = ${bookingA.id}
		`) {
			await f.run(callback.callback_job_id);
		}
		const issuedEventA = await simulateWaybillIssue(sql, "test", bookingA.id);
		await f.run(await ingestWaybillEvent(sql, issuedEventA));

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

				if (url.pathname === "/admin/print-center") {
					const ws = await readPrintCenterWorkspace(webReq, identity);
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(renderPrintCenterHtml(ws));
					return;
				}
				if (url.pathname.startsWith("/api/v1/admin/")) {
					const r = await handleShippingLabels(webReq, identity);
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
				f.owner.browser.request("/api/v1/me").headers.get("cookie") ?? "";
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

			await page.goto(`${baseUrl}/admin/print-center`);
			await expect(page.getByTestId("print-center-heading")).toBeVisible();

			// 1. Generate single label for parcelA (issued waybill)
			await page.getByTestId(`btn-gen-${parcelA.shipment_id}`).click();
			await expect(page.getByTestId("print-status-banner")).toContainText(
				"Label siap:",
			);

			// 2. Record initial print, then test reprint governance (fails without reason, succeeds with reason)
			const initialPrintBtn = page
				.locator('[data-testid^="btn-initial-print-"]')
				.first();
			await initialPrintBtn.click();
			await expect(page.getByTestId("print-status-banner")).toHaveText(
				"Cetak tercatat: initial_print",
			);

			const reprintBtn = page.locator('[data-testid^="btn-reprint-"]').first();
			await reprintBtn.click();
			await expect(page.getByTestId("print-status-banner")).toHaveText(
				"Gagal cetak: REPRINT_REASON_REQUIRED",
			);

			await page
				.getByTestId("input-reprint-reason")
				.fill("Kertas thermal macet di roller");
			await reprintBtn.click();
			await expect(page.getByTestId("print-status-banner")).toHaveText(
				"Cetak tercatat: reprint",
			);

			// 3. Batch label generation across ready + unbooked shipments reports partially_failed
			await page.getByTestId("btn-batch-generate").click();
			await expect(page.getByTestId("print-status-banner")).toHaveText(
				"Batch selesai: partially_failed",
			);
			await expect(page.getByTestId("batch-summary")).toContainText(
				"WAYBILL_REQUIRED",
			);

			// 4. Template governance: neutral_partner rejected without partner_brand_name & disclosure_text, accepted with both
			const tplName = `mitra-thermal-${randomUUID().slice(0, 6)}`;
			await page.getByTestId("tpl-name").fill(tplName);
			await page.getByTestId("tpl-brand-mode").selectOption("neutral_partner");
			await page.getByTestId("btn-create-template").click();
			await expect(page.getByTestId("print-status-banner")).toHaveText(
				"Template ditolak: PARTNER_BRAND_GOVERNANCE_REQUIRED",
			);

			await page
				.getByTestId("tpl-partner-name")
				.fill("Mitra Ekspedisi Nusantara");
			await page
				.getByTestId("tpl-disclosure")
				.fill("Difasilitasi oleh sistem logistik 99ribu");
			await page.getByTestId("btn-create-template").click();
			await expect(page.getByTestId("print-status-banner")).toHaveText(
				`Template dibuat: ${tplName}`,
			);

			// 5. Verify zero horizontal overflow at 390x844 and 1440x900
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
					`Zero horizontal overflow on /admin/print-center at ${vp.width}x${vp.height} (overflow=${overflow})`,
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
		await f.close();
	}
});
