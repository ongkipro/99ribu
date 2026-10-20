import { icons } from "./icons.mjs";

// S08 composition fixture only. No API client, business persistence or external request.
const app = document.querySelector("#app");
const money = (value) =>
	new Intl.NumberFormat("id-ID", {
		style: "currency",
		currency: "IDR",
		maximumFractionDigits: 0,
	}).format(value);
const escapeHtml = (value = "") =>
	String(value).replace(
		/[&<>"']/g,
		(s) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				s
			],
	);
const icon = (name) => icons[name] ?? "";
const views = {
	home: "Beranda",
	search: "Kategori & pencarian",
	product: "Produk",
	checkout: "Checkout",
	order: "Pesanan",
	returns: "Pengembalian",
	affiliate: "Afiliasi",
	warehouse: "Gudang",
	chat: "Chat",
};
const products = [
	{
		id: "shirt",
		name: "Kemeja lengan panjang",
		category: "Fashion",
		contents: "1 kemeja · pilihan ukuran",
		shot: "Tampak depan, warna dan potongan terlihat",
	},
	{
		id: "bag",
		name: "Tas selempang harian",
		category: "Tas",
		contents: "1 tas · warna hitam",
		shot: "Tampak depan dan tali lengkap",
	},
	{
		id: "cream",
		name: "Paket perawatan, isi 2",
		category: "Perawatan",
		contents: "2 kemasan dalam 1 pilihan",
		shot: "Dua kemasan, label terbaca",
	},
	{
		id: "kitchen",
		name: "Set wadah dapur, isi 3",
		category: "Rumah tangga",
		contents: "3 wadah dalam 1 pilihan",
		shot: "Ketiga wadah dan tutup, ukuran terlihat",
	},
	{
		id: "lamp",
		name: "Lampu meja",
		category: "Elektronik",
		contents: "1 lampu · kelengkapan sesuai spesifikasi",
		shot: "Lampu utuh, sakelar dan kabel terlihat",
	},
];
const state = {
	option: "M",
	step: 1,
	staleQuote: false,
	reviewedQuote: false,
	method: "cod",
	fields: {},
	draft: "",
	job: "all",
	search: "",
	listUrl: "?view=home",
	scroll: new Map(),
};
let currentUrl = location.search;
const url = (view, extra = {}) => `?${new URLSearchParams({ view, ...extra })}`;
const link = (view, text, extra = {}) =>
	`<a href="${url(view, extra)}">${text}</a>`;
const photo = (product, tiny = false) =>
	`<div class="photo-slot" role="img" aria-label="Slot foto ${escapeHtml(product.name)} belum tersedia"><strong>${tiny ? "Foto" : "Foto produk"}</strong>${tiny ? "" : `<span>${escapeHtml(product.shot)}</span>`}</div>`;
const productCard = (product) =>
	`<a class="product-card" href="${url("product", { item: product.id })}">${photo(product)}<h3>${product.name}</h3><small>${product.contents}</small><div class="price">${money(99000)}</div></a>`;
const announce = (text) => {
	document.querySelector("#announcement").textContent = text;
};

