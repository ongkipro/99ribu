Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s22/cart-1024.png, docs/spec/design/renders/s22/cart-1440.png, docs/spec/design/renders/s22/cart-390.png, docs/spec/design/renders/s22/cart-768.png, docs/spec/design/renders/s22/cart-empty-1024.png, docs/spec/design/renders/s22/cart-empty-1440.png, docs/spec/design/renders/s22/cart-empty-390.png, docs/spec/design/renders/s22/cart-empty-768.png, docs/spec/design/renders/s22/cart-empty-expired-390.png, docs/spec/design/renders/s22/cart-expired-390.png, docs/spec/design/renders/s22/cart-nojs-390.png, docs/spec/design/renders/s22/cart-pending-390.png, docs/spec/design/renders/s22/cart-pending-detail-390.png, docs/spec/design/renders/s22/cart-publication-detail-390.png, docs/spec/design/renders/s22/cart-publication-review-390.png, docs/spec/design/renders/s22/cart-quote-expired-390.png, docs/spec/design/renders/s22/cart-quote-expired-detail-390.png, docs/spec/design/renders/s22/cart-retired-offer-390.png, docs/spec/design/renders/s22/cart-session-denied-390.png, docs/spec/design/renders/s22/cart-stock-conflict-390.png, docs/spec/design/renders/s22/cart-stock-detail-390.png, docs/spec/design/renders/s22/cart-text-200-320.png, docs/spec/design/renders/s22/font-heading-390.png, docs/spec/design/renders/s22/pdp-1024.png, docs/spec/design/renders/s22/pdp-1440.png, docs/spec/design/renders/s22/pdp-390.png, docs/spec/design/renders/s22/pdp-768.png, docs/spec/design/renders/s22/pdp-back-1440.png, docs/spec/design/renders/s22/pdp-back-390.png, docs/spec/design/renders/s22/pdp-back-list-1440.png, docs/spec/design/renders/s22/pdp-back-list-390.png, docs/spec/design/renders/s22/pdp-back-nojs-390.png, docs/spec/design/renders/s22/pdp-options-1440.png, docs/spec/design/renders/s22/pdp-options-390.png, docs/spec/design/renders/s22/pdp-options-nojs-390.png, docs/spec/design/renders/s22/pdp-text-200-short-320.png, docs/spec/design/renders/s22/pdp-unavailable-390.png, docs/spec/design/renders/s22/pdp-unknown-390.png, docs/spec/design/renders/s22/pdp-version-conflict-390.png
References: docs/spec/design/refs/carbon-table/1440-top.png, docs/spec/design/refs/ikea-id/1440-top.png, docs/spec/design/refs/ikea-id/390-top.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png, docs/spec/design/renders/s08/product-1440.png, docs/spec/design/renders/s08/product-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 7ffb1cde4c25de05
Images-SHA: 588582a92822f5c2
Output-SHA: 9038a53a1bc6c877

Status: I opened all 88 listed slices, which come from 39 renders and 6 references (8 reference slices). The prompt's SHA256 matches 481e9a15…2498. I edited nothing. Four slices are blank page tails: `cart-768-02`, `cart-empty-768-02`, `pdp-1024-02` and `pdp-back-nojs-390-03`.

## Section review — PDP (`pdp-*`, `font-heading-390`)

Sample-data strip | authored | none | Keep it until real catalog data replaces the fixture; no visual change needed.
Task header (Katalog/Kembali, wordmark, cart + count) | authored | S08 `product-390/1440` focused header | At ≥1024 (`pdp-1440-01`, `pdp-back-1440-01`) the cart is icon-only. Add the visible "Keranjang" label that S08 wide and the S21 shopping header both use.
Breadcrumb | authored | S08 breadcrumb | None needed; the slash is quiet and the links are underlined.
Media slot + shot brief | authored (labeled owner-content slot, square, item-specific brief below) | S08 media-first; Dawn product-unit clarity | Replace it with the real square photograph before publication. It isn't a design failure: the layout is built around the photo.
Identity + price + basis | authored | S08 title→price | None. Rp99.000 at 20/28 under a 24/32 title; "/ pilihan lengkap" stays adjacent.
Option radios + "Lihat pilihan" (`pdp-options-*`, `pdp-unavailable-*`) | authored | S08 size chips adapted to complete-offer radios | Move the "Pilihan lengkap" legend from ~18px to the 16px content edge (390) and to the column edge (1440); it currently sits about 2px inside.
Contents + stock + quantity/add + Lihat keranjang | authored | S08 single purchase region | None. The region is in normal flow with one primary action. When unavailable, the add button is disabled with a text reason and the "Cari produk tersedia" recovery link.
State notices (nojs success, unknown, version conflict) | authored | none | Version conflict (`pdp-version-conflict-390-02`) says "Perubahan jumlah belum diterapkan" on an add action. Change it to "Tambahan belum diterapkan" so it describes what the buyer actually did.
Spesifikasi + shipping/returns disclosures | authored | S08 spec region | None. Missing facts are stated honestly. `font-heading-390` shows "Spesifikasi" intact at 100%; the apparent gap in downscaled renders is a resampling artifact.
200%/320 short (`pdp-text-200-short-320-01..04`) | authored | none | None. Back has its own row, brand and cart share the next, the slot stays square, and nothing is clipped.

