Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 30a062b3be042db3
Images-SHA: 0456e249bf143977
Output-SHA: 5ee9a00f6ea22c13

Paduka Ongki, saya sudah membuka ke-108 gambar: 88 render 99ribu dan 20 referensi shop.com. Ukuran brief tile dan state toggle filter saya cek juga di `src/app/globals.css`. Tidak ada file yang saya ubah, dan hasilnya **REVISE**. Review lengkap di bawah dalam bahasa Inggris.

## Section review (top to bottom)

```
Header / omnibox | authored | shop.com white pill omnibox (95bdbd…-1440-01, 24f5fb…-390-01) | none at 390/768/1440; at 320/200% the purple submit turns into a ~70×44 lozenge (3b1bae…-01) but nothing clips
Department chips | authored | shop.com category pills, without thumbnails | mark the current chip: on /search "Semua produk" looks the same as "Busana"/"Perawatan" (71b3b5…-1440-01)
Home hero + fixed-price card | authored | none (99ribu identity, accepted in round 1) | at 1440 the left column ends at y≈435 while the tiles run to y≈490, leaving an empty band under the yellow card
Home category tiles | generic placeholder | shop.com mosaic tiles (weak match) | remove the 26.5rem cap and use the card brief size (detail below)
Home product shelf | authored | shop.com card rhythm (1:1, 20px radius, 600 titles) | none: 4-up at 1440, 2-up at 768/390, price basis drops as one phrase
Home "Sebelum memesan" | authored | none | at 1440 the 1fr/2fr text column starts at x≈552 and lines up with no grid column above (cards start at 120/424/728)
Search filter panel | authored | shop.com chip row + filter sheet (bbf0d8…, c8a1c9…) | make the open "Filter dan urutan" toggle white with the 1.5px charcoal selected border instead of solid #18181b
Search results grid | authored | shop.com search 1440/390 grid | none (24 identical "Contoh Paket 2 Kaos" is catalog data, not design)
Search active-filter chip | authored | shop.com dropdown chips | none: removable pill, readable at 390
PDP buy box | authored | shop.com PDP 1440 (c9edea…) | the offer-option pill state is not rendered, so R3/R6 stay UNVERIFIED
PDP media slot | owner photo slot | shop.com white media panel | acceptable; the shot brief sits under the panel here but inside the slot on cards, so moving it in would give one treatment
Empty cart / not found | authored | shop.com empty cart (f256fb…, 9f3fa1…) | none: centred, one filled primary pill, canvas fills the page
Cart line | partly generic | none (no populated-cart reference) | merge "Rp99.000 / pilihan lengkap" and "1 pilihan · Rp99.000", and line "Hapus" up with the quantity column
Cart summary | authored | shop.com raised card + 52px pill | the "Pengiriman dan pengembalian" link sits ~10px above the CTA (4567ff…, 5802a1…); give it its own spacing
Help topic cards | authored | help.shop.app 2-up/1-up cards (27b2df…, 6c377b…) | none: 45rem column, 2-up plus a full-width privacy card
Help chat card | partly generic | help.shop.app "Need more help? Chat with us" | sentence-case visible labels, hours in muted text, a chevron on the attachment disclosure
Footer | authored | shop.com columned footer | none: wordmark and footnote on the left, "Bantuan" column on the right, links stack cleanly at 320/200%
Mobile dock | authored | shop.com active-pill dock | none: lavender pill plus purple label, and the count badge shows in the filled cart
```

## Findings

1. **The home category tiles don't fill the row, and their shot briefs are too small to read.**
   - `.department-tiles { max-width: 26.5rem }` (`src/app/globals.css:999`) holds the two tiles to about 424px. At 768 (`fd8b8d79ef3ae725-home-768-01.png`) they take the left half and leave about 300px empty, right above a full-width 2-column product grid.
   - `.department-photo small { font-size: 0.65rem }` (`globals.css:1034`) makes the tile briefs about 10px. The card briefs are about 13px (`894181cd6f0102a7-home-1440-01.png`, `b2fa7d0934f1b0da-home-390-01.png`).
   - Round 2 said both now "use one placeholder treatment". The renders show two different treatments.
   - Consequence: the main browse entry looks unfinished at tablet, and the brief the photographer needs is the hardest text on the page to read.