function navigation(active = "home") {
	return `<nav class="mobile-nav" aria-label="Navigasi utama">${[
		["home", "house", "Beranda"],
		["search", "grid-2x2", "Kategori"],
		["checkout", "shopping-bag", "Keranjang"],
		["order", "user-round", "Akun"],
	]
		.map(
			([view, glyph, text]) =>
				`<a href="${url(view)}" ${view === "checkout" ? "data-cart-preview" : ""} ${active === view ? 'aria-current="page"' : ""}>${icon(glyph)}<span>${text}</span></a>`,
		)
		.join("")}</nav>`;
}
function header(query = "", category = "") {
	return `<header class="site-header"><a class="brand" href="${url("home")}">99ribu</a><form class="search" id="search-form" role="search">${icon("search")}<label class="sr-only" for="query">Cari produk</label><input id="query" name="q" type="search" value="${escapeHtml(query)}" placeholder="Cari produk atau kebutuhan" autocomplete="off"><button type="submit">Cari</button></form><nav class="header-actions" aria-label="Akun dan keranjang"><a href="${url("order")}">${icon("user-round")}<span>Akun</span></a><a href="${url("checkout")}" data-cart-preview aria-label="Lihat contoh keranjang, 2 pilihan">${icon("shopping-bag")}<span>Keranjang</span></a></nav></header><nav class="categories" aria-label="Kategori produk">${["Semua", "Fashion", "Tas", "Perawatan", "Rumah tangga", "Elektronik"].map((label) => `<a href="${url("search", label === "Semua" ? {} : { category: label })}" ${category === label ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</nav>`;
}
function taskHeader(
	backView = "home",
	label = "Kembali",
	right = "Keranjang",
	rightView = "checkout",
) {
	return `<header class="task-header"><a class="back" ${label === "Kembali ke keranjang" ? "data-cart-preview" : ""} aria-label="${escapeHtml(label)}" href="${backView.startsWith("?") ? escapeHtml(backView) : url(backView)}">${icon("chevron-left")}<span>${label}</span></a><a class="brand" href="${url("home")}">99ribu</a><a class="back" ${right === "Keranjang" ? "data-cart-preview" : ""} aria-label="${escapeHtml(right)}" href="${url(rightView)}">${right === "Keranjang" ? icon("shopping-bag") : right === "Bantuan" ? icon("message-circle") : icon("package")}<span>${right}</span></a></header>`;
}
const footer = () =>
	`<footer class="page-footer"><p><strong>99ribu</strong><br>Pilihan lengkap, masing-masing Rp99.000.</p><p>Ongkir dihitung per paket.<br>Belanja dapat dilanjutkan tanpa akun.</p><div><a class="inline-link" href="${url("chat")}">Bantuan belanja</a><br><button class="text-button" type="button" data-policy>Pengiriman dan pengembalian</button><br><button class="text-button" type="button" data-privacy>Privasi</button></div></footer>`;
function home(params) {
	const search = params.get("view") === "search";
	const query = params.get("q") ?? "";
	const category = params.get("category") ?? "";
	const filtered = products.filter(
		(p) =>
			(!category || p.category === category) &&
			(!query ||
				`${p.name} ${p.category}`
					.toLocaleLowerCase("id-ID")
					.includes(query.toLocaleLowerCase("id-ID"))),
	);
	state.listUrl = location.search || "?view=home";
	return `${header(query, category)}<main id="main" class="shell" tabindex="-1">${search ? `<div class="intro search-intro"><div><h1>${category ? escapeHtml(category) : query ? `Hasil untuk “${escapeHtml(query)}”` : "Semua pilihan"}</h1><p class="muted">${filtered.length} pilihan${query || category ? ` · <a class="inline-link" href="${url("search")}">Hapus filter</a>` : ""}</p></div><button type="button" id="filter-open" class="icon-button">${icon("sliders-horizontal")}Filter</button></div>` : `<section class="intro"><div><h1>Kebutuhan harian, satu harga.</h1><p class="muted">Pilih produk atau paket lengkap. Periksa isinya sebelum masuk keranjang.</p></div><div class="price-note"><span>Setiap pilihan</span><strong>Rp99.000</strong></div></section><div class="section-heading"><h2>Jelajahi pilihan</h2><a class="inline-link" href="${url("search")}">Lihat semua</a></div>`}<section class="product-grid" aria-label="Pilihan produk">${filtered.length ? filtered.map(productCard).join("") : `<div class="empty"><h2>Produk belum ditemukan</h2><p class="muted">Coba nama produk lain atau hapus filter.</p><a class="inline-link" href="${url("search")}">Lihat semua pilihan</a></div>`}</section><section class="help-strip"><div><h3>Periksa isi setiap pilihan</h3><p>Satu pilihan bisa berisi satu produk atau beberapa barang. Jumlah dan varian dijelaskan di halaman produk.</p></div><div><h3>Pengiriman per paket</h3><p>Barang dari gudang berbeda dapat dikirim terpisah. Biaya dan jumlah COD ditampilkan sebelum konfirmasi.</p></div></section></main>${footer()}${navigation(search ? "search" : "home")}`;
}
function product(params) {
	const p =
		products.find((item) => item.id === params.get("item")) ?? products[0];
	const choices = ["shirt", "mixed"].includes(p.id)
		? ["S", "M", "L"]
		: p.id === "bag"
			? ["Hitam"]
			: p.id === "cream"
				? ["Isi 2 kemasan"]
				: p.id === "kitchen"
					? ["Isi 3 wadah"]
					: ["1 lampu"];
	const selected = choices.includes(state.option) ? state.option : choices[0];
	const contents =
		p.id === "mixed"
			? "<li>1 kemeja sesuai ukuran pilihan</li><li>1 tas selempang hitam</li>"
			: p.id === "cream"
				? "<li>2 kemasan perawatan</li>"
				: p.id === "shirt"
					? `<li>1 kemeja · ukuran <span id="selected-size">${selected}</span></li>`
					: `<li>${escapeHtml(p.contents)}</li>`;
	return `${taskHeader(state.listUrl, "Kembali ke pilihan")}<main id="main" class="shell" tabindex="-1"><div class="breadcrumb">${p.category} / ${p.name}</div><div class="pdp">${photo(p)}<section class="purchase"><p class="muted small">${p.category}</p><h1>${p.name}</h1><p class="price">${money(99000)}</p><p class="muted small">Harga untuk 1 pilihan lengkap. Belum termasuk ongkir.</p><fieldset><legend>${choices.length > 1 ? "Ukuran kemeja" : "Pilihan produk"}</legend><div class="choice-set">${choices.map((size) => `<button type="button" data-option="${size}" aria-pressed="${selected === size}" ${size === "L" ? 'aria-disabled="true"' : ""}>${size}${size === "L" ? " · habis" : ""}</button>`).join("")}</div></fieldset><div id="option-message" class="notice" role="status"></div><h2>Isi yang diterima</h2><ul class="contents">${contents}</ul><details class="specifications" open><summary>Spesifikasi dan ukuran</summary><dl class="job-facts"><div><dt>${p.id === "shirt" ? "Bahan" : "Material / spesifikasi"}</dt><dd>Belum tersedia</dd></div><div><dt>${p.id === "shirt" ? "Lingkar dada / panjang" : "Dimensi"}</dt><dd>Belum tersedia</dd></div></dl><p class="small muted">Data contoh belum lengkap. Periksa spesifikasi final sebelum memilih.</p></details><div class="purchase-action"><span class="price">${money(99000)}</span><button class="primary" id="cart-preview" type="button">Tambah ke keranjang</button></div><hr><details><summary>Pengiriman dan pengembalian</summary><p class="small muted">Ongkir ditampilkan setelah alamat dipilih. Permintaan pengembalian ditinjau sesuai barang dan riwayat penerimaannya.</p></details></section></div></main>${footer()}`;
}
const receiptItems = () =>
	[products[0], products[1]]
		.map(
			(p) =>
				`<div class="line-item">${photo(p, true)}<p>${p.name}<br><small class="muted">1 pilihan · ${p.id === "shirt" ? "ukuran M" : "hitam"}</small></p><strong>${money(99000)}</strong></div>`,
		)
		.join("");
function summary(estimated = false) {
	return `<details class="checkout-summary" id="order-summary" ${innerWidth >= 768 ? "open" : ""}><summary><span><span class="summary-closed">Lihat ringkasan</span><span class="summary-open">Tutup ringkasan</span><small>${estimated ? "Estimasi · ongkir belum final" : "2 pilihan"}</small></span><span class="summary-total"><span class="total">${money(230000)}</span><span class="disclosure-icon">${icon("chevron-left")}</span></span></summary><div class="summary-content">${receiptItems()}<dl class="money-list"><div><dt>2 pilihan produk</dt><dd>${money(198000)}</dd></div><div><dt>${estimated ? "Estimasi ongkir" : "Ongkir"} 2 paket</dt><dd>${money(40000)}</dd></div><div><dt>Subsidi ongkir</dt><dd>−${money(8000)}</dd></div><div class="grand-total"><dt>${estimated ? "Estimasi total" : "Total"}</dt><dd>${money(230000)}</dd></div></dl><p class="small muted">${estimated ? "Estimasi — ongkir belum final. Periksa kembali setelah alamat dan layanan dipilih." : "Contoh perhitungan untuk dua paket."}</p></div></details>`;
}
function parcels(showStatus = false, method = state.method) {
	return [
		{
			warehouse: "Malang",
			contents: "1 kemeja lengan panjang · ukuran M",
			shipping: 18000,
			total: 113000,
		},
		{
			warehouse: "Pontianak",
			contents: "1 tas selempang · hitam",
			shipping: 22000,
			total: 117000,
		},
	]
		.map(
			(p, i) =>
				`<section class="parcel" aria-label="Paket ${i + 1}"><h3>Paket ${i + 1} · Gudang ${p.warehouse}</h3><p>${p.contents}</p><p>Layanan reguler contoh · estimasi tiba belum tersedia</p><dl class="money-list"><div><dt>Produk</dt><dd>${money(99000)}</dd></div><div><dt>Ongkir − subsidi</dt><dd>${money(p.shipping)} − ${money(4000)}</dd></div></dl><div class="amount"><strong>${method === "cod" ? "COD" : "Jumlah"} paket ${i + 1}</strong><strong>${money(p.total)}</strong></div>${showStatus ? `<ol class="timeline" aria-label="Status paket ${i + 1}"><li><strong>Pesanan tercatat</strong><p>16 Okt 2026, 09.00 WIB · contoh</p></li><li><strong>Menunggu resi</strong><p>Belum diserahkan ke kurir. Waktu tiba belum tersedia.</p></li></ol>` : ""}</section>`,
		)
		.join("");
}
function checkout() {
	const f = (key) => escapeHtml(state.fields[key] ?? "");
	return `${taskHeader("checkout", "Kembali ke keranjang", "Bantuan", "chat")}<main id="main" class="checkout" tabindex="-1"><section class="checkout-form"><ol class="steps" aria-label="Langkah checkout">${["Alamat", "Pengiriman", "Tinjau"].map((name, i) => `<li ${state.step === i + 1 ? 'aria-current="step"' : ""}>${i + 1}. ${name}</li>`).join("")}</ol><h1>${["Alamat penerima", "Pengiriman dan pembayaran", "Periksa sebelum konfirmasi"][state.step - 1]}</h1><form id="checkout-form" novalidate><div id="checkout-error" class="notice error" role="alert"></div>${state.step === 1 ? `<p class="muted small">Tidak perlu membuat akun untuk berbelanja. Semua kolom wajib diisi kecuali yang bertanda opsional.</p><div class="field"><label for="buyer-name">Nama lengkap</label><input id="buyer-name" name="name" autocomplete="name" value="${f("name")}" required aria-describedby="name-error"><p class="error-text" id="name-error"></p></div><div class="fields-two"><div class="field"><label for="phone">Nomor HP</label><input id="phone" name="phone" type="tel" autocomplete="tel" value="${f("phone")}" required aria-describedby="phone-error"><p class="error-text" id="phone-error"></p></div><div class="field"><label for="email">Email <span class="muted">(opsional)</span></label><input id="email" name="email" type="email" autocomplete="email" value="${f("email")}"></div></div><div class="field"><label for="region">Wilayah pengiriman</label><select id="region" name="region"><option value="contoh">Contoh: Klojen, Kota Malang, Jawa Timur</option></select><small class="muted">Wilayah contoh untuk pratinjau ongkir.</small></div><div class="field"><label for="address">Alamat lengkap</label><textarea id="address" name="address" autocomplete="street-address" required aria-describedby="address-error" placeholder="Nama jalan, nomor rumah, RT/RW">${f("address")}</textarea><p class="error-text" id="address-error"></p></div>` : state.step === 2 ? `<p class="muted small">Pesanan ini dikirim dalam 2 paket. Tinjau biaya masing-masing.</p><div id="parcel-breakdown">${parcels()}</div><fieldset><legend>Metode pembayaran</legend><label class="radio-row"><input type="radio" name="method" value="cod" ${state.method === "cod" ? "checked" : ""}><span>COD<small>Bayar ke kurir untuk setiap paket yang tiba.</small></span></label><label class="radio-row"><input type="radio" name="method" value="prepaid" ${state.method === "prepaid" ? "checked" : ""}><span>Bayar sebelum dikirim<small>Ikuti instruksi pembayaran setelah pesanan dibuat.</small></span></label></fieldset><button type="button" id="quote-change" class="text-button">Lihat contoh ongkir kedaluwarsa</button>${state.staleQuote && !state.reviewedQuote ? `<div class="notice error"><strong>Ongkir perlu diperiksa ulang</strong><p>Alamat Anda tetap tersimpan di langkah ini. Tinjau kembali ongkir sebelum melanjutkan.</p><button id="review-quote" type="button">Periksa ongkir lagi</button></div>` : state.reviewedQuote ? '<p class="notice" role="status">Contoh ongkir telah diperiksa. Total tetap Rp230.000.</p>' : ""}` : `<p class="muted small">${escapeHtml(state.fields.name)} · ${escapeHtml(String(state.fields.phone ?? "").replace(/.(?=.{4})/g, "•"))}</p><p>${escapeHtml(state.fields.address)}</p>${parcels()}<dl class="money-list"><div class="grand-total"><dt>Total ${state.method === "cod" ? "COD" : "pembayaran"}</dt><dd>${money(230000)}</dd></div></dl><p class="small muted">${state.method === "cod" ? "Siapkan Rp113.000 untuk paket 1 dan Rp117.000 untuk paket 2." : "Pesanan belum lunas sampai pembayaran dikonfirmasi."}</p>`}<div class="checkout-actions">${state.step > 1 ? '<button id="previous-step" type="button">Kembali</button>' : ""}<button class="primary" type="submit">${state.step === 3 ? `Pratinjau konfirmasi ${state.method === "cod" ? "COD" : "pembayaran"}` : state.step === 1 ? "Lanjut ke pengiriman" : "Tinjau pesanan"}</button></div></form></section>${summary(state.step === 1)}</main>${footer()}`;
}
function order(params = new URLSearchParams()) {
	if (params.get("state") === "payment-pending")
		return `${taskHeader("checkout", "Kembali ke checkout", "Pesanan", "order")}<main id="main" class="shell" tabindex="-1"><div class="order-layout"><section><p class="small muted">Contoh pesanan #99-CONTOH-01</p><h1>Pembayaran belum terkonfirmasi</h1><p class="small muted">Pembaruan contoh: 16 Okt 2026, 09.00 WIB</p><p class="muted">Kembali dari halaman pembayaran belum berarti pembayaran selesai.</p><div class="notice pending"><p>Periksa status pesanan yang sama. Jangan membuat pembayaran kedua ketika hasil sebelumnya belum diketahui.</p></div><dl class="money-list"><div class="grand-total"><dt>Total pesanan</dt><dd>${money(230000)}</dd></div></dl><button id="payment-refresh" class="primary" type="button">Lihat contoh status terbaru</button><p id="payment-state" class="small muted" role="status"></p><p class="view-prompt"><a href="${url("chat")}">Bantuan pembayaran melalui chat</a></p></section>${summary()}</div></main>`;
	return `${taskHeader("home", "Beranda", "Pesanan", "order")}<main id="main" class="shell" tabindex="-1"><div class="order-layout order-with-parcels"><section class="order-overview"><header class="order-title"><p class="muted small">Contoh pesanan #99-CONTOH-01</p><h1>Pesanan menunggu pengiriman</h1><p class="muted">Belum dibayar. Anda memilih COD untuk 2 paket.</p><p class="small muted">Pembaruan contoh: 16 Okt 2026, 09.00 WIB</p></header><div class="cash"><p class="small">Total yang perlu disiapkan</p><div class="price">${money(230000)}</div><p class="small">Bayar sesuai jumlah masing-masing paket saat diterima.</p></div><button id="share-summary" type="button">Lihat ringkasan untuk penerima</button><p id="share-result" class="small muted" role="status"></p></section>${summary()}<section class="order-parcels"><h2>Rincian pengiriman</h2>${parcels(true, "cod")}<hr><a class="inline-link" href="${url("returns")}">Lihat contoh pengembalian</a><p class="view-prompt"><a href="${url("chat")}">Bantuan pesanan melalui chat</a></p></section></div></main>`;
}
function returns() {
	return `${taskHeader("order", "Kembali ke pesanan", "Pesanan", "order")}<main id="main" class="shell" tabindex="-1"><section class="return-form"><p class="small muted">Contoh paket yang telah diterima</p><h1>Ajukan pengembalian</h1><p class="muted">Pilih barang dan jelaskan kendalanya. Persetujuan pengembalian dan pengembalian dana memiliki status terpisah.</p><form id="return-form"><fieldset><legend>Barang yang diajukan (wajib)</legend><label class="radio-row"><input type="checkbox" name="item" checked required><span>Kemeja lengan panjang<small>1 pilihan · ukuran M · diterima 10 Oktober 2026</small></span></label></fieldset><div class="field"><label for="reason">Kendala barang (wajib)</label><select id="reason" name="reason"><option>Barang rusak saat diterima</option><option>Barang tidak sesuai pesanan</option></select></div><div class="field"><label for="return-note">Ceritakan kendalanya (wajib)</label><textarea id="return-note" name="note" required rows="4" placeholder="Bagian mana yang bermasalah?"></textarea></div><fieldset class="attachment-preview"><legend>Foto bukti (belum aktif)</legend><div class="attachment-slot" role="img" aria-label="Slot foto bukti belum diisi"><strong>Foto kendala</strong><span>Tampilkan bagian bermasalah dan keseluruhan barang.</span></div><button type="button" disabled>Tambah foto</button><p class="small muted">Unggahan belum aktif dalam prototipe. Belum ada foto dilampirkan.</p></fieldset><button class="primary" type="submit">Tinjau permintaan</button></form></section></main>`;
}
function affiliate() {
	return `${taskHeader("home", "Beranda", "Pesanan", "order")}<main id="main" class="shell" tabindex="-1"><h1>Afiliasi</h1><section class="affiliate-head"><div class="affiliate-balance"><p class="muted">Komisi memenuhi syarat</p><p class="price eligible">${money(99000)}</p><p class="small muted">Batas minimum transfer Rp99.000. Komisi memenuhi syarat otomatis H+10 setelah penerimaan terverifikasi; transfer awal dilakukan oleh tim keuangan.</p></div><dl class="balance-list"><div><dt>Menunggu H+10</dt><dd>${money(19800)}</dd></div><div><dt>Ditahan</dt><dd>${money(9900)}</dd></div><div><dt>Menunggu transfer manual</dt><dd>${money(99000)}</dd></div><div><dt>Dalam proses transfer</dt><dd>${money(99000)}</dd></div><div><dt>Sudah ditransfer</dt><dd>${money(198000)}</dd></div></dl><div class="affiliate-referral"><h2>Tautan afiliasi Anda</h2><label class="sr-only" for="referral">Contoh tautan afiliasi</label><div class="copy-link"><input id="referral" value="https://example.invalid/r/contoh" readonly><button id="copy-referral" type="button">Salin</button></div><p id="copy-result" class="small muted" role="status">Tautan contoh. Tidak menghasilkan atribusi.</p></div></section><div class="section-heading"><h2>Riwayat komisi per pilihan</h2><span class="small muted">Data contoh</span></div><table class="data-table"><thead><tr><th>Pilihan</th><th>Status</th><th>Penerimaan & kelayakan</th><th>Komisi</th></tr></thead><tbody><tr><td data-label="Pilihan"><div>Kemeja · REF-101<small>1 pilihan</small></div></td><td data-label="Status"><div class="state-label">Ditahan<small>Penggantian barang</small></div></td><td data-label="Tanggal"><div>Pengganti diterima 13 Okt<small>Tanggal kelayakan baru: 23 Okt 2026</small></div></td><td data-label="Komisi"><div class="price">${money(9900)}</div></td></tr><tr><td data-label="Pilihan"><div>Tas · REF-102<small>1 pilihan, tidak terdampak penggantian</small></div></td><td data-label="Status"><div class="state-label">Memenuhi syarat</div></td><td data-label="Tanggal"><div>Diterima 1 Okt<small>Memenuhi syarat 11 Okt 2026</small></div></td><td data-label="Komisi"><div class="price">${money(9900)}</div></td></tr></tbody></table><p class="view-prompt">Angka di atas menunjukkan contoh keadaan yang berbeda, bukan saldo akun Anda. Dana dalam proses tidak dihitung lagi sebagai saldo yang dapat dialokasikan.</p></main>`;
}
function warehouse() {
	const empty = state.job === "empty";
	return `<div class="operator"><nav class="operator-nav" aria-label="Ruang kerja gudang"><a class="brand" href="${url("home")}">99ribu</a><a href="${url("warehouse")}" aria-current="page">Pengiriman</a><a href="${url("warehouse", { filter: "all" })}" data-job-history>Riwayat pekerjaan</a></nav><main id="main" class="operator-main" tabindex="-1"><header><div><p class="small muted">Ruang kerja gudang · Malang</p><h1>Pengiriman perlu ditangani</h1></div><span class="small muted">Contoh 16 Okt 2026, 09.00 WIB</span></header><div class="notice pending"><strong>1 paket mendekati batas penerbitan resi</strong><p>Periksa paket CONTOH-01. Mencetak label tidak mencatat penyerahan ke kurir.</p></div><div class="toolbar"><label for="job-filter">Tampilkan</label><select id="job-filter"><option value="all" ${!empty ? "selected" : ""}>Perlu ditangani</option><option value="empty" ${empty ? "selected" : ""}>Sudah diserahkan</option></select><span class="small muted">${empty ? 0 : 2} paket contoh</span></div>${empty ? '<div class="empty"><h2>Tidak ada paket pada filter ini</h2><button id="reset-jobs" type="button">Hapus filter</button></div>' : `<table class="data-table"><thead><tr><th>Paket / isi</th><th>Resi</th><th>Label / penyerahan</th><th>Batas berikutnya</th><th>Aksi</th></tr></thead><tbody><tr><td data-label="Paket"><div>CONTOH-01<small>1 kemeja · Malang</small></div></td><td data-label="Resi"><div>Belum terbit</div></td><td data-label="Label"><div>Belum tersedia<small>Belum diserahkan</small></div></td><td data-label="Batas"><div>16 Okt, 16.00 WIB<small>Penerbitan resi · kalender contoh</small></div></td><td data-label="Aksi"><button data-job="CONTOH-01" type="button">Periksa</button></td></tr><tr><td data-label="Paket"><div>CONTOH-02<small>1 tas · Malang</small></div></td><td data-label="Resi"><div>Sudah terbit<small>AWB-CONTOH-02</small><small>16 Okt, 08.30 WIB</small></div></td><td data-label="Label"><div>Sudah dicetak<small>Belum diserahkan</small></div></td><td data-label="Batas"><div>16 Okt, 17.00 WIB<small>Penyerahan · kalender contoh</small></div></td><td data-label="Aksi"><button data-job="CONTOH-02" type="button">Periksa</button></td></tr></tbody></table>`}<p class="view-prompt">Lingkup pekerjaan: gudang Malang.</p></main></div>`;
}
function chat() {
	return `${taskHeader("order", "Kembali ke pesanan", "Pesanan", "order")}<main id="main" tabindex="-1" class="chat"><aside class="chat-sidebar"><h2>Pesan</h2><p><strong>Bantuan pesanan</strong><br><span class="muted">Contoh percakapan</span></p><p class="small muted">Paket pertama belum mendapat resi.<br>Pesan terakhir: 09.12</p></aside><section class="thread" aria-label="Percakapan bantuan"><header class="thread-header"><h1>Bantuan pesanan</h1><p>Belum ada status ketersediaan petugas</p></header><div class="messages" role="log" aria-label="Riwayat pesan contoh"><article class="message"><p>Paket mana yang ingin ditanyakan? Anda dapat menyebut paket pertama atau kedua.</p><small>Contoh pesan petugas · 09.10</small></article><article class="message mine"><p>Paket pertama saya belum mendapat resi.</p><small>Contoh pesan pelanggan · 09.12</small></article><p id="send-state" class="notice error" role="status" hidden></p></div><form class="composer" id="chat-form"><div><label for="draft">Pesan</label><textarea id="draft" name="draft" placeholder="Tulis pesan" required>${escapeHtml(state.draft)}</textarea></div><button class="primary" type="submit">Kirim</button></form></section></main>`;
}
function render({ focus = false, restore = false } = {}) {
	const params = new URLSearchParams(location.search);
	const view = Object.hasOwn(views, params.get("view"))
		? params.get("view")
		: "home";
	if (view === "warehouse") state.job = params.get("filter") ?? "all";
	document.body.className = `${view}-page`;
	app.innerHTML = {
		home: () => home(params),
		search: () => home(params),
		product: () => product(params),
		checkout,
		order: () => order(params),
		returns,
		affiliate,
		warehouse,
		chat,
	}[view]();
	currentUrl = location.search;
	if (focus) document.querySelector("#main").focus({ preventScroll: true });
	if (restore) scrollTo(0, state.scroll.get(currentUrl) ?? 0);
}
function navigate(href) {
	state.scroll.set(currentUrl, scrollY);
	history.pushState({}, "", href);
	render({ focus: true });
	scrollTo(0, 0);
}
function openDialog(dialog) {
	history.pushState({ prototypeDialog: dialog.id }, "", location.href);
	dialog.showModal();
}
function closeDialog(dialog) {
	dialog.close();
	if (history.state?.prototypeDialog === dialog.id) history.back();
}
for (const dialog of document.querySelectorAll("dialog")) {
	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		closeDialog(dialog);
	});
}
function preview(title, body) {
	document.querySelector("#preview-title").textContent = title;
	document.querySelector("#preview-content").innerHTML = body;
	openDialog(document.querySelector("#preview"));
}
document.querySelector("#view-links").innerHTML = Object.entries(views)
	.map(([view, title]) => link(view, title))
	.join("");
