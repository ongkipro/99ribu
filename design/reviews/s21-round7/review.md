Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s21/account-pending-1440.png, docs/spec/design/renders/s21/account-pending-390.png, docs/spec/design/renders/s21/cart-pending-1440.png, docs/spec/design/renders/s21/cart-pending-390.png, docs/spec/design/renders/s21/category-1440.png, docs/spec/design/renders/s21/category-390.png, docs/spec/design/renders/s21/departments-1440.png, docs/spec/design/renders/s21/departments-390.png, docs/spec/design/renders/s21/empty-390.png, docs/spec/design/renders/s21/help-1440.png, docs/spec/design/renders/s21/help-390.png, docs/spec/design/renders/s21/home-1440.png, docs/spec/design/renders/s21/home-390.png, docs/spec/design/renders/s21/home-products-detail-390.png, docs/spec/design/renders/s21/invalid-filter-390.png, docs/spec/design/renders/s21/not-found-1440.png, docs/spec/design/renders/s21/not-found-390.png, docs/spec/design/renders/s21/product-preview-1440.png, docs/spec/design/renders/s21/product-preview-390.png, docs/spec/design/renders/s21/product-preview-detail-390.png, docs/spec/design/renders/s21/search-1440.png, docs/spec/design/renders/s21/search-390.png, docs/spec/design/renders/s21/text-200-320.png, docs/spec/design/renders/s21/text-200-section-320.png
References: docs/spec/design/refs/carbon-table/1440-top.png, docs/spec/design/refs/ikea-id/1440-top.png, docs/spec/design/refs/ikea-id/390-top.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 6c711cdad12de1d1
Images-SHA: 2d7f3ae10dc21b0f
Output-SHA: 396983e25b11e59f

Paduka Ongki, semua 50 gambar sudah saya buka dan periksa. Hasilnya **REVISE**: ada dua masalah kecil tapi kelihatan, sisanya sudah memenuhi kontrak. Detail review di bawah ini dalam bahasa Inggris (format teknis yang diminta).

---

### Section lines (top to bottom)

**Shared chrome**
- Simulation strip ("Data contoh. Pesanan dan pengiriman simulasi.") | authored | none | Keep it. It is honest, quiet and fits on one line at 390 and two lines at 320/200%.
- Desktop header (wordmark, wide search, Keranjang/Akun, category row) | authored | IKEA 1440 header with the dominant grey search | On `/cart` and `/account`, mark the matching desktop utility as current the way mobile tabs and the "Busana" underline already do. Right now the desktop header shows no state on those pages.
- Mobile header (wordmark, then full-width search, then category links) | authored | IKEA 390 compact utility row, without its header/campaign overlap | none needed.
- Footer (wordmark, price basis, sample-catalog note) | generic | none | **Add help/policy links ("Cara pesan dan pengembalian").** The footer has no links on any page. The help page is reachable only from the home "Sebelum memesan" link, so category, search, PDP, cart and 404 pages have no route to shipping/return facts. The footer sentence also repeats home's "Sebelum memesan" copy almost word for word.
- Mobile bottom tabs | authored | MW1 | none needed. The selected state uses purple plus bold text, and Kategori/Keranjang/Akun/none are selected correctly.

**Home**
- Top band at 1440 (headline, yellow price group, departments) | authored, but grouping is off | IKEA category-first | Stack the yellow group under the headline text in the left column. As rendered, the yellow box sits about 98px from its text and only about 48px from the department column. Its top (y≈179) does not line up with the headline (≈210) or the "Pilih kategori" heading (≈190). The result reads as three loose columns rather than SF2's "text/yellow price group beside departments", and there is dead white space under both the text and the yellow box down to y≈472.
- Top band at 390 | authored | MW2 | none needed. Order is headline, price, then departments. The two-option sentence lives inside the yellow group once.
- "Pilih kategori" tiles | authored | IKEA image-led category tiles (labels below instead of inside) | none needed. These are labeled photo slots sized at 200px square with shot briefs; that is owner content, not a design failure.
- "Mulai dari pilihan ini" grid | authored | Dawn comparable product units | none needed. Four columns at 1440 and two at 390. Quantities sit next to the price, "/ pilihan lengkap" follows at 13px, there are no card frames, and the first product names fit inside 900px.
- "Sebelum memesan" | authored | Baymard/C1 factual help | Keep it, and remove its duplicate from the footer (see the footer line).

