Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 509bfd70d4d71349
Images-SHA: 780cf9918c5e1744
Output-SHA: 8e203a2aa9a84ac3

Paduka Ongki, semua 162 gambar sudah saya buka: 143 render 99ribu dan 19 potongan referensi shop.com. Ini review visual saja, tidak ada source yang diubah. Draft-nya juga ada di `/home/ongki/.claude/plans/you-review-a-web-goofy-sun.md`.

## Section lines

Shell header/omnibox | authored | shop.com borderless pill omnibox + white hairline chips (`95bdbd15314992d5-1440-01`) | at 1440/768 the chip row cuts the 6th department at "Otomo" with no fade or scroll cue (`7cd5a859d10e44c2-cart-1440-01`); add an end-edge mask fade or a trailing scroll affordance
Home hero + price card | authored | none (99ribu fixed-price identity) | accepted round-1 scale; no change
Home "Pilih kategori" tiles | authored at 390/768/1440, **broken at 320/200%** | shop.com department shelf, reduced to one photo per department | collapse to one column at narrow tile width or enlarged text, and set `min-width:0` on tile and media
Home "Mulai dari pilihan ini" shelf | authored | shop.com 1:1, 20px-radius cards | reserve two title lines so prices align at 768
Home "Sebelum memesan" | authored | none | none
Footer | authored | shop.com columned footer, reduced to one column | none
Mobile dock | authored | shop.com active-pill indicator, lavender instead of grey | none
Search heading + filter disclosure | authored | shop.com chip row + filter sheet, adapted as a non-modal panel | none
Search active filter chip | authored | shop.com chip | none
Search results grid | authored | shop.com 6-column grid → 5 columns | give the card title a two-line min-height
PDP media + buy box | authored | shop.com PDP 1440/390 (`c9edea82…`, `52a31a5d…`) | none
PDP "Spesifikasi" + accordions | authored | shop.com Description/Reviews accordions | accepted deviation
Cart empty | authored | shop.com empty cart (`f256fbf0…`, `9f3fa1c5…`) | none
Cart filled: line + summary | authored | none (no populated reference) | none
Help topics + chat card | authored | help.shop.app centred 2-up (`27b2df7e…`, `6c377b87…`) | top-align the short "Pengembalian" card or let it span the full row
`/masuk` + error state | authored | shop.com centred empty-state pattern | none
Not found | authored | shop.com recovery state | none

## Findings

1. **Category tiles break at 320/200%** (`f9ad8c3bad0b98a7-home-320-text200-03.png`). Names run past the tile edge: "Kecantikan", "Kebersihan" (shows as "Kebersihar") and "Elektronik". The white photo panels also stick out past the right edge of the lavender tile. Breakage at any width is always a finding, and this is the deciding defect. The subgrid baseline fix holds at 390/768/1440, but the two-column layout cannot fit long Indonesian words at doubled text size.
2. **Price baseline still misaligns.** Round 9 says prices "align across each row", but that fails whenever one card title fits on one line:
   - `71b3b51172f2be14-search-1440-02`: "Paket Ibadah Pria Muslim" puts its price about 22px higher than its neighbours, and "Paket Glowing Lengkap 3-in-1" does the same.
   - `e539555aa785082a-search-768-03/04` show the same offset.
   - `fd8b8d79ef3ae725-home-768-02/03`, rows 1 and 2.

   Effect: the fixed-price rhythm across rows breaks, which hurts quick comparison. The clamp limits titles to two lines but sets no minimum height.
3. **The department chip row hard-clips on desktop.** At 1440 a department is visible only as "Otomo…", with no visual sign that the row scrolls. In the reference (`95bdbd15…-1440-01`) all chips fit, centred. Effect: a department becomes hard to discover on desktop.
4. **Help "Pengembalian" card** (`603301b6…-help-1440-01`, `799a4b55…-help-768-01`): a single line of text stretched to row height, leaving a mostly empty box. The text is owner content still to come, so this is minor, but the layout makes the gap stand out.
5. **Omnibox at 320/200%**: the search icon fills the purple button edge to edge, so it looks cramped. Minor.

Not counted as defects:
- The empty band in the PDP left column at 768/1440 is expected: the media is sticky, and a full-page capture cannot show sticky behaviour.
- The 7-item cart line at 390 pushes checkout below the first screen; this was accepted earlier.
- The home H1 scale is an accepted round-1 deviation.

## Reference transfer

These match the references:
- **Canvas and surfaces:** the off-white `#fafafa` canvas with white raised omnibox and chips matches the 1440 home reference.
- **Search grid:** 1:1 cards with a 20px radius, bold title and a small price matches `c8a1c9a0…-search-1440`, at 5 columns instead of 6. Ratings and discount badges were correctly left out.
- **PDP:** the narrow buy box with a full-width 52px pill and chevron accordions between hairlines matches the reference.
- **Empty states:** cart and not-found are centred with a single filled pill, as in `f256fbf0…`.
- **Help:** the centred column of 2-up cards with chat at the end matches `27b2df7e…`.

Two mismatches:
- **Department tiles:** shop.com uses a mosaic of four photos per department with labels on the images. 99ribu shows one photo inside a lavender card. The research log explains this (one representative photo per department), so it is acceptable.
- **Chip row:** shop.com's chips fit on one row; 99ribu's overflow at desktop (finding 3).

Evidence gaps noted in the direction document:
- The multi-option PDP pills (R3/R6) are still unverified.
- Category pages were never captured.
- The direction document references renders under `docs/spec/design/renders/shop-com-r2-20261022/`, but the slices I was given are under `design/review-slices/`. I judged the slices.

Most important change: on home, make the category tiles drop to one column (or add `min-width:0` and `overflow-wrap`) under enlarged text at 320px, so names and photos stay inside the tile.
Verdict: REVISE