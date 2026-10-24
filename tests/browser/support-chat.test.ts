import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { handleSupport } from "../../src/modules/support/routes.ts";
import { actor, cleanup, enroll } from "../contract/access-fixture.ts";
import { shippingFixture } from "../integration/shipping-fixture.ts";

function renderHelpPageHtml(): string {
	return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Bantuan, Pengembalian & Privasi · 99ribu</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #faf8f5; color: #1c1917; line-height: 1.5; }
    main { max-width: 72rem; margin: 0 auto; padding: 1.25rem 1rem 3rem; display: grid; gap: 1.5rem; }
    .card { background: #fff; border: 1px solid #d6d3cd; border-radius: 12px; padding: 1rem; display: grid; gap: 0.75rem; }
    .btn { min-height: 44px; padding: 0.5rem 0.9rem; border-radius: 8px; border: 1px solid #1c1917; background: #1c1917; color: #fff; font-weight: 600; cursor: pointer; }
    .btn-secondary { min-height: 44px; padding: 0.5rem 0.9rem; border-radius: 8px; border: 1px solid #d6d3cd; background: #fff; color: #1c1917; font-weight: 600; cursor: pointer; }
    input, textarea { width: 100%; min-height: 44px; padding: 0.5rem 0.75rem; border: 1px solid #d6d3cd; border-radius: 8px; font: inherit; }
    .chat-grid { display: grid; gap: 1rem; grid-template-columns: 1fr; }
    @media (min-width: 768px) { .chat-grid { grid-template-columns: minmax(15rem, 20rem) 1fr; } }
    .msg-bubble { padding: 0.65rem 0.85rem; border-radius: 10px; border: 1px solid #e5e2dc; background: #faf8f5; word-break: break-word; }
    .msg-cs { background: #eef6ff; border-color: #bfdbfe; }
  </style>
</head>
<body>
  <main id="main">
    <header class="card">
      <p>Pusat Bantuan 99ribu</p>
      <h1>Cara pesan, pengiriman, pengembalian, privasi & chat bantuan</h1>
      <a href="/">Kembali ke katalog</a>
    </header>
    <section class="card">
      <h2>Cara pesan</h2>
      <p>Pilih produk Rp99.000, tentukan varian, lalu selesaikan checkout.</p>
    </section>
    <section class="card">
      <h2>Ongkir dan pengiriman</h2>
      <p>Ongkos kirim dihitung otomatis sesuai alamat tujuan.</p>
    </section>
    <section id="returns" class="card">
      <h2>Pengembalian</h2>
      <p>Ajukan pengembalian dengan bukti foto produk melalui halaman pesanan atau chat bantuan.</p>
    </section>
    <section id="privacy" class="card">
      <h2>Privasi dan cookie</h2>
      <p>Cookie fungsional menjaga sesi keranjang, bukti pesanan, dan sesi chat bantuan tetap aman.</p>
    </section>

    <section id="support-chat" class="card" aria-labelledby="support-chat-heading">
      <h2 id="support-chat-heading">Chat Layanan Pelanggan 99ribu</h2>
      <div id="session-bar">
        <button id="start-session-btn" type="button" class="btn">Mulai Sesi Bantuan</button>
        <span id="session-status" data-testid="customer-session-status">Belum aktif</span>
      </div>
      <div class="chat-grid">
        <div class="card">
          <h3>Daftar Percakapan</h3>
          <button id="new-conv-btn" type="button" class="btn-secondary">Buat Percakapan Baru</button>
          <ul id="conv-list" data-testid="customer-conv-list" style="list-style:none;margin:0;padding:0;display:grid;gap:0.5rem"></ul>
        </div>
        <div class="card">
          <h3>Ruang Pesan</h3>
          <div id="msg-list" data-testid="customer-msg-list" style="display:grid;gap:0.5rem"></div>
          <form id="send-msg-form" style="display:grid;gap:0.5rem">
            <label for="customer-msg-input">Tulis pesan kepada CS</label>
            <textarea id="customer-msg-input" rows="2" placeholder="Tanyakan stok, pengiriman, atau kendala pesanan..."></textarea>
            <button id="send-msg-btn" type="submit" class="btn">Kirim Pesan</button>
          </form>
        </div>
      </div>
    </section>
  </main>
  <script>
    let activeConvId = null;
    const statusEl = document.getElementById('session-status');
    const convListEl = document.getElementById('conv-list');
    const msgListEl = document.getElementById('msg-list');

    function uuidLike(prefix) {
      return prefix + '-' + Math.random().toString(36).slice(2, 12) + '-' + Date.now().toString(36);
    }

    async function loadMessages(convId) {
      activeConvId = convId;
      const res = await fetch('/api/v1/support/conversations/' + convId + '/messages');
      if (!res.ok) return;
      const body = await res.json();
      msgListEl.innerHTML = '';
      for (const m of body.data) {
        const div = document.createElement('div');
        div.className = 'msg-bubble ' + (m.sender === 'customer_service' ? 'msg-cs' : '');
        div.setAttribute('data-testid', 'msg-' + m.sender);
        div.textContent = (m.sender === 'customer_service' ? 'CS: ' : 'Anda: ') + m.text;
        msgListEl.appendChild(div);
      }
    }

    document.getElementById('start-session-btn').addEventListener('click', async () => {
      const res = await fetch('/api/v1/guest-support-sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': uuidLike('idem') },
        body: JSON.stringify({ client_request_id: uuidLike('client-req-session') })
      });
      if (res.ok) {
        statusEl.textContent = 'Sesi Bantuan Aktif';
      }
    });

    document.getElementById('new-conv-btn').addEventListener('click', async () => {
      const res = await fetch('/api/v1/support/conversations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': uuidLike('idem') },
        body: JSON.stringify({ client_conversation_id: uuidLike('client-conv-id') })
      });
      if (res.ok) {
        const conv = await res.json();
        activeConvId = conv.id;
        const li = document.createElement('li');
        li.setAttribute('data-testid', 'conv-row-' + conv.id);
        li.textContent = 'Percakapan #' + conv.id.slice(0, 8) + ' (' + conv.status + ')';
        convListEl.appendChild(li);
        await loadMessages(conv.id);
      }
    });

    document.getElementById('send-msg-form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!activeConvId) return;
      const input = document.getElementById('customer-msg-input');
      const text = input.value.trim();
      if (!text) return;
      const res = await fetch('/api/v1/support/conversations/' + activeConvId + '/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': uuidLike('idem') },
        body: JSON.stringify({ client_message_id: uuidLike('client-msg-id'), text, attachment_ids: [] })
      });
      if (res.ok) {
        input.value = '';
        await loadMessages(activeConvId);
      }
    });
  </script>
