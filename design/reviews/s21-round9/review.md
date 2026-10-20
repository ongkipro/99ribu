Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s21/account-pending-1440.png, docs/spec/design/renders/s21/account-pending-390.png, docs/spec/design/renders/s21/attributed-filters-1440.png, docs/spec/design/renders/s21/attributed-filters-390.png, docs/spec/design/renders/s21/attributed-filters-text-200-320.png, docs/spec/design/renders/s21/cart-pending-1440.png, docs/spec/design/renders/s21/cart-pending-390.png, docs/spec/design/renders/s21/category-1440.png, docs/spec/design/renders/s21/category-390.png, docs/spec/design/renders/s21/category-policy-footer-390.png, docs/spec/design/renders/s21/continuation-1440.png, docs/spec/design/renders/s21/continuation-390.png, docs/spec/design/renders/s21/continuation-text-200-320.png, docs/spec/design/renders/s21/departments-1440.png, docs/spec/design/renders/s21/departments-390.png, docs/spec/design/renders/s21/empty-390.png, docs/spec/design/renders/s21/help-1440.png, docs/spec/design/renders/s21/help-390.png, docs/spec/design/renders/s21/home-1440.png, docs/spec/design/renders/s21/home-390.png, docs/spec/design/renders/s21/home-products-detail-390.png, docs/spec/design/renders/s21/invalid-filter-390.png, docs/spec/design/renders/s21/not-found-1440.png, docs/spec/design/renders/s21/not-found-390.png, docs/spec/design/renders/s21/not-found-nojs-390.png, docs/spec/design/renders/s21/product-preview-1440.png, docs/spec/design/renders/s21/product-preview-390.png, docs/spec/design/renders/s21/product-preview-detail-390.png, docs/spec/design/renders/s21/search-1440.png, docs/spec/design/renders/s21/search-390.png, docs/spec/design/renders/s21/search-policy-footer-390.png, docs/spec/design/renders/s21/text-200-320.png, docs/spec/design/renders/s21/text-200-section-320.png
References: docs/spec/design/refs/carbon-table/1440-top.png, docs/spec/design/refs/ikea-id/1440-top.png, docs/spec/design/refs/ikea-id/390-top.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 150855d17d8d946f
Images-SHA: f655728854fc543d
Output-SHA: 4b8ee87126c963ae

Paduka Ongki, saya sudah buka semua 67 gambar, termasuk referensi IKEA, Carbon dan Tokophi. Review-nya di bawah, ditulis dalam English.

## Section review (top to bottom)

| Section | Generic / authored | Look matched | One concrete fix |
|---|---|---|---|
| Simulation strip + header | authored | IKEA 1440: logo, wide search, utilities, category row | None needed. Desktop `Keranjang`/`Akun` show the current page with underline, weight and color (`cart-pending-1440`, `account-pending-1440`) |
| Mobile header + category row | authored | IKEA 390 search-first idea, without its campaign overlap | The 3-link text row repeats the `Kategori` tab. Cap it or let it scroll horizontally before more departments ship, so it doesn't grow into a compressed desktop nav (MW1) |
| Home intro: headline + yellow price group | authored | none (99ribu-owned); not the IKEA carousel | None needed. The headline sits directly on the yellow group, which states the basis once ("Untuk seluruh isi pilihan. Dua pilihan Rp198.000 sebelum ongkir"). No hero, accent word or eyebrow |
| Home departments (desktop right column) | authored | IKEA 1440 photo-led "Belanja berdasarkan kategori" tiles | Shot briefs here are top-left aligned, but product slots center theirs. Use one alignment so the photo slot looks like one component |
| Product grid (home/category/search/facets) | authored | Dawn/IKEA comparable units, no card frames | None needed. Square slots, contents line (`2 × Krim contoh`), one Rp99.000 and the `/ pilihan lengkap` basis. Single results keep their column width (`search-1440`) |
| "Sebelum memesan" (home) | partly generic | none | On 1440 the heading sits at x=120 and the text starts at about x=756, leaving a large empty gap. Its `Cara pesan dan pengembalian` link also appears again in the footer about 120px lower (both widths). Either drop this section now that every footer has the policy link, or put heading and text in one column |
| Listing header + active-filter links | authored | none (SF4) | The underline runs through the trailing space before `×` (`Kategori: Busana _×`, all widths). End the underline at the label text |
| Filter side region / mobile disclosure | authored | Carbon anatomy only loosely; native form | Facet heading `size` and value text `size: L, M` show a raw lowercase key next to Indonesian labels (`Isi pilihan`, `Ketersediaan`). Confirm a display-label field exists. If the label comes from sample data, it is owner content, not layout |
| Continuation (empty with cursor) | authored | none | On 1440 the empty-state block starts at the x=360 grid column with nothing to its left, because filters are collapsed. Align it to the 120px content edge whenever there is no side region |
| Empty / invalid filter | authored | none | `empty-390` says "hapus filter" with no filter applied. Show that clause only when filters are active |
| Departments page | authored | IKEA category tiles | None needed. Two 200px tiles plus the `Kategori lainnya` disclosure, with Kategori selected on mobile |
| Help (`Cara pesan`) | authored | none | None needed. The 760px reading column is aligned to the content edge, the return-policy status is stated honestly, and there is one primary recovery button |
| PDP preview | authored (bounded) | IKEA/Dawn media-left split | Mobile `Kembali ke katalog` is the only text link without an underline; match the other links. The full shop chrome and tabs here are the accepted S21 boundary; S22 owns the C2 task header |
| Cart/account pending | authored | Tokophi empty-state recovery: one heading, one action | None needed. No fake empty cart, and the active tab is shown with text and icon |
| 404 (JS and no-JS) | authored | none | "Halaman belum tersedia / … belum bisa ditampilkan" suggests the page will exist later, which misleads for a mistyped URL. Use neutral "tidak ditemukan" wording for unmatched paths |
| Footer | authored | none | None needed. Wordmark matches the header, and the policy link and sample-data note are factual |
| Mobile bottom nav (390) | authored | none | None needed at 100% text. Four labeled destinations, active state uses color, weight and a filled icon |
| 200% text at 320 | authored | none | The two-row fixed nav takes about 215px of the viewport and covers `Contoh Kaos` and the `Urutan:` filter link mid-scroll. MW6 says fixed regions return to normal flow when enlarged text leaves too little room. Switch it to `position: static` at the enlarged breakpoint |

