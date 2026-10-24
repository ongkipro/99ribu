Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/banners-1440.png, docs/spec/design/renders/shop-com-r2-20261022/banners-390.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-home-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/filter-nojs-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-pop-1440-dpr2.png, docs/spec/design/renders/shop-com-r2-20261022/filter-sheet-390.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-appended-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-more-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-skeleton-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-focused-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 576689ae32d461a8
Images-SHA: 585b2fbc26b27b0b
Output-SHA: 2dc7255ecd7ebd66

Paduka Ongki, verdict-nya **REVISE**, karena satu masalah konten: ada klaim pemutih (whitening) yang lolos ke rak home pilihan. Ke-116 gambar sudah saya buka semua. Sebanyak 26 di antaranya ternyata capture referensi shop.com, bukan render 99ribu: semua slice berlabel `2026-10-2x`, plus `f256…`, `9f3f…`, `27b2…`, `6c37…`, `95bd…`, `24f5…`. Itu saya pakai sebagai referensi. Tidak ada yang saya ubah. Rencana perbaikan ada di `~/.claude/plans/you-review-a-web-melodic-kite.md`, belum dijalankan.

## Per section (atas ke bawah)

| Section | Generic / authored | Look matched | Satu perbaikan konkret |
|---|---|---|---|
| Banner simulasi + header (desktop) | authored | header shop.com (omnibox di tengah, ikon Promo → Cart → Akun) | Tidak ada. Di `brand-hover-mid-1440` huruf "Serba" sempat terpotong saat transisi. Itu cuma sesaat, jadi bukan finding. |
| Header phone (tanpa logo) | authored (keputusan owner) | header phone shop.com | Tidak ada |
| Pill kategori | authored | pill shop.com `2026-10-23-pills` | Tidak ada. Ring fokus di 320/200% kelihatan utuh. |
| Hero | authored | value card shop.com | Di `hero-320-text200` H1 "Semua Rp99.000" (~36px) hampir sama besar dengan paragraf (~28px), jadi hierarkinya runtuh. Batasi ukuran paragraf atau beri H1 rasio minimum. |
| Grid "Kategori ›" | authored | Categories shop.com, dengan tint + kartu foto sendiri | Tidak ada. Label tidak terpotong; 2/5 kolom, dan 1 kolom di 320/200%. |
| Rak "Terbaru" | authored | product shelf shop.com | Tidak ada. 7 kartu di 1440, 2.3 kartu di phone dengan kartu terpotong di tepi. |
| Category switcher | authored | switcher shop.com | **Panel Kecantikan menampilkan cover "Snap On Smile" dengan teks "Dengan formula pemutih"** (`894181…-home-1440-02`, kartu ke-6). Masukkan ke `CLAIM_PHOTOS` atau tambah kata "pemutih" ke homeSafe. |
| "Temukan pilihan" (banner) | authored | rail "Discover something you love" shop.com | Tidak ada. Caption dan pill sejajar, kartu berikutnya selalu mengintip di 320/200%. Beda perlakuan collage vs cut-out sudah diputuskan coordinator. |
| Footer | authored | footer shop.com | Tidak ada di render. Tapi `434aa…-footer-320-text200-02` terpotong oleh dock di heading "99ribu", jadi perlu recapture. |
| Dock phone | authored | bar shop.com | `236d9…-dock-320-text200` sama sekali tidak menampilkan dock (isinya kartu banner). Bukti dock statis di layar pendek tidak terlihat; perlu recapture. |
| Listing/search (chip, grid) | authored | `2026-10-22-search-1440/390` | Tidak ada. 6/2 kolom, skeleton satu baris, tombol "Lihat produk lainnya" pill putih. |
| Dropdown filter / sheet / no-JS | authored | sheet shop.com dan Select shadcn | Tidak ada. Dropdown menempel tepi kiri chip di DPR2; tombol remove di chip aktif tersambung rapi. |
| Omnibox terbuka | authored | `2026-10-23-omnibox-open` | Minor: chip "Summerspring" itu lini produk/brand, bukan jenis produk. Sudah dicatat di direction. |
| PDP | authored | `2026-10-22-pdp-1440/390` | Tidak ada. Buy box sempit, CTA 52px, accordion hairline, aman di 320/200%. Strip thumbnail untuk bundle masih backlog. |
| Keranjang (kosong / isi) | authored | empty cart shop.com | Tidak ada |
| Bantuan | authored | help.shop.app (kolom ~720px, kartu 2-up) | Chat card pakai secondary outline ungu, sementara "Kembali ke katalog" pakai hairline putih. Beda gaya ini sudah tercatat milik owner lain, jadi tidak memblokir. |
| Promo | authored | — | Tidak ada |

## Observasi dan perbandingan dengan referensi

- **Hierarki dan ritme:** urutan home sudah sama dengan `2026-10-23-home-1440-full` (pill → hero → Categories → shelf → switcher → rail → footer). Skala tipografinya cocok: section heading 20/600 dan judul kartu 14/600 satu baris. Grid search 6 kolom tanpa sidebar juga sama dengan `2026-10-22-search-1440`.
- **Visual:** shop.com memakai foto editorial full-bleed. 99ribu mengganti dengan foto merchant di atas tint brand. Alasannya tercatat (foto latar putih, jadi label putih tidak terbaca di atas putih). Itu transfer yang masuk akal, bukan sekadar meniru.
- **Kepadatan:** gutter 1250px dan shelf 7 kartu memang keputusan owner. Di 320/200% tidak ada yang terpotong atau overflow di semua slice.
- **Tidak terlihat template-generic:** tidak ada hero gelap bergrid, eyebrow, angka statistik, atau panah di setiap tombol. Sinyal "Rp99.000 per pilihan lengkap" ada di hero, kartu, PDP, dan footer, jadi halaman ini tidak cocok untuk bisnis lain.
- **Klaim di listing/search:** BUBUK AJAIB, Antabur, WAJAH GLOW UP, dan sejenisnya masih muncul. Itu sudah backlog yang diterima, jadi bukan finding di sini. Yang jadi finding hanya klaim di permukaan pilihan (curated), karena kontrak sendiri menjanjikan homeSafe menyaringnya.
- **Riset dan alasan transfer** sudah lengkap di direction, jadi tidak ada yang kurang.

**Most important change:** Keluarkan cover "Snap On Smile" ("Dengan formula pemutih") dari panel switcher home lewat `CLAIM_PHOTOS` atau kata "pemutih" di homeSafe, lalu recapture home-1440/390.

**Verdict: REVISE**

Ini penerimaan visual saja, bukan bukti interaksi atau aksesibilitas.