Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: f766eea40ca3795d
Images-SHA: 12963739b9a82844
Output-SHA: eafc5f2229be2437

Paduka Ongki, saya sudah membuka ke-99 gambar: 20 tangkapan referensi shop.com dan 79 render 99ribu. Hasilnya **REVISE**. Ada satu cacat render yang terlihat jelas, dan dua item kontrak belum punya bukti render. Ulasan lengkap di bawah dalam bahasa Inggris.

---

## Section-by-section

**Home** (`894181cd…-home-1440-01`, `fd8b8d79…-home-768-01..03`, `b2fa7d09…-home-390-01..03`, `f9ad8c3b…-home-320-text200-01..07`)
- Header / omnibox / department chips | authored | shop.com white pill omnibox with a filled round submit, and white hairline chips (`95bdbd15…-1440-01`, `24f5fb56…-390-01`) | When on a listing, mark the current department chip with the 1.5px charcoal selected border from R3. Today "Semua produk" looks the same on home and on `/search` (`71b3b511…-search-1440-01`), so the page doesn't show where you are.
- Hero, H1 and yellow fixed-price card | authored | none. This is 99ribu's own fixed-price statement, not a template. | At 390 (`b2fa7d09…-01`), "Rp99.000" sits mid-row next to "Setiap pilihan" instead of aligned to the right edge. Right-align it, or stack it under the label, so the price reads as the card's anchor.
- "Pilih kategori" tiles | authored | shop.com department mosaic headed "Women ›" | Each photo-slot brief sits as tiny top-left text, while product cards centre "Foto belum tersedia" and the brief. Use one placeholder treatment on both, so slots read as one system when photos arrive.
- "Mulai dari pilihan ini" shelf | authored | shop.com shelf with a chevron pill (R12). 4-up at 1440, 2-up at 768/390. | No change needed. The chevron pill links match the reference affordance.
- "Sebelum memesan" | generic | none | At 1440 and 768 (`fd8b8d79…-03`), the heading sits alone on the left and the text is squeezed into the right half, leaving a large empty block. Use a single column below ~1024px, or put the text directly under the heading.
- Footer | authored | shop.com columned footer (R9) | No change needed.

**Search / listing** (`71b3b511…`, `e539555a…`, `41a37444…`, `0e1bd073…`, `0eda6f57…`, `81f1433a…`, `7554e96f…`, `92b4704d…`)
- Title, count and active-filter chip | authored | shop.com "Results" heading plus a chip row | No change needed. The removable chip "Isi pilihan: Paket barang yang sama ×" fits on one line at 390.
- Filter panel | authored | the filter row and sheet in `c8a1c9a0…-search-1440` and `bbf0d8af…-search-filters-390`, adapted to native selects | No change needed. The layout is one row of four at 1440, 2×2 at 768 (labels no longer clipped) and stacked at 390. The toggle fills black when open, like shop.com's selected filter icon.
- Results grid and card rhythm | authored | shop.com 1:1 media with 20px radius, then title and price | At 390, "Stok pilihan belum tersedia" wraps to two lines inside a full-radius pill and turns into a lozenge (`7554e96f…-02..05`, `92b4704d…-02..06`). Use a shorter label ("Stok habis") or a 10–12px radius when the text wraps.
- Pagination | authored | none | No change needed.

**PDP** (`bc2effc7…-pdp-1440-01`, `00c6b847…-pdp-768-01..02`, `5246c805…-pdp-390-01..02`, `b6b3ad67…-pdp-320-text200-01..04`)
- Media panel | authored | shop.com 28px media panel (`c9edea82…-pdp-1440`) | Here the shot brief sits *below* the panel as a caption, while listing cards put it inside the slot. Pick one placement.
- Buy box | authored | shop.com narrow buy box with a full-width 52px primary and hairline accordions | "Spesifikasi" is a static heading with no chevron, placed between two chevron accordions, so it looks like a broken accordion row. Give it a visibly different treatment, such as a plain section above the first hairline, or explain the difference.
- Option pills (R3/R6) | unverified | — | The local catalog has no multi-option product, so no render shows these pills. Seed one product with options and capture it.

**Cart** (`7cd5a859…-cart-1440-01`, `871c54c7…-cart-768-01..02`, `40d700da…-cart-390-01..02`, `3b1bae43…-cart-320-text200-01..03`)
- Empty state | authored | shop.com empty cart (`f256fbf0…`, `9f3fa1c5…`): centred heading, one line of text, one filled pill | No change needed. The canvas fills the short page and the active dock tab shows its lavender pill.
- Cart with lines (R7) | unverified | — | The summary card, the 52px checkout button and the pill quantity input have no render this round. Capture a guest cart with items.

**Help** (`603301b6…-help-1440-01`, `799a4b55…-help-768-01..02`, `c56a5cb6…-help-390-01..03`, `11721880…-help-320-text200-01..07`)
- Topic cards | authored | the 2-up topic cards in `27b2df7e…-1440` | No change needed.
- Chat card | generic, conflicting system | none | This card mixes 8px square buttons, a bordered and tinted box, and Title Case copy ("Mulai Chat Bantuan", "Lampirkan Konteks Produk atau Pesanan (Opsional)") into a pill, sentence-case page. Its badge also uses the `A • B` pattern. **At 320/200% (`11721880…-04`), the badge becomes an ellipse and "08.00–21.00 WIB" runs into the curved edge, so the text is clipped.** Saying another component owns it doesn't make the page visually acceptable.
- Return action | authored | — | No change needed. "Kembali ke katalog" is secondary, so the chat start stays the only filled action.

**Not found** (`f630dc19…`, `7798c907…`, `a3d7e240…`)
- Recovery state | authored | shop.com centred empty state | No change needed.

## Reference fidelity

The transfer itself holds up:
- **Canvas and surfaces:** the off-white canvas with white raised surfaces matches `95bdbd15…-1440-01`.
- **Omnibox and chips:** pill omnibox and white chips, as on the shop.com home.
- **Grids:** 2-column mobile grid with tight gaps (`488cca11…-search-390`).
- **Empty states:** centred, with one primary action.
- **Help:** 2-up help cards (`27b2df7e…`, `6c377b87…`).

No template signals turned up: there's no dark hero, eyebrow label, icon tile, monospace text or arrow-on-every-button, and no unsourced claim apart from the chat badge's "24/7". Photo slots are labelled with shot briefs and sized at their final proportions, so missing photos count as owner content, not a design failure.

The density is a little lower than shop.com's: the price basis adds a line per card on phones. That is justified, because the fixed-price rule has to stay visible.

**Evidence and research gaps:**
- Category pages, the populated cart and multi-option PDP have no reference and no render.
- In the 390 and 320 slices, the fixed dock covers part of the page. At 320/200% it wraps into two rows about 180px tall (`f9ad8c3b…-01`, `11721880…-02`). Whether the short-viewport rule fixes that under real text zoom is still unverified.

Most important change: Fix the help chat card so it uses pill controls and sentence-case copy and its badge wraps without clipping at 320px/200%, then capture a cart with items and a multi-option PDP so R7 and the R3/R6 option pills have render evidence.

Verdict: REVISE