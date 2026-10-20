Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, preflight-nya selesai. Hasilnya **NO-GO**. Semua 8 temuan lama sudah beres, tapi ada 2 masalah tampilan nominal uang yang baru. Laporan lengkapnya di bawah, dalam bahasa Inggris. Tidak ada file yang saya ubah.

---

# S26 visual preflight r2: advisory report (read-only)

**Verdict: NO-GO.** Every image was inspected and every historical T2 finding is resolved. Two rendered money-display issues remain at P2 (findings N1 and N2). This is advisory only: it is not a canonical PASS, not a source approval, not S26 acceptance, and it does not use up any owner-authorized round.

**Reviewer runtime:** Claude Code (Claude Agent SDK), model `claude-opus-5-5` (Opus 5.5), provider Anthropic, low reasoning effort for this session. I am not the builder, not the canonical reviewer and not T2 Gemini. I made no writes, ran no tests, used no DB, network, credentials or other agents, and did not touch Git, `design/review.md` or any engineering-review artifacts.

## Integrity (checked before and after; nothing changed)
| Item | Result |
|---|---|
| HEAD | `8b17eee844ba9715581959fc0821af25ce1b99ef` ✓ |
| Preflight manifest | `2dfc2551…36d1` ✓ |
| Source manifest r4 | `5ba4c1bd…00b9` ✓ |
| Design context `design/reviews/s26-visual-context.md` | 13954 B, `2261be97…8b6a` ✓ (matches the manifest) |
| Renders | 57/57 SHA-256 match |
| References | 4/4 match |
| Slices | 151/151 match |

**Images inspected:** all 151 listed slices, opened with the image reader at slice size. That covers all 57 current renders and all 4 references (S08 390 and 1440, Tokophi 390 and 1440). None were missing.

## Historical T2 findings, checked against current source and renders
| # | Finding | Current source | What the render shows | Status |
|---|---|---|---|---|
| 1 | Unknown order | `checkout-forms.tsx:90` (`UnknownOrder`); the boundary uses it at `:19` | order-unknown-390: heading "Hasil tindakan belum diketahui", summary "Total permintaan Rp225.000", caution with icon, same-request retry "Periksa hasil tindakan", Help present | GO |
| 2 | Status semantics | `order/[orderId]/page.tsx:21`; `globals.css:1291-1293` | Pending is neutral grey with no icon (payment-390/768/1024/1440, instructions, nojs, failed). Unknown and closed use caution plus icon. Nothing pending looks paid. Routine steps show no success check (contact-390, shipping-*, review-*). Lookup status sits under the destination field (contact-390) | GO |
| 3 | Duplicate totals and fee rows | `:152` has no restated `<p>`; `:95` shows the subsidy rows only when subsidy > 0 | review-1440: charges outside the summary plus the confirm amount only. Unsubsidized parcels show one "Ongkir yang dibayar" row. Subsidized: Ongkir paket 27.000, −3.000, 24.000. Totals add up in every render I checked (210k, 213k, 222k, 225k, 431k, 434k) | GO |
| 4 | Help return | `:156` is an `<a href="#checkout-step">` | Every checkout stage shows the text link "Kembali ke formulir" under Help. No submit button | GO |
| 5 | Summary at 320px / 200% text | `globals.css:1301` sets `span:first-child{flex-basis:100%}` | contact-text-200-320 slices 01–08: label sits above the amount, no word-per-line crush, no visible horizontal overflow | GO |
| 6 | Focus ring | Retained by design | Rings appear only on the last-edited field (contact-1024/1440 note, contact-error phone, draft-conflict, review-draft-js/nojs) | GO (disclosed) |
| 7 | Payment page width and button | `globals.css:1298` sets `justify-self:start` | payment-1024/1440: the primary button fits its content; the 40rem single column reads cleanly | GO (disclosed) |
| 8 | Legend axis and select truncation | `:95` puts the price first | Legends sit just inside the card axis, a few px right of the content, which is acceptable. Parcel service selects show `Rp12.000 · …` first at 390, and the full service wraps at review | GO for the parcel select only; see N1 |
| §3 | Missing states | — | All are now rendered: pending submit, empty and expired checkout, denied scope, draft conflict, allocation and service change, positive subsidy, two origins prepaid and COD at all four widths, payment unknown, failed, expired and denied | GO |

## New or remaining findings (seen in renders unless marked as source-only)

**N1, P2: the allocation select still hides money at 390px.**
- Images: shipping-two-origins-cod-390-01, shipping-two-origins-prepaid-390-01, shipping-service-changed-390-01, allocation-changed-390-01.
- The closed native select reads `2 paket · Pontianak, Malang · ongkir Rp35.0` or `…Rp31.0(`. The shipping amount is cut mid-number. It is the same class as historical #8, but only the parcel service select was fixed.
- Source: `checkout-forms.tsx:148`. The option text is `{p.package_count} paket · {p.origins.join(', ')} · ongkir {rupiah(p.shipping_total)}`.
- Suggested fix: apply the same amount-first order as `:95`.