2. **The open filter toggle is the heaviest element on search.**
   - Open, "Filter dan urutan" is a solid near-black pill (`globals.css:586`). It sits beside the purple "Terapkan filter" pill, so the panel has two filled pills (`71b3b5…-1440-01`, `81f1433a…-768-01`, `92b4704d…-390-01`).
   - In the reference, black fill is only for the sheet's Done and filled choice chips. The toggle is the control you use least, yet it outweighs both the primary action and the "Hasil untuk 'kaos'" heading.
   - Fix: use R3's selected treatment (white fill, 1.5px charcoal border).

3. **The cart line has flat hierarchy and repeats the price.**
   - At 1440 (`4567ff…`) the line is seven rows of almost equal weight. The price shows twice in the line and a third time in the summary, and "1 pilihan · Rp99.000" is an `A · B` label.
   - At 390 and 320/200% (`24e17e…-01`, `ecb1c4…-02`), "Hapus" starts about 20px right of the column edge that the quantity input and "Perbarui jumlah" share.
   - Consequence: the line total doesn't stand out on the last step before checkout.

4. **The help chat card is inconsistent with the rest of the page** (`603301…`, `c56a5c…-02`, `799a4b…-02`).
   - Its visible labels are Title Case ("Mulai Chat Bantuan", "Muat Percakapan Saya"), while every other pill is sentence case ("Kembali ke katalog", "Lanjut ke checkout").
   - The non-interactive hours line uses the same bold purple as the "Lampirkan konteks…" disclosure, so it reads like a link.
   - That disclosure has no chevron, unlike the PDP accordions.
   - Before changing the labels, check whether the tests match those names exactly or case-insensitively.

5. **Evidence gap, not a defect:** no render shows the R3/R6 offer-option pills or the quantity stepper with options. The PDP only shows the plain "Pilihan lengkap: Paket lengkap" line. This review cannot accept that state.

**Minor issues:**
- "Spesifikasi — Spesifikasi tambahan belum tersedia." shows an empty section on every PDP.
- The PDP task header has an icon-only cart, while the store header shows the "Keranjang" label.

**Template signals:** no dark hero, eyebrows, monospace, gradient words, arrow-on-every-button, stat figures or "resmi"-style claims. The only one present is the cart's `A · B` label (finding 3). The page is clearly tied to its fixed-price job: every card and summary states the price basis.

## Reference transfer

- **Matches the reference:**
  - The #fafafa canvas with white raised surfaces matches the shop.com home/search (`95bdbd…-1440-01`).
  - The full-width 5-column grid, with the left rail dropped by contract, matches `c8a1c9…-search-1440-01`.
  - The narrow buy box with a full-width 52px pill and chevron accordions between hairlines matches `c9edea…-pdp-1440-01` and `2d2dc5…-pdp-390-scrolled-01`.
  - The centred empty state with one filled pill matches `f256fb…-1440-01` and `9f3fa1…-390-01`.
  - The centred help column with 2-up/1-up topic cards matches `27b2df…-1440-01` and `6c377b…-390-01`.
- **Justified deviations:**
  - The filter panel is a non-modal in-flow `details`, not shop.com's modal sheet (`bbf0d8…`). The direction explains this: native selects are tested no-JS controls and keyboard order must not change.
  - The help support entry is a full card, not shop.com's one-line "Need more help?". That is justified because chat runs inline.
- **Weaker transfers:**
  - shop.com's mosaic tiles are dense, full-bleed and fill the row. 99ribu's department tiles are capped and sparse (finding 1).
  - With an active filter, the open panel at ≥701px pushes the first result row to y≈627 at 1440 (`0eda6f…-01`). shop.com shows results at about y≈140. That follows contract R4 as written; I'm noting it, not failing it.
- **Research:** the direction document's research and transfer rationale are enough. The only unaddressed reference gap is the option-pill state above.

**Most important change:** Remove the 26.5rem cap on `.department-tiles` and give the tile briefs the product-card brief size, so the home browse entry fills the row at 768 and the shot briefs are readable.

**Verdict: REVISE**

All images were inspected. This is a visual review only, not interaction or accessibility test evidence.