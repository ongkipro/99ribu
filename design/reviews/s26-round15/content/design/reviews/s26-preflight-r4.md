Warning: claude.ai MCP servers blocked by enterprise policy: claude.ai Zapier, claude.ai Descript, claude.ai KOL Kelola, claude.ai Hugging Face, claude.ai ClickUp, claude.ai Google Calendar
Paduka Ongki, preflight r4 sudah selesai. Hasil advisory-nya **GO**. Semua 163 slice saya buka dan nominal ongkir untuk alokasi yang dipilih sekarang sudah cocok dengan rincian paket. Tidak ada blocker baru, cuma ada beberapa catatan P3. Laporan lengkapnya di bawah (dalam English).

---

# S26 visual preflight r4: advisory report (read-only)

**Verdict: GO.** This is advisory only. It is not a canonical PASS, source approval, engineering approval, WCAG or interaction claim, or final acceptance, and it consumes no owner round. Engineering source-r6 is separate and still pending.

**Reviewer:** Claude Code CLI, model `claude-opus-5-5`. Provider and reasoning effort are not exposed to me. I am not the builder, T2 Gemini or the canonical reviewer.

**What I did not touch:** I wrote no files. That includes no plan file, even though this session started in plan mode, because the brief forbids all writes. I also ran no tests, used no DB, network, provider, credentials, workers or other agents, and made no Git changes. I did not edit `design/review.md`, the rounds log or any evidence files, and I did not run `/tmp/99ribu-s26-preflight-r4-verify.py`.

## Integrity (checked before and after; nothing changed)
| Item | Before | After |
|---|---|---|
| HEAD | `8b17eee844ba9715581959fc0821af25ce1b99ef` | same |
| Source manifest r6 | `e3c4a6c0…8f04` | same |
| Preflight manifest r4 | `09929513…9123` | same |
| `design/reviews/s26-visual-context.md`, `design/review-rounds.log`, `design/review.md` | fingerprints match | match |
| Renders / refs / slices | 59 / 4 / 163: sha256 and byte size match, 0 mismatches; slice directory holds exactly 163 files | same |

**Inspection count:** I opened all **163 of 163** listed slices with the image reader at slice size. They cover all 59 renders (including the new `shipping-return-selected-390`) and all 4 refs: Tokophi 1440/390 (`5d95…`, `1194…`) and S08 checkout 1440/390 (`466b…`, `3dad…` ×2).

Five slices are blank trailing strips: checkout-empty-02, checkout-expired-02, draft-scope-denied-02, payment-1024-02 and review-two-origins-prepaid-390-04. One slice boundary cuts through the COD button text (review-two-origins-cod-768-03/04); the two halves together show it intact. No slice was accepted on hashes alone.

**Context I read:**
- the current visual-context (CO1–CO8 table and the selected-allocation paragraph)
- docs10 CO1–CO8 (`:353–360`)
- the current `s26-preflight-fix-map.md`
- the full prior preflight-r3 report (`/tmp/99ribu-s26-preflight-r3.txt`)
- the full source-r5 P2 report

## Primary item: selected-allocation correction (source-r5 P2)
- **Source (grep-verified):** `src/components/storefront/checkout-forms.tsx:148` renders `rupiah(p.id===quote.selected_allocation_id?quote.shipping_total:p.shipping_total)} ongkir · {p.package_count} paket · {origins}`. Both amounts are native. The UI calculates nothing. The amount comes first and is labelled "ongkir".
- **shipping-return-selected-390 (01–04), as rendered:**
  - Closed allocation select: `Rp38.000 ongkir · 2 paket · Pontianak, Mala…`. The amount is fully visible; only the origin list clips.
  - Paket 1 (Pontianak): selected service `Rp30.000 · Local shipping simulation`, "Ongkir tersimpan Rp30.000".
  - Paket 2 (Malang): `Rp8.000`, "Ongkir tersimpan Rp8.000".
  - Summary: Produk 396.000 + Ongkir 2 paket 38.000 = **Total Rp434.000**, labelled "Perhitungan tersimpan".
  - The allocation figure, the parcel figures and the summary agree, so no stale default appears.
- **Cross-check with final review:** review-two-origins-prepaid at 390/768/1024/1440 shows Pontianak Regular Rp30.000 + Malang Economy Rp8.000 = 38.000, total 434.000, and the button "Buat pesanan · Rp434.000". The total-change notice reads "431.000 → 434.000". These are this fixture's native rates only, not a general tariff.
- **Alternatives still show the native default:** in allocation-changed-390-02 the newly chosen alternative reads `Rp35.000 ongkir · 2 paket`, while the summary stays at the stored 31.000/427.000. The notices "Perbarui pembagian…" and "Perbarui pembagian paket" are present. The old and new amounts are clearly separated.
- **Status: corrected in the rendered states I inspected.** I did not re-run the browser test.