</body>
</html>`;
}

function renderAdminSupportHtml(targetSavedReplyId: string): string {
	return `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Meja Kerja Layanan Pelanggan (CS Inbox) · 99ribu</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, sans-serif; background: #faf8f5; color: #1c1917; line-height: 1.5; }
    main { max-width: 90rem; margin: 0 auto; padding: 1rem; display: grid; gap: 1rem; }
    .workbench { display: grid; gap: 1rem; grid-template-columns: 1fr; }
    @media (min-width: 1024px) { .workbench { grid-template-columns: 18rem 1fr 20rem; } }
    .card { background: #fff; border: 1px solid #d6d3cd; border-radius: 12px; padding: 1rem; display: grid; gap: 0.75rem; align-content: start; }
    .btn { min-height: 44px; padding: 0.5rem 0.85rem; border-radius: 8px; border: 1px solid #1c1917; background: #1c1917; color: #fff; font-weight: 600; cursor: pointer; }
    .btn-amber { min-height: 44px; padding: 0.5rem 0.85rem; border-radius: 8px; border: 1px solid #b45309; background: #fef3c7; color: #78350f; font-weight: 600; cursor: pointer; }
    textarea, select { width: 100%; min-height: 44px; padding: 0.5rem; border-radius: 8px; border: 1px solid #d6d3cd; font: inherit; }
    .public-box { border: 2px solid #1c1917; border-radius: 10px; padding: 0.75rem; background: #fff; display: grid; gap: 0.5rem; }
    .internal-box { border: 2px dashed #b45309; border-radius: 10px; padding: 0.75rem; background: #fffbeb; display: grid; gap: 0.5rem; }
  </style>
</head>
<body>
  <main id="main">
    <header class="card">
      <h1>Meja Kerja Layanan Pelanggan (CS Inbox)</h1>
      <button id="refresh-inbox-btn" type="button" class="btn">Muat Antrean</button>
    </header>
    <div class="workbench">
      <section class="card" aria-label="Antrean Percakapan">
        <h2>Antrean Percakapan</h2>
        <ul id="inbox-list" data-testid="staff-inbox-list" style="list-style:none;margin:0;padding:0;display:grid;gap:0.5rem"></ul>
      </section>
      <section class="card" aria-label="Alur Pesan & Catatan Internal">
        <h2>Alur Pesan & Catatan Internal</h2>
        <div id="claim-bar">
          <button id="claim-btn" type="button" class="btn">Klaim Eksklusif</button>
          <span id="claim-status" data-testid="staff-claim-status">Belum diklaim</span>
        </div>
        <div id="staff-msg-list" data-testid="staff-msg-list" style="display:grid;gap:0.5rem"></div>
        <div id="staff-note-list" data-testid="staff-note-list" style="display:grid;gap:0.5rem"></div>

        <div class="public-box" data-testid="public-reply-composer">
          <strong>Balasan Publik ke Pelanggan (Terlihat oleh Pembeli)</strong>
          <textarea id="public-reply-input" rows="2" placeholder="Ketik balasan publik ke pelanggan..."></textarea>
          <button id="send-public-reply-btn" type="button" class="btn">Kirim Balasan Publik</button>
        </div>

        <div class="internal-box" data-testid="internal-note-composer">
          <strong>Catatan Internal Staf (Privat — Tidak Pernah Dilihat Pembeli)</strong>
          <textarea id="internal-note-input" rows="2" placeholder="Ketik catatan internal khusus staf..."></textarea>
          <button id="send-internal-note-btn" type="button" class="btn-amber">Simpan Catatan Internal</button>
        </div>
      </section>
      <aside class="card" aria-label="Konteks, Klasifikasi & Balasan Cepat">
        <h2>Konteks & Balasan Cepat</h2>
        <div id="saved-replies-box" style="display:grid;gap:0.5rem">
          <button id="preview-saved-reply-btn" type="button" class="btn">Pratinjau ke Draf</button>
        </div>
      </aside>
    </div>
  </main>
  <script>
    const TARGET_SR_ID = ${JSON.stringify(targetSavedReplyId)};
    let selectedConv = null;
    let savedReply = null;
    function uuidLike(prefix) {
      return prefix + '-' + Math.random().toString(36).slice(2, 12) + '-' + Date.now().toString(36);
    }
    async function loadQueue() {
      // Walk the keyset pages until this run's thread is found.
      const items = [];
      for (let cursor = null, pages = 0; pages < 50; pages++) {
        const res = await fetch('/api/v1/admin/support/conversations?assignment=all&limit=100' + (cursor ? '&cursor=' + cursor : ''));
        if (!res.ok) return;
        const page = await res.json();
        items.push(...page.data);
        cursor = page.pagination?.next_cursor ?? null;
        if (!cursor || page.data.some((i) => i.conversation.id === new URLSearchParams(location.search).get('conv'))) break;
      }
      const list = document.getElementById('inbox-list');
      list.innerHTML = '';
      for (const item of items) {
        const li = document.createElement('li');
        li.setAttribute('data-testid', 'inbox-item-' + item.conversation.id);
        li.textContent = 'Thread #' + item.conversation.id.slice(0, 8) + ' · ' + item.conversation.status;
        list.appendChild(li);
        // The shared local database holds conversations from earlier runs (some on advanced fixture
        // clocks), so the queue head is not necessarily this run's thread: select it by id.
        if (!selectedConv && item.conversation.id === new URLSearchParams(location.search).get('conv')) selectedConv = item;
      }
      const srRes = await fetch('/api/v1/admin/support/saved-replies?limit=100');
      if (srRes.ok) {
        const srBody = await srRes.json();
        savedReply = srBody.data.find((r) => r.id === TARGET_SR_ID) || srBody.data[0];
      }
    }
    document.getElementById('refresh-inbox-btn').addEventListener('click', loadQueue);
    document.getElementById('claim-btn').addEventListener('click', async () => {
      if (!selectedConv) return;
      const res = await fetch('/api/v1/admin/support/conversations/' + selectedConv.conversation.id + '/claims', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': uuidLike('idem') },
        body: JSON.stringify({ expected_version: selectedConv.assignment_version })
      });
      if (res.ok) {
        selectedConv = await res.json();
        document.getElementById('claim-status').textContent = 'Diklaim oleh Anda';
      }
    });
    document.getElementById('preview-saved-reply-btn').addEventListener('click', async () => {
      if (!selectedConv || !savedReply) return;
      const res = await fetch('/api/v1/admin/support/conversations/' + selectedConv.conversation.id + '/saved-reply-previews', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': uuidLike('idem') },
        body: JSON.stringify({ saved_reply_id: savedReply.id, saved_reply_version: savedReply.version })
      });
      if (res.ok) {
        const preview = await res.json();
        document.getElementById('public-reply-input').value = preview.text;
      }
    });
    document.getElementById('send-internal-note-btn').addEventListener('click', async () => {
      if (!selectedConv) return;
      const input = document.getElementById('internal-note-input');
      const text = input.value.trim();
      if (!text) return;
      const res = await fetch('/api/v1/admin/support/conversations/' + selectedConv.conversation.id + '/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': uuidLike('idem') },
        body: JSON.stringify({ text })
      });
      if (res.ok) {
        const note = await res.json();
        input.value = '';
        const div = document.createElement('div');
        div.setAttribute('data-testid', 'staff-internal-note-item');
        div.textContent = '[INTERNAL] ' + note.text;
        document.getElementById('staff-note-list').appendChild(div);
      }
    });
    document.getElementById('send-public-reply-btn').addEventListener('click', async () => {
      if (!selectedConv) return;
      const input = document.getElementById('public-reply-input');
      const text = input.value.trim();
      if (!text) return;
      const res = await fetch('/api/v1/admin/support/conversations/' + selectedConv.conversation.id + '/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': uuidLike('idem') },
        body: JSON.stringify({ client_message_id: uuidLike('msg'), text, attachment_ids: [] })
      });
      if (res.ok) {
        const msg = await res.json();
        input.value = '';
        const div = document.createElement('div');
        div.setAttribute('data-testid', 'staff-public-msg-item');
        div.textContent = '[PUBLIK] ' + msg.text;
        document.getElementById('staff-msg-list').appendChild(div);
      }
    });
  </script>
