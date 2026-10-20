Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s22/cart-1024.png, docs/spec/design/renders/s22/cart-1440.png, docs/spec/design/renders/s22/cart-390.png, docs/spec/design/renders/s22/cart-768.png, docs/spec/design/renders/s22/cart-empty-1440.png, docs/spec/design/renders/s22/cart-empty-390.png, docs/spec/design/renders/s22/cart-expired-390.png, docs/spec/design/renders/s22/cart-nojs-390.png, docs/spec/design/renders/s22/cart-pending-390.png, docs/spec/design/renders/s22/cart-publication-detail-390.png, docs/spec/design/renders/s22/cart-publication-review-390.png, docs/spec/design/renders/s22/cart-quote-expired-390.png, docs/spec/design/renders/s22/cart-quote-expired-detail-390.png, docs/spec/design/renders/s22/cart-retired-offer-390.png, docs/spec/design/renders/s22/cart-session-denied-390.png, docs/spec/design/renders/s22/cart-stock-conflict-390.png, docs/spec/design/renders/s22/cart-stock-detail-390.png, docs/spec/design/renders/s22/cart-text-200-320.png, docs/spec/design/renders/s22/pdp-1024.png, docs/spec/design/renders/s22/pdp-1440.png, docs/spec/design/renders/s22/pdp-390.png, docs/spec/design/renders/s22/pdp-768.png, docs/spec/design/renders/s22/pdp-back-1440.png, docs/spec/design/renders/s22/pdp-back-390.png, docs/spec/design/renders/s22/pdp-back-list-1440.png, docs/spec/design/renders/s22/pdp-back-list-390.png, docs/spec/design/renders/s22/pdp-back-nojs-390.png, docs/spec/design/renders/s22/pdp-options-1440.png, docs/spec/design/renders/s22/pdp-options-390.png, docs/spec/design/renders/s22/pdp-options-nojs-390.png, docs/spec/design/renders/s22/pdp-text-200-short-320.png, docs/spec/design/renders/s22/pdp-unavailable-390.png, docs/spec/design/renders/s22/pdp-unknown-390.png, docs/spec/design/renders/s22/pdp-version-conflict-390.png
References: docs/spec/design/refs/carbon-table/1440-top.png, docs/spec/design/refs/ikea-id/1440-top.png, docs/spec/design/refs/ikea-id/390-top.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png, docs/spec/design/renders/s08/product-1440.png, docs/spec/design/renders/s08/product-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 1ab3eff14e6d04b1
Images-SHA: 39614d8f97f6aa17
Output-SHA: bc13fa36ef4ee851

Paduka Ongki, saya sudah buka ke-80 gambar satu per satu. Hasilnya REVISE: ada tiga masalah yang benar-benar terlihat dan satu bukti visual yang kurang. Ini review visual saja, bukan bukti interaksi atau aksesibilitas. Saya tidak mengubah file apa pun selain catatan rencana.

## Section lines (top to bottom)

**PDP: 1440 / 1024 / 768 / 390, back, options, no-JS, states**
- Notice strip "Data contoh…" | authored | the S08 prototype label | none needed. It's honest and doesn't compete with the task.
- Task header (Back / wordmark / cart) | authored | S08 `product-1440/390` focused header | none needed. The Back label changes correctly between "Katalog" and "Kembali" depending on where the buyer came from. The count badge shows at 1, 2 and 3.
- Breadcrumb "Semua produk   Paket" | generic | none | **add a "/" or chevron separator.** Right now the two underlined links read as sibling links, not a path. The S08 reference uses "Fashion / Kemeja lengan panjang".
- Media slot and brief | authored | the honest owner-photo slot from the contract | none needed. The square slot reads "Foto belum tersedia" and the item-specific shot brief sits below it, sized like the real photo will be. This is not a fake drawing.
- Identity/price block | authored | S08 decision column | none needed. Price is 24/32 on desktop and 20/28 on mobile, with "/ pilihan lengkap" beside it. There's no strikethrough, rating or scarcity.
- Option radios with "Lihat pilihan" (`pdp-options-1440`, `-390`, `-nojs-390`) | authored | S08 size chips, adapted to native radios plus a form submit | none required. The extra step is explained in one line and works without JS. The outlined secondary button is placed correctly between the choice and its contents.
- "Isi yang diterima" and stock line | authored | the bundle-contents contract | **check "Spesifikasi" at 100%.** In the 390/768/1024/1440 slices it still looks like "Spesifi kasi". At 200% (`pdp-text-200-short-320-03`) it renders cleanly. Confirm at pixel level that the round-12 ligature fix applies at the base size.
- Quantity and "Tambah ke keranjang" | authored | S08 single purchase region, kept in normal flow | none needed. One filled purple primary; the input and button share a 44px+ height.
- Success notice (`pdp-back-nojs-390-02`) | authored | none | none needed. It names the exact product, option, quantity and Rp99.000.
- Unknown result (`pdp-unknown-390-02`) | authored | none | none needed. The caution style (peach background, brown rule, warning icon) is clearly not success. There's one retry action and one cart link, with no duplicate below.
- Version conflict (`pdp-version-conflict-390-02`) | authored | none | optional: shorten the 4-line red message. It's the only red block on the page and reads heavier than the actual risk.
- Unavailable option (`pdp-unavailable-390-01/02`) | authored | none | none needed. The selected radio still reads clearly, the add control is disabled with the reason above it, and "Cari produk tersedia" offers a way out.
- Shipping and return disclosures, footer | authored | none | none needed. Factual and not padded.
- 320px / 200% text (`pdp-text-200-short-320-01..04`) | authored | none | minor: the stock check icon is vertically centred on a two-line label. Align it to the first line. No clipping or horizontal overflow.

