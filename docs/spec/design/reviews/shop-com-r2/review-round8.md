Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 318a563a49e28476
Images-SHA: a3c9232a29d3776c
Output-SHA: 08423df179ca81dc

Paduka Ongki, saya sudah buka semua 170 slice (22 referensi shop.com dan 148 render 99ribu). Hasilnya **REVISE**. Tidak ada tanda template, tapi ada dua masalah hierarki yang terlihat jelas setelah pindah ke katalog asli. Ini review visual saja, saya tidak mengubah kode apa pun.

## Section by section

| Section | Generic or authored | Look matched | One concrete fix |
|---|---|---|---|
| Env banner + header/omnibox | authored | shop.com white pill omnibox with round filled submit (R2) | none |
| Department chips | authored, but broken at tablet | shop.com chip row (scrolls correctly at 390) | Use the one-row horizontal scroll up to at least 1050px. At 768 the chips wrap to 4 rows (~210px), and at 1440 to 2 rows |
| Home hero + fixed-price card | authored | none (accepted round-1 hero) | Accepted deviation, not raised again |
| Home "Pilih kategori" tiles | generic treatment | none | Tiles use the same white card and single product photo as product cards, so a tile reads as a product (a hair trimmer for "Kecantikan & Perawatan Diri", a CCTV for "Perkakas…"). Put the label inside the media like shop.com's mosaic, or use a shorter tinted tile |
| Home "Mulai dari pilihan ini" shelf | authored | shop.com shelf with a white chevron pill (R12) | Clamp titles to 2 lines |
| "Sebelum memesan" | authored | none | none |
| Search heading + filter disclosure | authored | R4 adaptation of the shop.com filter row | At 768, chips plus the open panel push the first card to ~815px. Fixing the chips solves this |
| Listing grid/cards | authored | shop.com 1:1 media, 20px radius, 5 columns / 2 columns (R5) | Titles are unclamped. "Paket 2 pcs Kaos Kata Lucu…" runs 4 lines at 390, and in row 1 at 1440 one price sits ~22px lower. Clamp titles to 2 lines |
| PDP media + buy box | authored | shop.com PDP panel + narrow buy box (R6) | The 7-item "Isi yang diterima" list pushes "Tambah ke keranjang" to y≈960 at 1440, ≈1290 at 390 and ≈3200 at 320/200%. Show the count plus 2–3 items, and put the rest behind `details` |
| PDP accordions | authored | shop.com hairline + chevron accordions | none ("Spesifikasi" is an accepted deviation) |
| Cart empty | authored | shop.com centred empty cart with one filled pill (R8) | none |
| Cart filled | authored | R7 summary card + 52px pill | none (7-line push and 1440 gap are accepted) |
| Help | authored | help.shop.app 45rem column with 2-up cards (R11) | none ("Pengembalian" is labelled owner content) |
| `/masuk` + error | authored | centred raised 20px card | none. Alert, invalid edges and focus ring are visible at every width |
| Not found | authored | centred recovery state, one primary action | none |
| Footer + dock | authored | R9 columned footer; R10 lavender active pill | none |

## Findings, with the consequence of each

1. **Tablet chip wall (most important).** On `e539555aa785082a-search-768-01.png` and `81f1433ae3189a1a-search-active-768-01.png`, the 9 department chips wrap into 4 rows. Together with the open filter panel, no product appears in the first ~815px. The same wall pushes home, cart, help and `/masuk` down at 768. At 1440 (`71b3b51172f2be14-search-1440-01.png`) they wrap to 2 rows. shop.com (`c8a1c9a03f2c268b`, `24f5fb56f2b3b0c6`) keeps one row. Consequence: the main task (seeing products) is pushed out of the first screen on tablet.
2. **PDP CTA too low.** On `bc2effc755f453fb-pdp-1440-01.png` the purchase button falls below the 900px fold, and at 320/200% (`b6b3ad679a106622-…-04`) it is about 3 screens down. In the shop.com reference (`c9edea82517b9a0c`) the action sits at y≈450. The description fix from round 7 is in place, but the full contents list now blocks the same way. Consequence: the buy block's hierarchy loses to a long list.
3. **Category tiles look like product cards.** In `894181cd6f0102a7-home-1440-01.png`, the "Pilih kategori" and "Mulai dari pilihan ini" rows look identical. Consequence: the reference fidelity to shop.com's labelled mosaic (`95bdbd15314992d5`) is lost, and buyers may tap a tile expecting that one product.
4. **Unclamped titles.** In `7554e96f814d67c8-search-active-390-0x` the card rhythm is uneven. In row 1 of `71b3b51172f2be14-search-1440-01.png`, prices do not line up.
5. **Hyphen breaks.** "3-in-" / "1", "Anti-" / "Stres", "4-" / "in-1" appear at 390/320 (`41a37444…-06`, `0e1bd073…-16`, `b6b3ad67…-02`). This is minor, but it breaks product names.

**Checked and fine:**
- No template signals: no dark hero, no eyebrow labels, no fake stats, no unsourced "resmi" claims, no arrows on buttons.
- The photos are real catalog images, and the copy is concrete Indonesian.
- No clipping at any width.
- The sign-in error alert reads well at 320/200%.

**Still unverified:**
- The multi-option PDP pills (R3/R6).
- Category pages.
- The sticky PDP media. A static full-page capture cannot prove it.
- The line total in the 390 filled cart. The fixed dock covers it at the slice boundary (`24e17e70…-01/02`), which is a capture artifact.

## Reference transfer

These match the references:
- Canvas, omnibox, chips, card media radius, the PDP accordion pattern, the empty states and the help column all match the inspected shop.com slices.
- The recorded rationale explains every deviation (native selects, in-flow filter, no rail).

These do not:
- **Density at tablet:** the chip wall.
- **Hierarchy on the PDP:** contents above the CTA.
- **Imagery:** single-product tiles instead of a mosaic.

None of these three is covered by an accepted deviation.

I wrote the fix list and recapture checks to `/home/ongki/.claude/plans/you-review-a-web-dazzling-pine.md`.

Most important change: Keep the department chips as one horizontally scrolling row up to at least 1050px, so search at 768 shows products in the first screen.
Verdict: REVISE