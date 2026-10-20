Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s21/category-1440.png, docs/spec/design/renders/s21/category-390.png, docs/spec/design/renders/s21/empty-390.png, docs/spec/design/renders/s21/home-1440.png, docs/spec/design/renders/s21/home-390.png, docs/spec/design/renders/s21/invalid-filter-390.png, docs/spec/design/renders/s21/search-1440.png, docs/spec/design/renders/s21/search-390.png, docs/spec/design/renders/s21/text-200-320.png
References: docs/spec/design/refs/carbon-table/1440-top.png, docs/spec/design/refs/ikea-id/1440-top.png, docs/spec/design/refs/ikea-id/390-top.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 866993234c21787b
Images-SHA: 4f578e526f861ed8
Output-SHA: 5fa43854d89cc8ff

Paduka Ongki, saya sudah buka ke-25 gambar dan lihat satu per satu. Ringkasnya: arah halamannya sudah ditulis untuk 99ribu, bukan template generik. Tapi masih ada label tab bawah yang terpotong di tengah kata pada 320px/200%, beberapa deviasi dari kontrak, dan skala hero yang terlalu besar. Hasilnya **REVISE**.

## Section-by-section

**Home 1440 / 390** (`1f01ca90…-home-1440-01`, `7947aebb…-home-390-01..03`)
- Sample banner | authored | none | Fine as a required disclosure. Drop the `·` and use two short sentences so it reads as a notice, not a tagline.
- Header (logo, search, Keranjang, Akun) | authored | IKEA 1440 search-dominant header | Mobile repeats cart and account as header icons *and* bottom tabs. Remove the header duplicates on 390 to free space in the first viewport.
- Category row (Semua produk / Busana / Perawatan / Paket) | generic | IKEA text category row | "Paket" is an offer type, not a department, and it sits beside real departments. Move it to the "Isi pilihan" filter and keep this row for departments only.
- Hero ("SATU HARGA, ISI JELAS" + "Pilihan lengkap. Harga tetap." + yellow panel) | partly authored | asymmetric text/price strip per SF2 | The headline is about 56px and the panel price about 56px, against the selected 28/36 page title and 24/32 price. At 390 this pushes products to y≈600 and only one row of titles is visible. Cut both to the type scale and shrink the 510×225 panel, whose right half is empty.
- Tracked uppercase eyebrows (SATU HARGA…, KATALOG CONTOH, KATALOG, FOTO PRODUK) | generic | eyebrow-on-every-heading signal | Four eyebrow treatments on one page carry no task information. Keep "KATALOG CONTOH" only if it is the sample disclosure, and drop the rest.
- Department tiles | **missing** | IKEA image-led category tiles (inspected) | The contract order is proposition → department tiles → product groups. The home goes straight to one product group, so the multi-category store has no department entry beyond text links. Add a department tile row with labeled photo slots.
- Product grid (4 / 2 columns) | authored | Dawn/IKEA comparable product unit | Name, contents and price sit together, which matches C3. Two fixes:
  - Price formatting is inconsistent: `Rp99.000` in the hero and meta lines vs `Rp 99.000` on cards. Pick one.
  - The photo slots show "FOTO PRODUK / name / Foto belum tersedia" but no shot brief, which SF6 and the review rules require. Use one line per slot, e.g. "Dua tube krim berdiri, label depan, latar putih".
- Bundle explainer band ("Yang dihitung satu pilihan…") | authored | none (owned by the 99ribu bundle rule) | Strongest section on the page: it explains the Rp198.000 case concretely. Keep it.
- Shopping/return help | **missing** | contract C1 / home order | Nothing on the page explains returns or how buying works before the footer. Add a short factual help block (shipping cost basis, returns link).
- Footer | authored | none | Fine. Mobile trailing clearance for the bottom nav is acceptable.

