Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s22/cart-1024.png, docs/spec/design/renders/s22/cart-1440.png, docs/spec/design/renders/s22/cart-390.png, docs/spec/design/renders/s22/cart-768.png, docs/spec/design/renders/s22/cart-empty-1440.png, docs/spec/design/renders/s22/cart-empty-390.png, docs/spec/design/renders/s22/cart-expired-390.png, docs/spec/design/renders/s22/cart-nojs-390.png, docs/spec/design/renders/s22/cart-pending-390.png, docs/spec/design/renders/s22/cart-publication-detail-390.png, docs/spec/design/renders/s22/cart-publication-review-390.png, docs/spec/design/renders/s22/cart-quote-expired-390.png, docs/spec/design/renders/s22/cart-quote-expired-detail-390.png, docs/spec/design/renders/s22/cart-retired-offer-390.png, docs/spec/design/renders/s22/cart-session-denied-390.png, docs/spec/design/renders/s22/cart-stock-conflict-390.png, docs/spec/design/renders/s22/cart-stock-detail-390.png, docs/spec/design/renders/s22/cart-text-200-320.png, docs/spec/design/renders/s22/pdp-1024.png, docs/spec/design/renders/s22/pdp-1440.png, docs/spec/design/renders/s22/pdp-390.png, docs/spec/design/renders/s22/pdp-768.png, docs/spec/design/renders/s22/pdp-back-1440.png, docs/spec/design/renders/s22/pdp-back-390.png, docs/spec/design/renders/s22/pdp-back-list-1440.png, docs/spec/design/renders/s22/pdp-back-list-390.png, docs/spec/design/renders/s22/pdp-back-nojs-390.png, docs/spec/design/renders/s22/pdp-options-1440.png, docs/spec/design/renders/s22/pdp-options-390.png, docs/spec/design/renders/s22/pdp-options-nojs-390.png, docs/spec/design/renders/s22/pdp-text-200-short-320.png, docs/spec/design/renders/s22/pdp-unavailable-390.png, docs/spec/design/renders/s22/pdp-unknown-390.png, docs/spec/design/renders/s22/pdp-version-conflict-390.png
References: docs/spec/design/refs/carbon-table/1440-top.png, docs/spec/design/refs/ikea-id/1440-top.png, docs/spec/design/refs/ikea-id/390-top.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png, docs/spec/design/renders/s08/product-1440.png, docs/spec/design/renders/s08/product-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 9f156486d0375193
Images-SHA: 52735c38e44642a4
Output-SHA: a3fa1925d32e3b0b

Saya sudah buka dan memeriksa ke-79 gambar. Hasilnya **REVISE**: anatomi sudah sesuai kontrak, tapi masih ada beberapa cacat yang terlihat di render. Review lengkap di bawah dalam bahasa Inggris, sesuai format prompt.

## Section lines (top → bottom)

**PDP**

- Sample-data strip | authored | none | Fine as is; the honest one-line simulation notice doesn't compete with the task.
- Task header (Back / wordmark / cart) | authored | S08 `product-390/1440` focused header | Fine as is. The Katalog/Kembali label follows the real source, and the badge `1`/`2` appears after an add.
- Category links (Semua produk / Paket) | authored | none | Fine as is; plain underlined links, not pills.
- Media slot + caption | authored | S08 square slot | Fine as is. The inside says "Foto belum tersedia" and an item-specific shot brief sits below, sized like a real square photo. This is owner content, not a design failure.
- Identity / price (`Rp99.000 / pilihan lengkap`) | authored | S08 identity→price order | Fine as is; price leads, the basis is subordinate, and the mobile price sits right under the name.
- Option radios (multi-option) | authored | S08 size chips → labeled native radios | Delete the redundant line "Pilihan untuk keranjang: Pilihan 2 kaos". It repeats the checked radio. The helper sentence plus the "Lihat pilihan" button already carry the explicit-apply model, so three statements describe one choice.
- Isi yang diterima | authored | contract "contents adjacent to price" | Fine as is.
- Stock + quantity + add region | authored | S08 single purchase region | Fine as is. One primary purple action, and disabled-with-reason works in `pdp-unavailable`. "Lihat keranjang" sits about 4 px below the button at 200% (`pdp-text-200-short-320-03`); give it 8 px.
- Feedback callouts (success / unknown / version) | partly generic | none | `pdp-back-nojs-390-02` (success) and `pdp-unknown-390-02` (unknown) use the **identical** purple-tint, left-border container; only the icon and heading differ. Give unknown a neutral or caution container. The contract requires pending, unknown and success to be distinguishable, and the outcome a buyer must act on currently looks like confirmation. Version conflict (`pdp-version-conflict-390-02`) is red text only: "Periksa kembali pilihan Anda" doesn't say the cart already holds this item. Name the fact, e.g. that the cart already has 2.
- Spesifikasi heading | defect | none | There is a visible glyph gap, rendering as "Spesif ikasi", in every ordinary-size capture: 390, 768, 1024, 1440, options, back. The 200% capture renders it correctly. Check the `fi` ligature or letter-spacing on the section token. It reads as broken typography in a heading every PDP shows.
- Shipping/returns disclosures | authored | contract inline disclosure | Fine as is.
- Footer | authored at 390/1440; awkward at 768/1024 | none | At 768/1024 the disclaimer drops below and stays indented at the link's 152 px column, leaving an orphaned left gutter (`pdp-1024-01`, `pdp-768-02`). Let it start at the page edge.

