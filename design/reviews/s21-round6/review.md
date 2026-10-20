Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s21/account-pending-1440.png, docs/spec/design/renders/s21/account-pending-390.png, docs/spec/design/renders/s21/cart-pending-1440.png, docs/spec/design/renders/s21/cart-pending-390.png, docs/spec/design/renders/s21/category-1440.png, docs/spec/design/renders/s21/category-390.png, docs/spec/design/renders/s21/departments-1440.png, docs/spec/design/renders/s21/departments-390.png, docs/spec/design/renders/s21/empty-390.png, docs/spec/design/renders/s21/help-1440.png, docs/spec/design/renders/s21/help-390.png, docs/spec/design/renders/s21/home-1440.png, docs/spec/design/renders/s21/home-390.png, docs/spec/design/renders/s21/invalid-filter-390.png, docs/spec/design/renders/s21/not-found-1440.png, docs/spec/design/renders/s21/not-found-390.png, docs/spec/design/renders/s21/product-preview-1440.png, docs/spec/design/renders/s21/product-preview-390.png, docs/spec/design/renders/s21/product-preview-detail-390.png, docs/spec/design/renders/s21/search-1440.png, docs/spec/design/renders/s21/search-390.png, docs/spec/design/renders/s21/text-200-320.png
References: docs/spec/design/refs/carbon-table/1440-top.png, docs/spec/design/refs/ikea-id/1440-top.png, docs/spec/design/refs/ikea-id/390-top.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: e92e6e100499c2a8
Images-SHA: 7699a0dc11c143e9
Output-SHA: 73826a98af2c120c

Paduka Ongki, saya sudah buka dan periksa langsung ke-48 gambarnya. Verdict: **REVISE**. Review ini cuma penilaian visual, belum ada kode yang diubah, dan ini bukan bukti interaksi atau aksesibilitas.

## Per section (top → bottom)

**Home 1440 / 390**
- Simulation banner | authored | none | Keep. "Data contoh. Pesanan dan pengiriman simulasi." honestly says the data is sample data and adds no visual noise.
- Header (wordmark, search, Keranjang/Akun) | authored | IKEA 1440 (dominant search) | None needed. Search spans x≈253–1100 and is the dominant element, as in the IKEA 1440 capture. On mobile, search comes first and the utilities move to the bottom tabs.
- Category text nav (Semua produk/Busana/Perawatan) | generic | none | On mobile it repeats the Kategori tab. Acceptable, but it costs a row before content at 390.
- Intro + yellow price strip | authored | none | On desktop the copy and the 320px yellow block fill only x 120–920, leaving x 920–1320 empty for about 500px of height. Put the department tiles in that space.
- "Pilih kategori" tiles | authored | IKEA image-led category row | Only two 200px tiles. The "Semua kategori" link sits at x≈544 instead of the container edge (x 1320, where "Semua produk" is), so the right half of the section is empty. Right-align the link, or place the tiles in the band above.
- "Mulai dari pilihan ini" product grid | authored | Dawn/IKEA comparable units | Four equal square slots with labeled shot briefs, contents and price. The repetition is justified because these are products to compare. The "/ pilihan lengkap" label is about 11px and sits about 24px under the price, which detaches the price basis. Use 13/18 and attach it to the price.
- "Yang dihitung satu pilihan…" band | authored | none | The content is useful, but it is the 3rd of 5 repeats of the fixed-price rule (subline, strip, band, footer, every card). Merge it into the yellow strip and drop the band.
- "Sebelum memesan" + help link | authored | none | Factual and short. No change.
- Footer | authored | none | No change.

**Category / Search 1440 + 390**
- Title + count + removable chips | authored | none | On mobile the two filter chips stack about 47px apart. Tighten the gap to 8–12.
- Filter sidebar / disclosure | authored | Carbon-like form anatomy (not storefront evidence) | Native labeled selects, one purple apply action and a reset link. No change.
- Result grid | authored | Dawn | With one result, the empty comparable track stays correctly sized. No change.

**Departments 1440/390** | authored | IKEA category tiles | Two tiles plus a "Kategori lainnya" disclosure. Acceptable as fixture data. The desktop empty space is the same issue as on home.

**Empty / Invalid filter 390** | authored | none | Each keeps the query, names the problem and offers one recovery action. No change.

**Help 1440/390** | authored | none | The centered column of about 760px breaks the x=120 alignment used on other pages, but it reads well for prose. The grey note repeats the top banner. Optional: remove it.

**Product preview 1440/390/detail** | authored | none | Media and decision split, honest "sedang disiapkan" note with no fake buy button. On mobile the price is below the first viewport. S22 owns the C2 task header and the contents list.

**Cart/Account pending 1440/390** | authored | Tokophi empty-cart pattern (heading, one line, one action) | Truthful, with one recovery action. No change.

**Not found 1440/390** | authored | none | No falsely selected tab. No change.

**Text 200% at 320** | authored | none | One-column reflow works, the focus outline wraps the whole card, and the two-row bottom nav keeps whole captions. Two problems: the section heading and its side link stay in one row, so "Mulai / dari / pilihan / ini" wraps to 4 lines at about 2× line spacing ("Pilih kategori" is the same); and the department briefs start at different heights. Let the link wrap below the heading and use unitless line-height. The bottom nav takes about 27% of the viewport; that matches the contract but is worth knowing.

## Comparison with the references
- **IKEA 1440 (`ee576f…`)**: the pill search dominance and the image-tile category row carry over correctly. The campaign carousel, promo badges and emoji were rightly left out. The mismatch is density: IKEA's tile row fills the container, while 99ribu's two left-aligned tiles leave half the band empty.
- **IKEA 390 (`69ce9ad…-01/02`)**: the header overlapping the campaign was correctly not copied.
- **Tokophi 390 (`11946f…`)**: covers checkout only. Its empty-cart pattern matches the cart-pending page.
- **Carbon (`aaccc28…`)**: an operator/table reference, not relevant to these storefront pages. That's fine, just noting it is not evidence for them.
- **Missing references**: no Dawn render is among these slices, and Target/Blibli are blocked. Since this is disclosed in the contract, it is not a finding.

## Template signals
None of the template signals appear:
- no dark hero
- no accent word in the headline
- no eyebrow pills
- no arrows on buttons
- no monospace
- no stat claims
- no "resmi"/"terpercaya" claims
- no illustrations standing in for photos

The photo slots are sized and carry a shot brief each, as the contract requires.

## Image paths inspected
All 48 listed paths under `design/review-slices/` were opened. These are the main ones the findings rest on:
- `1f01ca90…-home-1440-01/02`
- `7947aebb…-home-390-01..03`
- `273be850…-category-1440-01`
- `41d1a7df…-search-1440-01`
- `4c688750…-search-390-01/02`
- `fab92fc4…-text-200-320-01..08`
- `7ce26dc7…-product-preview-1440-01`
- the 3 reference sets above

The review is also saved to `/home/ongki/.claude/plans/you-review-a-web-serialized-church.md`.

Most important change: on desktop home, move the department tiles into the empty band to the right of the intro and price block, or make the category row span the full container with "Semua kategori" right-aligned, so the top half is balanced and product names appear in the 1440×900 first viewport.
Verdict: REVISE