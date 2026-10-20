Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s22/cart-1024.png, docs/spec/design/renders/s22/cart-1440.png, docs/spec/design/renders/s22/cart-390.png, docs/spec/design/renders/s22/cart-768.png, docs/spec/design/renders/s22/cart-empty-1440.png, docs/spec/design/renders/s22/cart-empty-390.png, docs/spec/design/renders/s22/cart-expired-390.png, docs/spec/design/renders/s22/cart-nojs-390.png, docs/spec/design/renders/s22/cart-pending-390.png, docs/spec/design/renders/s22/cart-publication-detail-390.png, docs/spec/design/renders/s22/cart-publication-review-390.png, docs/spec/design/renders/s22/cart-quote-expired-390.png, docs/spec/design/renders/s22/cart-quote-expired-detail-390.png, docs/spec/design/renders/s22/cart-session-denied-390.png, docs/spec/design/renders/s22/cart-stock-conflict-390.png, docs/spec/design/renders/s22/cart-stock-detail-390.png, docs/spec/design/renders/s22/cart-text-200-320.png, docs/spec/design/renders/s22/pdp-1024.png, docs/spec/design/renders/s22/pdp-1440.png, docs/spec/design/renders/s22/pdp-390.png, docs/spec/design/renders/s22/pdp-768.png, docs/spec/design/renders/s22/pdp-back-1440.png, docs/spec/design/renders/s22/pdp-back-390.png, docs/spec/design/renders/s22/pdp-back-list-1440.png, docs/spec/design/renders/s22/pdp-back-list-390.png, docs/spec/design/renders/s22/pdp-back-nojs-390.png, docs/spec/design/renders/s22/pdp-text-200-short-320.png, docs/spec/design/renders/s22/pdp-unavailable-390.png, docs/spec/design/renders/s22/pdp-unknown-390.png, docs/spec/design/renders/s22/pdp-version-conflict-390.png
References: docs/spec/design/refs/carbon-table/1440-top.png, docs/spec/design/refs/ikea-id/1440-top.png, docs/spec/design/refs/ikea-id/390-top.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png, docs/spec/design/renders/s08/product-1440.png, docs/spec/design/renders/s08/product-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 2dbd4716b1d43fb1
Images-SHA: 850ba11b05a25166
Output-SHA: 056c591dc880f693

Paduka Ongki, saya sudah buka ke-76 gambar yang ada di daftar. Hasilnya REVISE. Review di bawah saya tulis dalam bahasa Inggris karena ini output teknis.

## Section lines (top to bottom)

**PDP (390/768/1024/1440, back, nojs, unknown, version-conflict, unavailable, 320/200%)**
- Simulation strip + task header (Back/wordmark/cart) | authored | S08 accepted PDP header | Make the cart count look the same on every surface: plain "1" in the PDP header, a pill badge in the mobile tabs, "(2)" with underlined brackets at 768, and a separately underlined "Keranjang (2)" at 1440.
- Category links | authored | S08 breadcrumb | No fix.
- Media slot + shot-brief caption | authored | S08/SF6 honest photo slot | No fix. It's square, labeled, sized for the real photo, and the brief sits outside the slot.
- Title/price/basis | authored | global type tokens | Cut the "Harga berlaku untuk satu pilihan lengkap…" sentence. "/ pilihan lengkap" already says it, and the paragraph above the quantity field says it a third time.
- Option selection | authored but over-built | S08 size chips | Every fixture has exactly **one** option, yet each one shows a radio fieldset, an instruction line and a "Lihat pilihan" button for a choice the buyer can't make. Show a single option as a static fact. No render has 2+ options, so the core variant-selection composition (P2) has no visual evidence at all.
- Contents / applied offer / stock | authored | S08 "Isi yang diterima" | No fix. This is the strongest part: contents sit right next to the applied offer.
- Purchase region | authored | S08 single purchase region | At 390 the add-to-cart button sits around y≈1300, so it's outside the first viewport. S08 was tighter. Hide "Lihat pilihan" for single options and drop the duplicate basis copy to bring it up.
- Unknown-outcome block | authored | MW5 | No fix. The primary retry plus "Periksa keranjang" and the no-double-add statement are clear.
- Version conflict | authored | P3 | No fix. One field-adjacent error and the input is kept.
- Unavailable | authored | P2 | "Cari produk tersedia" renders as unlinked grey text with no period, so the recovery isn't visibly actionable. Make it a real link.
- Spesifikasi + shipping/returns disclosures | authored | S08 | No fix. Missing facts are stated honestly.
- Footer | authored | S21 accepted | No fix.

