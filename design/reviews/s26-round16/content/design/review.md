Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s26/allocation-changed-390.png, docs/spec/design/renders/s26/checkout-empty-390.png, docs/spec/design/renders/s26/checkout-expired-390.png, docs/spec/design/renders/s26/cod-unavailable-390.png, docs/spec/design/renders/s26/contact-1024.png, docs/spec/design/renders/s26/contact-1440.png, docs/spec/design/renders/s26/contact-390.png, docs/spec/design/renders/s26/contact-768.png, docs/spec/design/renders/s26/contact-error-390.png, docs/spec/design/renders/s26/contact-nojs-390.png, docs/spec/design/renders/s26/contact-text-200-320.png, docs/spec/design/renders/s26/contact-text-200-collapsed-320.png, docs/spec/design/renders/s26/draft-conflict-390.png, docs/spec/design/renders/s26/draft-conflict-nojs-390.png, docs/spec/design/renders/s26/draft-scope-denied-390.png, docs/spec/design/renders/s26/order-unknown-390.png, docs/spec/design/renders/s26/payment-1024.png, docs/spec/design/renders/s26/payment-1440.png, docs/spec/design/renders/s26/payment-390.png, docs/spec/design/renders/s26/payment-768.png, docs/spec/design/renders/s26/payment-denied-390.png, docs/spec/design/renders/s26/payment-expired-390.png, docs/spec/design/renders/s26/payment-failed-390.png, docs/spec/design/renders/s26/payment-instructions-390.png, docs/spec/design/renders/s26/payment-nojs-390.png, docs/spec/design/renders/s26/payment-unknown-390.png, docs/spec/design/renders/s26/quote-expired-390.png, docs/spec/design/renders/s26/review-1024.png, docs/spec/design/renders/s26/review-1440.png, docs/spec/design/renders/s26/review-390.png, docs/spec/design/renders/s26/review-768.png, docs/spec/design/renders/s26/review-consented-390.png, docs/spec/design/renders/s26/review-draft-js-390.png, docs/spec/design/renders/s26/review-draft-nojs-390.png, docs/spec/design/renders/s26/review-pending-390.png, docs/spec/design/renders/s26/review-subsidized-390.png, docs/spec/design/renders/s26/review-two-origins-cod-1024.png, docs/spec/design/renders/s26/review-two-origins-cod-1440.png, docs/spec/design/renders/s26/review-two-origins-cod-390.png, docs/spec/design/renders/s26/review-two-origins-cod-768.png, docs/spec/design/renders/s26/review-two-origins-prepaid-1024.png, docs/spec/design/renders/s26/review-two-origins-prepaid-1440.png, docs/spec/design/renders/s26/review-two-origins-prepaid-390.png, docs/spec/design/renders/s26/review-two-origins-prepaid-768.png, docs/spec/design/renders/s26/shipping-1024.png, docs/spec/design/renders/s26/shipping-1440.png, docs/spec/design/renders/s26/shipping-390.png, docs/spec/design/renders/s26/shipping-768.png, docs/spec/design/renders/s26/shipping-return-selected-390.png, docs/spec/design/renders/s26/shipping-service-changed-390.png, docs/spec/design/renders/s26/shipping-service-restored-390.png, docs/spec/design/renders/s26/shipping-subsidized-390.png, docs/spec/design/renders/s26/shipping-two-origins-cod-1024.png, docs/spec/design/renders/s26/shipping-two-origins-cod-1440.png, docs/spec/design/renders/s26/shipping-two-origins-cod-390.png, docs/spec/design/renders/s26/shipping-two-origins-cod-768.png, docs/spec/design/renders/s26/shipping-two-origins-prepaid-1024.png, docs/spec/design/renders/s26/shipping-two-origins-prepaid-1440.png, docs/spec/design/renders/s26/shipping-two-origins-prepaid-390.png, docs/spec/design/renders/s26/shipping-two-origins-prepaid-768.png, docs/spec/design/renders/s26/shipping-unavailable-390.png
References: docs/spec/design/refs/tokophi-store-checkout-20261016/1440.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png, docs/spec/design/renders/s08/checkout-1440.png, docs/spec/design/renders/s08/checkout-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 428918e4e01ab74f
Images-SHA: 7f7df6bd8661a34c
Output-SHA: ec75c1cd708758b8

Paduka Ongki, semua 168 slice di daftar (termasuk 5 slice referensi S08/Tokophi) dan 4 gambar referensi aslinya sudah saya buka satu per satu. Tidak ada gambar yang gagal dibaca. Ini laporan review-nya, ditulis dalam English sesuai format yang diminta.

