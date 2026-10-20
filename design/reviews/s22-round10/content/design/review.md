Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s22/cart-1440.png, docs/spec/design/renders/s22/cart-390.png, docs/spec/design/renders/s22/cart-768.png, docs/spec/design/renders/s22/cart-empty-1440.png, docs/spec/design/renders/s22/cart-empty-390.png, docs/spec/design/renders/s22/cart-expired-390.png, docs/spec/design/renders/s22/cart-nojs-390.png, docs/spec/design/renders/s22/cart-pending-390.png, docs/spec/design/renders/s22/cart-publication-detail-390.png, docs/spec/design/renders/s22/cart-publication-review-390.png, docs/spec/design/renders/s22/cart-quote-expired-390.png, docs/spec/design/renders/s22/cart-quote-expired-detail-390.png, docs/spec/design/renders/s22/cart-session-denied-390.png, docs/spec/design/renders/s22/cart-stock-conflict-390.png, docs/spec/design/renders/s22/cart-stock-detail-390.png, docs/spec/design/renders/s22/cart-text-200-320.png, docs/spec/design/renders/s22/pdp-1440.png, docs/spec/design/renders/s22/pdp-390.png, docs/spec/design/renders/s22/pdp-768.png, docs/spec/design/renders/s22/pdp-back-1440.png, docs/spec/design/renders/s22/pdp-back-390.png, docs/spec/design/renders/s22/pdp-back-list-1440.png, docs/spec/design/renders/s22/pdp-back-list-390.png, docs/spec/design/renders/s22/pdp-back-nojs-390.png, docs/spec/design/renders/s22/pdp-text-200-short-320.png, docs/spec/design/renders/s22/pdp-unavailable-390.png, docs/spec/design/renders/s22/pdp-unknown-390.png, docs/spec/design/renders/s22/pdp-version-conflict-390.png
References: docs/spec/design/refs/carbon-table/1440-top.png, docs/spec/design/refs/ikea-id/1440-top.png, docs/spec/design/refs/ikea-id/390-top.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png, docs/spec/design/renders/s08/product-1440.png, docs/spec/design/renders/s08/product-390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 26eed9906e15a7d6
Images-SHA: b3bc8dfffae21b9e
Output-SHA: eb783331b812a4c0

Paduka Ongki, saya sudah membuka ke-66 slice, ditambah referensi S08 PDP yang diterima sebagai pembanding. Hasilnya: tidak ada pola template generik, tapi hierarki PDP mobile mundur dibanding S08, dan ada beberapa masalah state/render. Verdict-nya **REVISE**.

## Section-by-section

