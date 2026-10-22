Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 7136c58c27a17ad3
Images-SHA: a6f5af79a8422011
Output-SHA: c8d3fd298eb65658

Semua 159 slice sudah kubuka, termasuk 17 referensi shop.com. Hasilnya **REVISE**. Masalah utamanya bukan layout, tapi isi katalog yang ter-capture: produk fixture/test mendominasi home dan listing, dan PDP yang di-capture juga produk fixture. Review lengkap di bawah dalam bahasa Inggris.

---

## Section-by-section

**Shared shell (all storefront pages)**
- Env banner + header | authored | shop.com white pill omnibox (`894181…home-1440-01`), the soft-shadow pill with a 44px purple round submit matches `95bdbd…1440-01` | At 320/200% the grown submit button squeezes the input until the placeholder clips to "Cari produk" with the "k" cut off (`f9ad8c…home-320-text200-01`, same on search/cart/help/masuk). Shorten the placeholder at this size or let the field keep about 6ch before the button grows.
- Department chip row | authored | shop.com chip row (`24f5fb…390-01`) with the end fade and the charcoal current chip ("Semua produk" on `/search`) | none needed.
- Footer | authored | shop.com columned footer reduced to one "Bantuan" column | none.
- Mobile dock | authored | shop.com active grey pill moved to lavender (`b2fa7d…home-390-02`, `40d700…cart-390-02`) | none in design. The evidence is broken, though; see "Evidence defects".

**Home** (`894181…-01/02`, `fd8b8d…-01..04`, `b2fa7d…-01..04`, `f9ad8c…-01..11`)
- Hero + fixed-price card | authored | the 99ribu-owned yellow price card | none (accepted round-1 hero).
- "Pilih kategori" tiles | authored | shop.com department shelf, using lavender category cards that read differently from product cards | none. Labels share one baseline at 1440/768, and the tiles drop to one per row at 320/200%.
- "Mulai dari pilihan ini" shelf | generic in content, authored in layout | shop.com product grid | **Six of the eight cards are fixtures:** "Contoh Paket Kaos dan Krim", "Contoh Kaos", "SYNTHETIC cream-pack [s21-d2ef0bc3]", "SYNTHETIC shirt [s21-d2ef0bc3]". All six show "Foto belum tersedia". At 1440 the first visible row is four empty lavender slots directly under four real-photo tiles, so the page's most important shelf looks unfinished. The footer on the same page says "Katalog dan foto produk asli", which contradicts it. Fix the data/capture source (exclude test-owned rows from the public reader, or capture against a DB without integration fixtures). Do not change the styling.
- Card price alignment | authored | shop.com card rhythm | Prices do not line up across a row when the contents text has one line in one card and two in the next. At 390 row 1 the prices sit at y≈534 vs 516 (`b2fa7d…-02`). Reserve two lines for contents the same way titles are reserved, or pin the price row with subgrid.
- "Sebelum memesan" | authored | none (99ribu-specific) | none. It aligns to the second card column at 1440.

**Search / listing** (`71b3b5…`, `0eda6f…`, `e53955…`, `41a374…`, `7554e9…`, `81f143…`, `92b470…`, `0e1bd0…`)
- Title + count | authored | shop.com 18px "Results" | none.
- Active filter chip | authored | shop.com chip | none.
- Filter disclosure / panel | authored | shop.com filter sheet transferred as an in-flow panel | none new. At 768 with the panel open the first product starts at y≈711, but this is an already-accepted R4 trade-off.
- Results grid | authored | shop.com 6-col grid → 5-col | Same price misalignment, and it shows at every width: "Contoh Paket 2 Kaos" sits at 957 vs 977 (1440 active), 195 vs 215 (768 active) and 736 vs 754 (390 active); the "SYNTHETIC shirt" row sits at 1264 vs 1284 (1440). The round-10 title reservation did not finish this job, because contents is now the variable line. The same fixture rows also lead the default "Semua produk" order.
- Card titles on the "kaos" query | authored | — | Content: about 20 cards read "Paket 2 pcs Kaos Kata Lucu Sindiran…" and the two-line clamp cuts every one before the slogan that tells them apart. This is mainly a catalog naming issue; flag it to the catalog owner.
- 320/200% single column | authored | — | The two-line title reservation leaves an empty line under one-line titles ("Contoh Kaos", `0e1bd0…-04`) even though no neighbour shares the row. Drop the reservation when the grid is one column.
- Pagination | authored | — | none.