**Category 1440 / 390** (`273be850…-category-1440-01`, `ed2d87d1…-category-390-01..02`)
- Heading + meta | authored | IKEA category heading | Fine.
- Desktop filter sidebar | authored | none (from the SF4 contract) | Native selects and one purple Apply button are task-appropriate. The right ~330px is an empty column track; that is intentional per S21 and acceptable.
- Mobile filter disclosure | generic | native `<details>` | The collapsed box has about 30px of dead padding under the summary, and the ▶ marker breaks the SVG icon rule. Use a Lucide chevron and tighten the padding.

**Search 1440 / 390** (`41d1a7df…-search-1440-01`, `4c688750…-search-390-01..02`)
- Applied filter context | **finding** | none | "Isi pilihan: Paket campuran" is applied, but at 390 the disclosure is collapsed. The user sees "Hasil untuk 'Contoh' · 1 produk" with no hint that a filter is narrowing it. SF4 requires visible, removable context. Show applied-filter chips above results at every width.
- Single result | authored | none | It keeps the two-column track, so it stays comparable. Good.

**Empty / invalid** (`4950df03…-empty-390-01..02`, `5562894e…-invalid-filter-390-01..02`)
- Empty | authored | none | The query is kept and recovery is clear. But "0 produk pada halaman ini · Rp99.000 per pilihan lengkap" and the filter disclosure above an empty state are noise. Hide the meta line when there are 0 results.
- Invalid filter | generic | none | "Filter belum bisa digunakan" doesn't name the bad value, so it doesn't meet SF5's "explains the issue". It also loses the KATALOG/query heading context and leaves about 150px of dead space. Name the rejected parameter, e.g. "Urutan 'xyz' tidak dikenal".

**Mobile bottom nav** (all 390 slices)
- Tabs Beranda / Cari / Keranjang / Akun | contract mismatch | none | MW1 specifies Home/**Categories**/Cart/Account. "Cari" duplicates the full-width header search, and there is no category destination. Replace it with Kategori.

**200% text at 320** (`fab92fc4…-text-200-320-01..06`)
- Bottom nav | **broken** | none | Labels split mid-word: "Berand/a", "Keranja/ng" (slice 04). Use `overflow-wrap: normal` with an icon-over-label stack, or drop labels to one line by letting the nav grow taller.
- "Lihat paket campuran →" | broken | none | The arrow stays tiny and floats away from the wrapped text (slices 05–06). Size the icon in `em` and keep it inline with the last word.
- Card focus ring | finding | none | On "Contoh Kaos" (slice 03) the ring wraps the image and title only. Contents and price sit outside the link, so the focused target doesn't match the visible product unit. Extend the link or ring to the whole unit.
- Headings and the "Semua produk" link | acceptable | none | The heading reflows to four lines ("Mulai / dari / pilihan / ini") beside a right-aligned link. Stacking the link below the heading would read better, but nothing is clipped.

## Reference comparison

- **IKEA 1440 (`ee576f95…`)**: transferred correctly. Dominant search, text category row, campaign carousel excluded, product grid instead of promos. Not transferred: IKEA's image-led category tile row, which is the one IKEA pattern that serves a multi-department store. Its absence matters more because Target and Blibli are both blocked, so the department-store structure has no inspected visual evidence at all.
- **IKEA 390 (`69ce9ad8…-01..02`)**: shows header overlap and a promo poster. 99ribu correctly avoids both and puts search first.
- **Tokophi 390 (`11946f9e…`)**: a focused checkout shell with a framed empty cart. It doesn't govern these discovery pages. The 99ribu empty state uses a different (left-aligned, unframed) treatment, and that is acceptable.
- **Carbon 1440 (`aaccc28f…`)**: an operator/table reference. None of these storefront renders relate to it, so there is nothing to compare.
- **Research gap:** no successfully inspected multi-category reference (Target and Blibli are both challenge pages) and no Dawn render in this set. The department-store home order rests on written contract only.

Rhythm and density are good overall: open grid, no card frames, restrained purple, factual yellow. The two inflated display sizes (hero headline and panel price) are the main hierarchy problem, because they outrank the products the page exists to show.

Most important change: add a department entry to the home page (an image-led tile row with photo-brief slots) and a Kategori bottom tab in place of the duplicate "Cari", then fix the mid-word nav label breaks at 200% text.

Verdict: REVISE