**Cart (390/768/1024/1440, nojs, pending, expired, quote-expired, publication, stock, session-denied, empty, 320/200%)**
- Shopping header + tabs | authored | MW1/SF1 | No fix.
- Parent line record | authored | C1/S08 cart preview | At 1440, "Perbarui jumlah" stretches to about 346px and outweighs everything else on the line. Cap its width.
- Pending | authored | MW5 | No fix. Only the affected form changes state, and the other line stays usable.
- Stock conflict | authored, redundant | C2 | The grey "Stok tidak cukup…" note and the red "Jumlah itu belum tersedia…" error say the same thing back to back. The contract asks for one associated error. Keep the red one.
- Publication review | authored, redundant | C2 | The yellow "Rincian pilihan berubah" box and the red sentence below it repeat each other. The "Persetujuan mempertahankan…" line also sits directly under the bullet with no gap.
- Publication detail viewport | rendering finding | none | In `f2a2545412d79748-…-01.png`, "Setujui isi terbaru" is cut off by the fixed tab bar. No slice shows the approval control clear of it, even though the critique says one does.
- Expired cart | authored | C3 | The greyed input and buttons still look like a form. Show the quantity as static text and drop the disabled controls.
- Quote expired | authored | C4 | No fix.
- Summary panel | authored | Tokophi focused summary | At 320/200%, "Rp198.000" wraps to the left under its label while "Dihitung saat checkout" stays right-aligned. Keep money values aligned to one edge.
- Session denied | partly generic | none | Three outline buttons of equal weight, and the destructive "Akhiri sesi dan mulai ulang" looks the same as the safe actions. Make "Muat ulang keranjang" primary and separate the destructive action under its consequence text.
- Empty cart | authored | Tokophi empty recovery | No fix. One action and no payable-zero summary.

**Search list (back-list 390/1440):** authored, IKEA search/category transfer. In the 600px-high fixture the tab row sits between the search and the results. This is the documented short-height rule, not a defect.

## Evidence and reference transfer
- **IKEA** (`ee576f…1440-top`, `69ce9a…390-top-01/02`): what transferred is the dominant search and the category row. The carousel and promo stack were correctly left out.
- **Tokophi** (`11946f…390-01`): the empty-cart single recovery and the summary-panel hierarchy transferred. The blue was correctly excluded.
- **S08 product** (`8fb075…1440`, `d7dc3b…390-01/02`): the task header, media/decision split, contents list and single purchase region all carried over. S08's purchase region was more compact: chips plus one price-and-button row. S22 roughly doubled the decision-region height with instructional copy. That's the main mismatch.
- **Carbon** (`aaccc2…1440-top`): this is an admin table reference with no role on a buyer PDP or cart. I'm noting it as not applicable rather than inventing a link.
- Template signals I checked for: no dark hero, accent-word headline, eyebrow pills, monospace labels, arrow buttons, unsourced stats or "resmi/terpercaya" claims. The direction is product-first and brand-correct, and Inter/purple/yellow are applied with restraint.

I saved a short copy of these findings to `/home/ongki/.claude/plans/you-review-a-web-calm-clock.md`; I didn't change any source files.

Most important change: Collapse the PDP decision region by showing a single offer as a static fact, removing the two restated price-basis sentences and duplicate errors, and add a multi-option fixture render so variant selection gets real visual evidence.

Verdict: REVISE