**PDP** (`bc2eff…`, `00c6b8…`, `5246c8…`, `b6b3ad…`)
- Buy box order, 52px primary, pill quantity, chevron accordions | authored | shop.com PDP (`c9edea…`, `52a31a…`) | none in what is shown.
- Media panel | owner content | photo slot with a shot brief | Acceptable as a placeholder. The real problem is that the captured product is the fixture "Contoh Paket Kaos dan Krim". The round 8–10 PDP changes therefore have no render at all: the "Deskripsi" accordion, the "Lihat N barang lainnya" disclosure, sticky media and the nowrap on hyphenated tokens. Capture a real Berlapak bundle with more than three items and a long description.

**Cart, empty** (`7cd5a8…`, `871c54…`, `40d700…`, `3b1bae…`)
- Centred heading, one line and one primary pill | authored | shop.com empty cart (`f256fb…`, `9f3fa1…`) | none.

**Cart, filled** (`4567ff…`, `5802a1…`, `24e17e…`, `ecb1c4…`)
- Unboxed line + white 20px summary card + 52px checkout pill | authored | R7 | none in design. At 390 the summary rows are not visible in the evidence (see "Evidence defects").

**Help** (`603301…`, `799a4b…`, `c56a5c…`, `117218…`)
- Topic cards, 2-up plus a full-width card | authored | help.shop.app (`27b2df…`, `6c377b…`) | none. The top alignment fix holds.
- Chat card | authored | help "Need more help? / Chat with us" | The hours line renders as dark semibold small text, not the muted line the brief describes, so it competes with the H2. Use regular weight in the muted colour.

**/masuk** (`0ba055…`, `ad4b21…`, `d1f24a…`, `34b0c1…`, `e297cb…`, `f0b455…`, `7c24ac…`, `f7adea…`)
- Centred 20px card, 48px fields, focused rounded alert, invalid edges | authored | R8 centred card | none. At 320/200% the alert wraps in readable lines and its icon scales.

**Not found** (`f630dc…`, `7798c9…`, `a3d7e2…`)
- Centred recovery with one primary | authored | shop.com empty state | none.

## Evidence defects (these are not design defects)
- The 390/768 slices still come from full-page captures that include the fixed dock. In `24e17e…cart-filled-390-02` the dock sits exactly over the summary rows ("1 pilihan lengkap / Rp99.000", "Ongkir"), so R7 at 390 cannot be verified. The tall-viewport method used for 320 was not applied at 390.
- No `/categories` render exists, but round 9 says the tile change ships there too.
- The option pills (R3/R6) are still UNVERIFIED, as already recorded.

## Reference transfer
Hierarchy, rhythm and density do follow the references:
- an off-white canvas with white raised pills;
- a department chip row above the content;
- a full-width grid with no sidebar, using 1:1 rounded media and a 600-weight title;
- a narrow buy box with a full-width pill primary;
- centred empty states;
- a 720px help column of 2-up cards.

I found no template signals: no dark hero, no eyebrows, no monospace, no icon-tile card rows, and no unsourced claims. The research and transfer rationale are documented and supported.

The gap is imagery. The shop.com home and listing are photo-led (`95bdbd…`, `c8a1c9…`). These renders lead with empty placeholder slots, and the cause is test data in the captured catalog, not owner photos that have yet to arrive.

Most important change: Recapture home, listing and PDP from a catalog without the `Contoh…`/`SYNTHETIC…[s21-…]` fixture rows, including a real long-bundle PDP, then fix the price-row misalignment that varying contents length causes.

Verdict: REVISE