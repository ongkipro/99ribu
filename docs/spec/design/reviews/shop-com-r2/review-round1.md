Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 04b021dc9750f2c5
Images-SHA: f328be20bc29d1a0
Output-SHA: b8164a61193e3127

Paduka Ongki, hasilnya **REVISE**. Semua 100 slice dan gambar referensi shop.com sudah saya buka satu per satu. Review lengkapnya ada di `/home/ongki/.claude/plans/you-review-a-web-playful-puppy.md`. Belum saya salin ke `docs/spec/design/reviews/shop-com-r2/review.md` karena plan mode masih aktif dan memang belum ada yang diubah di repo.

## Per bagian halaman
`<section> | generic or authored | look matched | one concrete fix`

**Shell**
- Header omnibox + chip | authored | omnibox pill shop.com (R2/R3) | tidak perlu diubah. Tombol 44px tumbuh dengan benar di 320/200%.
- Footer | authored | footer berkolom (R9) | di 320/200% dua link "Bantuan" menempel tanpa jarak. Pertahankan jarak baris ≥44px seperti di 390.
- Dock | authored | pill aktif (R10) | tidak perlu diubah.

**Home**
- Hero + kartu kuning | authored (brand) | tidak ada, sengaja 99ribu | di 1440 H1 kecil dan mengambang di atas ruang kosong besar. Samakan skalanya dengan tinggi kartu.
- Tile kategori | authored | shelf shop.com (R12) | brief placeholder ditaruh kiri-atas ±10px, sedangkan slot produk di tengah. Pakai satu pola placeholder. Di 768 sepertiga kanan kosong.
- Shelf produk | authored | ritme kartu (R5) | di 768 grid 3 kolom menyisakan kartu ke-4 sendirian di baris kedua. Pakai 2 atau 4 kolom.

**Search**
- Judul + chip filter aktif | authored | "Results" + chip (R4) | tidak perlu diubah.
- Panel filter | **generic form block** | shop.com hanya dari bentuknya | kontrak R4 bilang facet berupa grup pill, tapi di semua state hanya ada 4 native select. Di 768 nilai "Paket barang yang sama" terpotong di panah select, dan "Urutan" jatuh sendirian ke baris ke-4. Isi pilihan dan Ketersediaan jadikan grup pill radio/checkbox, lalu pakai grid 2×2 di 768.
- Grid hasil | authored | grid 5/2 kolom (R4) | kartu yang stoknya habis hanya ditandai teks abu-abu 12px. Beri state visual, misalnya media atau harga diredupkan.
- Basis harga di kartu | authored | R5 | di 390/320 "/ pilihan lengkap" turun baris dengan indent spasi di depan (±4px). Buang spasi depannya supaya rata dengan harga.

**PDP**
- Media | authored | panel putih (R6) | placeholder putih polos, beda dari slot lavender di listing. Samakan polanya.
- Buy box | authored | buy box sempit, pill 52px | cocok. Pill opsi **UNVERIFIED** karena belum ada produk multi-opsi.
- Spesifikasi | sebagian generic | accordion hairline | "Spesifikasi" berupa heading statis lebih besar dan isinya kosong, jadi merusak ritme accordion. Jadikan baris accordion yang sama, atau sembunyikan selama kosong.

**Cart kosong** | authored | empty cart shop.com (R8) | cocok di semua lebar. R7 (cart berisi baris + kartu ringkasan) tidak ada di set gambar ini.

**Help**
- Kartu topik | authored | kartu 2-up help.shop.app (R11) | cocok di 1440/768/390.
- Kartu chat | tidak konsisten | tidak ada | di 320/200% badge jam operasional berubah jadi blob elips 4 baris, jadi rendering-nya rusak. Selain itu ada dua tombol primer (filled) berdempetan: "Mulai Chat Bantuan" dan "Kembali ke katalog". Batasi radius badge dan turunkan "Kembali ke katalog" jadi sekunder. Badge ada di `CustomerChatView` (owner lain), tapi cacatnya tetap kelihatan di halaman ini.

**Not found** | authored | recovery terpusat (R8) | jarak teks ke tombol (±24px) beda dengan cart kosong (±44px). Samakan.

## Perbandingan dengan referensi
- **Sudah tertransfer dengan baik:** kanvas off-white, omnibox, chip, media kartu 1:1, buy box PDP, empty state, footer, kartu help.
- **Satu klaim yang tidak terbukti di render:** sheet filter shop.com (`2026-10-22-search-filters-390.png` dan slice `bbf0d8aff568c306…`) isinya grup pill chip dengan state selected yang filled. Di render kita yang muncul justru form select.
- **Tidak saya anggap masalah:**
  - Tidak ada sinyal template: tanpa hero gelap, eyebrow, kartu ikon, monospace, panah di tombol, atau klaim tanpa sumber.
  - Slot foto sudah berlabel 1:1 dengan brief, jadi terhitung konten owner.
  - Kartu lebih besar dari shop.com (16/18px) itu deviasi yang tercatat dan ada alasannya.
- **Riset yang masih kurang:** cart berisi baris dan PDP multi-opsi belum di-render. Keduanya item inti kontrak (R6/R7).
- **Catatan data (bukan desain):** "Contoh Kaos" tertulis "1 × Kaos" di home tapi "2 × Kaos" di search.

Most important change: Render facet filter di listing sebagai grup pill native (transfer yang diklaim R4) dan perbaiki select yang terpotong di 768, sebelum halaman search disebut setara shop.com.

Verdict: REVISE