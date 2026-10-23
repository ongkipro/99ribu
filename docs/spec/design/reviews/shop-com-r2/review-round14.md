Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/categories-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 69bfdbde8fa60531
Images-SHA: d8531b12fe7ad362
Output-SHA: 3cb5e28c27427ff5

Paduka Ongki, saya sudah membuka ke-184 gambar. Hasilnya **REVISE**, karena satu masalah judul kartu di HP. Review lengkapnya di bawah (bahasa Inggris, sesuai format yang diminta).

---

### Section-by-section

| Section | Generic / authored | Look matched | Concrete fix |
|---|---|---|---|
| Environment banner + header (wordmark, omnibox, utilities) | authored | shop.com home omnibox: white pill with soft shadow and a round purple submit | Use one current-page treatment. On `/cart` "Keranjang" is purple **and underlined**; on `/masuk` "Akun" is purple with no underline. |
| Department chip row | authored | shop.com chip row ("Women / Men / Beauty…") with no thumbnails; fade at the end edge | None. The charcoal edge on "Semua produk" (search 1440/390) reads clearly as current. |
| Home hero + fixed-price card | authored (99ribu-specific price rule) | no shop.com equivalent; accepted round-1 hero | None new. The left half beside the small H1 at 1440 is already an accepted deviation. |
| Home "Pilih kategori" tiles | authored | stands in for shop.com's mosaic tiles; lavender card with the real department photo | None. Names and photos align by row at 768/1440, and tiles go to one per row at 320/200% without clipping. |
| Home "Mulai dari pilihan ini" shelf | authored | shop.com shelf "Women ›" → "Semua produk ›" | None. 4-up at 1440, 3-up with six cards at 768 (no orphan), 2-up at 390. |
| "Sebelum memesan" | authored | none (99ribu policy block) | None. At 1440 the text starts on the second card column. |
| Footer | authored | shop.com columned footer, reduced to "Bantuan" | None. |
| Mobile dock | authored | shop.com active-pill indicator, in lavender | None. The labelled 2×2 dock at 320/200% sits after the footer. |
| Search/listing filter panel | authored | shop.com search filter row, kept in-flow with native selects (accepted deviation) | None. One row of four at 1440, 2×2 at 768, stacked at 390; "Terapkan filter" is the only filled action. |
| Search product grid | authored | shop.com search cards: 1:1 media, 20px radius, 2/8 shadow, 600-weight price | **At 390, unclamp titles (or clamp at 5 lines).** See finding 1. |
| Active-filter chip | authored | shop.com removable chip | None. |
| PDP / bundle PDP buy box | authored | shop.com PDP 1440: white media panel, narrow buy box, 52px pill primary, hairline accordions with chevrons | None that is material. "Tambah ke keranjang" sits at y≈796 at 1440 (bundle), within the first screen. |
| PDP extra-contents disclosure | authored | accordion chevron pattern | None. The chevron stays inline after "Lihat 4 barang lainnya" even at 320/200%. |
| Cart, empty | authored | shop.com empty cart: centred heading, one line, one filled pill | None. |
| Cart, filled | authored | shop.com summary card treatment; lines unboxed per spec | None that is material. The summary is a 20px card with a full-width 52px "Lanjut ke checkout". |
| `/categories` | authored | no inspectable shop.com reference (documented gap) | None. 12 tiles at 4/4/2/1 per row by width; no chip falsely marked current. |
| Help | authored | help.shop.app: centred ~720px column, 2-up topic cards, support entry last | Put the chat disclosure chevron inline after its label at 390/320, as it already is at 768/1440 and on the PDP. At phone widths it is pinned to the card's right edge. |
| `/masuk` + error | authored | centred card (help topic card pattern) | None. The alert holds focus, both fields carry the error edge, and at 320/200% everything wraps without clipping. |
| Not found | authored | shop.com recovery state | None. |

No template signals were found. There is no dark textured hero, no eyebrow labels, no accent-word headline, no icon-tile card rows, no monospace, no unsourced stats, and no unsupported "resmi/terpercaya"-style claims. The unsourced "katalog dan foto produk asli" footer claim is gone. Imagery is real catalog photography in real-size slots, and nothing is generated or drawn.

### Findings