---

## Section-by-section (top to bottom)

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Simulation banner ("Data contoh. Pesanan dan pengiriman simulasi.") | authored | S08 "Prototipe · data contoh" strip | None; it is factual, quiet and wraps cleanly at 320/200%. |
| Focused header (Back · 99ribu. · Bantuan) | authored | S08 focused header (CO1) | At 320/200% it stacks into three rows: logo, then "‹ Keranjang", then "Bantuan" (`092ad647…-01`). Keep Back and Bantuan on one row so the form starts higher. |
| "Checkout" H1 + step nav (1. Alamat / 2. Pengiriman / 3. Tinjau) | authored | S08 step row | None. The active step is underlined in purple, and at 200% the steps reflow vertically without clipping. |
| Collapsed summary disclosure (390/768) | authored | S08 "Lihat ringkasan · Rp… ⌄" | None. It shows the known amount plus the state text ("Produk · ongkir belum dihitung" / "Perhitungan tersimpan" / "Total perhitungan"). There are no fixed bars or tabs. |
| Wide summary panel (1024/1440) | authored | S08 recessed right summary | The shell measures 1080px and the split is about 587/461px (≈56/44). CO2 asks for one column divider; the summary uses a bordered card instead. Accept that deviation in docs10 or replace the card border with the single divider. |
| Contact form (labels, optional markers, error summary) | authored | S08 form | `894a0458…-02` shows three stacked helper lines under the destination select, and "Pilih tujuan dari hasil pencarian." still shows after a destination is chosen. Drop that line once a value is selected. |
| Payment preference fieldset | authored | none (no S08 equivalent) | See recovery finding R1: the COD error does not mark this fieldset. |
| Primary action + "Menyimpan draf…" | slightly generic | S08 full-width purple CTA | The labels are about 14px and visibly tracked on 48px bars ("Tinjau pesanan", "Lanjut ke pengiriman"), which reads weaker than S08's ~17px. Use the body-size untracked weight for primary actions. |
| Shipping recipient recap + "Ubah alamat atau metode" | authored | none | None. |
| "Pembagian paket" select + stored origin line | authored | none (domain-specific) | The native select truncates at 390 ("Pontianak, Mala…"). The "Asal paket tersimpan" line below repeats the full value, so this is acceptable. |
| Parcel fieldset (origin legend, offers, contents, service, fee/subsidy/COD) | authored | CO5 parcel grouping | Fixture tokens "[s26-98863af7]" appear on every content line. This is fixture noise, not judged as design, but it inflates list density everywhere. |
| Review: method block + per-parcel "COD paket ini" | authored | CO7 | None. Every parcel's shipping fee, subsidy and COD amount appears outside the disclosure. |
| Review: editable delivery note | authored | none | None. Note edits are visibly retained in both the JS and no-JS drafts (`ce3c662e…-02`, `0e045364…-02`). |
| Totals + confirm ("Buat pesanan · Pembayaran simulasi · Rp225.000" / "Buat pesanan COD · Rp431.000") | authored | CO7 | Two-origin COD collects Rp223.000 and Rp208.000 per parcel, but the confirm button reads as one Rp431.000 COD payment. Label the total row "Total COD (2 paket)" so it matches the per-parcel collection. |
| Bantuan checkout (details list) + "Kembali ke formulir" | authored | CO8 | Empty and expired cart states (`316badc0…-01`, `b8467e18…-01`) show three shipping/order/payment questions that do not apply. Show only a cart-relevant question there. |
| Footer (price fact + two policy links) | authored | S08 footer, reduced | None. |
| Caution/error alerts (stale quote, total changed, conflict, COD, no-route) | mixed | none | The "Total berubah dari Rp431.000 menjadi Rp434.000" notice (`54ec5152…-01`, `bde785fa…-01`) has no icon, unlike every other caution. Use the shared caution alert. |
| Private payment view (Menunggu / gagal / tidak tersedia / sedang diperiksa / COD) | authored | none (scoped to stay compact) | The order reference "99-5522D9F584E64C17" is 16 run-together hex characters set bold, which is hard to read aloud to support. Group it (e.g. 99-5522-D9F5-84E6-4C17) or use a tabular font. |
| Single-task states (empty, expired cart, scope denied, payment denied, order unknown) | authored | Tokophi empty-state recovery (focused header + one action) | `f37504b1…-01` has a ~60px blank gap between the disclosure and the caution. Remove the empty step-nav slot. |

## Findings

