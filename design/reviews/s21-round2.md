Reviewer: claude via visual-review.py
Review-Context: separate ai-ask invocation
Model: unavailable: ai-ask does not report the resolved model/provider
Screenshots: docs/spec/design/renders/s21/account-pending-1440.png, docs/spec/design/renders/s21/account-pending-390.png, docs/spec/design/renders/s21/cart-pending-1440.png, docs/spec/design/renders/s21/cart-pending-390.png, docs/spec/design/renders/s21/category-1440.png, docs/spec/design/renders/s21/category-390.png, docs/spec/design/renders/s21/departments-1440.png, docs/spec/design/renders/s21/departments-390.png, docs/spec/design/renders/s21/empty-390.png, docs/spec/design/renders/s21/help-1440.png, docs/spec/design/renders/s21/help-390.png, docs/spec/design/renders/s21/home-1440.png, docs/spec/design/renders/s21/home-390.png, docs/spec/design/renders/s21/invalid-filter-390.png, docs/spec/design/renders/s21/not-found-1440.png, docs/spec/design/renders/s21/not-found-390.png, docs/spec/design/renders/s21/product-preview-1440.png, docs/spec/design/renders/s21/product-preview-390.png, docs/spec/design/renders/s21/product-preview-detail-390.png, docs/spec/design/renders/s21/search-1440.png, docs/spec/design/renders/s21/search-390.png, docs/spec/design/renders/s21/text-200-320.png
References: docs/spec/design/refs/carbon-table/1440-top.png, docs/spec/design/refs/ikea-id/1440-top.png, docs/spec/design/refs/ikea-id/390-top.png, docs/spec/design/refs/tokophi-store-checkout-20261016/390.png
Prompt-SHA: 4ae0ce2195b477c4
Context-SHA: 41a7c2a3bb47d69b
Images-SHA: 2b7656d36bfe5746
Output-SHA: 7ae5e574dc784a8d

Paduka Ongki, saya sudah buka dan periksa ke-48 gambar. Hasilnya **REVISE**: arah desainnya sudah benar, tapi ada beberapa penyimpangan dari kontrak yang kelihatan jelas.

## Section-by-section (top to bottom)

**Shared chrome**
- **Sample banner** ("Data contoh. Pesanan dan pengiriman simulasi.") | authored | none | The sample notice shows up 4–5 times per page: the banner, the `KATALOG CONTOH` eyebrow, the "Contoh" prefix on every name, the "Data contoh" PDP lede and the footer. Keep the banner and footer and drop the eyebrow and PDP lede.
- **Desktop header** (wordmark, wide search, Keranjang/Akun, category row) | authored | IKEA 1440: dominant search plus a category row, without IKEA's promo stack | No change. This transfers the reference correctly.
- **Mobile header** (wordmark, full-width search, category links) | authored | IKEA 390 utility row, with its overlap correctly not copied | No change needed. At 200%/320 the search placeholder clips to "Cari kaos, pe|". Shorten it to "Cari produk".
- **Bottom nav** (Beranda/Kategori/Keranjang/Akun) | authored | MW1 | Search results, the 404 and the PDP all highlight **Kategori**. A 404 is not a category destination, so this misleads wayfinding. Highlight nothing on the 404. Decide on purpose whether search counts as Kategori.
- **Footer** | generic | none | The footer wordmark "99ribu" is charcoal with no dot. The header uses purple "99ribu." with a dot. That gives the brand two marks. Use one lockup.

**Home**
- **Proposition** (h1 + yellow Rp99.000 block) | authored | SF2 asymmetric strip | At 1440 there is about 450px of dead white between the headline and the yellow block, so they read as two separate objects. Constrain the strip to the content width or put the yellow block right next to the text column.
- **Pilih kategori** | generic and weak | IKEA's image-led tile row is cited but not achieved | At 1440 there are two 112px slots in the left half and the right half is empty. Each shot brief wraps into 4–5 lines inside a slot too small to stand for a real category photo. Use a row of square tiles (about 180–200px) with the label underneath, as the 390 layout already does.
- **Mulai dari pilihan ini** (4-column grid) | authored | Dawn/C3 comparable units | Each slot repeats the product name ("Paket 2 Krim") right above the card title. Keep only "Foto belum tersedia" and the shot brief in the slot.
- **"Yang dihitung satu pilihan…"** | authored | C3 bundle rule | No change. It explains the pricing rule concretely, which is real task content.
- **Sebelum memesan** | authored | none | Fine. On desktop the heading floats alone in the left column; that is acceptable.