document
	.querySelector("#views-open")
	.addEventListener("click", () =>
		openDialog(document.querySelector("#views")),
	);
document.addEventListener("keydown", (event) => {
	const dialog = document.querySelector("dialog[open]");
	if (!dialog || event.key !== "Tab") return;
	const controls = [
		...dialog.querySelectorAll(
			"button:not(:disabled),a[href],input,select,textarea",
		),
	];
	const first = controls[0],
		last = controls.at(-1);
	if (event.shiftKey && document.activeElement === first) {
		event.preventDefault();
		last.focus();
	} else if (!event.shiftKey && document.activeElement === last) {
		event.preventDefault();
		first.focus();
	}
});
document.addEventListener("click", (event) => {
	const close = event.target.closest("[data-close]");
	if (close) {
		closeDialog(document.getElementById(close.dataset.close));
		return;
	}
	const historyLink = event.target.closest("[data-job-history]");
	if (historyLink) {
		event.preventDefault();
		preview(
			"Riwayat pekerjaan Malang",
			`<p class="small muted">16 Okt 2026 · waktu WIB · data contoh</p><ol class="timeline"><li><strong>08.30 · Resi CONTOH-02 terbit</strong><p>AWB-CONTOH-02</p></li><li><strong>08.40 · Label CONTOH-02 dicetak</strong><p>Belum diserahkan ke kurir.</p></li></ol>`,
		);
		return;
	}
	const cartLink = event.target.closest("[data-cart-preview]");
	if (cartLink) {
		event.preventDefault();
		preview(
			"Contoh keranjang",
			`<p class="small muted">2 pilihan · keranjang contoh</p>${receiptItems()}<dl class="money-list"><div class="grand-total"><dt>Total produk</dt><dd>${money(198000)}</dd></div></dl><p class="small muted">Belum termasuk ongkir.</p><a class="primary cart-continue" href="${url("checkout")}">Lanjut ke contoh checkout</a>`,
		);
		return;
	}
	const anchor = event.target.closest('a[href^="?"]');
	if (
		anchor &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	) {
		event.preventDefault();
		const dialog = document.querySelector("dialog[open]");
		if (dialog) {
			history.replaceState({}, "", anchor.getAttribute("href"));
			dialog.close();
			render({ focus: true });
			scrollTo(0, 0);
		} else navigate(anchor.getAttribute("href"));
		return;
	}
	const button = event.target.closest("button");
	if (!button) return;
	if (button.dataset.option) {
		if (button.dataset.option === "L") {
			document.querySelector("#option-message").textContent =
				"Ukuran L habis pada contoh ini. Pilih S atau M.";
			return;
		}
		state.option = button.dataset.option;
		const selectedSize = document.querySelector("#selected-size");
		if (selectedSize) selectedSize.textContent = state.option;
		document.querySelectorAll("[data-option]").forEach((control) => {
			control.setAttribute(
				"aria-pressed",
				String(control.dataset.option === state.option),
			);
		});
		document.querySelector("#option-message").textContent =
			`Pilihan ${state.option} dipilih.`;
	}
	if (button.hasAttribute("data-privacy"))
		preview(
			"Privasi prototipe",
			`<p>Data yang diisi pada formulir hanya disimpan sementara di halaman ini dan hilang saat halaman dimuat ulang.</p><p>Prototipe tidak mengirim formulir, membuat pesanan, atau memproses pembayaran.</p>`,
		);
	if (button.hasAttribute("data-policy"))
		preview(
			"Pengiriman dan pengembalian",
			`<p>Ongkir ditampilkan per paket sebelum konfirmasi. Barang dari gudang berbeda dapat tiba terpisah.</p><p>Pengembalian ditinjau berdasarkan barang dan riwayat penerimaan. Persetujuan retur dan pengembalian dana memiliki status terpisah.</p><a class="inline-link" href="${url("chat")}">Tanyakan melalui chat</a>`,
		);
	if (button.id === "filter-open")
		preview(
			"Filter kategori",
			`<nav aria-label="Pilihan kategori">${["Semua", "Fashion", "Tas", "Perawatan", "Rumah tangga", "Elektronik"].map((name) => link("search", name, name === "Semua" ? {} : { category: name })).join("")}</nav>`,
		);
	if (button.id === "cart-preview")
		preview(
			"Pratinjau keranjang",
			`<p>1 pilihan · ${escapeHtml(document.querySelector('[data-option][aria-pressed="true"]').dataset.option)}</p><p class="price">${money(99000)}</p><p class="muted small">Pilihan ini belum disimpan. Layar checkout berikut memakai contoh pesanan dua paket.</p><a class="inline-link" href="${url("checkout")}">Lihat contoh checkout</a>`,
		);
	if (button.id === "previous-step") {
		state.step--;
		render({ focus: true });
	}
	if (button.id === "quote-change") {
		state.staleQuote = true;
		state.reviewedQuote = false;
		render({ focus: true });
	}
	if (button.id === "review-quote") {
		state.reviewedQuote = true;
		render({ focus: true });
		announce("Ongkir contoh telah diperiksa.");
	}
	if (button.id === "payment-refresh")
		document.querySelector("#payment-state").textContent =
			"Contoh status: masih menunggu konfirmasi. Pesanan dan total tidak berubah.";
	if (button.id === "copy-referral") {
		const input = document.querySelector("#referral");
		input.select();
		navigator.clipboard
			?.writeText(input.value)
			.then(() => {
				document.querySelector("#copy-result").textContent =
					"Tautan contoh disalin.";
			})
			.catch(() => {
				document.querySelector("#copy-result").textContent =
					"Pilih teks tautan lalu salin dari perangkat Anda.";
			});
	}
	if (button.id === "share-summary") {
		const text =
			"Contoh 99ribu: 2 paket. Siapkan Rp113.000 untuk paket 1 dan Rp117.000 untuk paket 2. Waktu tiba belum tersedia.";
		preview(
			"Ringkasan untuk penerima",
			`<p>${text}</p><p class="muted small">Tanpa alamat, nomor HP, atau tautan akses pribadi.</p>`,
		);
	}
	if (button.dataset.job)
		preview(
			`Paket ${button.dataset.job}`,
			`<p class="small muted">Gudang Malang · data contoh</p><dl class="job-facts"><div><dt>Resi</dt><dd>${button.dataset.job === "CONTOH-01" ? "Belum terbit" : "AWB-CONTOH-02"}</dd></div><div><dt>Penyerahan</dt><dd>Belum diserahkan</dd></div></dl><div class="notice pending"><p>Contoh hasil belum diketahui: periksa operasi yang sama sebelum mengulang penerbitan resi.</p></div><p class="muted small">Tidak ada penerbitan resi, cetak, atau perubahan status dari prototipe ini.</p>`,
		);
	if (button.id === "reset-jobs") navigate(url("warehouse"));
});
document.addEventListener("input", (event) => {
	if (event.target.closest("#checkout-form") && event.target.name)
		state.fields[event.target.name] = event.target.value;
	if (event.target.id === "draft") state.draft = event.target.value;
});
document.addEventListener("change", (event) => {
	if (event.target.id === "job-filter")
		navigate(url("warehouse", { filter: event.target.value }));
	if (event.target.name === "method") {
		state.method = event.target.value;
		document.querySelector("#parcel-breakdown").innerHTML = parcels();
	}
});
document.addEventListener("submit", (event) => {
	event.preventDefault();
	const form = event.target;
	if (form.id === "search-form") {
		const q = new FormData(form).get("q").trim();
		navigate(url("search", q ? { q } : {}));
	}
	if (form.id === "checkout-form") {
		if (state.step === 1) {
			let invalid;
			for (const [name, message] of [
				["name", "Isi nama penerima."],
				["phone", "Isi nomor HP penerima."],
				["address", "Isi alamat lengkap penerima."],
			]) {
				const input = form.elements[name];
				const bad = !input.value.trim();
				document.getElementById(`${name}-error`).textContent = bad
					? message
					: "";
				input.setAttribute("aria-invalid", String(bad));
				if (bad && !invalid) invalid = input;
			}
			if (!form.elements.email.validity.valid && !invalid)
				invalid = form.elements.email;
			if (invalid) {
				document.querySelector("#checkout-error").textContent =
					"Periksa kembali data penerima.";
				invalid.focus();
				return;
			}
			Object.assign(state.fields, Object.fromEntries(new FormData(form)));
		}
		if (state.step === 2 && state.staleQuote && !state.reviewedQuote) {
			document.querySelector("#checkout-error").textContent =
				"Periksa ongkir kembali sebelum melanjutkan.";
			document.querySelector("#review-quote").focus();
			return;
		}
		if (state.step < 3) {
			state.step++;
			render({ focus: true });
		} else
			preview(
				"Pratinjau konfirmasi",
				`<p>Seluruh paket dan total telah ditinjau dalam prototipe.</p><p class="muted">Tidak ada pesanan dibuat atau pembayaran diproses.</p><a class="inline-link" href="${url("order", state.method === "prepaid" ? { state: "payment-pending" } : {})}">Lihat contoh halaman pesanan</a>`,
			);
	}
	if (form.id === "return-form")
		preview(
			"Pratinjau permintaan",
			`<p>${escapeHtml(new FormData(form).get("note"))}</p><p class="muted">Permintaan belum dikirim. Pengunggahan bukti, validasi hak akses, dan keputusan menggunakan layanan nyata pada tahap implementasi.</p>`,
		);
	if (form.id === "chat-form") {
		const message = document.querySelector("#send-state");
		message.hidden = false;
		message.textContent =
			"Pesan belum dikirim. Ini contoh keadaan gagal; teks tetap ada di kolom pesan.";
		document.querySelector("#draft").focus();
	}
});
addEventListener("popstate", () => {
	const dialog = document.querySelector("dialog[open]");
	if (dialog) dialog.close();
	if (location.search !== currentUrl) render({ focus: true, restore: true });
	const reopened = history.state?.prototypeDialog;
	if (["preview", "views"].includes(reopened))
		document.getElementById(reopened).showModal();
});
render();
