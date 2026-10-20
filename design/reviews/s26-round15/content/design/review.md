Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s26/allocation-changed-390.png, docs/spec/design/renders/s26/checkout-empty-390.png, docs/spec/design/renders/s26/checkout-expired-390.png, docs/spec/design/renders/s26/cod-unavailable-390.png, docs/spec/design/renders/s26/contact-1024.png, docs/spec/design/renders/s26/contact-1440.png, docs/spec/design/renders/s26/contact-390.png, docs/spec/design/renders/s26/contact-768.png, docs/spec/design/renders/s26/contact-error-390.png, docs/spec/design/renders/s26/contact-nojs-390.png, docs/spec/design/renders/s26/contact-text-200-320.png, docs/spec/design/renders/s26/draft-conflict-390.png, docs/spec/design/renders/s26/draft-scope-denied-390.png, docs/spec/design/renders/s26/order-unknown-390.png, docs/spec/design/renders/s26/payment-1024.png, docs/spec/design/renders/s26/payment-1440.png, docs/spec/design/renders/s26/payment-390.png, docs/spec/design/renders/s26/payment-768.png, docs/spec/design/renders/s26/payment-denied-390.png, docs/spec/design/renders/s26/payment-expired-390.png, docs/spec/design/renders/s26/payment-failed-390.png, docs/spec/design/renders/s26/payment-instructions-390.png, docs/spec/design/renders/s26/payment-nojs-390.png, docs/spec/design/renders/s26/payment-unknown-390.png, docs/spec/design/renders/s26/quote-expired-390.png, docs/spec/design/renders/s26/review-1024.png, docs/spec/design/renders/s26/review-1440.png, docs/spec/design/renders/s26/review-390.png, docs/spec/design/renders/s26/review-768.png, docs/spec/design/renders/s26/review-consented-390.png, docs/spec/design/renders/s26/review-draft-js-390.png, docs/spec/design/renders/s26/review-draft-nojs-390.png, docs/spec/design/renders/s26/review-pending-390.png, docs/spec/design/renders/s26/review-subsidized-390.png, docs/spec/design/renders/s26/review-two-origins-cod-1024.png, docs/spec/design/renders/s26/review-two-origins-cod-1440.png, docs/spec/design/renders/s26/review-two-origins-cod-390.png, docs/spec/design/renders/s26/review-two-origins-cod-768.png, docs/spec/design/renders/s26/review-two-origins-prepaid-1024.png, docs/spec/design/renders/s26/review-two-origins-prepaid-1440.png, docs/spec/design/renders/s26/review-two-origins-prepaid-390.png, docs/spec/design/renders/s26/review-two-origins-prepaid-768.png, docs/spec/design/renders/s26/shipping-1024.png, docs/spec/design/renders/s26/shipping-1440.png, docs/spec/design/renders/s26/shipping-390.png, docs/spec/design/renders/s26/shipping-768.png, docs/spec/design/renders/s26/shipping-return-selected-390.png, docs/spec/design/renders/s26/shipping-service-changed-390.png, docs/spec/design/renders/s26/shipping-service-restored-390.png, docs/spec/design/renders/s26/shipping-subsidized-390.png, docs/spec/design/renders/s26/shipping-two-origins-cod-1024.png, docs/spec/design/renders/s26/shipping-two-origins-cod-1440.png, docs/spec/design/renders/s26/shipping-two-origins-cod-390.png, docs/spec/design/renders/s26/shipping-two-origins-cod-768.png, docs/spec/design/renders/s26/shipping-two-origins-prepaid-1024.png, docs/spec/design/renders/s26/shipping-two-origins-prepaid-1440.png, docs/spec/design/renders/s26/shipping-two-origins-prepaid-390.png, docs/spec/design/renders/s26/shipping-two-origins-prepaid-768.png, docs/spec/design/renders/s26/shipping-unavailable-390.png
References: docs/spec/design/refs/tokophi-store-checkout-20261016/1440.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png, docs/spec/design/renders/s08/checkout-1440.png, docs/spec/design/renders/s08/checkout-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 4026e1801bfa51a1
Images-SHA: e22ac3912a13cd44
Output-SHA: ca3bfaa63e524c5e

Paduka Ongki, saya sudah buka dan periksa semua 163 slice plus 4 gambar referensi. Verdict: **REVISE**. Hasil review di bawah dalam bahasa Inggris karena ini artefak teknis.

## Section critique (top to bottom)

| Section | Verdict | Look matched | One concrete fix |
|---|---|---|---|
| Simulation banner ("Data contoh…") | authored | S08 prototype strip | None needed |
| Focused header (Keranjang / 99ribu. / Bantuan) | authored | S08 header, CO1 | On the payment views, replace the "Keranjang" back link with an order or status destination. The cart is already consumed. |
| "Checkout" title + summary disclosure | authored, inconsistent state | S08 compact amount bar | Load collapsed at 390 and 768 in every state. Six renders open it by default (see F2). |
| Stepper (1 Alamat · 2 Pengiriman · 3 Tinjau) | authored | S08 step order | None needed |
| Contact/address form | authored | S08 form, CO6 | Drop the duplicate echo line under the destination select ("SYNTHETIC Malang destination · 00001" repeats the selected value) |
| Shipping per parcel | authored | CO5 parcel grouping | Show the full selected service name as text under each truncated native select at 390 |
| Review | authored | CO5/CO7 | Name the prepaid method on the confirm button (F1) |
| Totals + primary action | authored | S08 | Same as F1 |
| "Bantuan checkout" FAQ | generic in placement | none (repeated FAQ block) | Align its width to the form column. Show only the questions relevant to each view (payment views still ask about shipping recalculation). |
| Footer terms links | authored | S08 compact footer | None needed |
| Empty / expired / scope-denied | authored | Tokophi empty recovery, minus blue/Rp0 | None needed |
| Order-unknown / payment states | authored, with one inconsistent state | CO8 recovery | Give the failed-payment message the same alert component as expired/unknown (F5) |