## Evidence and transfer

- **Home 1440** (`1f01ca90…-home-1440-01`): the dominant search and category row match the IKEA 1440 capture (`ee576f…-1440-top-01`). The carousel, red promo tiles, heart/emoji menu item and blue notice bar are correctly left out. Product names sit at about y=868, inside a 900px first viewport. The yellow `#F6C945` group uses charcoal text and the purple is limited to actions, links and the active tab.
- **Mobile** (`7947…-home-390-01..03`, `0f33…-home-products-detail`): search and departments come before products. Two columns at 390, one column at 200% (`fab92…-03/04`). The focus ring wraps the whole card (`fab92…-02/03`).
- **IKEA 390** (`69ce…-390-top-01`) shows a header sitting over the campaign. 99ribu does not copy that; its header stays in normal flow.
- **Tokophi** (`11946…-390-01`): only the single-action empty-state pattern carries over, in cart-pending. The blue is not adopted.
- **Carbon** (`aaccc…-1440-top-01`) has no S21 storefront role. Its operator-table anatomy applies to later admin slices, so I'm not tying it to these renders.
- **Template signals:**
  - None of these appear: dark hero, grid texture, accent-colored headline word, pill eyebrows, monospace labels, `→` on buttons, checkmark lists, unsourced stats.
  - Repeated equal tiles are the product comparison grid and department tiles, which the content justifies.
  - Swap the name and the page still reads as 99ribu specifically: complete-option contents sit next to each price, and the fixed-price basis is stated once.
- **Photo slots:** every slot is labeled `Foto belum tersedia` with a one-line shot brief and is sized at the real photo ratio. Per the brief, that is owner content, not a design failure. No drawings or generated images stand in.
- **Claims:** I found no "resmi/terpercaya" style claims. Stock text ("Stok pilihan tersedia") and shipping text are factual and limited to what is known.
- **Clipped rendering:** none. The 200% search input scrolls its text (`S21 filter reco`), which is native input behaviour, not clipping.
- **Research gap:** the research doesn't explain what transfers from Carbon to S21 public pages. Target, Blibli and UNIQLO are already logged as unverified and excluded. Beyond that, the transfer reasoning for search, departments and product units is written down and matches the renders.

None of the findings above blocks visual acceptance. The 200% nav issue is a conflict between two contracts (SF7 says the nav stays fixed in two rows; MW6 says fixed regions return to normal flow). Owner decision #2 (rounds 9–11) leaves room to fix it.

Most important change: at enlarged text sizes, return the two-row bottom navigation to normal document flow (MW6), so it stops covering about a quarter of the 320px viewport over product titles and filter links.

Verdict: PASS