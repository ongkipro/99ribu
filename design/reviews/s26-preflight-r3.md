Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, the preflight is done. Advisory result: **GO**. N1 and N2 are fixed in the renders, and I found no new material problem. I opened all 159 slices and changed nothing. The full report is below, in English.

---

# S26 visual preflight r3: advisory report (read-only)

**Verdict: GO.** This is advisory only. It is not a canonical PASS, source approval, engineering approval or S26 acceptance, and it uses none of the owner-authorized rounds.

**Reviewer:** Claude Code (Claude Agent SDK), model `claude-opus-5-5` (Opus 5.5), provider Anthropic. My reasoning-effort setting isn't visible to me, so effort is unavailable. I am not the builder, not T2 Gemini and not the canonical reviewer. I made no writes, not even a plan file, despite this session's plan-mode prompt. I ran no tests and used no DB, network, credentials, workers or other agents. I did not touch Git, `design/review.md`, the canonical log or the engineering source-r5 artifacts.

## Integrity (checked before and after; nothing changed)
| Item | Result |
|---|---|
| HEAD | `8b17eee844ba9715581959fc0821af25ce1b99ef` ✓ |
| Source manifest r5 | `c36274c7…53a5` ✓ |
| Preflight manifest r3 | `03b21e97…213d` ✓ |
| Design `design/reviews/s26-visual-context.md` | 14875 B, `836c2efd…e090`, matches the manifest ✓ |
| Renders / refs / slices | 58/58, 4/4, 159/159 SHA-256 match; no extra or missing slices ✓ |

**Images inspected:** I opened all 159 listed slices with the image reader at slice size, top to bottom. They cover all 58 renders and all 4 references. The references are Tokophi 1440/390 (`5d95…`, `1194…`) and S08 1440/390 (`466b…`, `3dad…`). Five slices are blank trailing strips: checkout-empty-02, checkout-expired-02, draft-scope-denied-02, payment-1024-02 and two-origins-prepaid-390-04. None are missing or unread.

I also read the current visual-context, the full preflight-r2 and the fix-map, and checked each cited line in the source. Matching hashes don't prove how the pages look; every judgment below comes from the images.

## Prior P2s, with current source and what the render shows
| # | Source (grep-verified) | Render observation | Status |
|---|---|---|---|
| **N1** Allocation money cut off | `checkout-forms.tsx:148`: the option renders `{rupiah(p.shipping_total)} · {p.package_count} paket · {origins}` | The amount now leads and fits completely at 390. allocation-changed-390-02 shows `Rp35.000 · 2 paket · Malang, Pontianak`; the same holds in service-changed-390-02, service-restored-390-01, two-origins-cod/prepaid-390-01 (`Rp35.000…` / `Rp31.000…`) and shipping-subsidized-390-01. | **Fixed** |
| **N2** Pending parcel shows a stale fee | `:95`: when `pending`, the `<dl>` is replaced by "Biaya paket perlu dihitung ulang. Tinjau pesanan untuk melihat ongkir terbaru."; editable labels read "Ongkir/COD/Tarif/Subsidi … tersimpan" | service-changed-390-03: Paket 1 has its new `Rp10.000` service selected, no fee row, and the explanation right below the select. Untouched Paket 2 shows "Ongkir tersimpan Rp27.000". service-restored-390-02: after reload the chosen `Rp10.000` service and the pending text are still there, with no old fee. The no-JS baseline, plus all shipping renders at 390/768/1024/1440, use the "tersimpan" labels: "Ongkir tersimpan", "COD tersimpan" and "Tarif/Subsidi paket tersimpan" (subsidized-390-02). | **Fixed** |
| R4 Restore after reload | `:124` compares the restored intent with the quote (`servicePending`) | See service-restored above. The summary reads "Perhitungan tersimpan Rp431.000", and the button stays "Tinjau pesanan". | Fixed |