**1. Material: phone listing titles hide the only distinguishing words.**
- **Where:** `7554e96f814d67c8-search-active-390-02…06`, `92b4704dfc422c21-search-filters-open-390-02…06`, plus `41a37444f5889f28-search-390-04/05` ("…Necerel…", "…Pembersih…", "…Sablon Depan…").
- **What happens:** For "kaos", the shared prefix "Paket 2 pcs Kaos Kata Lucu Sindiran" uses about two of the three lines. Nearly all 24 cards then end in an ellipsis: "…Yang Ngutang Gaya Beba…", "…Saya Hanya Seorang…", "…Nakal Boleh Goblok Janga…", "…Bacot Sablon Depan…".
- **Why it matters:** The photos are almost identical (same model, black or white tee), so the title is the only way to tell cards apart. A mobile-first buyer can't compare options from the grid.
- **Contradiction with the direction note:** Round 14 says titles go to "up to three lines … so the 24 cards keep their distinguishing words". The 390 renders show that isn't true. At 768 and 1440 the same titles fit, which confirms this is a clamp problem, not a data problem.
- **Reference check:** shop.com does clamp titles to one line, but its names are short and its photos differ, so that clamp doesn't transfer here.

**2. Minor: standalone text links are styled two ways.**
- **Underlined:** "Lihat keranjang" (PDP), "Pengiriman dan pengembalian" (cart summary), "Cara pesan dan pengembalian" (home), "Lihat paket campuran" (price card).
- **Not underlined:** "Lanjut pilih produk", "Semua kategori ›" and "Lihat 4 barang lainnya".
- **Why it matters:** Round 14 says UI links drop the underline outside running prose, so one role currently has two treatments. Pick one rule and apply it everywhere.

**3. Minor: header current-page state** differs between `/cart` (underline) and `/masuk` (colour only). Covered in the table.

**4. Minor: help chat disclosure chevron** is pinned to the right edge at 390/320 (`c56a5cb6e1f10729-help-390-02`, `11721880fea1d6e7-help-320-text200-06`), while the PDP pattern keeps it inline. Covered in the table.

**Owner content, not a design defect:** On the bundle PDP, the open "Deskripsi" (`46d89c1d6a760cb4-pdp-bundle-open-1440-01`) repeats the seven-item "Isi yang diterima" list word for word.

### Reference transfer

- **Hierarchy:** The shop.com PDP 1440 (`c9edea82517b9a0c…`) leads the buy box with title → price → options → quantity → full-width pill. 99ribu's `bc2effc755f453fb-pdp-1440-01` keeps that order, and the bundle version (`a85e3ab921eb12cc`) keeps it with three items shown before the fold.
- **Rhythm and density:** shop.com search (`c8a1c9a03f2c268b`) is a dense 6-up grid with tight card text. 99ribu uses 5-up plus a filter panel (`71b3b51172f2be14-search-1440-01`), with prices aligned across each row. That fits the R4 contract.
- **Imagery:** shop.com mosaic tiles use editorial lifestyle photos. 99ribu has one product photo per department inside a lavender card. This is a documented deviation and reads clearly as a category, not a product.
- **Help:** help.shop.app (`27b2df7ee91537b2`, `6c377b87417f998f`) uses a centred column, 2-up cards and the support entry last. 99ribu matches this (`603301b60cad0c85`, `c56a5cb6e1f10729`).
- **Empty cart:** shop.com (`f256fbf064a79cee`) shows a centred heading, one line and one filled pill. 99ribu matches at every width.
- **Filter sheet:** shop.com (`bbf0d8aff568c306`) uses a modal sheet. 99ribu deliberately uses an in-flow panel with native selects; the rationale (tested no-JS controls) is recorded.
- **Option pills (R3/R6):** No published multi-option product exists, so these remain UNVERIFIED by data. That is a documented gap, not a design defect.

Research and transfer rationale are present and specific. The only rationale contradicted by the renders is the round-14 claim behind finding 1.

**Most important change:** In the phone two-column grid, show product titles in full or clamp at 5 lines, so same-family products can be told apart. The card subgrid already keeps prices aligned per row.

**Verdict: REVISE**

This is visual acceptance only, not interaction or accessibility test evidence. A short summary is also saved in `/home/ongki/.claude/plans/you-review-a-web-typed-bumblebee.md`.