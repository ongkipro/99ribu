Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/categories-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png, docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png, docs/spec/design/references/shop-com/2026-10-23-home-390-full.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 5580bcbd1ee9c3f9
Images-SHA: 17e0eb20ba4dd8ae
Output-SHA: 4314e98d19796466

Verdict: **REVISE**. I opened all 190 slices, including the shop.com reference captures. One material issue remains: on phones, the home "Kategori" block pushes the first products far down the page. Every other page and section looks authored and matches its R1–R12 transfer. I found no template signals and no unsourced trust claims.

**Section lines (top to bottom)**

**Shell (all storefront pages)**
- Environment banner | authored | none | At 390 it is 11px text wrapping to two lines; keep it to one line or raise it to 12px.
- Header and omnibox | authored | shop.com omnibox (white pill, soft shadow, round purple submit) | None. At 320/200% the submit button keeps clear space around the icon and "Cari produk" is not cut off.
- Department chip row | authored | shop.com chip row | None. The end fade cuts "Otom…" clearly; the current chip has the charcoal edge on search.
- Footer | authored | shop.com columned footer, trimmed | None.
- Mobile dock | authored | shop.com active pill | None. Lavender pill on Beranda, Kategori, Keranjang and Akun; the count badge sits on the cart icon.

**Home** (`894181cd…-home-1440-01/02`, `fd8b8d79…-home-768-01..03`, `b2fa7d09…-home-390-01..04`, `f9ad8c3b…-home-320-text200-01..09`)
- Value hero | authored | shop.com value card, scaled down | At 1440 the ~28px headline sits beside a 34rem yellow card with an empty middle. This was accepted in round 1, so it is not reopened; tightening that gap would help.
- "Kategori ›" tiles | authored | shop.com Categories tiles | **Material.**
  - At 390 the 10 tiles with name-above-4:3-photo run from about y 555 to about 1590, a full screen of tiles before any product. "Terbaru" starts around y 1650.
  - At 320/200% the tiles fill slices 02–06, about four screens.
  - shop.com's phone tiles are about 72px tall, so all 10 take about 400px.
  - Consequence: on the primary mobile surface, browsing tiles crowds out the product shelves, against the section map's own row 4 ("short tinted tiles ~72px phone").
  - Fix: below 700px show 6 tiles with a short photo strip (fixed ~72px height, `object-fit: contain`). The full list is already on `/categories` and in the chip row.
- Desktop tiles (1440) | authored | shop.com tinted tiles | The 64px white inset is too small for some photos; the Perkakas plug almost disappears white on white. Enlarge the inset to 72–80px or let the photo bleed to the tile edge.
- "Terbaru ›" and department shelves | authored | shop.com Beauty shelf | None.
  - At 1440, 6.5 cards are visible with a cut card at the edge.
  - At 390 the third card peeks about 33px.
  - Prices align across each row; titles are regular weight, prices 600.
  - At 320/200% each card shows as about 85% wide, so the next one peeks in.

**Search / listing** (`71b3b511…`, `e539555a…`, `41a37444…`, `0e1bd073…-01..17`, `0eda6f57…`, `81f1433a…`, `7554e96f…`, `92b4704d…`)
- Title and count | authored | shop.com "Results" | None.
- Active filter chip | authored | shop.com chip | None.
- Filter disclosure | authored | adapted from the shop.com filter sheet, recorded deviation | None.
  - The four selects sit in one row at 1440, 2×2 at 768 and stacked at 390.
  - "Terapkan filter" is the only filled action.
- Results grid | authored | shop.com search grid | None.
  - 5 columns at 1440, 3 at 768, 2 at 390, 1 at 320/200%.
  - The "Paket 2 pcs Kaos Kata Lucu Sindiran …" names show their distinguishing words in full, and prices align across rows.
- Pagination | authored | none | None.