**Category / search**
- Heading, page count and removable chips | authored | SF4 | At 390 search, the "Isi pilihan: Paket barang yang sama" chip wraps and its × sits about 40px right of the label text. The first chip's × hugs its label. Keep the × attached to the end of the label text.
- Filter side region at 1440 | authored | SF4 | none needed. Fields are labeled native selects, with one purple apply button and a reset text link.
- Mobile filter disclosure | authored | MW4 | none needed.
- Result grid with 2 or 1 items | authored | SF3 | none needed. Comparable track widths are kept rather than stretched.

**States**
- Empty search (390) | authored | SF5 | none needed. The query is kept and there is one recovery action.
- Invalid filter (390) | authored | SF5 | none needed. It names the problem and the valid options, and keeps the query.
- 404 (1440/390) | authored | none | none needed. No tab is falsely selected.
- Cart and account pending (1440/390) | authored | Tokophi empty-state single action, without its dashed card or blue | none needed. The copy is truthful and does not pretend there is an empty stored cart.

**Other pages**
- Departments page | authored | IKEA tiles | none needed. The large empty right area is honest for two categories. I could not verify from the image what is inside "Kategori lainnya".
- Help (1440) | authored | none | The 760px reading column starts at x=340, while every other page starts at x=120. Left-align it to the page edge or put it under a page-level heading at 120. "Kembali ke katalog" is a text link here but a button on the 404 page; pick one.
- Product preview (1440/390) | authored | C2 media/decision split | Add a link to shipping/return facts in the purchase region. C2 requires these facts to be reachable from the PDP. Option selection and the cart are out of scope here (they belong to S22).
- 200% text at 320 | authored | SF7 | none blocking. Headings wrap without clipping and the whole card gets the focus ring. The two-row fixed nav takes about 170 of 844px. That is acceptable, but keep MW6's fallback to normal flow in mind if more rows appear.

---

### Evidence and reference comparison
- **IKEA 1440 (`ee576f…-1440-top-01`).** Transferred: the dominant rounded grey search and light-grey image-led category tiles with labels. Correctly excluded: the carousel, campaign red/flowers, heart emoji in the nav and the blue notice bar.
- **IKEA 390 (`69ce9a…-390-top-01/02`).** This capture shows the header overlapping the campaign. The 99ribu mobile header has no overlap.
- **Tokophi 390 (`11946f…-390-01`).** The compact shell and one-action empty state carry over to cart-pending. Tokophi's blue and dashed frame are correctly not adopted.
- **Carbon 1440 (`aaccc2…`).** This is an operator reference and it is correctly not applied to the storefront.
- **Template signals checked and absent:** dark/blueprint hero, accent-word headline, eyebrows, icon-tile cards, monospace labels, `→` buttons, unsourced stats, "resmi/terpercaya" claims.
- **Business fit.** The page is specific to this business because it keeps per-complete-option contents beside every Rp99.000. With the name swapped, the layout would not suit an unrelated business.
- **Research gap (already acknowledged in the document).** Target, Blibli and Dawn have no successfully inspected render here, so multi-category information architecture rests on IKEA plus written sources. No real product photography exists yet; the layouts are built around correctly sized labeled slots.

**Most important change:** Put help/return/shipping links in the footer on every page (and link from the PDP purchase region), and drop the footer sentence that duplicates "Sebelum memesan". Second, stack the yellow price group under the desktop home headline so the top band reads as text-plus-price beside departments.

**Verdict: REVISE**

This verdict covers visual review only. It is not evidence of interaction or accessibility testing.