**Cart: 1440 / 1024 / 768 / 390 and states**
- Header and shopping shell | authored | C3 "cart is a shopping-tab destination" | minor: at 200% (`cart-text-200-320-01`) the search icon stays about 16px while the text doubles. Scale it with the text.
- Line record (thumbnail, contents, unit and line total) | authored | S08 `cart-preview` item rows | none needed. One parent line per offer with its contents listed underneath; Rp99.000 × 2 = Rp198.000 is unambiguous.
- Line actions "Perbarui jumlah" / "Hapus" | generic | none | **give the actions distinct weights.** Update, remove and "Setujui isi terbaru" (`cart-publication-review-390-01`) all use the same outlined purple box. A destructive remove, a routine update and a consequential approval look equally important, and the approval doesn't read as the line's main decision. Make Hapus a quieter neutral or text-plus-icon style, and make the approval visually stronger than Hapus.
- Summary column | authored | Tokophi's recessed summary area | none needed. Merchandise and "Ongkir: Dihitung saat checkout" are separate, there's no fake total, and the honest "checkout sedang disiapkan" line has no fake continue button.
- Empty cart (`cart-empty-1440`, `cart-empty-390-01`) | authored | Tokophi's single empty-state action | none needed. Success notice, then empty state, then one primary "Lihat produk", with no Rp0 summary.
- Expired cart (`cart-expired-390-01`) | generic recovery | none | **add a primary "Lihat produk" inside the expired notice.** The text says "Pilih produk untuk memulai keranjang baru", but the only way forward is the small "Lanjut pilih produk" link in the header row. The empty cart gives the same recovery as a filled button, so this is inconsistent and the task is less clear.
- Quote expired (`cart-quote-expired-detail-390-01`) | authored | none | minor: the caution notice sits inside the grey summary box, a frame inside a frame. Acceptable, but it could sit flush.
- Retired offer (`cart-retired-offer-390-01`) | authored | none | minor: the error repeats "Contoh Kaos, Pilihan 1 kaos" right below the same name. This line's thumbnail label is also smaller than the others ("Foto belum tersedia" on 2 lines instead of 3).
- Stock conflict (`cart-stock-conflict-390-01`, `cart-stock-detail-390-01`) | authored | none | none needed. The rejected 6 has a red border, a non-colour icon and a nearby message, and the saved quantity stays 1. It has the same repeated-name nit as above.
- Pending (`cart-pending-390-01/02`) | unverified | none | **add a scrolled viewport capture.** In slice 02 the fixed bottom nav covers the "Menyimpan perubahan…" button area, so the pending control itself can't be judged. The publication, stock, quote and retired states each have a detail capture; pending doesn't.
- Session denied (`cart-session-denied-390-01`) | authored | none | none needed. Safe reload is the primary action, browsing is secondary, and the sign-out action uses a separate red outline under its consequence text.
- 768 two-column layout (`cart-768-01`) | authored | none | minor: Hapus wraps onto its own row under Perbarui jumlah. Consider stacking the summary below 900px.

## Reference comparison
- **S08 `product-1440/390`** (owner-selected anatomy): kept. Back/brand/cart header, media beside the decision column on desktop, then option, contents, one purchase region on mobile. The S22 type follows the global tokens rather than the prototype's oversized headings, as recorded. Size chips became radios plus a form submit, which is justified by the no-JS requirement.
- **Tokophi `390`** (focused checkout reference): its visible summary-total area and single empty-state action carry over to the cart summary and empty state. The cart correctly keeps the shopping shell rather than Tokophi's checkout-only shell.
- **IKEA `1440-top`, `390-top-01/02`**: these only bear on the listing (`pdp-back-list-*`). Search is dominant and the product grid is open with no carousel. The header overlap in the 390 capture was not carried over.
- **Carbon `1440-top`**: an operator table reference with no role on PDP or cart. Its inclusion in this set adds nothing, and that's fine.

Template signals checked and absent: no dark hero, accent word in the headline, eyebrow pills, equal icon-card rows, decorative arrows, stats or unsourced trust claims. The page wouldn't fit an unrelated business: the complete-option contents next to Rp99.000 is specific to 99ribu. Fixed-nav overlap in the full-page slices (`cart-390-02`, `cart-stock-conflict-390-02`) is a capture artifact, not a layout defect, except where it hides the pending state under review.

Most important change: Give cart line actions distinct weights (quiet Hapus, routine update, stronger publication approval) and add a primary recovery button to the expired cart, then re-capture the pending state in a scrolled viewport so its control can actually be seen.
Verdict: REVISE