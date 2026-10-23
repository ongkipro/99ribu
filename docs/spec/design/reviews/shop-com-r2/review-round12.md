Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-768.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png, docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png, docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png, docs/spec/design/renders/shop-com-r2-20261022/categories-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/categories-390.png, docs/spec/design/renders/shop-com-r2-20261022/categories-768.png, docs/spec/design/renders/shop-com-r2-20261022/help-1440.png, docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/help-390.png, docs/spec/design/renders/shop-com-r2-20261022/help-768.png, docs/spec/design/renders/shop-com-r2-20261022/home-1440.png, docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/home-390.png, docs/spec/design/renders/shop-com-r2-20261022/home-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png, docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png, docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-390.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-768.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png, docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png, docs/spec/design/renders/shop-com-r2-20261022/search-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png, docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png, docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png
References: docs/spec/design/references/shop-com/2026-10-22-cart/1440.png, docs/spec/design/references/shop-com/2026-10-22-cart/390.png, docs/spec/design/references/shop-com/2026-10-22-help/1440.png, docs/spec/design/references/shop-com/2026-10-22-help/390.png, docs/spec/design/references/shop-com/2026-10-22-home/1440.png, docs/spec/design/references/shop-com/2026-10-22-home/390.png, docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png, docs/spec/design/references/shop-com/2026-10-22-pdp-390.png, docs/spec/design/references/shop-com/2026-10-22-search-1440.png, docs/spec/design/references/shop-com/2026-10-22-search-390.png, docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 3a5c331d81d8dac4
Images-SHA: 98cce887ab698986
Output-SHA: d83b080c0d98907a

Paduka Ongki, verdict-nya **REVISE**. Hampir semua bagian udah authored dan nyambung ke R1–R12. Yang bikin belum lolos: kartu hasil pencarian "kaos" nggak bisa dibedain satu sama lain, dan jarak antar baris grid jauh lebih longgar dari kontrak R4. Opsi pill R3/R6 juga masih belum ada render-nya. Semua 196 gambar udah saya buka, nggak ada yang gagal dibuka. Ini review visual aja, bukan bukti interaksi atau aksesibilitas.

## Section review

```
Environment banner | authored | none (99ribu-specific) | Fine; wraps to two centred lines at 390 without clipping.
Header + omnibox | authored | shop.com white pill omnibox, no border, soft shadow (R2) | None needed; 320/200% keeps "Cari produk" readable beside a 44px+ purple button.
Department chip row | authored | shop.com chip row (R3) | Add the end-edge fade cue on narrow widths too; at 390/320 the row just cuts "Keca…" with no visible fade.
Home hero | authored | none (99ribu fixed-price card) | At 1440 the ~28px H1 sits in a ~450px empty band left of the yellow card; size the H1 up or give it the card's height. Recorded as an accepted deviation; flagged, not blocking.
Home "Pilih kategori" tiles | authored | shop.com department shelf, adapted to one photo per tile | None; names in each row share a baseline at 1440/768/390.
Home "Mulai dari pilihan ini" shelf | authored | shop.com shelf + "Semua produk ›" pill (R12) | At 768 the 2-up cards are ~350px squares, so 8 products take 4 screens; allow 3 columns at tablet.
Home "Sebelum memesan" | authored | none | Fine; text starts on the second card column at 1440.
Footer | authored | shop.com columned footer, reduced (R9) | "Katalog dan foto produk asli" can read as a genuineness claim with no source; say "Katalog dan foto dari produk yang dijual" or similar.
Mobile dock | authored | shop.com active-pill indicator (R10) | None; the lavender pill plus text and weight mark Beranda/Kategori/Keranjang/Akun, and the cart badge holds at 320/200%.
Search heading + active filter chip | authored | shop.com "Results" + chip (R3/R4) | None.
Filter panel | authored | shop.com filter sheet, non-modal (R4) | None; one row at 1440, 2×2 at 768, stacked at 390; "Terapkan filter" is the only filled action.
Results grid | authored, with a task-clarity defect | shop.com 6-column search grid → 5 columns (R4/R5) | See finding 1 (indistinguishable "kaos" cards) and finding 2 (row gap).
Pagination | authored | none | Fine; the outline pill plus one muted line is centred.
/categories page | authored | none (no reference capturable) | The chip row marks no current item on /categories; mark "Semua produk" or none consistently with the dock's "Kategori".
PDP task header + breadcrumb | authored | accepted S22 task header | None.
PDP media panel | authored | shop.com white media panel (R6) | None; the empty band under the media in full-page shots is the sticky column.
PDP buy box | authored | shop.com narrow buy box (R6) | None; title → price → contents → stock → quantity → 52px "Tambah ke keranjang" sits inside the first ~850px at 1440.
PDP "Isi yang diterima" disclosure | authored | shop.com "Read more" collapse | None; the label switches to "Sembunyikan barang lainnya" with an up-chevron when open.
PDP Spesifikasi + accordions | authored | shop.com hairline accordions | Open "Deskripsi" shows raw "- 1pcs …" lines that repeat the contents list; render hyphen lines as a list or trim the duplicate (owner content, minor).
Cart empty | authored | shop.com empty cart (centred heading, text, one filled pill) | None.
Cart line | authored | none (spec: unboxed rows) | The line lists all 7 items while the PDP collapses after 3; at 320/200% that takes ~2.5 screens before the quantity. Reuse the PDP "Lihat N barang lainnya" disclosure.
Cart summary | authored | R7 white 20px card | None; at 390 "Dihitung saat checkout" right-aligns cleanly; at 320/200% values wrap under their labels without clipping.
Help topic cards | authored | help.shop.app 2-up cards (R11) | The short "Pengembalian" card leaves a hole next to "Ongkir dan pengiriman" at 1440/768. The reference stretches row cards to equal height; either way is acceptable. Not blocking.
Help chat card | authored | help.shop.app support entry | None; sentence-case pills, muted hours line, chevron scales at 320/200%.
/masuk default | authored | R1 raised card pattern | None; centred 28rem card, 52px pills, neutral copy.
/masuk error | authored | none | None; the alert wraps in readable lines at 320/200% and both fields carry the error edge.
Not found | authored | shop.com recovery state (R8) | None.
```

