Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/banners-1440.png, docs/spec/design/renders/shop-com-r2-20261022/banners-390.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png, docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/dock-cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/dock-home-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/filter-nojs-390.png, docs/spec/design/renders/shop-com-r2-20261022/filter-pop-1440-dpr2.png, docs/spec/design/renders/shop-com-r2-20261022/filter-sheet-390.png, docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png, docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-appended-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-first-390.png, docs/spec/design/renders/shop-com-r2-20261022/listing-more-1440.png, docs/spec/design/renders/shop-com-r2-20261022/listing-skeleton-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-few-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png, docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-focused-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 660dac1e7b8b03a5
Images-SHA: 8a8d5c54ed7df73d
Output-SHA: 30752af1dc096758

Paduka Ongki, saya sudah buka dan periksa ke-115 gambar. Hasilnya **REVISE**, tapi hanya karena dua cacat kecil yang muncul saat teks diperbesar 200% di layar 320 px. Arah desainnya sendiri sudah didukung referensi dan kontrak. Review-nya saya tulis dalam bahasa Inggris di bawah.

---

## Section verdicts (top to bottom)

**Shell and home**
- Environment strip | authored | none (99ribu sim notice) | It shortens to "Data contoh: simulasi lokal." below 360. Keep it.
- Header 1440 (wordmark, centred omnibox, Promo→Cart→Account) | authored | shop.com omnibox (`f256fbf…-1440-01`, `95bdbd…-1440-01`) | In `brand-hover-mid-1440`, the "a" of "Serba" overlaps the first "9" mid-reveal instead of clipping inside its track. Add `overflow: clip` to each reveal track so letters never overlap during the 240 ms.
- Header 390 (no logo, full-width omnibox) | authored | shop.com mobile header (`44fc7a…-390-full-01`) | None. This is an accepted owner override.
- Category pill row | authored | shop.com pills (`56ae2f…-1440-full-01`: plain circle + 16/600 label, grid icon at the end) | None. The focus ring at 1440 and 320/200% (`pills-focus-*`) surrounds the whole pill and isn't clipped.
- Hero card | authored | shop.com "Shop is all about you" card (copy bottom-left, Sign-in pill + white secondary) | None. The 99ribu tiles are its own catalog photos on the lavender/yellow tint. At 320/200% the card grows and "Rp99.000" stays on one line.
- "Kategori ›" grid | authored (documented deviation) | shop.com Categories tiles (5 per row at 1440, 2 on phones) | None. The pastel tint, dark label and tilted photo card are the recorded answer to white-ground photos. Labels wrap only between words.
- "Terbaru" shelf | generic-by-design (1:1 owner contract) | shop.com product shelf | None. It shows 7 whole cards at 1440 and 2.3 bleeding cards at 390.
- Category switcher | authored | shop.com "Beauty / Women" switcher (`56ae2f…-02`) | None. The medallion sits above the label, a recorded legibility deviation.
- "Temukan pilihan" banner rail | authored (coordinator round 50/53) | shop.com "Discover something you love" rail | At 320/200% (`f9ad8c…-04/05`) card 1 grows to about 950 px. Its body sets about one word per line, and the peeking card shows only letter stubs ("R / k / s"). Below 360 px with enlarged text, set the card body to the 14/18 caption size or drop the body line and keep title + action.
- Footer | authored | shop.com footer (columns right, brand left; 2-column menus on phones) | None.
- Mobile dock | authored | shop.com floating dock (filled active icon, rounded top) | None. The active filled icon reads clearly on home, category and cart. It hides when search has focus (`search-focused-390`).

**Omnibox open**
- Suggestion surface | authored | shop.com open omnibox chip variant | None this cycle. Pills ghosting through the glass ("…an Peliharaan") is backlog, and there's no inner pill left inside the field.

**Search / category listing**
- Heading + filter chip row | authored | shop.com filter chips (`c8a1c9…-search-1440`, `488cca…-search-390`) | **At 320/200% (`90075c…-category-320-text200-01`), "Urutkan: Paling sesuai ⌄" is wider than the 288 px content box.** The value is cut at "Paling se" under the end fade, and the chevron is off-screen, so the one control that sets order can't be read without scrolling. Let chip labels wrap, or cap the chip at the content width with an ellipsis on the value.
- Active chips + dropdown | authored | shop.com filled chip | None. The ink fill with joined "×" and "Hapus semua" is clear. The DPR2 dropdown has whole-pixel edges, a check on the selected row, and a separator after "Semua pilihan".
- Phone sort sheet | authored | shop.com filter sheet (`bbf0d8…`: 28 px radius, scrim) | None.
- No-JS form | authored | none | None. It uses native selects, Terapkan as primary and Hapus filter as secondary.
- Results grid | generic-by-design | shop.com 6-column grid with 20 px media | None. The skeleton row reuses the card frame. "Lihat produk lainnya" is a hairline pill, and the footer stays reachable.

**PDP**
- Task header + breadcrumb | authored | none (no rail to copy) | None.
- Media panel + buy box | authored | shop.com PDP (`c9edea…-pdp-1440`) | None. The narrow buy box, 52 px "Tambah ke keranjang" and chevron accordions match. The empty canvas under the media in `pdp-bundle-open-1440-01` is the documented sticky-capture artifact.
- Bundle disclosure "Sembunyikan barang lainnya" | authored | none | None. Description repeating the item list is owner backlog.

**Cart / Promo**
- Filled cart | authored | no reference (sign-in needed) | None. Lines are unboxed, the summary card has a 52 px primary, and at 390 "Perbarui jumlah" sits beside the quantity pill.
- Empty cart | authored | shop.com "Your cart is waiting" (`9f3fa1…-390-01`) | None. It's centred with one filled primary.
- `/promo` | authored | none | None. The current tag icon is filled, "Paket campuran" comes first and "Promo ongkir" has its plain sentence.

## Evidence and transfer check

- **Hierarchy:** the reference home is pills, then hero card, then category tiles, then the shelf/switcher, then the editorial rail, then the footer (`56ae2f…-01..03`, `44fc7a…-01..05`). `894181…-home-1440-01/02` and `b2fa7d…-home-390-01..04` keep that order with 99ribu content. Trending stores is dropped correctly (single merchant).
- **Rhythm and density:** card text in 14/18 and 12/16, 20 px media radius, and 7 cards per row at 1440 / 2.3 on phones match the reference shelves and the 6-column search grid.
- **Imagery:** all 99ribu photos are its own catalog photos. Hero, tiles, pills and banners use the curated clean picks. Claim-bearing photos appear only in listings, which is the accepted compliance backlog. No drawn or generated stand-ins.
- **Template signals checked:** no dark hero, no grid texture, no eyebrow pills. No mono labels, no `→` on every button (only the hero secondary and the banner pills), and no unsourced stats. "Rp99.000" is the real fixed price. No "resmi"/"terpercaya" claims in the UI copy.
- **Gaps in the evidence set:** `/bantuan` (R11) and help/sign-in renders aren't in this image list. They're marked "reviewed earlier", so R11 isn't re-verified this round. Checkout and receipt have no reference and weren't judged.

**Most important change:** At 320 px with 200% text, let the filter chips wrap or cap at the content width, so "Urutkan: …" and its chevron fit on screen.

**Verdict: REVISE**

This is visual acceptance only, not interaction or accessibility test evidence. The two fixes are small (the chip at 320/200% and the banner body text at 320/200%), plus the optional `overflow: clip` on the wordmark reveal. Nothing else is blocking.