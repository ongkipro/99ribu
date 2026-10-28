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
import { actor, enroll, labelTemplateProof } from "../contract/access-fixture.ts";
import {
	closeFulfillmentActor,
	fulfillmentFixture,
} from "../integration/fulfillment-fixture.ts";

// Stand-in page for /admin/print-center served from the isolated TEST database. It mirrors the
// real PrintCenterClient contract (src/components/admin/print-center-client.tsx): the same test
// ids, the same API calls and the same Indonesian notices, so the label, print, reprint, batch and
// template rules are proven against the real handlers. The built page itself reads the LOCAL
// database; its rendered proof is the console design/browser suites (S113 note: a local-database
// rewrite of this suite would drive the real component).
function renderPrintCenterHtml(
	workspace: Awaited<ReturnType<typeof readPrintCenterWorkspace>>,
) {
	if (!workspace.authorized) {
		return `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pusat Cetak Label Pengiriman · Admin 99ribu</title></head><body><main id="main"><h1 data-testid="print-center-heading">Pusat Cetak Label Pengiriman</h1><section data-testid="print-center-denied"><p>Kode akses: ${workspace.code}</p></section></main></body></html>`;
	}
	const latest = (shipmentId: string) =>
		workspace.artifacts.find((a) => a.shipment_id === shipmentId);
	return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pusat Cetak Label Pengiriman · Admin 99ribu</title>
<style>
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,sans-serif;background:#fff;color:#18181b}
main{max-width:76rem;margin:0 auto;padding:1.25rem 1rem;display:grid;grid-template-columns:minmax(0,1fr);gap:1.25rem}
section{border:1px solid #e4e4e7;border-radius:8px;padding:1rem;display:grid;grid-template-columns:minmax(0,1fr);gap:.75rem}
input,select,button{font:inherit;padding:.4rem .75rem;border-radius:6px;border:1px solid #d4d4d8;max-width:100%}
button{min-height:2.25rem;background:#fff;cursor:pointer}
button:disabled{opacity:.5;cursor:not-allowed}
ul{list-style:none;margin:0;padding:0;display:grid;gap:.5rem}
li{border-top:1px solid #f4f4f5;padding-top:.5rem;word-break:break-word;display:grid;gap:.4rem}
.row{display:flex;flex-wrap:wrap;gap:.4rem;align-items:center}
#notice{overflow-wrap:anywhere}
</style>
</head>
<body>
<main id="main">
	<header>
		<h1 data-testid="print-center-heading">Pusat Cetak Label Pengiriman</h1>
		<p>Buat dan cetak label Thermal 100×150 mm atau A4. Mencetak label tidak mengubah status pengemasan atau serah terima kurir.</p>
	</header>
	<div role="status" data-testid="print-center-status-banner" id="notice" hidden></div>

	<section data-testid="print-controls-section" aria-labelledby="print-controls-heading">
		<h2 id="print-controls-heading">Format label dan cetak sekaligus</h2>
		<div class="row">
			<label for="label-format-select">Format Kertas Label</label>
			<select id="label-format-select" data-testid="label-format-select">
				<option value="thermal_100x150">Thermal 100×150 mm</option>
				<option value="a4">A4</option>
			</select>
			<span id="batch-slot">Pilih paket di daftar untuk membuat label sekaligus.</span>
		</div>
	</section>

	<section data-testid="shipments-queue-section" aria-labelledby="shipments-queue-heading">
		<h2 id="shipments-queue-heading">Daftar Paket &amp; Status Resi Gudang</h2>
		<ul data-testid="print-shipment-list">
			${workspace.shipments
				.map((s) => {
					const art = latest(s.shipment_id);
					const name = `${s.order_number} · ${s.parcel_id}`;
					return `<li data-testid="print-shipment-row-${s.shipment_id}" data-name="${name}">
						<label class="row"><input type="checkbox" data-testid="select-shipment-${s.shipment_id}" aria-label="Pilih paket ${s.parcel_id}" data-shipment="${s.shipment_id}"> <strong>${s.order_number}</strong> ${s.parcel_id}</label>
						<span>${s.warehouse_name} · Resi: <span data-testid="shipment-waybill-${s.shipment_id}">${s.tracking_number ?? "Belum terbit"}</span></span>
						<div class="row" data-actions="${s.shipment_id}">
							<button type="button" data-testid="generate-label-${s.shipment_id}" data-generate="${s.shipment_id}">Buat label</button>
							${art && art.status === "valid" ? actionButtons(s.shipment_id, art.id) : ""}
						</div>
						<div class="row" data-testid="reprint-modal-${s.shipment_id}" hidden>
							<label for="reprint-reason-${s.shipment_id}">Alasan cetak ulang (wajib, tercatat di audit)</label>
							<input id="reprint-reason-${s.shipment_id}" data-testid="reprint-reason-input-${s.shipment_id}" placeholder="Contoh: Kertas thermal kusut">
							<button type="button" data-testid="confirm-reprint-${s.shipment_id}" disabled>Catat cetak ulang</button>
						</div>
					</li>`;
				})
				.join("")}
		</ul>
	</section>

	<section data-testid="templates-section" aria-labelledby="templates-heading">
		<h2 id="templates-heading">Template label</h2>
		<ul data-testid="template-list">
			${workspace.templates.map((t) => `<li data-testid="template-row-${t.id}"><strong>${t.name}</strong> (${t.format}, ${t.brand_mode}, ${t.privacy_mode}, v${t.active_version})</li>`).join("")}
		</ul>
	</section>

	<section data-testid="print-audit-section" aria-labelledby="print-audit-heading">
		<h2 id="print-audit-heading">Riwayat cetak</h2>
		<ul data-testid="print-attempts-list">
			${workspace.attempts.map((a) => `<li data-testid="print-attempt-row-${a.id}">${a.kind} (${a.outcome}) ${a.reason ?? ""}</li>`).join("")}
		</ul>
	</section>
</main>
<script>
const FORMATS = { thermal_100x150: "Thermal 100×150 mm", a4: "A4" };
const notice = (text) => { const n = document.getElementById("notice"); n.hidden = false; n.textContent = text; };
const nameOf = (id) => document.querySelector('[data-testid="print-shipment-row-' + id + '"]').dataset.name;
const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(body) });
const selected = new Set();
${actionButtons.toString()}
function attachActions(shipmentId, artifactId) {
	const box = document.querySelector('[data-actions="' + shipmentId + '"]');
	box.querySelectorAll("[data-art]").forEach((el) => el.remove());
	box.insertAdjacentHTML("beforeend", actionButtons(shipmentId, artifactId));
}
async function recordPrint(shipmentId, artifactId, kind, reason) {
	const res = await post("/api/v1/admin/shipments/" + shipmentId + "/print-attempts", { artifact_id: artifactId, kind, outcome: "completed", ...(reason ? { reason } : {}) });
	const data = await res.json();
	if (res.status !== 201) return notice("Cetakan " + nameOf(shipmentId) + " tidak tercatat. (kode: " + (data.code || res.status) + ")");
	document.querySelector('[data-testid="print-attempts-list"]').insertAdjacentHTML("afterbegin", '<li data-testid="print-attempt-row-' + data.id + '">' + data.kind + " (" + data.outcome + ") " + (data.reason || "") + "</li>");
	if (kind === "reprint") document.querySelector('[data-testid="reprint-modal-' + shipmentId + '"]').hidden = true;
	notice(kind === "initial_print" ? "Cetak awal " + nameOf(shipmentId) + " tercatat." : "Cetak ulang " + nameOf(shipmentId) + " tercatat beserta alasannya.");
}
document.addEventListener("click", async (e) => {
	const t = e.target.closest("button");
	if (!t) return;
	const format = document.getElementById("label-format-select").value;
	if (t.dataset.generate) {
		const id = t.dataset.generate;
		const res = await post("/api/v1/admin/shipments/" + id + "/label-jobs", { format });
		const job = await res.json();
		if (res.status !== 202 || job.status === "failed") return notice("Label " + nameOf(id) + " gagal dibuat. (kode: " + (job.failure_code || job.code || res.status) + ")");
		if (job.artifact_id) attachActions(id, job.artifact_id);
		notice(job.artifact_id ? "Label " + FORMATS[format] + " untuk " + nameOf(id) + " siap dicetak." : "Label " + nameOf(id) + " sedang dibuat.");
	} else if (t.dataset.initial) {
		await recordPrint(t.dataset.initial, t.dataset.art, "initial_print");
	} else if (t.dataset.reprint) {
		const modal = document.querySelector('[data-testid="reprint-modal-' + t.dataset.reprint + '"]');
		modal.hidden = false;
		modal.dataset.art = t.dataset.art;
	} else if (t.dataset.testid && t.dataset.testid.startsWith("confirm-reprint-")) {
		const id = t.dataset.testid.slice("confirm-reprint-".length);
		const modal = document.querySelector('[data-testid="reprint-modal-' + id + '"]');
		await recordPrint(id, modal.dataset.art, "reprint", document.getElementById("reprint-reason-" + id).value.trim());
	} else if (t.id === "batch") {
		const res = await post("/api/v1/admin/label-batches", { shipment_ids: [...selected], format });
		const batch = await res.json();
		if (res.status !== 202) return notice("Label sekaligus gagal dibuat. (kode: " + (batch.code || res.status) + ")");
		const ok = batch.items.filter((i) => i.status === "succeeded"), failed = batch.items.filter((i) => i.status === "failed");
		for (const i of ok) if (i.artifact_id) attachActions(i.shipment_id, i.artifact_id);
		const parts = [ok.length + " label siap"];
		if (failed.length) parts.push(failed.length + " gagal: " + failed.map((i) => nameOf(i.shipment_id) + " (kode: " + i.failure_code + ")").join("; "));
		notice("Label " + FORMATS[batch.format] + " untuk " + batch.items.length + " paket: " + parts.join(", ") + ".");
	}
});
document.addEventListener("input", (e) => {
	const input = e.target.closest("[data-testid^='reprint-reason-input-']");
	if (!input) return;
	const id = input.dataset.testid.slice("reprint-reason-input-".length);
	document.querySelector('[data-testid="confirm-reprint-' + id + '"]').disabled = !input.value.trim();
});
document.addEventListener("change", (e) => {
	const box = e.target.closest("[data-shipment]");
	if (!box) return;
	if (box.checked) selected.add(box.dataset.shipment); else selected.delete(box.dataset.shipment);
	// Mirrors the print center (S113 #15): no batch button until a parcel is selected.
	document.getElementById("batch-slot").innerHTML = selected.size === 0
		? "Pilih paket di daftar untuk membuat label sekaligus."
		: '<button type="button" data-testid="batch-generate-button" id="batch">Buat label ' + selected.size + " paket</button>";
});
</script>
</body>
</html>`;
}

/** The valid-label actions of a parcel row (real ids: initial-print-*, open-reprint-*, download-pdf-*). */
function actionButtons(shipmentId: string, artifactId: string) {
	return `<a data-art="${artifactId}" data-testid="download-pdf-${artifactId}" href="/api/v1/admin/label-artifacts/${artifactId}/content" target="_blank" rel="noreferrer">Unduh PDF</a><button type="button" data-art="${artifactId}" data-initial="${shipmentId}" data-testid="initial-print-${shipmentId}">Catat cetak awal</button><button type="button" data-art="${artifactId}" data-reprint="${shipmentId}" data-testid="open-reprint-${shipmentId}">Cetak ulang</button>`;
}

test("S55 browser: admin shipping print center renders thermal/A4 label generation, batch partial-failure reporting, reprint reason governance, and neutral_partner template governance at 390x844 and 1440x900 with zero overflow or console errors", async () => {
	const f = await fulfillmentFixture("cod");
	const identity = f.identity;
	const sql = f.identity.sql;
	const [parcelA, parcelB] = f.parcels;
	assert.ok(parcelA && parcelB);
	let server: Server | null = null;
	// Parcel work runs as staff of the fixture's own warehouses, so the queue
	// holds exactly this order's parcels whatever else the database contains.
	const staff = await actor(identity, "warehouse", [
		...new Set([String(parcelA.warehouse_id), String(parcelB.warehouse_id)]),
	]);
	await enroll(staff.browser, staff.password);

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
				if (url.pathname === "/favicon.ico") {
					res.writeHead(204).end();
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
			const consoleErrors: string[] = [];
			const pageErrors: string[] = [];
			const openAs = async (user: typeof staff) => {
				const context = await browser.newContext({
					viewport: { width: 390, height: 844 },
					reducedMotion: "reduce",
				});
				const cookieHeader =
					user.browser.request("/api/v1/me").headers.get("cookie") ?? "";
				await context.addCookies(
					cookieHeader
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
						}),
				);
				const opened = await context.newPage();
				opened.on("console", (msg) => {
					// The reprint-reason and partner-template refusals are asserted on their 422 codes; the browser
					// logs each refused fetch, which is expected and not a page error.
					if (msg.type() === "error" && !msg.text().includes("status of 422")) consoleErrors.push(msg.text());
				});
				opened.on("pageerror", (err) => {
					pageErrors.push(String(err));
				});
				return opened;
			};
			const page = await openAs(staff);
			const banner = page.getByTestId("print-center-status-banner");

			await page.goto(`${baseUrl}/admin/print-center`);
			await expect(page.getByTestId("print-center-heading")).toBeVisible();

			// 1. Generate a single label for parcelA (issued waybill)
			await page.getByTestId(`generate-label-${parcelA.shipment_id}`).click();
			await expect(banner).toContainText("siap dicetak.");

			// 2. Record the initial print, then reprint governance: the confirm stays disabled and the
			// API refuses a reprint without a reason; with a reason it is recorded.
			await page.getByTestId(`initial-print-${parcelA.shipment_id}`).click();
			await expect(banner).toContainText("Cetak awal");
			await expect(banner).toContainText("tercatat.");

			await page.getByTestId(`open-reprint-${parcelA.shipment_id}`).click();
			const confirmReprint = page.getByTestId(`confirm-reprint-${parcelA.shipment_id}`);
			await expect(confirmReprint).toBeDisabled();
			const artifactId = await page
				.locator(`[data-testid^="download-pdf-"]`)
				.first()
				.getAttribute("data-art");
			assert.ok(artifactId);
			const refused = await page.evaluate(
				async ({ shipmentId, artifactId }) => {
					const res = await fetch(`/api/v1/admin/shipments/${shipmentId}/print-attempts`, {
						method: "POST",
						headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
						body: JSON.stringify({ artifact_id: artifactId, kind: "reprint", outcome: "completed" }),
					});
					return { status: res.status, code: (await res.json()).code };
				},
				{ shipmentId: parcelA.shipment_id, artifactId },
			);
			assert.equal(refused.code, "REPRINT_REASON_REQUIRED", JSON.stringify(refused));

			await page
				.getByTestId(`reprint-reason-input-${parcelA.shipment_id}`)
				.fill("Kertas thermal macet di roller");
			await expect(confirmReprint).toBeEnabled();
			await confirmReprint.click();
			await expect(banner).toContainText("tercatat beserta alasannya.");
			await expect(page.getByTestId("print-attempts-list")).toContainText(
				"Kertas thermal macet di roller",
			);

			// 3. Batch labels for the selected ready + unbooked parcels report partially_failed
			// No batch action until a parcel is selected (S113 #15: hidden, not a disabled "0 paket").
			await expect(page.getByTestId("batch-generate-button")).toHaveCount(0);
			await page.getByTestId(`select-shipment-${parcelA.shipment_id}`).check();
			await page.getByTestId(`select-shipment-${parcelB.shipment_id}`).check();
			const batchResponse = page.waitForResponse(
				(r) => r.url().endsWith("/api/v1/admin/label-batches") && r.request().method() === "POST",
			);
			await page.getByTestId("batch-generate-button").click();
			const batch = (await (await batchResponse).json()) as {
				status: string;
				items: { shipment_id: string; status: string; failure_code: string | null }[];
			};
			assert.equal(batch.status, "partially_failed");
			assert.equal(
				batch.items.find((i) => i.shipment_id === parcelB.shipment_id)?.failure_code,
				"WAYBILL_REQUIRED",
			);
			await expect(banner).toContainText("untuk 2 paket: 1 label siap, 1 gagal");
			await expect(banner).toContainText("WAYBILL_REQUIRED");

			// 4. Template governance (owner-only API; the page lists templates): neutral_partner is
			// rejected without partner_brand_name and disclosure_text, accepted with both, then listed.
			const ownerPage = await openAs(f.owner);
			await ownerPage.goto(`${baseUrl}/admin/print-center`);
			await expect(ownerPage.getByTestId("print-center-heading")).toBeVisible();
			const tplName = `mitra-thermal-${randomUUID().slice(0, 6)}`;
			const createTemplate = async (extra: Record<string, string>) =>
				ownerPage.evaluate(
					async (body) => {
						const res = await fetch("/api/v1/admin/shipping-label-templates", {
							method: "POST",
							headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
							body: JSON.stringify(body),
						});
						const data = await res.json();
						return { status: res.status, code: data.code as string | undefined, id: data.id as string | undefined };
					},
					{
						name: tplName,
						format: "thermal_100x150",
						brand_mode: "neutral_partner",
						privacy_mode: "masked_phone",
						...extra,
						reauthentication_proof: await labelTemplateProof(identity, f.owner),
					},
				);
			const rejected = await createTemplate({});
			assert.equal(rejected.code, "PARTNER_BRAND_GOVERNANCE_REQUIRED", JSON.stringify(rejected));
			const accepted = await createTemplate({
				partner_brand_name: "Mitra Ekspedisi Nusantara",
				disclosure_text: "Difasilitasi oleh sistem logistik 99ribu",
			});
			assert.ok(accepted.status < 300 && accepted.id, JSON.stringify(accepted));
			await ownerPage.reload();
			await expect(ownerPage.getByTestId(`template-row-${accepted.id}`)).toContainText(tplName);

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

			assert.equal(consoleErrors.length, 0, `Zero console errors: ${consoleErrors.join(" | ")}`);
			assert.equal(pageErrors.length, 0, "Zero uncaught page errors");
		} finally {
			await browser.close();
		}
	} finally {
		if (server) {
			await new Promise<void>((resolve) => server?.close(() => resolve()));
		}
		await closeFulfillmentActor(identity, staff);
		await f.close();
	}
});
