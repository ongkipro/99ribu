Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s21/account-pending-1440.png, docs/spec/design/renders/s21/account-pending-390.png, docs/spec/design/renders/s21/cart-pending-1440.png, docs/spec/design/renders/s21/cart-pending-390.png, docs/spec/design/renders/s21/category-1440.png, docs/spec/design/renders/s21/category-390.png, docs/spec/design/renders/s21/departments-1440.png, docs/spec/design/renders/s21/departments-390.png, docs/spec/design/renders/s21/empty-390.png, docs/spec/design/renders/s21/help-1440.png, docs/spec/design/renders/s21/help-390.png, docs/spec/design/renders/s21/home-1440.png, docs/spec/design/renders/s21/home-390.png, docs/spec/design/renders/s21/home-products-detail-390.png, docs/spec/design/renders/s21/invalid-filter-390.png, docs/spec/design/renders/s21/not-found-1440.png, docs/spec/design/renders/s21/not-found-390.png, docs/spec/design/renders/s21/not-found-nojs-390.png, docs/spec/design/renders/s21/product-preview-1440.png, docs/spec/design/renders/s21/product-preview-390.png, docs/spec/design/renders/s21/product-preview-detail-390.png, docs/spec/design/renders/s21/search-1440.png, docs/spec/design/renders/s21/search-390.png, docs/spec/design/renders/s21/text-200-320.png, docs/spec/design/renders/s21/text-200-section-320.png
References: docs/spec/design/refs/carbon-table/1440-top.png, docs/spec/design/refs/ikea-id/1440-top.png, docs/spec/design/refs/ikea-id/390-top.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 2975f8d6c258773a
Images-SHA: 0db516db82ae59af
Output-SHA: efd317f96b83cc85

Paduka Ongki, saya sudah membuka 52 slice gambar dan dua referensi IKEA. Review di bawah dalam bahasa Inggris sesuai format yang diminta.