## Related prior P3s
| Prior | Source | Render | Status |
|---|---|---|---|
| N3 Routine notice stacked on the total change | `:133` uses `checkout-step-notice`; `:134` uses `.checkout-total-change` (`globals.css:1244`, warning border and surface) | service-changed-390-02: a short grey "Pembagian paket diperbarui." sits above a separate caution-styled box: "Total berubah dari Rp427.000 menjadi Rp431.000. Periksa rincian paket." There is clear spacing before "Penerima". The total-change box appears alone in review-two-origins-prepaid at 390/768/1024/1440. | Fixed |
| N4 Expired payment doesn't say why | `order/[orderId]/page.tsx:21`: "Batas waktu pembayaran telah lewat…", with a separate "ditutup" branch | payment-expired-390-01 states the reason, with the caution icon. The payment summary still shows Rp27.000, −Rp3.000 and Rp222.000. | Fixed |
| N5 Draft conflict easy to miss | `:154` is still a plain `checkout-hint` | draft-conflict-390-02 shows grey text under the button, with no reload action. | **Remains P3 (disclosed)** |
| N6 Pending submit looks unchanged | `globals.css:1301-1302` | review-pending-390-02: grey disabled button "Menyimpan pesanan…" and a greyed textarea. The money rows and the final total stay legible. | Fixed |
| N7 Wide two-origin summary collapsed | `:86`: `matchMedia` change listener plus cleanup | All four wide two-origin renders (shipping and review, COD and prepaid, 1024 and 1440) show the summary open with every line and the total. | Fixed |
| N8 Destination truncated at narrow widths | The selected description renders under the select (`:142-143`) | cod-unavailable-390-02, shipping-unavailable-390-02 and contact-text-200-320-04/05: the closed select still clips, but the full "SYNTHETIC … destination · 0000x" line wraps directly below it. | Fixed |
| Unknown recovery | `:88` labels it "Perhitungan terakhir yang tersedia…"; `:90-91`; exact retry at `:19` | order-unknown-390-01: caution "Balasan belum diterima. Periksa hasil dengan permintaan yang sama.", the button "Periksa hasil tindakan", and the summary "Perhitungan tersimpan Rp225.000". The old "Total permintaan" label is gone. The body copy at `:88` sits inside the closed disclosure, so I confirmed it from source only. | Fixed |

## Final-review money (all native, all visible)
Every check below was done on the rendered slices:
- review-390/768/1024/1440 show Rp210.000, Rp213.000 (COD) and Rp225.000.
- review-subsidized-390 shows the parcel at 27.000 − 3.000 = 24.000, then Produk 198.000 + Ongkir 27.000 − Subsidi 3.000 = **Rp222.000**.
- two-origins-cod shows COD per parcel 208.000 + 223.000 = **Rp431.000**, and the button reads "Buat pesanan COD · Rp431.000".
- two-origins-prepaid shows 10.000 + 27.000 = 37.000, giving **Rp433.000**.

Full selected carrier and service names wrap in final review. Shipping selects put the price first. No essential amount is truncated anywhere.

## Remaining P3s (not blockers)
1. **Draft conflict hint** (N5, disclosed). draft-conflict-390-02 shows only grey hint text, with no caution style or reload action. Minimum fix: caution styling plus a reload link.
2. **Links stay active while pending.** In review-pending-390-02, "Ubah pengiriman" and "Kembali ke formulir" still look like active purple links while the form is disabled. Cosmetic; the fieldset is disabled at `:136`.
3. **Disclosure open at narrow width after crossing the breakpoint.** review-two-origins-cod-390/768, allocation-changed-390 and service-changed-390 start with the summary open ("Tutup ringkasan"). That pushes the steps about 650 px down at 390. The listener at `:86` only opens the summary and never closes it, so a buyer who rotates or resizes from wide to narrow keeps it open. The content is correct and you can still collapse it, so this is not a blocker. Optional fix: collapse it again when the media query stops matching, unless the buyer opened it themselves.

## CO1–CO8 contract checks
- **Shell and layout:** focused header (Keranjang / logo / Bantuan) with compact policy links. No shopping tabs, floating money bar or fake chat.
- **Brand:** Inter with the purple and yellow roles.
- **Widths:** 390 has the native summary disclosure with the known amount and a basis label. 768 stacks. 1024/1440 use the roughly 1080px shell at about 56/44.
- **Enlarged text:** 320/200% stacks the label above the amount with no horizontal overflow.
- **Payment page:** the compact 40rem layout has no fake second column. Pending is neutral, unknown and closed show a caution, and the failed state shows an explicit alert.
- **Facts and claims:** I saw no invented methods, ETAs, trust claims, stock or paid status. The simulation is labelled and the SYNTHETIC fixtures are honest.
- **References:** used for hierarchy only. Nothing copied from Tokophi's blue/Rp0/voucher, or from the S08 estimate and subsidy totals.

## Not claimed
I made no interaction, keyboard or WCAG claim and did not re-run browser20 or native10. No physical Safari or device, native support/chat, S27 receipt or `design-gate` result is implied; those remain downstream parent gates. Renewed engineering source-r5, canonical visual review rounds 15–19 and final R3 are still pending and separate.