## Section review — Cart (`cart-*`)

Shared header/search/categories | authored (S21 chrome) | IKEA dominant search | At 768/1024 (`cart-768-01`, `cart-1024-01`, `cart-empty-1024-01`) the icon-only cart shows no visible current-page state on the Cart page. Reuse the underline/weight indicator that 1440 applies to "Keranjang".
Title + "Lanjut pilih produk" | authored | Tokophi focused shell | None.
Parent line records | authored | S08 cart preview / receipt rows | In `cart-retired-offer-390-01`, the first thumbnail's "Foto belum tersedia" renders smaller and on 2 lines, while the same-size thumbnail below uses 3 lines at normal size. Use one missing-photo label size.
Line states (stock, retired, publication, pending) | authored | none | Pending (`cart-pending-390-01`, `cart-pending-detail-390-01`) shows "Menyimpan perubahan pilihan ini…" above a "Menyimpan…" button, the same message twice. Drop the sentence or neutralise the button label. Also capture the second line's retained "3" above the nav: in both captures its field sits under the fixed bar, so the claimed retained draft is not visible.
Summary column/block | authored | Tokophi/S08 recessed summary (56/44 at 1440, stacked below 1024) | On the closed record (`cart-expired-390-01/02`), "Catatan keranjang" still shows "Ongkir — Dihitung saat checkout" and "belum memesan stok". That is checkout-pending copy on a closed cart, which the contract says not to show. Omit the ongkir row or state that the record is closed.
Empty / expired-empty / session denied | authored | Tokophi single empty recovery, deliberately without Tokophi's Rp0 | `cart-empty-expired-390-01` says "Pilih produk…" twice in a row (notice, then empty state). Keep one. The expired/quote warning notices have no icon, unlike success (check) and unknown (triangle); add the same caution glyph for consistency.
Bottom tabs | authored | MW1 four labeled destinations | None. Keranjang is selected with purple, weight and text. At 200%/320 the tabs drop into normal flow as two rows (`cart-text-200-320-01`).
Footer | authored | S21 | None.

## Transfer and evidence

- **S08 product reference:** the task anatomy carries over. The wide media/decision split (568 media + decision column in a 1200 shell) and the mobile header → media → identity → option → contents → purchase order match `product-1440-01` and `product-390-01/02`. Current builds correctly drop S08's oversized title, its "Fashion" eyebrow and its duplicated price beside the add button, and keep the S21 type tokens.
- **Tokophi reference (`11946f9e7fad1ec5-390-01`):** the focused single-recovery empty state transfers. 99ribu correctly declines the payable "Rp0" summary and Tokophi's blue.
- **IKEA references (`ee576f953289514a-1440-top-01`, `69ce9ad898fe0316-390-top-01/02`):** they govern only the shared search-first header. The campaign carousel and the mobile header overlap are, correctly, not transferred.
- **Carbon reference (`aaccc28f84eb001b-1440-top-01`):** it has no bearing on PDP/cart, and I am not inventing one.
- **Template signals:** none present. There is no dark hero, no eyebrows, no icon-tile card rows, no arrows on buttons, no monospace and no unsourced claims. "·" appears only as a data separator in "2 pilihan · Rp198.000". The only boxed surfaces are the summary and state notices; there are no nested frames.
- **Capture limitation, not a defect:** fixed-nav full-page captures paint the bar over content at the initial viewport line. Examples are the struck-through footer link in `cart-stock-conflict-390-02` and footers hidden in `cart-session-denied-390-02` and `cart-empty-390-02`. Space is reserved below the bar, so at the end of scroll the content is visible. This does limit what the captures prove (see the pending item above).

The remaining items are copy and consistency polish. None blocks the hierarchy, the purchase task or brand fit.

Most important change: drop the checkout-pending "Dihitung saat checkout"/stock copy from the expired cart's "Catatan keranjang" summary so a closed cart never reads as payable.

Verdict: PASS