## Findings

**F1 — The prepaid confirm button does not name the payment method (contract violation).**
- COD reviews say "Buat pesanan COD · Rp431.000", which is correct.
- Every prepaid review says only "Buat pesanan · Rp225.000 / 210.000 / 222.000 / 434.000". This covers review-390/768/1024/1440, consented, draft-js/nojs, subsidized and two-origins-prepaid at all widths.
- The composition contract and CO7 require the selected method plus the authoritative total on the final action.
- Consequence: the buyer confirms money without the method restated at the decision point.

**F2 — The mobile and tablet summary renders expanded, breaking CO3.**
- Expanded ("Tutup ringkasan") with the full item list filling the first viewport: allocation-changed-390, shipping-return-selected-390, shipping-service-changed-390, review-two-origins-cod-390, review-two-origins-cod-768, contact-text-200-320.
- At 768 the stepper starts below the fold. At 320/200% the form starts about 1.5 screens down.
- Sibling states at the same widths (review-two-origins-prepaid-390/768, shipping-service-restored-390) render collapsed.
- Consequence: the step task loses hierarchy, and the same width behaves inconsistently. This looks like the "open after crossing the breakpoint" behavior carrying back into narrow widths.

**F3 — Status messages in shipping-service-changed-390 stack up and contradict each other.**
- In order: "Pembagian paket diperbarui.", a caution saying "Total berubah dari Rp427.000 menjadi Rp431.000", a per-parcel "Biaya paket perlu dihitung ulang", a bottom note "Tinjau pesanan untuk menghitung…", and "Menyimpan draf…".
- Meanwhile the summary says "Perhitungan tersimpan belum mengikuti perubahan Anda".
- The caution presents Rp431.000 as the new total, but that number is itself already stale.
- Consequence: the buyer cannot tell which amount is current. Use one alert that says the stored total is pending recalculation.

**F4 — The draft conflict in draft-conflict-390 is buried.**
- The only signal is grey helper text under the active primary button: "Draf berubah di halaman lain. Muat ulang untuk memeriksanya."
- There is no alert treatment and no reload action, and "Lanjut ke pengiriman" stays fully enabled.
- Consequence: this recovery state is not distinct (CO8), and a buyer may submit over a competing draft.

**F5 — The failed-payment message in payment-failed-390 uses a different style.**
- It is red body text with no icon or bar, unlike expired-390 and unknown-390, which use the alert component.
- The heading stays "Menunggu pembayaran".
- Consequence: failure carries less visual weight than unknown, which inverts the severity.

**F6 — Selected service names are clipped on mobile.**
- At 390, service selects truncate, e.g. "Rp12.000 · Local shipping simulation · E…" in shipping-390 and the two-origins states.
- The allocation select truncates to "Pontianak, Mala…".
- Price-first ordering fixed the earlier money truncation. But the Regular/Economy distinction is not readable in the shipping step until review.

**F7 — The contact step summary label is inconsistent in contact-nojs-390.**
- It shows "Total perhitungan Rp225.000" at step 1.
- Other states use "Perhitungan tersimpan" or "ongkir belum dihitung".
- CO3 needs an explicit shipping-not-final or stored label here.

**F8 — The wide layout drifts from the S08 reference.**
- At 1024 and 1440 the sidebar keeps a "Tutup ringkasan" toggle plus a duplicate "Ringkasan pesanan" heading.
- The help block is about 704px wide, which matches neither the form column (~587px) nor the shell.
- S08's recessed borderless panel became a bordered card. That card is acceptable, but the misaligned help measure is visible.
- S08 included thumbnail ("Foto") slots on summary lines. The renders have no image slot for product recognition, and the transfer rationale does not say why it was dropped.

## Evidence and transfer check

These parts of the transfer hold up:
- **Proportions:** contact-1440 and review-1440 hold the ~1080px shell, with the form at about 587px and the summary at about 460px. That is close to the 56/44 target.
- **Stacking:** 768 stacks as specified, and 1024 keeps two readable columns.
- **Charges outside the disclosure:** final review shows every parcel's service, paid shipping, subsidy (review-subsidized-390: Rp27.000 − Rp3.000 = Rp24.000) and per-parcel COD (Rp223.000 + Rp208.000 = Rp431.000).
- **No forbidden content:** no Tokophi blue or Rp0, invented totals, wallet logos, transit estimates or fabricated trust claims.
- **No template signals:** none of the listed signals appear. There is no dark hero, no eyebrow pills, no icon-tile card rows and no monospace. The layout is task-specific, not generic.
- **Copy and brand:** the copy is concrete Indonesian. SYNTHETIC labels are disclosed fixtures. Yellow does not appear on any checkout surface, which is consistent with S08 and not a finding by itself.

Defects F1–F8 are the reasons for REVISE. Nothing renders broken or clipped beyond the native-select truncation noted in F6.

This is visual acceptance only. It is not interaction or accessibility evidence.

**Most important change:** Put the payment method on the prepaid confirm button and make the summary load collapsed in every state at 390 and 768, so the final decision and the step task both lead the page.

**Verdict: REVISE**