## Section-by-section

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Sample-data strip + header (all routes) | authored | IKEA 1440 search-first header, without its campaign strip | Make the active Keranjang/Akun label keep the same width when bold. On cart and account the search field shrinks about 3px (ends near x≈1097 vs 1100 on home), so the header shifts between routes. |
| Mobile header category row | authored | none (99ribu's own pattern) | Plan for when the department count grows. At 200% text the 3-link row already wraps to 2 lines. With skincare, electronics, bags and wallets it will push products down and duplicate the Kategori tab. |
| Home intro: headline + yellow price group + departments (1440) | authored | IKEA image-led category entries, adapted | None blocking. Headline, Rp99.000 and the two-option explanation sit together on the left, the 200px department slots sit on the right, and product names show inside the 1440×900 first viewport. |
| Home product grid "Mulai dari pilihan ini" | authored (fits a fixed-price shop) | Dawn/IKEA open product grid | None. 4→2→1 columns, no card frames, contents line and the "/ pilihan lengkap" basis next to every price. |
| Home "Sebelum memesan" + footer | authored, but redundant | none | Remove the section's own "Cara pesan dan pengembalian" link, or skip the footer link on home. Right now the identical link appears twice in a row (`home-390-03`, `text-200-320-06`). |
| Category / search listing (1440) | authored | IKEA findability; Carbon-style filter anatomy | Remove the underlined trailing space before the × in "Kategori: Busana ×" so the close mark sits right against the label. |
| Category / search listing (390) | authored | none | Top-align the active-filter links. In `search-390-01` the single-line "Kategori: Busana" sits lower than the wrapped "Isi pilihan…" next to it. |
| Departments page | authored | IKEA category tiles | Use one photo-slot brief layout everywhere. Department slots put a small brief top-left; product slots center it. Same concept, two treatments. |
| Empty results | authored | none | None. The query stays visible, there is one recovery action, and no zero metadata. |
| Invalid filter | authored, weak copy | none | The copy tells buyers to "Pilih Paling sesuai atau Publikasi terbaru" but gives no control for it, and "Publikasi terbaru" is internal wording. Say "Urutan tidak dikenali" and keep only the Hapus filter action. |
| Product preview (1440/390) | authored, explicitly bounded | Dawn media/decision split | Pick one name for the help route. It is "Ongkir dan pengembalian" on the PDP, "Cara pesan dan pengembalian" in the footer, and "Cara pesan" as the page title. |
| Help | authored | none | Same naming fix as above. The 760px reading column and left edge line up with the rest of the site. |
| Cart / account pending | authored | Tokophi focused empty-state recovery (principle only) | None. These states are honest and the current utility is marked with underline and weight, not just color. |
| 404 (JS and no-JS) | authored | none | "Halaman belum tersedia" suggests the URL will exist later. Use "Halaman tidak ditemukan" for unmatched URLs. |
| 200% text at 320px | authored | none | Scale the search-icon glyph with the text: it stays small next to 2× placeholder text. Everything else reflows: one column, whole tab captions, visible focus ring, briefs inside their slots. |

## Template signals checked
- **Not present:** dark hero with grid texture, accent word in the headline, eyebrow pills, icon-tile card rows, monospace labels, `→` on every button, checkmark lists, stat figures, carousel, urgency, reviews.
- **Equal tiles:** the repeated equal tiles are comparable product units and department photo slots. Showing them as equals is what the contract asks for (C3/SF3).
- **No unsourced trust claims:** I found no "resmi", "terpercaya" or similar badges.
- **"Stok pilihan tersedia":** this is labeled advisory availability, not a scarcity claim.

## Evidence and reference comparison
- **Inspected:** all 52 images listed, including `1f01ca90…-home-1440-01`, `7947aebb…-home-390-01..03`, `273be850…-category-1440-01`, `4c688750…-search-390-01`, `435d1979…-departments-1440-01`, `7ce26dc7…-product-preview-1440-01`, `08480b80…-not-found-1440-01`, `fab92fc4…-text-200-320-01..07`, and the reference slices `ee576f95…` (IKEA 1440), `69ce9ad8…` (IKEA 390), `aaccc28f…` (Carbon) and `11946f9e…` (Tokophi checkout).
- **IKEA 1440:**
  - Carried over: the dominant pill search and image-led category entries (Sofa / Lemari Pakaian / Meja Kerja). The 200px department slots and the wide search field follow both.
  - Correctly excluded: the campaign carousel, the promo blue bar and the emoji in the nav.
  - Correctly not copied: the IKEA 390 capture shows the header overlapping the campaign artwork; 99ribu's mobile header is clean and the four destinations live in the bottom bar.
- **Rhythm and density:** the 99ribu pages are sparser than IKEA, which suits a 4-product sample catalog. The 1440 departments page with only two tiles looks empty, but that comes from the data, not the layout.
- **Photo slots:** shown as labeled slots with item-specific shot briefs, sized as square media. That counts as owner-supplied content still to come, not a design failure.
- **References that don't apply here:** Carbon and Tokophi are operator and checkout references. They have no role on these discovery pages, which is correct, but they add no evidence for this slice.
- **Gaps:** I saw no Dawn render, and Target/Blibli captures are blocked. The discovery direction therefore rests on IKEA alone plus the written contracts. The spec says this openly, so it is a disclosed limit, not a hidden one.
- **Not visible:** in the full-page mobile captures the fixed bottom nav covers the footer link on category, search and PDP. The extra scrolled captures expose most of that content, but I could not see the category/search footer link at 390 directly.

None of the findings is a broken, clipped or hierarchy-breaking defect. They are copy consistency (three names for one help route, 404 wording, invalid-sort wording), one redundant link, and spacing/alignment polish (filter close mark, wrapped filter links, header width shift).

**Most important change:** Give the help/policy route one label across PDP, footer and page title, and drop the duplicate link at the end of the home page.

**Verdict:** PASS

This is visual acceptance only, not interaction or accessibility evidence. The polish items above are not blocking.