**PDP** (`bc2effc7…`, `00c6b847…`, `5246c805…`, `b6b3ad67…`) **and PDP bundle** (`a85e3ab9…`, `b1bab246…`, `9b34ad0a…`, `43cc1a8d…`, `46d89c1d…`, `3135d8d9…`)
- Task header | authored | none | None.
- Media panel | authored | shop.com PDP media panel | None. At 1440 the empty left column below the media is a full-page capture artifact, because the media is sticky in a live browser.
- Buy box | authored | shop.com buy box | "Lihat keranjang" shows before anything has been added; show it only after a successful add.
- Contents list with fold | authored | shop.com description fold | When open, the "Sembunyikan barang lainnya" toggle sits between item 3 and item 4. That is acceptable, but moving the toggle below the list would read better.
- Spesifikasi and accordions | authored | shop.com accordions | None (the empty "Spesifikasi" is an accepted, test-checked heading).

**Cart, empty** (`7cd5a859…`, `871c54c7…`, `40d700da…`, `3b1bae43…`) | authored | shop.com empty cart | None. Centred heading, text and one filled pill.

**Cart, filled** (`4567ff2f…`, `5802a125…`, `24e17e70…`, `ecb1c43a…`)
- Line | authored | none (spec forbids boxed rows) | None.
- Summary | authored | none (white summary card per R7) | None. The 52px checkout pill is still readable at 320/200%.

**Categories** (`65e1c0b3…`, `3520b888…`, `666bf4a0…`, `0a4e6e0d…-01..07`) | authored | no reference (shop.com category pages could not be captured) | Same small-inset issue as the home desktop tiles. The 1440 grid ends with a two-tile row, which is acceptable.

**Help** (`603301b6…`, `799a4b55…`, `c56a5cb6…`, `11721880…`) | authored | shop.com help centre | None. Centred column, topic cards top-aligned, one filled chat action. At 320/200% the chat buttons stay inside the card.

**Sign-in, default and error** (`0ba0553c…`, `d1f24aee…`, `e297cb8b…`, `7c24aca5…`, `ad4b217f…`, `34b0c10f…`, `f0b455b1…`, `f7adea3e…`) | authored | shop.com card and pill language | None.
- The 52px "Masuk" pill clearly leads; "Batal" is a quiet text action.
- The error alert keeps its focus ring, and both fields show the error edge.
- At 320/200% the alert wraps readably.

**Not found** (`f630dc19…`, `7798c907…`, `a3d7e240…`) | authored | shop.com recovery state | None.

**Reference transfer**
I compared the renders with `56ae2fb1…`/`44fc7af5…` (home, 2026-10-23), `95bdbd15…`/`24f5fb56…` (home, 2026-10-22), `c9edea82…`/`52a31a5d…`/`2d2dc596…` (PDP), `c8a1c9a0…`/`488cca11…`/`bbf0d8af…` (search and filters), `f256fbf0…`/`9f3fa1c5…` (cart) and `27b2df7e…`/`6c377b87…` (help).

- **Hierarchy:** carried over everywhere except the phone home. There, shop.com's short category tiles followed by an early product shelf became tall photo tiles that push the shelves down.
- **Rhythm:** about 48px between sections, and shelf headings carry a "›" link, as on shop.com.
- **Imagery:** real catalog photos on white 20px media. Some seller images are washed-out marketing composites (Jig saw, Laundry, Penghilang Bau); that is owner content, not a layout fault.
- **Density:** matches the reference at 768 and 1440.
- **Skipped sections:** stores, the wordmark marquee and editorial collections are left out with stated reasons, which is justified.
- **Research and rationale:** sufficient.
- **Evidence gaps:** the multi-option PDP option pills (R3/R6) remain unverified because no published multi-option product exists. Category pages have no reference. Neither is a visual defect, but neither is proven.

Most important change: on phones, cut the home "Kategori" block to about 400px (6 short tiles with a fixed ~72px photo strip, full list behind "Kategori ›") so the first product shelf starts within the second screen at 390.

Verdict: REVISE