**Listing (category and search)**
- **Title + count + removable filter links** | authored, but the type is off-contract | SF4 | "Busana" and "Hasil untuk "Contoh"" render at about 44px, heavy, with negative tracking. The contract is 28/36, weight 600, normal tracking. Fix the scale.
- **Filter side panel** | authored | SF4 native GET form | "Hapus filter" is centred under a left-aligned stack. Left-align it.
- **Grid with an empty track** | authored | SF3 | No change. Leaving the track empty keeps cards comparable.
- **Mobile disclosure + 2-column grid** | authored | MW2 | No change.

**States**
- **Empty search, invalid filter, 404, cart/account placeholders** | authored | SF5 | The stub pages ("Keranjang sedang disiapkan", "Halaman akun sedang disiapkan") get the biggest, heaviest type on the site at 1440. A placeholder outranks every real page. Use the 28px page-title scale.
- **Departments page** | generic | none | Same tiny 112px tiles as the home. "Kategori lainnya" stretches to about 720px with its chevron far from the label. Size the disclosure to the content.
- **Help** | authored | none | The reading column is good. "Informasinya harus tersedia sebelum pemesanan dibuka" talks to the operator, not the buyer. Change it to buyer copy such as "Ketentuan pengembalian akan ditampilkan di sini sebelum pemesanan dibuka."
- **PDP preview** | authored, but the hierarchy is inverted | C2, limited by S22 scope | The title is about 44px and the price about 28px, and the price, "2 × Krim contoh" and "Stok pilihan tersedia" stack with no grouping. Set the title to 28px and the price to 24px. Group contents and stock under the price with 8px spacing.
- **200% text at 320** | authored | SF7 | The bottom-nav labels nearly touch ("Beranda Kategori Keranjang Akun"), the icons stay unscaled, and "Akun" sits against the right edge. The two category tiles end at different heights, so "Busana" and "Perawatan" sit on different baselines. Let the nav labels wrap or shrink the icon gap, and stretch the category tiles to equal height.

## Evidence and reference comparison

**Inspected:** all 48 slices, including the reference slices:
- `aaccc…` Carbon 1440
- `ee576…` IKEA 1440
- `69ce…` IKEA 390 (two slices)
- `11946…` Tokophi checkout 390

**What fulfils the contract:**
- The IKEA 1440 principles transfer correctly: one dominant pill search with utilities on the right, a plain category row, and no promo banner or carousel. IKEA's campaign hero and the header-over-promo overlap in its 390 capture are correctly excluded.
- Product slots carry item-specific shot briefs at square real-photo size, with no substitute drawings. That meets the owner-content rule.
- No claims like "resmi"/"terpercaya", no fake stats, no emoji, no arrow on every button, and no card frames around every product.
- Purple is used only for actions, links and the selected tab. Yellow is used once, for the price fact.

**Mismatches:**
1. **Type scale.** The selected system says page title 28/36 at 600, price 24/32, "normal body letter spacing", with a 600 heading weight. The renders use about 44px at 700+ with visibly tight tracking on every page title (category, search, departments, help, PDP, cart, account, 404). This is the most widespread defect. It makes headings read like marketing display type, lets placeholders outrank real content, and on the PDP puts the title above the price.
2. **Department entry.** IKEA's tile row is a horizontal band of equal image tiles; the desktop renders have two thumbnail slots in a half-empty row. The mobile 390 layout is closer to the reference than desktop is.
3. **References with no bearing on these pages.** Carbon and Tokophi do not apply to these storefront pages. Tokophi is an empty checkout and Carbon is the admin reference. No inspected multi-category retail reference beyond IKEA supports the home order: Target and Blibli captures were blocked, and no Dawn image is in this set. The department-store hierarchy rests on written rationale, not visual evidence. Flag this, but it doesn't block.

**Capture note:** in the 390 PDP full-page capture, the fixed bottom nav covers the price, contents and stock lines. The separate detail capture shows them, so this is not a design defect.

**Most important change:** Apply the selected type scale to every page title and price (28/36 at 600 with normal tracking for titles, 24/32 for price) so that real content, not placeholder pages or product names, carries the hierarchy.

**Verdict: REVISE**