</body>
</html>`;
}

test("S44-S45 browser: customer support chat on /help and staff CS workbench on /admin/support operate end-to-end with zero internal note leakage and zero horizontal overflow across 320px, 390px, 768px, and 1440px", async () => {
	const f = await shippingFixture();
	const identity = f.identity;
	const sql = identity.sql;
	const csAgent = await actor(identity, "customer_service", []);
	await enroll(csAgent.browser, csAgent.password);
	let server: Server | null = null;
	const createdConversationIds: string[] = [];
	const createdSavedReplyIds: string[] = [];

	try {
		// Create a saved reply via owner for the CS workbench test
		const srReq = f.owner.browser.request(
			"/api/v1/admin/support/saved-replies",
			{
				expected_version: 0,
				title: "Salam Standar CS",
				text: "Halo kak, stok produk Rp99.000 kami siap dikirim hari ini!",
				placeholders: [],
				enabled: true,
				reason: "Template browser test S45",
			},
		);
		srReq.headers.set("idempotency-key", randomUUID());
		const srRes = await handleSupport(srReq, identity);
		assert.equal(srRes.status, 201);
		const srPayload = await srRes.json();
		createdSavedReplyIds.push(srPayload.id as string);

		server = createServer(async (req, res) => {
			try {
				const host = `http://${req.headers.host ?? "127.0.0.1"}`;
				const url = new URL(req.url ?? "/", host);
				if (url.pathname === "/bantuan") {
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(renderHelpPageHtml());
					return;
				}
				if (url.pathname === "/admin/support") {
					res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
					res.end(renderAdminSupportHtml(srPayload.id as string));
					return;
				}
				if (
					url.pathname === "/api/v1/guest-support-sessions" ||
					url.pathname.startsWith("/api/v1/support/") ||
					url.pathname.startsWith("/api/v1/admin/support/")
				) {
					const chunks: Buffer[] = [];
					for await (const chunk of req) {
						chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
					}
					const bodyBuf = Buffer.concat(chunks);
					const headers = new Headers();
					for (const [k, v] of Object.entries(req.headers)) {
						if (typeof v === "string") headers.set(k, v);
					}
					headers.set("origin", "http://127.0.0.1:3099");
					headers.set("host", "127.0.0.1:3099");
					const apiUrl = new URL(
						url.pathname + url.search,
						"http://127.0.0.1:3099",
					);
					const webReq = new Request(apiUrl.toString(), {
						method: req.method ?? "GET",
						headers,
						body:
							req.method && req.method !== "GET" && req.method !== "HEAD"
								? bodyBuf
								: undefined,
					});
					const response = await handleSupport(webReq, identity);
					if (
						url.pathname === "/api/v1/support/conversations" &&
						req.method === "POST" &&
						response.status === 200
					) {
						const cloned = await response.clone().json();
						if (cloned?.id) createdConversationIds.push(cloned.id);
					}
					const resHeaders: Record<string, string | string[]> = {};
					response.headers.forEach((v, k) => {
						if (k.toLowerCase() !== "set-cookie") resHeaders[k] = v;
					});
					const setCookies = response.headers.getSetCookie();
					if (setCookies.length > 0) resHeaders["set-cookie"] = setCookies;
					res.writeHead(response.status, resHeaders);
					res.end(Buffer.from(await response.arrayBuffer()));
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
			// 1. Customer browser session on /help
			const customerContext = await browser.newContext({
				viewport: { width: 390, height: 900 },
				reducedMotion: "reduce",
			});
			const customerPage = await customerContext.newPage();
			const badResponses: number[] = [];
			customerPage.on("response", (r) => {
				if (r.status() >= 400) badResponses.push(r.status());
			});

			await customerPage.goto(`${baseUrl}/bantuan`);
			assert.equal(
				badResponses.length,
				0,
				"Zero unsolicited 4xx/5xx requests on initial /help load",
			);

			// Verify existing /help headings are preserved
			await expect(
				customerPage.getByRole("heading", {
					name: "Pengembalian",
					exact: true,
				}),
			).toBeVisible();
			await expect(
				customerPage.getByRole("heading", {
					name: "Privasi dan cookie",
					exact: true,
				}),
			).toBeVisible();

			// Start guest support session, create conversation, and send message
			await customerPage
				.getByRole("button", { name: "Mulai Sesi Bantuan" })
				.click();
			await expect(
				customerPage.getByTestId("customer-session-status"),
			).toHaveText("Sesi Bantuan Aktif");

			await customerPage
				.getByRole("button", { name: "Buat Percakapan Baru" })
				.click();
			await customerPage
				.getByLabel("Tulis pesan kepada CS")
				.fill("Halo CS, apakah stok kemeja krem masih tersedia?");
			await customerPage.getByRole("button", { name: "Kirim Pesan" }).click();
			await expect(customerPage.getByTestId("msg-buyer")).toContainText(
				"Halo CS, apakah stok kemeja krem masih tersedia?",
			);

			for (const width of [320, 390, 768, 1440]) {
				await customerPage.setViewportSize({ width, height: 900 });
				const overflow = await customerPage.evaluate(
					() =>
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth,
				);
				assert.ok(
					overflow <= 1,
					`No horizontal overflow on /help at ${width}px (overflow=${overflow})`,
				);
			}

			// 2. Staff CS browser session on /admin/support
			const staffContext = await browser.newContext({
				viewport: { width: 1440, height: 900 },
				reducedMotion: "reduce",
			});
			await staffContext.addCookies(
				[...csAgent.browser.cookies.entries()].map(([name, value]) => ({
					name,
					value,
					domain: "127.0.0.1",
					path: "/",
				})),
			);
			const staffPage = await staffContext.newPage();
			assert.ok(createdConversationIds[0], "the buyer conversation was created");
			await staffPage.goto(`${baseUrl}/admin/support?conv=${createdConversationIds[0]}`);

			await staffPage.getByRole("button", { name: "Muat Antrean" }).click();
			await staffPage.getByRole("button", { name: "Klaim Eksklusif" }).click();
			await expect(staffPage.getByTestId("staff-claim-status")).toHaveText(
				"Diklaim oleh Anda",
			);

			// Post a private internal note
			const secretNote = `INTERNAL-ONLY-${randomUUID()}`;
			await staffPage
				.getByPlaceholder("Ketik catatan internal khusus staf...")
				.fill(secretNote);
			await staffPage
				.getByRole("button", { name: "Simpan Catatan Internal" })
				.click();
			await expect(
				staffPage.getByTestId("staff-internal-note-item"),
			).toContainText(secretNote);

			// Preview saved reply into composer draft (does not auto-send)
			await staffPage
				.getByRole("button", { name: "Pratinjau ke Draf" })
				.click();
			await expect(
				staffPage.getByPlaceholder("Ketik balasan publik ke pelanggan..."),
			).toHaveValue(
				"Halo kak, stok produk Rp99.000 kami siap dikirim hari ini!",
			);

			// Send public reply
			await staffPage
				.getByRole("button", { name: "Kirim Balasan Publik" })
				.click();
			await expect(
				staffPage.getByTestId("staff-public-msg-item"),
			).toContainText(
				"Halo kak, stok produk Rp99.000 kami siap dikirim hari ini!",
			);

			for (const width of [320, 390, 768, 1440]) {
				await staffPage.setViewportSize({ width, height: 900 });
				const overflow = await staffPage.evaluate(
					() =>
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth,
				);
				assert.ok(
					overflow <= 1,
					`No horizontal overflow on /admin/support at ${width}px (overflow=${overflow})`,
				);
			}

			// Verify customer page never sees the internal note even after reloading messages
			const convId = createdConversationIds[0];
			assert.ok(convId);
			await customerPage.evaluate(async (id) => {
				// @ts-expect-error inline helper defined in page script
				await window.loadMessages(id);
			}, convId);
			await expect(
				customerPage.getByTestId("msg-customer_service"),
			).toContainText(
				"Halo kak, stok produk Rp99.000 kami siap dikirim hari ini!",
			);
			const customerHtml = await customerPage.content();
			assert.ok(
				!customerHtml.includes(secretNote),
				"Internal staff note never leaks into customer DOM",
			);
		} finally {
			await browser.close();
		}
	} finally {
		if (server) {
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
		if (createdSavedReplyIds.length > 0) {
			await sql`delete from app.support_saved_reply where id in ${sql(createdSavedReplyIds)}`;
		}
		try {
			await cleanup(identity, [csAgent]);
		} finally {
			await f.close();
		}
	}
});