**PDP (pdp-390/768/1440, back, back-nojs, unknown, version-conflict, unavailable, text-200)**
- Focused task header | authored | S08 header: Back + brand + cart | At 320/200% the cart icon falls to its own row and stays ~20px while the text doubles (`d91ba…-01`). Keep the cart icon on the brand row and size it in `em`.
- Media slot | authored | S08 media slot with shot brief | None needed at 390/1440: the brief is item-specific and sized like a real photo. At 320/200% the slot is no longer square (`d91ba…-01`); keep `aspect-ratio:1`.
- Title + price | generic hierarchy | none (S08 regressed) | On 390, `Rp99.000` renders at ~15px bold. That is below the 20/28 mobile price token, smaller than the option heading "Paket lengkap" (18/26), and smaller than the card price on the listing (`e6fa…-01/02`, ~20px). Desktop (`4c39…`) correctly uses 24/32. Apply the price token on mobile and put price directly under the title, as in S08.
- Option selection | authored but weaker than the contract | S08 labeled option chips | The native select plus a "Lihat pilihan" button hides choices. On `pdp-unavailable-390-01` the selected value is cut to "Pilihan 2 kaos · Belum", so the clipped label drops the availability fact. The selected option name then repeats as a heading right below. Show options as labeled radio choices with the state in text (as in S08's "L · habis"), keep a submit for no-JS, and drop the duplicate heading.
- Contents | partial | S08 "Isi yang diterima" | The bullet list has no heading and floats between price and stock text. Add a section heading (20/28).
- Spec / category facts | missing | S08 had a spec region with "Belum tersedia" | C2 requires contents, specification, delivery and return facts in reading order. S22 has no breadcrumb/category and no spec region. Restore both as labeled owner-content slots.
- Stock + disclaimer + purchase | generic | none | "Stok pilihan tersedia/belum tersedia" is plain 14px with no icon or emphasis. It is followed by three lines of grey system text ("isi keranjang belum memesan stok") right before the controls, and "Jumlah pilihan" sits about 4px below that paragraph. In the unavailable state the add button is just greyed out: no adjacent reason, no alternative offer (P2 requires "offers real alternatives"). Show stock with an icon and text next to the controls, move the disclaimer below the button, and put the reason plus an alternative-option link beside the disabled add.
- Feedback states | mixed | none | The version conflict shows the identical sentence twice, once black and once red (`81be…-02`). The no-JS success (`44d4…-02`) is plain body text with no status treatment. In the unknown state (`3710…-02`) "Periksa keranjang" is indented ~12px out of alignment and "Lihat keranjang" appears again right below it. Use one status block per state with an icon and title, aligned links, and no repeated destination.
- Secondary links | generic | none | "Lihat keranjang" and "Ongkir dan pengembalian" are stacked bare links; at 200% they nearly touch (`d91ba…-03`). Shipping/returns should be an inline disclosure (as in S08), not an off-page link.

**Cart (cart-390/768/1440 and its states)**
- Header/nav | authored | IKEA-derived search-first shell | At 768 (`291a…-01`) the cart/account icons have no label and no count badge, while 1440 shows "Keranjang (2)" and 390 shows a badge. Show the count at every width. In `pdp-back-list-390-01` the bottom tabs render in normal flow under the header at ordinary text size. If that capture used a normal viewport height, it contradicts SF1/MW1, so check it.
- Line record | authored | S08 cart-preview row | The photo slot is 80–128px with a ~9px brief. On 768 (`291a…-01`) "Foto belum tersedia" touches the top edge and the brief is unreadable; on 390 the brief disappears. Either show the brief at a legible size or drop it on thumbnails and keep it in the PDP.
- Line actions | generic | none | The heaviest element on the page is the full-width purple "Perbarui jumlah". With checkout absent, a quantity update becomes the visual primary task. Make Perbarui secondary/outlined and keep purple for the eventual checkout continuation.
- Summary | authored | Tokophi summary hierarchy | "Checkout sedang disiapkan…" is shown in every state, including the expired, read-only cart (`eb2e…-02`), where it contradicts the expiry notice. In pending (`a148…-02`), "Tunggu sampai keranjang selesai diperbarui." sits at the bottom of the summary under a link, far from the line that is pending. Make the summary copy state-aware and put pending feedback on the affected line.
- Empty | partially authored | Tokophi empty-cart reference | It shows "0 pilihan · Rp0" above "Keranjang masih kosong" (`dc74…`, `a4f7…`), which is the payable-zero display the contract excludes. "Lanjut pilih produk" and "Lihat produk" also repeat the same destination. Remove the Rp0 line and keep one recovery action.
- Expired | authored | none | It stacks two yellow notices (cart expired + shipping quote expired). The quantity input still looks editable while its buttons are disabled, and the bottom tab still shows a "1" badge for a dead cart. Show one notice, a read-only-looking input, and no live-count badge.
- Stock conflict | generic | none | The same "Jumlah itu belum tersedia…" message appears three times: page-level, yellow callout, and red inline (`b762…-01`). Keep one inline error at the field.
- Publication review | authored | none | The old contents are a list while the new contents are a prose sentence inside the callout, so the before/after is hard to compare. "Setujui isi terbaru" also sits beside an editable quantity input, so it is unclear whether approving submits the quantity. Show both contents lists in the same format and separate approval from the quantity field.
- Session denied | generic | none | Three buttons of three different widths and weights; the consequential "Akhiri sesi dan mulai ulang" is the widest and comes first, and "Periksa kembali" is ambiguous. Order them safe action first, then the explicit destructive action, with consistent width.
- 200% text reflow | authored | none | No clipping or horizontal overflow (`7206…-01..04`). The search icon does not scale, which is minor.
- Footer | authored | none | Consistent wordmark, help link and sample-data note.

## Evidence and transfer
Template-signal check: no dark hero, accent-word headline, eyebrow pills, icon-tile card rows, decorative monospace, arrow-on-every-button or unsourced stats. No "resmi/terpercaya" claims appear.

**References.**
- IKEA (`ee576…`, `69ce…`): the transferred findability principle (dominant search, category row) holds. The mobile overlap is correctly not transferred.
- Tokophi (`11946…`): supports the focused cart shell and the single empty-state action. 99ribu copies its Rp0 line, which the contract explicitly rejects.
- Carbon (`aaccc…`): irrelevant to this surface. Its blank live-demo region confirms it is not interaction evidence.
- S08 PDP (`8fb0…`, `d7dc…`, plus the S08 render): the closest relevant reference, and S22 falls below it on price prominence, option visibility, contents heading, spec region and inline shipping/returns.

**Gaps in the brief.**
- There is no stated rationale for replacing S08 chips with a select + "Lihat pilihan". The no-JS requirement alone doesn't require a select, because radios plus a submit work without JS.
- There is no 1024/landscape PDP or cart render, even though the S22 contract names tablet/desktop behavior.

**Most important change:** On mobile, restore S08's PDP order: a 20/28 price under the title, visible option choices with the unavailable state in text, a labeled contents + spec region, and inline shipping/return facts, with the system disclaimer moved below the add button.

**Verdict: REVISE**

The review is saved to `/home/ongki/.claude/plans/you-review-a-web-frolicking-dragonfly.md`. Nothing in the repository was changed.