## Findings

1. **Search results can't be told apart (task clarity, material).** In `7554e96f814d67c8-search-active-390-07.png` two adjacent cards both read "Paket 2 pcs Kaos Kata Lucu Sindiran Bukan…". Under each, the contents line repeats the title ("2 × Kaos Kata Lucu Sindiran Bukan …"). The same happens at 768 (`81f1433ae3189a1a-search-active-768-05.png`) and 1440 (`0eda6f57d4c5059d-search-active-1440-02.png`: "Sindiran Bukan Orang Kaya…" next to "Sindiran Bukan Hewan…" only survives at 1440).
   - The user's job is to compare options and contents. Here the two-line title clamp keeps only the shared prefix, and the contents line adds no new information.
   - Fix: when a bundle's contents are just N × the titled item, replace the contents line with a count ("Isi: 2 kaos"). That frees one line, so the title can clamp at 3 lines on phones.

2. **Grid rhythm is much looser than R4 and the reference (density, reference fidelity).**
   - In `71b3b51172f2be14-search-1440-01.png` there are about 55–65px between a row's price line and the next row's media. Home 1440 and search 390 look the same.
   - The shop.com captures (`c8a1c9a03f2c268b-2026-10-22-search-1440-01.png`, `488cca110d71e931-2026-10-22-search-390-01.png`) put about 8–15px of air between rows, and R4 specifies a 12px gap.
   - The likely cause is the empty fourth subgrid row (stock note) plus the row gap. Fix: collapse the empty stock-note row when no card in the row needs it, and use the 12px row gap.

3. **Evidence gap (unchanged).** R3/R6 option pills still have no render. Also, `pdp-*` and `pdp-bundle-*` show the same product (Paket Borongan 7-in-1), so the "pdp" set adds no second state.

## Reference comparison

- **Matches:**
  - Canvas and raised white surfaces (R1): `894181cd6f0102a7-home-1440-01` against `95bdbd15314992d5-1440-01`.
  - Pill omnibox (R2) and pill chip row (R3).
  - Narrow buy box with a full-width primary action and hairline chevron accordions (R6): `bc2effc755f453fb-pdp-1440-01` against `c9edea82517b9a0c-2026-10-22-pdp-1440-01`.
  - Centred empty cart with one filled pill (R8): `7cd5a859d10e44c2-cart-1440-01` against `f256fbf064a79cee-1440-01`.
  - Centred help column with 2-up topic cards and the support entry last (R11): `603301b60cad0c85-help-1440-01` against `27b2df7ee91537b2-1440-01`.
- **Excluded as recorded:** the rail, the floating desktop omnibox, ratings, discount badges and Save/Share/Buy now are correctly left out.
- **Mismatches:**
  - Grid density (finding 2).
  - Department tiles use one photo each instead of shop.com's 2×2 mosaic. That is recorded and justified by the data.
- **Template signals:** none found. There are no dark heroes, eyebrows, mono labels, `A · B` labels, arrow-on-every-button, or unsourced stats.
- **Product photos:** the photos with embedded marketing text are owner catalog images, not stand-ins, so they aren't a design failure.

Most important change: on search cards, replace the contents line with an item count when the contents only repeat the title, and allow a 3-line title clamp on phones so same-family bundles can be told apart.

Verdict: REVISE