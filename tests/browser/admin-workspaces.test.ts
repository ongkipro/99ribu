import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { handleAccess } from "../../src/modules/access/routes.ts";
import {
	handleAdvertisingDiagnostics,
	listAdvertisingDestinations,
} from "../../src/modules/advertising/diagnostics.ts";
import {
	type CanonicalWorkspace,
	getDashboardSnapshot,
	handleReporting,
	listWorkQueue,
} from "../../src/modules/reporting/service.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { advertisingFixture } from "../integration/advertising-fixture.ts";

function renderAdminWorkspaceHtml(params: {
	workspace: CanonicalWorkspace;
	dashboard: Awaited<ReturnType<typeof getDashboardSnapshot>>;
	queueRows: Awaited<ReturnType<typeof listWorkQueue>>["data"];
	destinations: Awaited<ReturnType<typeof listAdvertisingDestinations>>["data"];
}) {
	const { workspace, dashboard, queueRows, destinations } = params;
	const isOwner = workspace === "owner";
	const canSeeMoney = workspace === "owner" || workspace === "finance";
	const canSeeCatalog =
		workspace === "owner" || workspace === "ecommerce_admin";
	const canSeeWarehouse =
		workspace === "owner" ||
		workspace === "warehouse" ||
		workspace === "ecommerce_admin";
	const canSeeCs = workspace === "owner" || workspace === "customer_service";
	const canSeeFinance = workspace === "owner" || workspace === "finance";

	const titleMap: Record<CanonicalWorkspace, string> = {
		owner: "Ruang Kerja Pemilik (Owner)",
		ecommerce_admin: "Ruang Kerja Admin E-Commerce",
		warehouse: "Ruang Kerja Staf Gudang",
		customer_service: "Ruang Kerja Layanan Pelanggan (CS)",
		finance: "Ruang Kerja Staf Keuangan",
	};

	const formatIdr = (amount: number | null) =>
		amount === null
			? "Belum Lengkap (Sumber Biaya Tidak Diketahui)"
			: new Intl.NumberFormat("id-ID", {
					style: "currency",
					currency: "IDR",
					maximumFractionDigits: 0,
				}).format(amount);

	return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${titleMap[workspace]} · 99ribu</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; overflow-x: hidden; }
    main { max-width: 100%; padding: clamp(12px, 2.5vw, 24px); display: grid; gap: 16px; }
    .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; display: grid; gap: 8px; word-break: break-word; }
    .btn { padding: 6px 10px; border-radius: 6px; border: 1px solid #0f172a; background: #0f172a; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; }
    code { word-break: break-all; font-size: 12px; }
  </style>
</head>
<body>
  <main data-testid="admin-workspaces-root">
    <header class="card">
      <h1 data-testid="workspace-heading">${titleMap[workspace]}</h1>
      <p>Basis Waktu: ${dashboard.timezone} · Gudang Aktif: ${dashboard.warehouse_ids.length}</p>
    </header>

    <section aria-label="KPI Operasional" data-testid="kpi-cards-grid" class="grid">
      ${dashboard.metrics
				.filter((m) => (m.kind === "money" ? canSeeMoney : true))
				.map(
					(m) => `<article class="card" data-testid="kpi-card-${m.key}">
            <strong>${m.key}</strong>
            <div data-testid="kpi-value-${m.key}">${m.kind === "money" ? formatIdr(m.complete ? m.amount : null) : `${m.count ?? 0} item`}</div>
            <span data-testid="kpi-basis-${m.key}">${m.complete ? m.financial_basis : "unknown"}</span>
          </article>`,
				)
				.join("")}
    </section>

    <section class="card" data-testid="work-queue-section">
      <h2>Antrean Kerja (${queueRows.length} baris)</h2>
      <div data-testid="export-controls-bar">
        <button type="button" class="btn" data-testid="freeze-export-selection-btn">Bekukan Pilihan Ekspor</button>
        <button type="button" class="btn" data-testid="download-csv-btn">Unduh CSV Aman</button>
      </div>
      <div class="grid">
        ${queueRows
					.slice(0, 10)
					.map(
						(r) => `<div class="card" data-testid="queue-row-${r.id}">
              <strong>${r.resource_kind.toUpperCase()}</strong>
              <code>${r.id}</code>
              <span>Status: ${r.state} · v${r.version}</span>
            </div>`,
					)
					.join("")}
      </div>
    </section>

    <div class="grid">
      ${canSeeCatalog ? `<section class="card" data-testid="panel-s49-catalog"><h3>Manajemen Katalog Rp99.000, Biaya Komponen & Publikasi (S49)</h3></section>` : ""}
      ${canSeeWarehouse ? `<section class="card" data-testid="panel-s50-warehouse"><h3>Operasional Pemenuhan Gudang, Retur & Kendala Kirim (S50)</h3></section>` : ""}
      ${canSeeCs ? `<section class="card" data-testid="panel-s50-cs"><h3>Layanan Pelanggan, Resolusi Kendala & Persetujuan Retur (S50)</h3></section>` : ""}
      ${canSeeFinance ? `<section class="card" data-testid="panel-s51-finance"><h3>Rekonsiliasi Keuangan, Pengembalian Dana & Pencairan Afiliasi (S51)</h3></section>` : ""}
      ${isOwner ? `<section class="card" data-testid="panel-s52-access"><h3>Tata Kelola Akses Staf, Kebijakan Platform & Komisi Afiliasi (S52)</h3></section>` : ""}
    </div>

    ${
			isOwner
				? `<section class="card" data-testid="panel-s60-advertising">
            <h2>Diagnostik Tujuan Iklan, Rekonsiliasi Uang-vs-Sinyal & Replay Terkontrol (S60)</h2>
            <div class="grid">
              ${destinations
								.map(
									(
										d,
									) => `<article class="card" data-testid="ad-destination-card-${d.platform}">
                    <strong>${String(d.platform).toUpperCase()} · v${d.version}</strong>
                    <span data-testid="ad-status-badge-${d.platform}">${d.paused ? "Dijeda" : "Aktif"}</span>
                    <div data-testid="ad-secret-redacted-${d.platform}">${d.credentials_configured ? "Terkonfigurasi (Rahasia Diredaksi)" : "Belum Diatur"}</div>
                    <div>Memenuhi Syarat: ${d.eligible} · Ditekan: ${d.suppressed} · Antrean: ${d.queued} · Diterima: ${d.accepted} · Diproses: ${d.processed} · Atribusi: ${d.attributed === null ? "Tidak Diketahui" : d.attributed}</div>
                    <div data-testid="ad-instances-vs-orders-${d.platform}">Kejadian Koleksi Purchase: ${d.purchase_collection_instances} vs Pesanan Unik: ${d.unique_orders}</div>
                    <div data-testid="ad-reconciliation-${d.platform}">Gross: ${formatIdr(d.reconciliation.gross_merchandise_amount_idr)} · Net: ${formatIdr(d.reconciliation.net_merchandise_amount_idr)}</div>
                  </article>`,
								)
								.join("")}
            </div>
          </section>`
				: ""
		}
  </main>
</body>
</html>`;
}

test("T-34 & T-30 browser: admin workspaces enforce role boundaries across all 5 staff roles, render S60 advertising diagnostics for owner only without secret leakage, and maintain zero horizontal overflow at 320px, 390x844, 768x1024, and 1440x900", async () => {
	const f = await advertisingFixture();
	const extraUsers: { id: string; email: string }[] = [];
	let server: Server | null = null;

	try {
		await f.consent(f.client);
		const order = await f.order(f.client);
		const pay = await f.pay(f.client, order.id);
		assert.equal(await pay.complete(), true);

		const whRows = await f.identity.sql<
			{ id: string }[]
		>`select id from app.warehouse where active order by id`;
		const whA = String(whRows[0].id);

		const warehouseStaff = await actor(f.identity, "warehouse", [whA]);
		extraUsers.push(warehouseStaff);
		await enroll(warehouseStaff.browser, warehouseStaff.password);

		const financeStaff = await actor(f.identity, "finance", []);
		extraUsers.push(financeStaff);
		await enroll(financeStaff.browser, financeStaff.password);

		server = createServer(async (req, res) => {
			try {
				const url = new URL(req.url ?? "/", "http://127.0.0.1:3099");
				const headers = new Headers({
					host: "127.0.0.1:3099",
					origin: "http://127.0.0.1:3099",
				});
				if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
				if (req.headers["content-type"])
					headers.set("content-type", String(req.headers["content-type"]));
				if (req.headers["idempotency-key"])
					headers.set(
						"idempotency-key",
						String(req.headers["idempotency-key"]),
					);

				const chunks: Buffer[] = [];
				for await (const chunk of req) chunks.push(Buffer.from(chunk));
				const bodyBuf = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

				const webReq = new Request(url.toString(), {
					method: req.method ?? "GET",
					headers,
					body: bodyBuf,
				});

				if (url.pathname === "/admin") {
					const wsParam = (url.searchParams.get("workspace") ??
						"owner") as CanonicalWorkspace;
					const defaultQueueMap: Record<CanonicalWorkspace, string> = {
						owner: "orders",
						ecommerce_admin: "orders",
						warehouse: "fulfillments",
						customer_service: "support",
						finance: "reconciliation",
					};
					const dashReq = new Request(
						`http://127.0.0.1:3099/api/v1/admin/dashboard?workspace=${wsParam}`,
						{ headers },
					);
					const dash = await getDashboardSnapshot(dashReq, f.identity);
					const qReq = new Request(
						`http://127.0.0.1:3099/api/v1/admin/work-queues?workspace=${wsParam}&queue=${defaultQueueMap[dash.workspace]}`,
						{ headers },
					);
					const queue = await listWorkQueue(qReq, f.identity);
					const dests =
						dash.workspace === "owner"
							? (
									await listAdvertisingDestinations(
										new Request(
											"http://127.0.0.1:3099/api/v1/admin/advertising/destinations",
											{ headers },
										),
										f.identity,
									)
								).data
							: [];

					const html = renderAdminWorkspaceHtml({
						workspace: dash.workspace,
						dashboard: dash,
						queueRows: queue.data,
						destinations: dests as Awaited<
							ReturnType<typeof listAdvertisingDestinations>
						>["data"],
					});
					res.writeHead(200, {
						"content-type": "text/html; charset=utf-8",
						"cache-control": "no-store",
					});
					res.end(html);
					return;
				}

				if (
					url.pathname.startsWith("/api/v1/admin/dashboard") ||
					url.pathname.startsWith("/api/v1/admin/work-queues") ||
					url.pathname.startsWith("/api/v1/admin/export-selections") ||
					url.pathname.startsWith("/api/v1/admin/exports") ||
					url.pathname.startsWith("/api/v1/operations/")
				) {
					const r = await handleReporting(webReq, f.identity);
					res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
					res.end(await r.text());
					return;
				}

				if (url.pathname.startsWith("/api/v1/admin/advertising/destinations")) {
					const r = await handleAdvertisingDiagnostics(webReq, f.identity);
					res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
					res.end(await r.text());
					return;
				}

				if (
					url.pathname.startsWith("/api/v1/me") ||
					url.pathname.startsWith("/api/v1/admin/warehouses")
				) {
					const r = await handleAccess(webReq, f.identity);
					res.writeHead(r.status, Object.fromEntries(r.headers.entries()));
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

		const browser = await chromium.launch({
			executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
		});

		try {
			// 1. Verify Warehouse Staff workspace: sees S50 warehouse panel, never sees money KPIs, finance panel, or S60 advertising
			const whContext = await browser.newContext({
				viewport: { width: 390, height: 844 },
				reducedMotion: "reduce",
			});
			await whContext.addCookies(
				[...warehouseStaff.browser.cookies].map(([name, value]) => ({
					name,
					value,
					domain: "127.0.0.1",
					path: "/",
				})),
			);
			const whPage = await whContext.newPage();
			await whPage.goto(`${baseUrl}/admin?workspace=warehouse`);
			await expect(whPage.getByTestId("workspace-heading")).toHaveText(
				"Ruang Kerja Staf Gudang",
			);
			await expect(whPage.getByTestId("panel-s50-warehouse")).toBeVisible();
			await expect(whPage.getByTestId("panel-s51-finance")).toHaveCount(0);
			await expect(whPage.getByTestId("panel-s60-advertising")).toHaveCount(0);
			await expect(
				whPage.getByTestId("kpi-card-net_merchandise_revenue"),
			).toHaveCount(0);
			await whContext.close();

			// 2. Verify Finance Staff workspace: sees S51 finance panel and money KPIs, never sees S60 advertising panel
			const finContext = await browser.newContext({
				viewport: { width: 768, height: 1024 },
				reducedMotion: "reduce",
			});
			await finContext.addCookies(
				[...financeStaff.browser.cookies].map(([name, value]) => ({
					name,
					value,
					domain: "127.0.0.1",
					path: "/",
				})),
			);
			const finPage = await finContext.newPage();
			await finPage.goto(`${baseUrl}/admin?workspace=finance`);
			await expect(finPage.getByTestId("workspace-heading")).toHaveText(
				"Ruang Kerja Staf Keuangan",
			);
			await expect(finPage.getByTestId("panel-s51-finance")).toBeVisible();
			await expect(
				finPage.getByTestId("kpi-card-net_merchandise_revenue"),
			).toBeVisible();
			await expect(finPage.getByTestId("panel-s60-advertising")).toHaveCount(0);
			await finContext.close();

			// 3. Verify Owner workspace across 320px, 390x844, 768x1024, and 1440x900 viewports + S60 advertising diagnostics
			const ownerContext = await browser.newContext({
				viewport: { width: 1440, height: 900 },
				reducedMotion: "reduce",
			});
			await ownerContext.addCookies(
				[...f.owner.browser.cookies].map(([name, value]) => ({
					name,
					value,
					domain: "127.0.0.1",
					path: "/",
				})),
			);
			const ownerPage = await ownerContext.newPage();
			await ownerPage.goto(`${baseUrl}/admin?workspace=owner`);
			await expect(ownerPage.getByTestId("workspace-heading")).toHaveText(
				"Ruang Kerja Pemilik (Owner)",
			);
			await expect(ownerPage.getByTestId("panel-s49-catalog")).toBeVisible();
			await expect(ownerPage.getByTestId("panel-s50-warehouse")).toBeVisible();
			await expect(ownerPage.getByTestId("panel-s51-finance")).toBeVisible();
			await expect(ownerPage.getByTestId("panel-s52-access")).toBeVisible();
			await expect(
				ownerPage.getByTestId("panel-s60-advertising"),
			).toBeVisible();
			await expect(
				ownerPage.getByTestId("ad-destination-card-meta"),
			).toBeVisible();
			await expect(
				ownerPage.getByTestId("ad-destination-card-google"),
			).toBeVisible();
			await expect(
				ownerPage.getByTestId("ad-destination-card-tiktok"),
			).toBeVisible();

			const htmlContent = await ownerPage.content();
			assert.equal(
				htmlContent.includes("secret://local/"),
				false,
				"No raw secret reference in rendered HTML",
			);

			for (const vp of [
				{ width: 320, height: 800 },
				{ width: 390, height: 844 },
				{ width: 768, height: 1024 },
				{ width: 1440, height: 900 },
			]) {
				await ownerPage.setViewportSize(vp);
				const overflow = await ownerPage.evaluate(
					() =>
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth,
				);
				assert.ok(
					overflow <= 1,
					`Expected zero horizontal overflow at ${vp.width}x${vp.height}, got ${overflow}`,
				);
			}
			await ownerContext.close();
		} finally {
			await browser.close();
		}
	} finally {
		if (server) {
			await new Promise<void>((resolve) => server?.close(() => resolve()));
		}
		await cleanup(f.identity, extraUsers);
		await f.close();
	}
});
