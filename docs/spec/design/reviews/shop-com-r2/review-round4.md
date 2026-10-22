Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 7e83e77cc1fd9446
Images-SHA: d30d5a90e8582c13
Output-SHA: 0023be6e9d41b113

Paduka Ongki, putusannya **REVISE**. Halaman `/masuk` tidak memakai bahasa visual storefront ronde ini. Halaman lain di storefront sudah sesuai kontrak shop.com R1–R12.

Saya buka sendiri 125 gambar di `design/review-slices/`. Daftar di prompt menulis 127 entri, tapi semua hash yang disebut ada di folder. Dua belas di antaranya ternyata capture referensi shop.com (cart, help, home, PDP, search, filter). Review lengkap ada di `/home/ongki/.claude/plans/you-review-a-web-refactored-corbato.md`. Karena plan mode, belum saya simpan ke repo.

## Penilaian per section

| Section | Generic / authored | Pola shop.com yang cocok | Satu perbaikan konkret |
|---|---|---|---|
| Header, omnibox, chip departemen | authored | omnibox pill putih + chip pill | Tidak ada |
| Dock mobile | authored | dock dengan pill aktif | Di halaman search tidak ada tab yang aktif, padahal tab Beranda, Keranjang, dan Akun menyala di halamannya masing-masing |
| Home: hero + kartu harga | authored | tidak ada (anchor harga milik 99ribu) | Tidak ada |
| Home: kategori + rak produk | authored | mosaic departemen + rak "›" | Tidak ada; slot foto berlabel + brief foto sudah sah |
| Home: "Sebelum memesan" | generic | tidak ada | Di 1440 kolom teks mulai di x≈552, tidak sejajar dengan grid kartu (424/728) |
| Search: panel filter + grid | authored | sheet filter + grid tanpa sidebar | Di 390, pill "Stok pilihan belum tersedia" melebar penuh selebar kartu; buat mengikuti panjang teksnya |
| PDP: buy box + accordion | authored | buy box sempit, tombol utama 52px | Pill pilihan (R3/R6) masih UNVERIFIED |
| Cart kosong / not found | authored | empty state di tengah dengan satu pill terisi | Tidak ada |
| Cart berisi | authored | kartu ringkasan putih | Di 1440 ada celah kosong ~270px antara baris produk dan ringkasan |
| Help: judul | generic | tidak ada | Judulnya "Cara pesan", tapi tidak ada langkah memesan. Tambah 3 langkah, atau ganti judulnya |
| Help: kartu topik + chat | authored | kartu topik 2-up | Di 320/200% chevron lampiran tetap kecil; ukur pakai em |
| `/masuk` (default + error) | generic | tidak ada | Lihat temuan 1 |

## Temuan utama
1. **`/masuk` (material).**
   - Masih kartu admin dengan border dan radius 8px, rata kiri di 1440, dan separuh kanan halaman kosong.
   - Input berupa kotak radius 6px dengan border gelap.
   - Alert error kotak bergaris merah di kiri, dan ikonnya tidak ikut membesar di teks 200%.
   - Copy untuk staf ("Konsol Operasional", "komisi afiliasi") tampil ke pembeli.

   Hasilnya, halaman ini terasa seperti produk lain tepat saat pembeli diminta login.
2. **Dua gaya tombol sekunder dipakai bersamaan.** Ada pill outline ungu (Perbarui jumlah, Halaman berikutnya, Batal) dan pill putih bergaris tipis (Muat percakapan saya, toggle filter). Pilih satu gaya per peran dan catat di spec 10.
3. **Dock di 320/200% text.** Dock pecah jadi 2×2 setinggi kira-kira 180px dan menutup konten di semua capture 320. Toggle "Filter dan urutan" di search 320 tidak pernah terlihat di slice mana pun. Builder bilang pengaturan ukuran teks asli browser akan memicu rule tinggi layar pendek (`max-height: 38rem`), tapi belum ada capture yang membuktikannya.
4. **Celah bukti.** PDP dengan lebih dari satu pilihan belum pernah dirender.

## Transfer referensi
Yang dipindahkan dari shop.com sudah sesuai klaim dokumen arah: canvas off-white dengan permukaan putih timbul, chip pill, grid tanpa sidebar, buy box sempit, empty cart di tengah, dan kartu topik help 2-up. Elemen yang dilarang juga sudah dibuang, termasuk logo, rating, badge diskon, Buy now, dan rail kiri. Adaptasi grid 5-up dan panel filter non-modal didukung riset dan alasan di kontrak. Satu-satunya komposisi yang tidak didukung referensi maupun kontrak adalah `/masuk`.

Perubahan terpenting: bangun ulang `/masuk` dengan bahasa visual storefront, yaitu kartu putih timbul radius 20px di tengah, input pill atau radius 12px, dan alert membulat, lalu buang copy untuk staf.

Verdict: **REVISE**

Ini penerimaan visual saja, belum bukti interaksi atau aksesibilitas. Kalau Paduka setuju, saya simpan review ini sebagai `docs/spec/design/reviews/shop-com-r2/review-round4.md` dan salin ke `review.md`, sesuai pola ronde sebelumnya.