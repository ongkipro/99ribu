Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/categories-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 3cec528df65726c9
Images-SHA: 6a5d0846bc2ac882
Output-SHA: 3216c0d9f147778c

Paduka Ongki, verdict-nya **REVISE**. Saya sudah membuka ke-192 gambar. Ada dua masalah yang mengganjal: halaman `/categories` cuma menampilkan 4 dari 9 departemen, dan dua capture 390 rusak karena dock menutupi konten. Review lengkapnya di bawah dalam English, sesuai format yang diminta. Ringkasannya juga tersimpan di `/home/ongki/.claude/plans/you-review-a-web-recursive-hickey.md`.

## Sections, top to bottom

**Shared shell**
- Header and omnibox | authored | shop.com white pill omnibox (95bdbd15 home-1440) | none; the 44px purple submit keeps clear space even at 320/200%.
- Department chip row | authored | shop.com chip row (24f5fb56 home-390) | at 1440 the clipped last chip "Otomo…" sits right against the edge fade; leave a whole chip's width of fade, or end the row on a full chip.
- Footer | authored | shop.com columned footer, reduced to the contract's one "Bantuan" column (R9) | at 320/200% "Cara pesan dan pengembalian" and "Privasi data pesanan" are only about 4px apart visually; add an 8px row gap.
- Mobile dock | authored | shop.com active grey pill shown as lavender (R10) | none in the correct captures; see evidence finding 2.

**Home**
- Hero and fixed-price card | authored | none; this is 99ribu's own price-rule anchor | none.
- "Pilih kategori" tiles | authored | shop.com department shelves, without the mosaic | none; the lavender card with a white photo inset reads as a category, not a product.
- "Mulai dari pilihan ini" shelf | authored | shop.com 1:1 cards (c8a1c9a0 search-1440) | at 768, one-line titles leave a blank line above the contents (see finding 3).
- "Sebelum memesan" | authored | none | none; the text starts on the second card column.

**Search and listing**
- Title and count | authored | shop.com "Results" heading | none.
- Active-filter chip | authored | shop.com dropdown chips | none.
- Filter panel | authored | shop.com filter sheet (bbf0d8af), as an in-flow, non-modal panel | none; four fields in one row at 1440, 2×2 at 768, stacked at 390.
- Results grid | authored | shop.com 6-column grid, shown as 5 columns | blank line under one-line titles ("Paket Ibadah Pria Muslim", "Paket Glowing Lengkap 3-in-1"); fix in finding 3.
- Pagination | authored | none | none.

**PDP**
- Media panel | authored | shop.com pdp-1440 white 28px panel | none.
- Buy box | authored | shop.com narrow buy box: title, price, then a 52px primary pill | when "Lihat 4 barang lainnya" is open the label stays the same; change it to "Sembunyikan" when open.
- Spesifikasi and accordions | authored | shop.com hairline accordions with chevrons | "Spesifikasi tambahan belum tersedia" is an empty section. It is an accepted, test-checked deviation, so it is not a fail.
- "Deskripsi" opened | authored | shop.com Description section | the copy repeats the "Isi yang diterima" list in a different order. This is catalog content for the owner to fix, not a layout problem.

**Cart**
- Empty cart | authored | shop.com cart: centred heading, one line, one primary pill (f256fbf0, 9f3fa1c5) | none.
- Filled cart: line, summary and checkout | authored | R7: unboxed line, white 20px summary card | none; "Lanjut ke checkout" is the only filled action at every width.

**Help**
- Help topics | authored | help.shop.app 2-up cards in a centred column (27b2df7e) | none; the short "Pengembalian" card is top-aligned.
- Chat card | authored | help.shop.app "Need more help?" support entry | the chat card's bottom padding at 1440 is about 60px under the disclosure; cut it to the card's 24px padding.

**Sign-in (`/masuk`) and error state**
- Card, fields and actions | authored | centred white raised card (R8) | none. The error alert holds the focus ring and wraps readably at 320/200%.

**Not found**
- Recovery state | authored | shop.com empty state | none.

**Categories**
- Department index | authored layout, wrong content scope | shop.com department list | only 4 departments are tiles; 5 are hidden behind a plain-text "Kategori lainnya" disclosure (finding 1).

## Findings

1. **`/categories` hides most of the catalog (material).** The renders 65e1c0b3, 666bf4a0, 3520b888 and 0a4e6e0d each show 4 tiles and then a small "Kategori lainnya ⌄" text row. The chip row on the same page lists more departments than that.
   - Source: `src/app/(storefront)/categories/page.tsx:38-60` uses `featuredDepartments(identity, 4)` and puts every other department in a `<details>` list of plain links.
   - Consequence: listing departments is the page's only job, and it shows fewer than the header does. It also puts the "Kategori" dock tab behind a click and breaks the tile treatment.
   - Fix: render every department as a tile (photo, or the labelled placeholder) and drop the disclosure.
2. **Two captures are broken evidence.** In `7554e96f search-active-390-02` and `92b4704d search-filters-open-390-01/02` the fixed dock is drawn mid-page. It covers "Terapkan filter" and the first product row, and each page ends in a blank spacer.
   - `41a37444 search-390` was captured with the tall-viewport method and does not have this problem, so the method was not applied to these two state captures.
   - Consequence: the filter-open phone state, which is the closest transfer of shop.com search-filters-390, has no clean render.
   - Fix: recapture both with the same method.
3. **Gap under one-line titles (minor).** The five-row card subgrid lines prices up across a row. The cost is that a one-line title is followed by an empty line before its contents, for example at 768 (e539555a-04, fd8b8d79-03).
   - Fix: put title and contents in one subgrid row, so the spare space falls above the price instead of between title and contents.
4. **PDP disclosure label (minor).** "Lihat 4 barang lainnya" keeps the same label after opening; only the chevron flips.

## How the renders compare with the references

- **Hierarchy and density.** The off-white canvas with white raised surfaces, the pill omnibox, the hairline chips and the 1:1 card media with a large radius all match shop.com home-1440 and search-1440.
- **PDP.** The PDP keeps shop.com's order of title, price, primary pill and hairline accordions. "Tambah ke keranjang" sits at about y≈827 inside the first 900px at 1440.
- **Imagery.** It is real catalog photography with no stand-in drawings.
- **Decoration.** None of the template signals turned up: no dark hero, no eyebrow labels, no monospace labels, no unsourced stat claims, and no arrows on every button.
- **Intended departures.** The visible "/ pilihan lengkap" basis, 5 columns instead of 6, native select filters and no ratings rows are recorded in the contract, so they are not findings.
- **Missing evidence.** There is no multi-option PDP render, so the R3/R6 option pills are still UNVERIFIED. shop.com category pages were never captured as a reference, so finding 1 is judged on task clarity rather than reference fidelity.

**Most important change:** show every department as a tile on `/categories` instead of hiding five behind "Kategori lainnya", then recapture `search-active-390` and `search-filters-open-390` with the tall-viewport method.
**Verdict: REVISE**

This is visual acceptance only, not interaction or accessibility test evidence. I didn't change any source files.