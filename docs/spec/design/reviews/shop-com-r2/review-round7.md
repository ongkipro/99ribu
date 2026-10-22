Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: fae1a27e05b6b16c
Images-SHA: 8c9b4b1a0e58186c
Output-SHA: 3cb6c23668e6ad35

Paduka Ongki, verdict-nya **REVISE**. Saya sudah buka ke-173 gambar: 15 slice referensi shop.com dan 158 render 99ribu. Strukturnya sudah *authored*, tidak ada sinyal template. Tapi data katalog asli (S81) memunculkan satu masalah hierarki yang serius di PDP. Review lengkapnya ada di `/home/ongki/.claude/plans/you-review-a-web-delightful-newt.md`.

## Section verdicts

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Environment banner | authored | none (99ribu disclosure) | none; wraps cleanly at 320/200% |
| Header + omnibox | authored | shop.com omnibox, R2 | none |
| Department chips | authored | shop.com chip row, R3 | `shell.tsx:14` caps chips at 3, so "Perkakas, Lem & Elektronik Rumah" is a home tile but has no chip on any page. Show every department |
| Hero + fixed-price card | authored | none (accepted identity) | at 1440 the yellow card spans ~1200px with an empty ~600px centre; cap its width or put "Lihat paket campuran" under the text |
| "Pilih kategori" tiles | authored | shop.com shelves | (a) Rumah Tangga and Perkakas reuse the first two shelf products' photos; exclude shelf products. (b) At 768 the 350px tiles take ~1000px before any product. (c) At 320/200% the 2-up labels have no gap and read "Kebersihan Elektronik" (`f9ad…-03`) |
| Product shelf | authored | shop.com cards, R5 | none |
| Sebelum memesan / footer / dock | authored | R9/R10 | none |
| Search heading + filters | authored | shop.com search, R4 | none |
| Search grid | authored | 5-col / 2-col | at 390 the last 4–6 cards show blank white media (`41a3…-05/06`, `7554…-05/06`, `92b4…-06/07`). Cause: `loading="lazy"` in a full-page capture. Re-capture after scrolling, and give the image box the lavender slot surface while loading |
| PDP media | authored | shop.com white media panel | at 1440 the left column is empty for ~700px under the media; make the media sticky |
| **PDP buy box** | authored structure, order broken by real data | shop.com buy box | the raw "Isi paket: - 1 pcs … Harga Rp99.000" paragraph repeats "Isi yang diterima" and pushes "Tambah ke keranjang" to y≈1276 at 1440 (900px viewport), ≈1620 at 390, ~4.4k px at 320/200% |
| PDP accordions / empty cart / not found | authored | R6/R8 | none |
| Filled cart | authored | R7 | at 390 the 7-item list pushes checkout below the first screen; acceptable under the spec |
| Help | authored | help.shop.app 2-up cards, R11 | the "Pengembalian" card only says "belum diterbitkan", a content gap for the owner; at 1440 the hours line is squeezed beside the H2 |
| /masuk + error | authored | storefront card | none; the alert stays legible at 320/200% |

## Perbandingan dengan referensi

- **Yang sudah cocok:** ritme search (chip row → heading → grid 1:1), help (kolom tengah dengan kartu 2-up), empty cart (satu aksi primer), dan home (kanvas off-white dengan omnibox dan chip putih).
- **Satu mismatch material:** PDP shop.com menaruh title → price → options → qty → CTA di atas fold, dengan description dilipat. Di data fixture round 6 ini tidak kelihatan; katalog asli yang membukanya.
- **Gap riset yang masih terbawa:**
  - Option pill PDP multi-option (R3/R6) masih UNVERIFIED.
  - Halaman kategori tidak di-capture, baik di shop.com maupun di 99ribu.
  - Alasan memakai satu foto per departemen (bukan mosaic) belum ditulis, tapi wajar dengan datanya.

Most important change: move the raw product description out of the buy box into a collapsed "Deskripsi" accordion after "Tambah ke keranjang", so the primary action sits in the first viewport at 1440 and close to it on phones.

Verdict: REVISE

Ini penerimaan visual saja, bukan bukti interaksi atau aksesibilitas.