**Cart**

- Header and discovery chrome | authored | S21 accepted shell | At 1440 on the populated cart (`cart-1440-01`), "Akun" is underlined like the current-state treatment, but not on the empty cart (`cart-empty-1440-01`). Check for a hover artifact or a wrong current flag; current state must be unambiguous.
- Line record (thumb, name, option, frozen contents, unit/line total) | authored | contract C1 parent line + subordinate contents | Fine as is. The text-label thumbnail avoids a tiny shot brief.
- Quantity / Perbarui / Hapus | authored | none | Fine as is. Hapus has icon plus text, and the bounded secondary width holds.
- Stock conflict error | partly generic | none | The rejected "6" (`cart-stock-conflict-390-01`) has no invalid-field styling. Only red text above the label marks it, while the retired case gets a focus ring. Add an invalid border or icon on the input so the error attaches to the field and isn't signalled by text color alone.
- Retired-offer line | defect (content) | none | `cart-retired-offer-390-01` stacks two contradictory messages. One says "Pilihan ini tidak lagi dijual. Hapus…", the other says "Rincian pilihan berubah. Periksa isi terbaru sebelum melanjutkan", but there is no newer content to review. Show one message: "no longer sold → remove". The current copy sends the buyer looking for a review step that doesn't exist.
- Publication-change review | authored | contract C2 comparable lists | The "Isi saat ditambahkan" vs "Isi terbaru" comparison works, and approval is separated from quantity. Fine apart from the callout color (see below).
- Warning callouts (expired, publication, quote, retired) | generic | none | All use brand yellow #F6C945 as a left-border caution fill. The brand contract limits yellow to "limited offer/price emphasis". Reusing it as the warning color mixes up brand emphasis and caution states. Use a distinct caution role token.
- Summary panel | authored | Tokophi recessed summary zone | Honest: no fake checkout CTA and no payable zero. There is dead space of roughly 40 px between "Checkout sedang disiapkan…" and the link in every capture (`cart-390-02`, `cart-768-01`). Remove the empty spacer.
- Empty cart | authored | Tokophi empty-state single recovery | Fine as is. One primary action and **no Rp0 summary**, a deliberate, correct departure from Tokophi's "Rp0".
- Session denied | authored | none | Fine as is. The safe reload is primary, and the consequential sign-out is separated below, with a distinct red outline.
- Pending | authored | none | Fine as is. The pending state is local to its line ("Menyimpan…"), and the other line stays editable.
- Expired cart | authored | none | Fine as is. The static record has no forms and the summary is renamed "Catatan keranjang".
- 200%/320 reflow | authored | none | Fine as is. Nav wraps to 2×2, records and actions wrap, no clipping. The search glyph stays tiny next to 200% text, which is minor.

## Evidence and reference transfer

- **Inspected:** all 79 paths in the request.
- **Reference slices:**
  - S08 PDP prototype: `8fb075f0…product-1440-01`, `d7dc3bd0…product-390-01/02`
  - IKEA: `ee576f95…1440-top-01`, `69ce9ad8…390-top-01/02`
  - Tokophi empty checkout: `11946f9e…390-01`
  - Carbon: `aaccc28f…1440-top-01`
- **S08 → S22:** the task header, wide media/decision split, mobile media→identity→option→contents→purchase order and single purchase region all transfer faithfully. Type is reduced to the S21 tokens, as recorded. S08's chip-style size selector became labeled native radios with explicit apply; that is justified by the no-navigation-on-keyboard contract, but it costs a helper sentence and a redundant fact line.
- **Tokophi:** supports the empty-cart single recovery and the recessed summary. 99ribu correctly drops "Rp0".
- **IKEA:** relevant only to the search-first listing visible in `pdp-back-list`. The campaign carousel and the header overlap are correctly not transferred.
- **Carbon:** it is an operator/table reference with no role on PDP or cart, so it adds nothing to this review. Its inclusion here has no transfer rationale.
- **Template signals:** none present. There is no dark hero, eyebrow pills, equal icon-tile cards, `→` buttons, unsourced stats or "resmi/terpercaya" claims. The page is specific to fixed-price complete offers.

**Missing evidence:** the retired-offer capture starts mid-record, so the second cart line behind "2 pilihan / Rp198.000" can't be seen and I couldn't check that total. The ordinary-height mobile PDP bottom region is shown only where the 600 px fixture forces normal flow.

Most important change: replace the contradictory retired-offer message with one "no longer sold → Hapus" message, and give unknown-result and warning callouts their own non-brand, non-success visual roles.

Verdict: REVISE