## Prior material asks still hold (source line + rendered evidence)
| Ask | Source | Render observation |
|---|---|---|
| N1: amount first in allocation and service selects | `:148`; service options at `:95` (`rupiah(o.shipping_amount)` first) | Every shipping render at 390/768/1024/1440 shows the full amount at the start of both selects. Long origin and service names clip after the amount only. |
| N2: pending parcel drops stale charges | `:95` | service-changed-390-03 and restored-390-02: Paket 1 shows the new `Rp30.000` choice plus "Biaya paket perlu dihitung ulang. Tinjau pesanan…", with no fee row. Untouched Paket 2 shows "Ongkir tersimpan Rp8.000". Below that: "Tinjau pesanan untuk menghitung layanan dan total terbaru." |
| Stored labels, including no-JS HTML | `:95` | "Ongkir tersimpan", "COD tersimpan" and "Tarif/Subsidi paket tersimpan" appear in shipping-*, the two-origin COD 390/768/1024/1440 renders and shipping-subsidized-390-02. |
| R4: pending choice survives reload | `:124` | restored-390-01/02: the select stays on Rp30.000, the pending text remains, the summary says "Perhitungan tersimpan Rp431.000", and no old fee shows. |
| Final review shows all charges | `:82` (`QuoteCharges`) and the `:150` confirm label | review-390: 210.000. review-768 COD: 213.000. review-1024/1440: 225.000. Subsidized: 27.000 − 3.000 = 24.000, total 222.000. Two-origin COD: per-parcel COD 223.000 + 208.000 = 431.000, button "Buat pesanan COD · Rp431.000". Two-origin prepaid: 434.000. |
| Unknown-order recovery | `:88`, `:90`, `:20` | order-unknown-390-01: caution "Balasan belum diterima. Periksa hasil dengan permintaan yang sama.", the button "Periksa hasil tindakan", summary "Perhitungan tersimpan Rp225.000", and Help. No request-amount or paid claim. |
| Routine notice vs. total change | `:133`, `:134` | service-changed-390-02: grey "Pembagian paket diperbarui." above a separate caution box "Total berubah dari Rp427.000 menjadi Rp431.000". |
| Disabled pending state | `globals.css:1301–1302` | review-pending-390-02: grey "Menyimpan pesanan…" button and a greyed textarea; the amounts stay legible. |
| Known expiry reason | order page `:21` | payment-expired-390-01: "Batas waktu pembayaran telah lewat…" with the 27.000 / −3.000 / 222.000 rows. |
| Wrapping destination description | `:142` | cod-unavailable-02, shipping-unavailable-02 and contact-text-200-320-04/05: the select clips, but the full "SYNTHETIC … · 0000x" line wraps below it. |
| Wide summary opens | `:86` | All 1024/1440 checkout renders show the summary open with every line and the total. |
| 320 px at 200% text | `globals.css:1305` | Label above amount, header stacks, no horizontal overflow in any of the 8 slices. |
| Payment page states | — | Pending is neutral, unknown and expired use a caution, failed uses red explicit text, and denied asks to restore access. The 40rem layout has no fake second column, and nothing claims a payment is complete. COD 768 shows per-parcel "Paket 1 dari Malang: Rp213.000". |

## P3 notes (none block)
1. **Disclosed P3s, still present:**
   - draft-conflict-390-02: the "Draf berubah… Muat ulang…" hint is still plain grey text with no reload action.
   - review-pending-390-02: the "Ubah pengiriman" and "Kembali ke formulir" links still look active purple while the form is disabled.
   - The narrow summary stays open after crossing from wide: shipping-return-selected-390-01, allocation-changed-390-01, service-changed-390-01 and review-two-origins-cod-390/768-01. Content and totals are correct and the summary can be collapsed.
2. **New observation, pending service:** while Paket 1 shows a pending Rp30.000 choice, the allocation option still reads the stored `Rp35.000 ongkir` (service-changed-390-02, restored-390-01). It matches the stored summary, and two explicit pending messages are on screen, so this is not a contradiction. The allocation option itself has no "tersimpan" qualifier. *Optional fix:* add "tersimpan" to the option while `servicePending` is true.
3. **New observation, subsidized wording:** shipping-subsidized-390-01/02 uses "ongkir" for the gross Rp27.000 in the allocation option and in the summary's "Ongkir 1 paket". The parcel row "Ongkir tersimpan Rp24.000" is the net amount after "Tarif paket tersimpan 27.000 / Subsidi −3.000". The calculation is shown right there and the final review is consistent. This wording predates this fix. *Optional fix:* align the terms ("Tarif" for gross, "Ongkir dibayar" for net).

## Design contracts (CO1–CO8) and references
- **Shell and brand:** focused header (Keranjang / 99ribu / Bantuan) with compact policy links. No shopping tabs, floating pay bar or fake chat. Inter with purple/yellow.
- **Widths:** 390 has the known-total disclosure with a basis label. 768 stacks. 1024/1440 use the roughly 56/44 shell with a neutral summary.
- **Facts and claims:** no invented methods, ETAs, trust claims, stock or paid status. Simulation and SYNTHETIC labels are honest fixture data, and the focus rings are legitimate.
- **References:** used for hierarchy only. Nothing taken from Tokophi's blue, Rp0 or voucher, or from S08's estimate and subsidy figures.

## Not claimed
- No re-run of browser20, native10 or cart16.
- No WCAG, keyboard or interaction claim.
- No physical Safari or device test, native chat, S27 receipt or design-gate result.
- Engineering source-r6, canonical rounds 15–19 and final R3 remain separate and pending.