**N2, P2: a pending service edit shows a contradicting fee inside the parcel.**
- Image: shipping-service-changed-390-02.
- Parcel 1's select now shows `Rp30.000 · …`, but the row directly below still says "Ongkir yang dibayar **Rp27.000**". Nothing next to it marks that figure as the stored calculation.
- The stored-calculation basis is only stated in two places: the collapsed summary subtitle ("Perhitungan tersimpan Rp431.000") and a hint below Paket 2 ("Tinjau pesanan untuk menghitung layanan dan total terbaru."), which is far from the edit.
- Source: `:95` renders `parcel.buyer_shipping_amount` without checking `dirty`.
- Harm: the buyer sees two different fees for the same parcel. The mandatory final review does still reprice, so no wrong amount can be confirmed. The contract is met for totals but not inside the parcel card.

**N3, P3: the routine allocation-update transition shows two stacked instructions.**
- Images: shipping-service-changed-390-01, plus review-two-origins-prepaid-390/768/1024/1440-01.
- "Pembagian paket diperbarui. Periksa layanan setiap paket…" sits directly on top of "Total berubah dari Rp427.000 menjadi Rp431.000. Periksa rincian paket." Both say "Periksa…".
- The lines have no spacing before the "Penerima" or "Penerima dan tujuan" heading.
- The total-change notice is small grey hint text, which is a weak treatment for a money change.
- Source: `checkout.ts:174` and `checkout-forms.tsx:133-134`.

**N4, P3: closed/expired payment does not say why.**
- Image: payment-expired-390-01.
- Title "Pembayaran tidak tersedia" with the same caution style as unknown, and the copy "…Periksa status sebelum memulai pesanan lain." The known fact (the payment deadline passed or the order was closed) is never stated.
- Unknown and closed are still told apart by their titles, so this is not a blocker.

**N5, P3: draft conflict feedback is easy to miss.**
- Image: draft-conflict-390-02.
- "Draf berubah di halaman lain. Muat ulang untuk memeriksanya." is grey hint text under the primary button. It has no caution style and no reload action.
- Source: `actions.ts:17` and `checkout-forms.tsx:154`.

**N6, P3: pending submit looks almost unchanged.**
- Image: review-pending-390-02.
- Only the label changes to "Menyimpan pesanan…". The button colour is the same, and the fields and links still look active.
- Source-only inference: the fieldset is disabled at `:136`, so a second submit should be blocked even though it doesn't look disabled.

**N7, P3: the wide two-origin views show the summary collapsed.**
- Images: review/shipping-two-origins-cod/prepaid-1024 and -1440.
- The right column is a single closed bar with a large empty area below it. Single-origin wide renders show the summary open.
- Source-only inference: `:86` opens the summary only on mount at ≥1024px, so these captures probably mounted at a narrower width. All final charges are still in the left column.

**N8, P3: native destination selects truncate the postal code or name.**
- Images: cod-unavailable-390-02 and shipping-unavailable-390-02 show `…· 000`; contact-text-200-320-04 shows `SYNTHETIC Mala`.
- The full address appears at the shipping and review steps.

**Note: fixture clock.** The payment deadlines read "15 Okt 2026", while the PNG mtimes are 2026-10-19. Source-only: the tests use the namespace fixture clock (`storefront-checkout.test.ts:38,224`), so the deadline is consistent with fixture time and not a fabrication.

## Contract checks that pass (CO1–CO8)
- **Shell and layout:** focused header (Keranjang / logo / Bantuan) with compact policy links. No shopping tabs, no floating pay bar, no fake chat.
- **Brand:** Inter with purple and yellow roles.
- **Copy and claims:** factual Indonesian copy. No invented payment methods, provider ETAs or trust claims. The simulation is labelled and "SYNTHETIC" fixtures are disclosed.
- **Widths:** 390 is native disclosure with the known amount, 768 stacks, and 1024/1440 use the roughly 1080px shell split about 56/44.
- **Money:** COD per parcel is shown, and the confirm button names the method and amount ("Buat pesanan COD · Rp431.000").
- **References:** used for focused header, form and summary hierarchy only. No Tokophi blue, Rp0 or voucher was borrowed, and the S08 prototype's estimated totals were not copied.

## Not claimed
I did not re-run the 20-case browser proof, test native chat, use physical Safari or a device, check WCAG conformance, or run `design-gate`.

**To reach GO:** fix N1 (amount first in the allocation option) and N2 (mark or hide the stale per-parcel fee while an edit is pending), then re-render the affected 390 shipping and service-changed images. N3–N8 are polish and not blockers.
