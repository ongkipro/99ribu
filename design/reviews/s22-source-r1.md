Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, hasilnya **CHANGES REQUIRED** untuk source preflight engineering S22 ini. Saya menemukan 2 P2 dan tidak ada P1.

## Binding (sudah dicek, read-only)
- **Fingerprint:** semua 22 source, 29 context dan 11 evidence cocok (sha256 dan bytes), tidak ada mismatch.
- **3 canonical digest cocok:** source `0af1641f…877d`, context `905393c0…3429`, evidence `273efb04…4864`.
- **Child test terlindungi:** `storefront-offer-selection.test.ts` byte-identical dengan arsip S21.
- **Delta `carts.ts`:** dibanding checkout sebelumnya, perubahannya cuma `hasCartStock`, plumbing namespace, dan urutan freeze sesudah cek namespace.

## Cakupan
- **22 file yang berubah:** dibaca penuh, termasuk seluruh 1148 baris `globals.css`, semua controller/boundary/form di `cart-forms`, fixture browser 9-case, 4 test integrasi dan registry.
- **Dependency runtime:** dibaca penuh — checkout access/routes/quotes/orders, inventory reservations/positions, access handler/http/auth/policy, catalog validation/publication, advertising events, local fixtures/storefront, listing, halaman categories, fixtures test, next.config dan package.json.
- **Kontrak:** bagian S22/API/MW di 10-DESIGN (P1–P3, C1–C4, R1), 17-UX (:107, :117) dan OAS `/carts*`.

## P2-1: konflik yang sudah diketahui menghapus jumlah yang diketik pembeli, dan error-nya muncul jauh dari baris terkait
- **Lokasi:** `src/components/storefront/cart-forms.tsx:50-51,56` dan `:41`.
- **Penyebab:** state `error` tidak ikut "retained", jadi form memakai intent `base` hasil revalidate dengan quantity lama. Input di-key ulang, dan form reset React 19 juga mengembalikan default. Padahal `cart.ts:94-100` masih menyimpan quantity yang dikirim.
- **Skenario:** di cart, line A diubah dari 1 ke 6 dan dapat `OFFER_UNAVAILABLE`. Field kembali ke 1, tidak ada warning di baris itu, dan hanya ada pesan di atas halaman tanpa nama line. Di PDP, ketik 7 lalu field kembali ke 1.
- **Kontrak yang dilanggar:** 10-DESIGN P3 ("retain inputs… beside the affected control"), 17-UX:107 dan 17-UX:117. Browser-r5 tidak menutup kasus ini.
- **Koreksi terkecil:** kalau `same && state.phase==='error'`, pakai `state.intent.quantity` sebagai default (tetap key/version dari base) dan tampilkan `state.message` dengan `role=alert` di dalam form itu. Tambah satu assertion browser.
- Temuan ini dari trace kode, belum dieksekusi.

## P2-2: OfferPicker langsung pindah halaman setiap pilihan berubah (WCAG 3.2.2, Level A)
- **Lokasi:** `src/components/storefront/offer-picker.tsx:4`, `onChange → requestSubmit()`.
- **Skenario:** di Chromium Linux/Windows, user keyboard menekan ArrowDown di select yang tertutup. `change` langsung jalan, jadi tiap tombol memicu navigasi GET dan fokus balik ke awal halaman.
- **Koreksi terkecil:** hapus `onChange` dan `'use client'`. Tombol "Lihat pilihan" yang sudah ada sudah jadi GET native. Lalu `storefront-cart.test.ts:73` diubah supaya klik "Lihat pilihan" sesudah `selectOption`.

## Yang sudah terverifikasi benar
- **Matching offer:** preferensi offer yang tersedia hanya di dalam konjungsi filter yang sama; filter unavailable-only tetap; urutan stabil; fallback atribut variant dulu baru product; truthiness `listProducts` tetap.
- **PDP:** memakai `?offer` persis. Offer foreign, sold-out, duplikat atau parameter ekstra tidak pernah diganti diam-diam. Media, isi dan harga mengikuti offer terpilih. Bundle tetap satu offer parent: 1 = 99k, 2 = 198k.
- **Writer:** replay jalan sebelum cek versi, publication dan stok. Stok dijumlah per warehouse sebagai offer lengkap. Delete tetap bisa. Cart tidak me-reserve stok.
- **Bridge:** memakai `handleCheckout`/`handleAuth` yang sudah ada, dengan header POST mentah dan `assertOrigin`. SSR memakai `cookies()` sesudah duplikat cookie mentah ditolak. Token hanya lewat cookie HttpOnly.
- **Recovery:** bootstrap guest di-acknowledge sebelum commit. Kunci init per actor dan generation memulihkan kehilangan respons create/add. Key, body, versi dan quantity tetap saat unknown. Key berotasi sesudah hasil diketahui. Restart memakai sign-out yang sudah dijaga, dan cart lama tetap tersimpan.
- **Clock:** expiry cart dan quote memakai business clock dari cart yang terotorisasi. Browser tidak menerima clock apa pun.
- **Fixture:** quarantine/release hanya untuk posisi milik test. Script repair memverifikasi 2 ID/revision/delta yang persis dan menyisakan 1 unit quarantine baseline. Tidak ada drain global. Kegagalan r4 tetap tercatat, r5 PASS 9/9.

## Catatan nonblocking
- **Badge cart:** `shell.tsx:8` ikut menghitung cart yang expired/submitted.
- **Stok fixture:** cart tanpa namespace ikut menghitung warehouse fixture (`carts.ts:37-40`). Ini hanya di localhost dan konsisten dengan `publicProduct`.
- **Duplikat cookie:** tidak bisa dipulihkan lewat restart (`handler.ts:72` → `access.ts:11`). Sifatnya fail-closed, user harus hapus cookie sendiri.
- **Pesan hapus:** nama line dicari dari cart saat ini, bukan `intent.cart`, jadi kadang hanya muncul pesan generik.
- **CSS:** `.detail-help` terdefinisi dua kali.
- **Retry:** error boundary mengulang semua intent yang belum selesai, tapi labelnya tunggal.

## Batas evidence dan gate yang masih pending
- **Browser-r5:** hanya satu file lewat `node --test`, bukan matrix browser 4-file yang terdaftar. Matrix itu masih jalan dan belum saya review.
- **Build-r8:** keterkaitannya dengan source sekarang hanya dibuktikan lewat mtime (source 13:57:37, BUILD_ID 13:59:21), bukan hash.
- **Masih pending:** fix kedua P2, review ulang source yang berubah, build dan bukti browser baru, matrix 4-file, keputusan owner untuk visual round, design-gate 0, final R3 boundary, dan acceptance S22/T-33/all68.
- **S33:** SQL `ca52af7b…` tidak dibaca dan tidak dijalankan. Tidak ada izin SQL atau bisnis yang diberikan.

Provenance: runtime Claude Code, model claude-opus-5-5, provider Anthropic. Reasoning setting tidak terekspos (unavailable). Satu-satunya scratch adalah plan file di luar repo, `~/.claude/plans/perform-a-real-independent-flickering-wigderson.md`, yang berisi laporan lengkapnya. Tidak ada gambar yang diperiksa dan tidak ada verdict visual.
CROSS_CLI_EXIT=0