**R1. Recovery copy points to actions or options that are not on screen.** This is the material issue.
- **COD unavailable** (`27f142c6…-01/-02`): the alert says "Pilih pembayaran online atau ubah tujuan." There is no option called "online"; the choices are "Pembayaran simulasi" and "COD · cek ketersediaan", and COD is still selected. The fieldset has no inline error and the alert has no field link. The buyer has to work out which control to change on a money step.
- **Quote expired** (`4f4b4edc…-01/-03`): the alert says "Hitung ulang, lalu periksa total terbaru." No "Hitung ulang" action exists; the only button is "Lanjut ke pengiriman".
- **No route** (`854dce22…-01/-02`): the alert sits above the intro copy and is not linked to the destination select. That select truncates to "SYNTHETIC unsupported destination · 000".
- The contact-error state (`8e5d30b7…-01`) already has the right pattern: an error summary with a field link ("Nomor HP"), plus an inline red message and outline on the field. The no-route and COD-unavailable states do not reuse it.

**R2. Expired payment is a dead end.** `438ff170…-01` ("Pembayaran tidak tersedia") says new instructions cannot be created. The only body action is "Perbarui status", which cannot change that outcome. The way forward is only the small "‹ Katalog" link in the header. Add one plain next step in the body.

**R3. Minor.** While the order is being saved (`64566c63…-02`), the button is disabled ("Menyimpan pesanan…") but "Ubah pengiriman" and "Ubah alamat atau metode" remain active links. This is a visual hint only; interaction proof is outside this review.

**R4. Minor.** Summary order does not match parcel order on two-origin COD. At 1024/1440 the summary lists "Contoh Paket 2 Krim" first (`3945087b…-01`, `9cdaa67f…-01`), while Paket 1 starts with "Contoh Kaos". Prepaid lists Kaos first. Sort the summary by parcel order.

### Checked and not findings
- **Sticky summary:** at 1440 the summary ends at about y=775 while the review form runs past y=1900. These are full-page captures, so stickiness cannot be judged; that is not a defect claim.
- **Service-changed vs service-restored:** `f1ec3098…` and `4e7e6647…` look the same except the "Menyimpan draf…" line. That is consistent if "restored" means the pending choice was restored from the draft. If it meant reverting to the stored service, the caution should be gone.

## Reference comparison

**S08** (`3dad1ce0…-01/-02`, `466be7e1…-01`):
- Transferred correctly: focused Back/brand/help header, compact "Lihat ringkasan" amount with a not-final status line, labeled 3-step row, persistent-label form, wide form-left/recessed-summary-right split at 1080px.
- Deliberately dropped, as the direction says: S08's invented estimate/subsidy totals and its "Foto" thumbnails (the cart projection has no frozen image), so the build does not fill those slots with catalog imagery.
- Real departures:
  - The CTA type is smaller and tracked compared with S08's larger untracked button.
  - The summary is a bordered card rather than an unbordered panel with a single divider.

**Tokophi** (`11946f9e…-01`, `5d95e056…-01`):
- Used only for the focused header, summary band and single-action empty recovery. The build's empty and expired states (`316badc0…`, `b8467e18…`) follow that pattern: one heading, one sentence, one purple action.
- The blue color, Rp0 and voucher field were correctly not copied. Showing no promo field matches CO7, since no promo policy has been accepted.

**Template signals:**
- None of the dark-hero, accent-word, eyebrow, equal-card-grid, mono-label, arrow-on-every-button or placeholder-stat patterns appear.
- The parcel fieldsets repeat because parcels really are repeated objects.
- The page could not pass for another business: the layout is built around origin parcels, per-parcel COD amounts, stored-vs-new quote states and Rp99.000 complete offers.
- No unsourced trust claims ("resmi", "terpercaya") appear. No photo slots are needed for a checkout.

**Research gap:** The direction document records which references were reopened and what was transferred, so the reasoning for the focused shell and summary split is supported. It gives no reasoning for the alert vocabulary or recovery copy, which is where R1 sits.

**Responsive behavior:** 390, 768, 1024, 1440 and 320/200% all render without horizontal overflow or clipped text. The only truncation is inside native selects, and each one is repeated in full by a helper line below. The 200% open disclosure (`0366d86d…-01…-08`) reflows the money rows to right-aligned wrapped values without loss.

---

Most important change: Rewrite the no-route, COD-unavailable and stale-quote alerts so they name the exact on-screen option or button and link to the affected field with an inline error, reusing the contact-error summary pattern; also give the expired-payment view one body-level next step.

Verdict: REVISE