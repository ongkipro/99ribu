# Storefront shop.com parity, round 2: visual context

Author: Claude (builder, storefront parity round 2, 2026-10-22)

This is the evidence companion for this round. The canonical contracts are still `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md` (tokens, MW1–MW7, the storefront notes section "shop.com storefront parity — 2026-10-22") and `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md`. This file scopes one independent review of the public storefront: home, search/listing with filters, product detail, cart, empty states and help. It does not redefine product, design or task ownership.

## Audience and job

Indonesian mobile-first buyers who browse a multi-category catalog where every complete option costs Rp99.000. They search or pick a category, compare options and contents, add complete options to the cart and continue to checkout. The page has to transfer shop.com's layout, spacing, type rhythm, component patterns and interaction behaviour. It must not transfer shop.com's name, logo, trademarks, copy or images. The 99ribu `99rb.` wordmark, Inter, purple `#5b35d5`, warm yellow `#f6c945`, Indonesian copy and every tested accessible name stay as they are.

## Accepted decisions (owner/coordinator) — reviewers judge layout, typography and interaction only

- **Accepted: merchant photo content.** Supplier text on product photos, claims such as "TERBUKTI AMPUH", before/after or slimming images, and brand text fragments are real catalog content that the owner accepted as dummy for now. They are out of scope for this visual/layout gate. Search and category results are not reordered to hide them (no ranking manipulation). The curated editorial picks leave them out: home shelves, the switcher, the hero and the department photos (`homeSafe`, `department-photos.ts`).
- **Hero primary "Masuk" for signed-out visitors** ("Lihat produk" when signed in) is the coordinator's specified copy, mirroring shop.com's "Sign in"; guest checkout stays available from every product, and "Lihat produk" remains one tap away in the header search, pills and grid. Accepted.
- **`/promo` "Paket campuran" lists real published mixed bundles; they overlap the newest catalog rows because the newest publications are bundles** (coordinator: bundles are real content). Accepted.
- **One-line card titles** (owner, 1:1 with shop.com), **desktop shelf arrows** (owner confirmed), **Promo icon shown when only bundles exist** (bundles are real content), and **header order Promo → Cart → Account** (owner) are accepted.
- **Content compliance backlog (owner, before go-live: BPOM/advertising-claims risk).** Products the reviewers flagged (rounds 26-30):
  - "Antabur Anti Pantat Burik & Selangkangan": before/after photo, "Kinclong dalam 14 hari", "TERBUKTI AMPUH".
  - "Paket Wajah Tirus & Glowing Spa di Rumah": face-slimming name and photo.
  - "Paket Glowing Lengkap 3-in-1": "Wajah Glow Up" claims on the photo.
  - "Celana Dalam Kesehatan Pria XL": "Pria Kuat" health claim on the photo.
  - "Paket Dapur Kinclong 3-in-1": "Lebih Ampuh" banner.
  - "Paket Korset Pelangsing" and other "pelangsing" names: slimming claims.
  - "Shampoo Ginseng Anti Botak": hair-loss claim.
  - "Bentuk Tubuh Lebih Rapi dalam Sekejap" (shapewear photo): body-shaping claim.
  - "Bright Glow" / "Gendes" listing photos with whitening or "glow" efficacy text.

## Reference evidence

The builder captured these shop.com pages on 2026-10-22 (headless Chrome via `ui-ref.mjs` and chrome-devtools MCP, read-only, no sign-in or purchase) and opened the screenshots:

- `docs/spec/design/references/shop-com/2026-10-22-home/` (390, 1440). Shows the near-white `oklch(0.988 0 0)` canvas, the white pill omnibox with a soft shadow and no border, white category pill chips, the department shelves headed "Women ›", the 20px mosaic tiles, the columned footer, and the floating rounded mobile dock whose active icon sits in a grey pill.
- `docs/spec/design/references/shop-com/2026-10-22-search-1440.png`. Shows the filter chip row at the top of the content (filter icon pill, then dropdown chips), an 18px/600 "Results" heading, and a full-width six-column grid with no sidebar. Cards have 1:1 media with a 20px radius, a 14px/600 title and a 12px/600 price.
- `docs/spec/design/references/shop-com/2026-10-22-search-390.png`. Shows the chip row scrolling horizontally and a two-column grid with an 8px gap.
- `docs/spec/design/references/shop-com/2026-10-22-search-filters-390.png`. Shows the filter sheet: a white panel with 28px radius, a 24px/600 title, sections separated by hairline dividers, pill choice chips (the selected one filled), and Reset/Done pills.
- `docs/spec/design/references/shop-com/2026-10-22-pdp-1440.png`. Shows a white media panel with ~28px radius beside a narrow (~465px) buy box. The buy box holds a 24px/600 title with −1px tracking, the price, 40px pill option chips (the selected one with a 1px charcoal border), a pill quantity stepper, a full-width 52px pill primary action, and a white 44px secondary pill. Accordion sections (Description, Reviews, Delivery) sit between hairlines with chevrons on the right.
- `docs/spec/design/references/shop-com/2026-10-22-pdp-390.png` and `docs/spec/design/references/shop-com/2026-10-22-pdp-390-scrolled.png`. Show full-width media, the title block, wrapping option pills, full-width 52px actions and the accordions.
- `docs/spec/design/references/shop-com/2026-10-22-cart/` (390, 1440; the signed-out empty cart). Shows a centred empty state: heading, one line of text and one primary pill.
- `docs/spec/design/references/shop-com/2026-10-22-help/` (390, 1440; help.shop.app). Shows a centred ~720px column, topic sections laid out as 2-up cards (1-up on mobile), and the support entry at the bottom.

- `docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png` and `docs/spec/design/references/shop-com/2026-10-23-home-390-full.png` (captured 2026-10-23, fully scrolled so the shelves loaded). These show the current home composition: the value card, "Trending stores", "Categories ›" tinted tiles (five per row at desktop, two at phone), the department product shelf as a single scrolling row with the next card cut at the edge and a "›" button, store carousels and editorial collections.

Measured on the live PDP and search (computed styles): buttons use radius 9999. The primary is 52px high with `rgb(84 51 235)` fill. Option pills are 40px with a 1px `rgba(0,0,0,.1)` border. Card text is 14/18 at 600 for the title, 12/16 for the price, and the strike-through price uses `rgba(0,0,0,.56)`.

Not inspectable: category pages (`/categories/*` returned "We ran into an issue" to the headless browser, so those captures were discarded), the populated cart and checkout (both need sign-in and a real purchase, and live orders are not authorised), and order receipts. Checkout and receipt therefore keep their accepted S26/S27 compositions. Only shared shell tokens reach them, and none of those apply to their white checkout frame.

## Composition contract (round 2)

| Item | Transferred principle → 99ribu implementation |
|---|---|
| R1 Canvas and surfaces | Storefront shells (`.store-header`/`.task-header` pages) use a `#fafafa` canvas with white raised surfaces for the omnibox, chips, media panels and summary cards. Checkout and receipt frames stay white (no reference). |
| R2 Omnibox | White pill with no border and a soft `0 2px 16px` shadow. The submit is a 44px round filled purple button with a white icon. The accessible names "Cari produk" stay. |
| R3 Chips | Department nav, active filters, facet options and offer options become white pills with a hairline `rgba(24,24,27,.10)` border, at least 44px high. The selected or checked state gets a 1.5px charcoal border, and the visible native control is kept (tests check/select it). |
| R4 Listing | The 200px sidebar is removed. The filter disclosure sits above the results across the full content width. Closed, it shows as a pill "Filter dan urutan" with a chevron. Open, it is a white 24px-radius panel with pill selects (one row of four at desktop, 2×2 at tablet, stacked on phones), attribute facets as wrapping pill groups when the catalog returns attribute facets, and Apply/Reset at the end. Kategori, Isi pilihan, Ketersediaan and Urutan stay native `<select>`s: they are the tested no-JS controls (`selectOption`/`toHaveValue` in the browser and integration suites), so they are not converted into radio pills. Results use a full-width grid: `auto-fill minmax(12.5rem,1fr)`, which gives 5 columns at the 1200px wrap, 2 columns on phones, and a 12px gap. The native `details` and FilterPanel behaviour are unchanged (open ≥701px, closed on phones). |
| R5 Product card rhythm | 1:1 media with a 20px radius. Title 1rem/1.375 at 600 with −0.01em tracking. Contents 0.8125rem muted. Price 1.125rem/700 with the "/ pilihan lengkap" basis kept inline beside it at 0.8125rem. The price basis stays visible because it is the fixed-price rule. |
| R6 PDP | Columns `minmax(0,1fr) minmax(20rem,28rem)` with a 64px gap. The media sits in a white 24px-radius panel. Buy box order: H1 (−0.02em), price, offer pills, contents, stock, then the quantity pill (7rem) and below it a full-width 52px "Tambah ke keranjang". Policy `details` become accordions with a right-hand chevron between hairlines. On phones the media spans the full content width. |
| R7 Cart | Lines stay unboxed with dividers (spec forbids boxed rows). The summary is a white 20px-radius card with a soft shadow and a full-width 52px "Lanjut ke checkout". The quantity input is a pill. |
| R8 Empty and recovery states | Content is centred on one column (heading, text, pill actions), as in shop.com's empty cart and error states. |
| R9 Footer | Wordmark and the sample-data footnote on the left; one link column, "Bantuan", on the right. Existing link names and destinations are kept. |
| R10 Mobile dock | The labelled four-tab dock is kept (MW1). The active tab gets a lavender `#efeafd` pill behind its icon, as in shop.com's active-pill indicator, with text and weight still marking the state. |
| R11 Help | A centred 45rem column. The three policy topics become white rounded topic cards (2-up from 40rem, 1-up below). Chat and catalog return follow. |
| R12 Section shelves | Home "Semua kategori"/"Semua produk" links become white pill links with a chevron, the shop.com shelf "Women ›" affordance with our copy. |

Do not substitute: shop.com's logo, wordmark, name, copy, imagery, ratings, merchant rows, discount badges, Save/Share/Buy now actions, or the desktop left icon rail. The rail would duplicate the header utilities, and `.shopping-tabs` must stay hidden above 700px under the integration contract. Also excluded: the floating bottom omnibox on desktop (the header search is the first-class entry), carousel-only lists, and a modal full-screen filter sheet (the non-modal native `details` stays, keyboard order is unchanged).

Intended deviations from the canonical defaults, also recorded in spec 10: the storefront uses pill controls (spec default 8px) and 20–24px media/summary radii for shop.com parity. Admin, checkout and receipt keep the canonical defaults. The listing card title is 16px rather than the 18px card heading so 5-column comparison fits Indonesian names; the PDP H1 and price keep the scale tokens.

## Render inspection A, coordinator build (pre-fix)

The builder opened the coordinator's fresh production-build captures (`home`, `search`, `search-filtered`, `pdp`, `cart` empty, `help#returns` and `notfound` at 390/768/1440, plus home/search/pdp/cart at 320px with 200% text; horizontal overflow measured 0 on all). The files are in the session scratchpad, not in the repo, and were superseded by the fixes below.

Each contract item, checked against its reference:
- R1: matched. The `#fafafa` canvas reads as shop.com's off-white with white raised surfaces. Deviation found: the empty-cart page at 1440 is shorter than the viewport, so a white band showed below the body. Fixed by painting the root element when a storefront shell is present.
- R2: matched at 390/1440. At 320px with 200% text, the 1.5rem search icon (48px) overflowed the fixed 44px purple button and looked clipped. Fixed: the button keeps a 44px minimum and grows with padding.
- R4: matched. 1440 shows the open filter panel above a full-width 5-column grid. 390 shows the closed "Filter dan urutan" pill and a 2-column grid.
- R5: deviation at 390 and 320: the "/ pilihan lengkap" basis split across two lines ("/ pilihan" + "lengkap"). Fixed: the basis is an unbreakable inline-block that drops to its own line as one phrase. The same was applied to the PDP price basis.
- R6: matched. The buy box is narrow with a full-width 52px "Tambah ke keranjang", a pill quantity input and chevron accordions; media spans the full width on phones.
- R8: matched (centred empty cart). Deviation: the only action, "Lihat produk", rendered as an outlined secondary pill, whereas shop.com's empty cart leads with one filled primary pill. Fixed: it is primary when it is the sole action (`view.kind==='none'`). The other recovery states keep primary reload + secondary.
- R9/R10/R11: matched (columned footer, active dock pill, centred help topic grid). Accepted deviation: the help chat card is `src/components/support/CustomerChatView.tsx`, which is outside this task's ownership and uses inline 8px-radius buttons and borders. It stays as is and is noted for its owner.
- Not a defect: in the 320px/200% captures the fixed dock overlays mid-page. That is a full-page-screenshot artifact of a `position: fixed` element. Also, the injected `html{font-size:200%}` does not change rem-based media queries, so the existing short-viewport rule (`max-height: 38rem`) does not fire as it would under real browser text-size settings.

## Render critique

Round 21 recapture (current build, renamed catalog, Indonesian URLs), taken 2026-10-23 with the scratchpad `shots-r21.mjs` from the round-21 production build: catalog withdraw dry-run 0 and the fixture guard on, light theme, reduced motion unless marked `-motion`, 320 shots with a 32px browser default font size. overflowX=0 on all 57 page captures, and 1280, 1440 and 1920 were also checked (content width 1216/1250/1250px). The script asserts that the omnibox centre equals the viewport centre within 1px at 768, 1024, 1440 and 1920, closed and open; it measured 0.0px every time. The full capture set (every page at 320/200%, 390, 768, 1024, 1440, 1920 where requested) is in the same folder; the shots below are the ones critiqued. Earlier rounds' critiques are in the round sections further down and are superseded where they disagree.

- Home: `docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/home-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/home-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/home-1440.png`. Order: header (brand, centred omnibox, icon-only cart, promo and account) with the 5-pill row and grid link; hero card; "Kategori ›" grid; "Terbaru" shelf; category switcher; footer. 1440 and 1920 sit in the 1250px container with 7 whole cards per shelf; 768 shows 4.6 (a cut card at the edge); phones bleed the shelf to the screen edge with 2.3 cards. The switcher medallion (112px, 56px on phones) sits above the selected name, so every name reads in full.
- Hero: `docs/spec/design/renders/shop-com-r2-20261022/hero-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/hero-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/hero-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/hero-1440-motion.png`. Our product photos float on the lavender/yellow tint, to the right on desktop and in a 236px band above the copy on phones. The copy sits on a near-opaque canvas scrim. At 320/200% the card grows instead of clipping, and "Rp99.000" stays on one line (the heading scales to the width). Motion (`hero-drift`) runs only without reduced motion; layout shift is at most 0.014.
- Category grid: `docs/spec/design/renders/shop-com-r2-20261022/home-categories-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/home-categories-1440.png`. 2 then 5 columns, never narrower than 10em (one per row at 320/200%); department tint, dark label, one tilted department photo clipped at the tile end; long names wrap between words. `/kategori` uses the same tiles and photos.
- Header and omnibox (closed state: `home-1440`): `docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/omnibox-opening-1440.png` (120ms into the open transition, live motion), `docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/omnibox-suggestions-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/omnibox-typing-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/header-cart-items-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/header-signed-in-390.png`. Focus grows the one glass surface down over the page into "Saran pencarian": product-type phrases from the catalog, fading in. Typing filters them, marks the match in bold, and ends with a "Cari “…”" row. There is no native clear glyph. The cart badge sits on the icon's top right; the "Promo" tag icon follows the cart. On phones the header holds brand and search only, and the dock carries cart and account. Signed in, the hero primary reads "Lihat produk" (`docs/spec/design/renders/shop-com-r2-20261022/hero-signed-in-390.png`).
- Category pills: `docs/spec/design/renders/shop-com-r2-20261022/pills-focus-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/pills-hover-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/pills-focus-1440.png`. Each circle holds the department's own product photo, contained and multiplied into the tint so the white ground disappears. Hover scales the photo slightly; keyboard focus draws the 2px ink ring with 2px offset around the whole pill, unclipped. 1440 fits all six centred; phones scroll with a hidden scrollbar.
- Search and category listings: `docs/spec/design/renders/shop-com-r2-20261022/search-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/search-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/category-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/category-1024.png`, `docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png`. 6 columns from 1024px, 4 at 768, 2 on phones. Titles are one line (14/18 600) with an ellipsis (owner decision, see the round-21 review response), prices 12/16 600, photos in 20px frames. On `/kategori/<slug>` the department pill carries the soft lavender current fill (round 35); "Semua kategori" is current only on `/kategori`.
- PDP: `docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png`. URLs read `/produk/<title>-<id>`; the task header keeps Kembali, the brand and the cart glyph.
- Cart, help, sign-in: `docs/spec/design/renders/shop-com-r2-20261022/cart-390.png` (empty cart), `docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/help-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/help-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png`. Layouts are unchanged, now on `/keranjang`, `/bantuan` and `/masuk`.
- Promo: `docs/spec/design/renders/shop-com-r2-20261022/promo-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/promo-1440.png`. H1 "Promo", then "Promo ongkir". No shipping promotion is active locally, so the plain sentence "Belum ada promo ongkir aktif." shows. "Paket campuran" lists the published mixed bundles in the standard grid.
- Footer: `docs/spec/design/renders/shop-com-r2-20261022/footer-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/footer-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/footer-1440.png`. A white band with the brand block, three labelled menus (Belanja, Bantuan, 99ribu) and a bottom row with the copyright and the Legal links. Phones stack the menus in two columns with 44px links; at 320/200% they become one column.
- Brand icons: `docs/spec/design/renders/shop-com-r2-20261022/favicon-sheet.png`. The "99" monogram at 16 and 32px (favicon), at 180px (apple-icon), and at 16/32 on the grey canvas. Two geometric 9s, white on brand purple, with the yellow dot from the wordmark. It reads as "99." even at 16px.
- Placeholder pages: `docs/spec/design/renders/shop-com-r2-20261022/placeholder-tentang-390.png`. One heading, "Halaman ini sedang disiapkan." and a secondary pill back to Bantuan; noindex.

## Independent review round 1 and response

`docs/spec/design/reviews/shop-com-r2/review.md` (Claude via `visual-review.py`; Codex could not start in this environment) returned REVISE. Responses, all in builder-owned files:
- Filter panel: values like "Paket barang yang sama" were clipped at 768 and "Urutan" was orphaned on its own row. The field basis is now 14rem, giving a 2×2 layout at tablet and one row at desktop. Converting the four selects to pill radios was declined because they are tested native controls (see R4). Facet pill groups render only when the data has attribute facets; this round's data had none.
- Price basis indent at 390/320: the 4px margin was replaced by a collapsible space, so a wrapped "/ pilihan lengkap" aligns with the price.
- Out-of-stock cards: "Stok pilihan belum tersedia" is now a quiet pill (`#5c4f37` on `#f1eee6`) instead of loose grey text.
- Home 768 orphan card: the shelf minimum is now 15rem, giving 2 columns at tablet and 4 at desktop.
- Footer links touching at 320/200%: the links are a grid with a 4px gap on top of their 44px targets.
- Not-found spacing: the action spacing now matches the empty cart (16px gap + 24px).
- PDP placeholder: it keeps the shared lavender photo-slot surface (consistent with listing); only the 24px panel radius differs.
- "Spesifikasi": it stays a heading (tested) but now uses the accordion summary size and hairline rhythm.
- Help: "Kembali ke katalog" is secondary, so the chat start remains the single filled action. The chat badge blob at 320/200% belongs to `CustomerChatView` (another owner) and is reported, not changed.
- Declined or out of scope: the home H1 scale versus the price card (accepted round-1 hero), the department tile brief alignment (accepted round-1 tiles), cart-with-lines and multi-option PDP (not capturable without DB writes or catalog data, so they stay UNVERIFIED), and the home-versus-search "Contoh Kaos" contents (a data difference between the featured and search offer variants, not design).

## Independent review round 2 and response

The round-2 review is `docs/spec/design/reviews/shop-com-r2/review-round2.md`; `review.md` is the latest copy and round 1 is kept as `review-round1.md`. Verdict: REVISE. It confirmed that the round-1 fixes hold: 2×2 filters at 768, matched filter toggle, removable chip, 2-up shelves, matched empty and recovery states, help return action. Responses in builder-owned CSS:
- Stock pill: on narrow cards "Stok pilihan belum tersedia" wrapped into a lozenge, so the radius is now 10px and stays readable when wrapped. The label is unchanged because it is shared copy.
- "Sebelum memesan": a 1fr/2fr split from 1050px up (no empty half-block at 768); below that the text sits under its heading.
- Fixed-price card: "Rp99.000" is pinned to the card's end edge on phones, as the card's anchor.
- Department tiles: the brief is now centred like the product photo slots, so both use one placeholder treatment.
- "Spesifikasi": a plain section above the first accordion hairline instead of a chevron-less row between accordions.

Open, not changed by the builder:
- The help chat card (`CustomerChatView`, another owner) uses 8px controls, Title Case copy, an `A • B` badge, and a badge that clips "08.00–21.00 WIB" at 320/200%. The reviewer treats this as page-level REVISE regardless of ownership, so it needs the component owner or an explicit ownership change.
- R7 cart-with-lines and the R3/R6 multi-option PDP have no render because capturing them needs a guest-cart write and a multi-option catalog product.
- Marking the current department chip, and the PDP shot-brief caption placement (S22 accepted figure caption), were left as is: the first needs routing context in the shell, the second is an accepted accessibility choice.

## Round-3 preparation (coordinator decisions)

- Help chat card: the coordinator transferred styling and copy ownership of `src/components/support/CustomerChatView.tsx` to the builder. Fetch, paging and conflict behaviour are unchanged. The card is now a white raised 20px card like the topic cards. Buttons use the storefront pill (9999px). Inputs and inner panels use 12–16px radii. The hours line is a wrapping sentence ("Pesan diterima kapan saja. CS membalas pukul 08.00–21.00 WIB.") instead of an `A • B` pill badge, so it cannot clip at 320/200%. Visible copy is sentence case, except the accessible names the tests use ("Mulai Chat Bantuan", "Muat Percakapan Saya", "Buka Percakapan", "Muat pesan sebelumnya", "Kirim Pesan", "Riwayat pesan percakapan"), which stay verbatim.
- R7 cart with lines: captured through the normal UI in one browser context (PDP → "Tambah ke keranjang" → `/cart`) as `cart-filled-*`. There are no other database writes.
- R3/R6 multi-option PDP: not verifiable with the current local data, because no published product has more than one option. Data is not seeded for design evidence, so option pills remain UNVERIFIED this round.

## Independent review round 3 and response

The round-3 review is `docs/spec/design/reviews/shop-com-r2/review-round3.md` (`review.md` is the latest copy). Verdict: REVISE. The reviewer confirmed the cart summary, empty states, help topic cards, dock, footer and reference transfer. Responses in builder-owned files:
- Department tiles: the 26.5rem cap is removed, so the tiles fill the row at tablet. Tile briefs now use the 0.75rem size of the product-slot briefs, with a semibold "Foto belum tersedia" line, so both placeholders use one treatment.
- Open filter toggle: instead of the solid near-black fill, it takes the R3 selected treatment (white with a charcoal edge). "Terapkan filter" stays the only filled action in the panel.
- Cart line: the separate unit-price line and the `A · B` total label are merged into an emphasised line total, with "N pilihan lengkap × Rp99.000" as its basis. "Hapus" aligns to the quantity column. The summary link gets 12px before the checkout pill.
- Chat card: the hours line is now muted, non-link text. The attachment disclosure has the same chevron as the PDP accordions. The Title Case labels "Mulai Chat Bantuan" and "Muat Percakapan Saya" are kept verbatim because the coordinator requires exact test names.
- Not changed: the empty "Spesifikasi" section (a tested heading), the icon-only task-header cart (the accepted S22 task header), the current-department chip state (needs route context), the open-panel height at ≥701px (contract R4 as written), and the option-pill state (UNVERIFIED with current data).

## Round-4 preparation (coordinator decisions)

- Chat labels: changed to sentence case ("Mulai chat bantuan", "Muat percakapan saya", "Buka percakapan", "Kirim pesan"). The only test uses (`support-live`, plus the `support-chat` mock) call `getByRole` without `exact`, which matches case-insensitively. The coordinator reruns S74 after the build.
- Current department chip (R3): the shell now takes a server-side `department` value from the search/category route (category slug, or `all` on unqueried `/search`). The current chip gets `aria-current="page"` and the charcoal selected edge, with no client JavaScript.
- "Spesifikasi" stays as is (test-checked).
- Round 4 also covers the new `/masuk` sign-in page (built by another agent): default state and the wrong-password error state, captured with the fake address `nobody@example.invalid`.

## Independent review round 4 and response

The round-4 review is `docs/spec/design/reviews/shop-com-r2/review-round4.md` (`review.md` is the latest copy). Verdict: REVISE. The material finding is `/masuk`, which is owned by the sign-in agent. Every other storefront section was judged authored and matched to R1–R12. Responses in builder-owned files:
- "Sebelum memesan": the text now starts on the shelf's second card column (a 4-column grid with a 16px gap) instead of the unaligned 1fr/2fr split.
- Help: the H1 is now "Cara pesan dan pengembalian", which matches the footer link and the page content. The page has no ordering steps, so the old "Cara pesan" title over-promised.
- Secondary buttons: the chat secondary uses the storefront `.button.secondary` purple outline pill, so there is one style per role. The white hairline pill is reserved for chips and the filter disclosure toggle (chip role, R3).
- Chat attachment chevron: sized in `em`, so it scales with enlarged text.
- 320 enlarged-text evidence: `shots-r2.mjs` now sets the browser default font size to 32px through CDP `Page.setFontSizes`, replacing the injected `html{font-size:200%}`. A probe on the current build showed the root at 32px, the `max-height: 38rem` rule matching and the dock `position: static`, so the next capture shows real-text-zoom behaviour instead of a fixed two-row dock covering content.
- Not changed: the dock has no active tab on search results (a query result is not a top-level destination; category pages mark Kategori). The ~270px gap at 1440 between the cart line and summary comes from the accepted 1.7fr/1fr cart layout. The multi-option PDP remains UNVERIFIED with the current data.

Outside builder authority, for the coordinator's decision:
- The `/masuk` composition (sign-in owner):
  - it is a bordered 8px card left-aligned at 1440 rather than a centred white raised 20px card;
  - its inputs are 6px dark-border boxes, not storefront pill or 12px controls;
  - its error alert is a square left-rule panel whose icon does not scale at 200%;
  - its buyer-facing copy mentions "Konsol Operasional" and "komisi afiliasi";
  - after a failed submit, focus is not moved to the alert or the first invalid field.

## Round-5 preparation (coordinator decision: `/masuk` styling, copy and error focus transferred to the builder)

- Composition: a centred white raised 20px card (`signin-card`, max 28rem), like the help topic cards. Inputs are 48px controls with a 12px radius and a 3:1 `#85858e` boundary; invalid fields get a 2px error edge. Actions are full-width 52px pills, primary "Masuk" with "Batal" as the secondary outline pill.
- Error alert: a rounded 16px error-surface panel with an `em`-sized icon that scales with text.
- Error focus: after every failed submit, in both the password and the code step, focus moves to the alert (`tabIndex=-1`, `role="alert"`, `aria-live="assertive"`). Fields keep `aria-invalid`, and the invalid field stays referenced by `aria-describedby="signin-error"`.
- Copy, neutral for buyers and staff:
  - The heading is "Masuk ke akun 99ribu".
  - The lead is "Lihat pesanan, alamat tersimpan, dan status pengiriman Anda."
  - The staff line is now "Akun staf meminta kode verifikasi dua langkah setelah kata sandi."; "Konsol Operasional" and "komisi afiliasi" are removed.
  - The MFA notice says "halaman operasional".
- Unchanged: request URLs, payloads, the two-factor step logic, `?next=` handling, redirects, 429 handling, the generic error wording, the `method="post"` fallback, every id/name (`#signin-email`, `#signin-password`, `#signin-code`, `signin-heading`, `signin-verify-heading`, `signin-error`, `signin-switch`) and the tested labels and buttons ("Email", "Kata sandi", "Kode autentikator", "Masuk", "Verifikasi").

## Independent review round 5 (final, cap reached) and status

The round-5 review is `docs/spec/design/reviews/shop-com-r2/review-round5.md` (`review.md` is the latest copy). Verdict: REVISE, and the cap of 5 review rounds is now used. It confirmed that every section at 390/768/1440 is authored and matches the recorded transfer, including the restyled `/masuk` and the filled cart; no template signals were found. The remaining findings are narrow-width polish at 320/200%, plus two evidence gaps.

The design gate on the round-5 evidence (before the fixes below): `refs` PASS, `critique` PASS with 39 screenshots, `review` FAIL (verdict REVISE).

Fixed in source after round 5. They were rendered in the round-6 capture and verified there: the `/masuk` error alert at 320/200% now wraps in readable lines, and the help H1 "Bantuan belanja" fits the gutter.
- Help chat disclosure chevron: it collapsed to about 7×3px at 320/200% because the flex row shrank it. It is now `flex: none` at 1.125em.
- `/masuk` card and alert inline padding: now `clamp()`, so the error message is no longer squeezed into one-word lines at 320/200%.
- Help H1: now "Bantuan belanja". It fits the gutter at 320/200% and no longer promises ordering steps; the footer link and page metadata keep "Cara pesan dan pengembalian".
- "Hapus filter": styled as a white outline pill paired with "Terapkan filter". The class and text are unchanged.

Accepted deviations, recorded:
- Native `<select>` filters instead of choice pills (tested no-JS controls).
- 16px card titles.
- The in-flow, non-modal filter disclosure.
- The empty "Spesifikasi" section (test-checked heading).
- The home H1 scale against the fixed-price card (round-1 hero).
- The ~270px gap in the 1440 cart (accepted 1.7fr/1fr layout).
- No active dock tab on search results.

Evidence gaps outside builder authority:
- The multi-option PDP option pills (R3/R6): no published multi-option product exists, and the imported Berlapak products are drafts.
- Category pages: not capturable on shop.com, and not separately captured here.

## Round 6 (owner-authorised beyond the 5-round cap)

Owner decision, 2026-10-22, relayed by the coordinator: "ya" to one extra independent review round beyond the 5-round cap. The rounds log is not reset; round 6 is appended to `docs/spec/design/reviews/shop-com-r2/review-rounds.log`. Mechanism: `visual-review.py` refuses at 5 rounds when it finds `design/review-rounds.log`, so the history log stays in `docs/spec/design/reviews/shop-com-r2/` during this authorised run, and the run's line is appended there as round 6 afterwards.

The round-6 capture comes from a fresh build that includes the four post-round-5 fixes: `npm run check` PASS, browser suite 61/61, the full `shots-r2.mjs` with the tall-viewport 320 method, nothing in `src/` newer than the captures, and overflowX 0. No source was edited after this capture.

## Real-catalog switch (S81) and follow-up, after the round-6 PASS

S81 replaced the demo merchandising with the published Berlapak catalog: real photos, real top-level departments and the eight newest publications on home. The round-6 PASS covered the fixture catalog only. The following builder changes need a new capture and review round:
- Category tiles: a real photo per department, the first image of the department's newest current publication, read through the guarded public reader (`departmentPhoto` in `src/modules/storefront/catalog.ts`). The tile shows it full-bleed with alt "Contoh produk kategori <name>". The labelled placeholder remains only when a department has no published photo.
- Home composition: the departments row now spans the full width below the hero (four per row on desktop, two on phones), instead of a 26.5rem side column that left an empty block beside four long-named departments.
- Department chips: on phones they form one horizontally scrolling row (the shop.com chip row), with focus-outline room, instead of three wrapped rows of long names.
- Listing cards: the real bundle contents are clamped to two lines. The full text stays in the DOM, and the PDP shows the full contents.
- Environment copy: the banner reads "Data contoh: pesanan, pembayaran, dan pengiriman masih simulasi lokal." (it keeps the "Data contoh" phrase asserted by `tests/smoke.test.ts`). The footer reads "Katalog dan foto produk asli. Pesanan, pembayaran, dan pengiriman masih simulasi lokal." The "katalog contoh" returns sentence is now "Ketentuan pengembalian belum diterbitkan."
- Department tile baselines: each tile spans two shared grid rows (media, label) through `subgrid`. Labels in a row therefore start on one line even when an enlarged placeholder brief grows one slot or names wrap to different line counts, which keeps the 200%-text baseline invariant of `storefront-http`. Before this, the media used `flex: 1 0 auto`, which pushed each label to the bottom of an equal-height cell, so labels with different line counts started at different tops.

## Round 7 (aborted) and round 8 (owner-authorised: "lanjutkan, juga sempurnakan", relayed by the coordinator, 2026-10-22)

Round 7 ran on the first real-catalog capture, but was aborted before counting because pending admin source changes made its evidence stale. Its verdict is not counted; the review is kept as `docs/spec/design/reviews/shop-com-r2/review-round7.md`. Its findings within builder authority are fixed for round 8, the counted round, which is appended to the existing rounds log (the log is not reset):
- PDP buy box: the raw catalog description no longer sits between the price and the purchase controls. It is now a "Deskripsi" accordion after the purchase region, using the same summary and chevron pattern as "Ongkir dan pengiriman" and "Pengembalian". A long description (over 160 characters) starts collapsed; a short one starts open. The text keeps its line breaks. Title → price → options → contents → stock → quantity → "Tambah ke keranjang" is the first block, as in the shop.com PDP.
- PDP media: sticky on desktop and tablet, so the left column no longer leaves a ~700px empty band beside the long buy box and accordions.
- Department chips: every top-level department is listed (the earlier cap of three hid one home tile's department). On phones they scroll horizontally on one line; on desktop they wrap.
- Home hero: on desktop the title sits beside a 34rem price card, instead of a ~1200px yellow band with an empty centre. Below 1050px they stack.
- Category tiles: the tile photo skips products already on the "Mulai dari pilihan ini" shelf, so no tile repeats a card photo. Tiles are four per row from tablet up (short tiles before the shelf at 768) and two per row on phones, with a 16px column gap so enlarged labels never run together.
- Lazy product images: the image box carries the lavender slot surface until it paints, and the capture script walks each page so every image loads before a full-page shot.
- Help chat header: the hours line sits under the H2 instead of being squeezed beside it.

Not changed (outside builder authority or accepted):
- The "Pengembalian" content is owner content that has not been published yet.
- The 7-line filled cart on phones pushes checkout below the first screen; this is acceptable under the spec.
- R3/R6 option pills remain UNVERIFIED because no published multi-option product exists.
- Category pages are still not captured.
- Tiles use one photo per department rather than shop.com's mosaic, because each department has a single representative photo in the data.

## Round 9 (owner-authorised under the standing "lanjutkan, juga sempurnakan", relayed by the coordinator)

Round 8 (counted) is `docs/spec/design/reviews/shop-com-r2/review-round8.md`, verdict REVISE. All five findings are within builder authority and are fixed for round 9, which is appended to the existing rounds log. Where they conflict, these entries supersede the round-8 notes above.
- Department chips: one horizontally scrolling row at every width, so they no longer wrap at 768 or 1440 and products return to the first screen on search at tablet. The current chip keeps `aria-current` and the charcoal edge. Focus rings are drawn inset (`outline-offset: -4px`) so the scroll clip cannot hide them, and the row scrolls on one line at 320/200%.
- PDP "Isi yang diterima": bundles of up to three items stay fully listed, so the fixture contents asserted visible in tests stay visible. Longer bundles show "N jenis barang dalam pilihan ini", the first three items, and a "Lihat N barang lainnya" disclosure using the accordion chevron pattern. "Tambah ke keranjang" moves up into the first screen at 1440 and much closer to it on phones.
- Category tiles now read as categories: a tinted lavender card with the department name first and a shorter 4:3 photo inside it, distinct from the white product cards, on both home and `/categories`. The subgrid keeps every name in a row on one line (name in row 1, media in row 2), so the 200%-text baseline invariant still holds.
- Product card titles are clamped to two lines, so prices align across each row. The full name stays in the DOM and the link's accessible name.
- Hyphenated tokens such as "3-in-1" and "Anti-Stres" are wrapped at render time in a `white-space: nowrap` span on card titles and the PDP title. The stored names and the text content (and therefore accessible names and test matching) are unchanged.

## Round 10 (owner-authorised under the standing "lanjutkan, juga sempurnakan"; the coordinator's last round this cycle)

Round 9 is `docs/spec/design/reviews/shop-com-r2/review-round9.md`, verdict REVISE. All five findings are fixed for round 10, which is appended to the existing rounds log. These entries supersede earlier notes where they conflict.
- Category tiles at 320/200%: the tile minimum width is now in `em` (9em on desktop and tablet, 8em on phones). Enlarged text therefore drops the tiles to one per row instead of squeezing long Indonesian names into two narrow columns, while ordinary text keeps two per row on phones and four from tablet up. Tile, label and media all have `min-width: 0`. Labels use `overflow-wrap: anywhere` and `hyphens: auto`. The photo panel is capped at the card width, so it stays inside the lavender card.
- Baseline test: the `storefront-http` 200%-text test compared labels pairwise (1–2, 3–4) on the assumption of two tiles per row. That no longer holds once enlarged text gives one tile per row. The builder changed it minimally to compare labels of tiles that share a row (same tile top), keeping the invariant that labels in one row share a baseline.
- Product card titles reserve two lines (`min-height: 2.75em` at a 1.375 line-height) and keep the two-line clamp, so a one-line title no longer lifts its price above its neighbours.
- Department chip row: a 40px end-edge fade signals that the row scrolls. End padding and scroll padding let the last chip, and any focused chip, rest clear of the fade, and a thin scrollbar appears on hover or keyboard focus. The nine real department names (roughly 1,800px of chips) cannot fit one 1200px row even with tighter padding, so the row scrolls at every width rather than imitating shop.com's fully visible row.
- Help topic cards are top-aligned, so the short "Pengembalian" card is not stretched to the height of its neighbour.
- Omnibox: the search icon is 1.25em inside an em-padded button with a minimum height of `max(44px, 2.25em)`, so at 320/200% the icon keeps clear space inside the purple button.

## Round 11 (owner-authorised: "ya jalankan, audit, juga validasi dan lakukan penyempurnaan", relayed by the coordinator)

Round 10 is `docs/spec/design/reviews/shop-com-r2/review-round10.md`, verdict REVISE. Its main finding was contaminated evidence: integration fixtures were published in the captured catalog, so home, listing and the captured PDP showed fixture products, and no real bundle PDP was rendered. The coordinator now captures only on a verified-clean catalog (withdraw dry-run 0 immediately before capture). The capture script also refuses to continue on contamination.

Design fixes for round 11, which supersede earlier notes where they conflict:
- Price rows: every product card spans five shared rows (media, title, contents, price, stock note) through `subgrid`. Prices line up across a row whatever the title or contents length, so the round-10 two-line title reservation is removed. In a one-column grid (320/200%), each row fits its own card, with no reserved blank line.
- Omnibox at 320/200%: the search icon is `max(1.25rem, 1em)` in a compact em-padded button (minimum height `max(44px, 2em)`), and the field keeps at least 6ch. "Cari produk" no longer truncates beside the enlarged button.
- Help chat hours line: regular weight in the muted colour, so it no longer competes with the H2.

Evidence method for round 11 (`shots-r2.mjs`):
- 390 and 768 use the document-tall viewport method (previously only 320), so the fixed mobile dock sits over its reserved spacer instead of covering cart summary rows mid-page.
- `/categories` is captured at all widths.
- A real B99 bundle PDP is chosen deterministically: the published product with the most contents lines, ties broken by URL, found by scanning every listing page. It is captured with "Deskripsi" and "Lihat N barang lainnya" collapsed (`pdp-bundle-*`) and opened (`pdp-bundle-open-390`, `pdp-bundle-open-1440`). The run aborts if that product has no collapsed contents disclosure.
- Contamination guard: the run aborts with a clear error if any rendered product name on a captured page matches `/^Contoh |SYNTHETIC|\[s2\d-|S21 filter/`.

## Round 12 (owner standing approval "lanjutkan … sempurnakan", relayed by the coordinator)

Round 11 is `docs/spec/design/reviews/shop-com-r2/review-round11.md`, verdict REVISE. It confirmed the clean catalog, the real 7-item bundle PDP with "Tambah ke keranjang" inside the first 900px at 1440, the subgrid price alignment and the shell and pages. Fixes for round 12 supersede earlier notes where they conflict:
- `/categories`: every top-level department is a tile (photo, or the labelled placeholder), and the "Kategori lainnya" disclosure is removed. Any subcategories are listed openly as wrapping pill links under "Subkategori". The header chip row lists every department too, so the two always match.
- Product cards now span four shared rows: media, a title-and-contents text block, price, and stock note. The spare height in a row falls below the text block, above the price, so there is no blank line between a one-line title and its contents, and prices still align.
- PDP extra-contents disclosure: the label reads "Lihat N barang lainnya" when closed and "Sembunyikan barang lainnya" when open. This is CSS on `details[open]`, so the summary's accessible name follows the visible label.
- Minor:
  - the chip row's end padding (56px) is now wider than its 40px fade;
  - footer links are 8px apart;
  - the help chat card ends on its own 24px padding (the attachment disclosure spaces only what follows it), and its notification heading is sentence case.
- Evidence: `search-active-390` and `search-filters-open-390` now use the document-tall viewport method like every other narrow capture, so the fixed dock no longer covers "Terapkan filter".
- Test alignment: `storefront-http` expected exactly four `/categories` tiles (the old featured cap). It now expects one tile per department link in the header chip row (all chips minus "Semua produk"), because both come from the same department list.

## Round 13 (owner standing approval "lanjutkan … sempurnakan"; the builder ran build, capture and review this round)

Round 12 is `docs/spec/design/reviews/shop-com-r2/review-round12.md`, verdict REVISE. Its gate also failed `critique` because the coordinator's CLS change to `src/components/storefront/filter-panel.tsx` (an inline pre-paint script that opens the filter panel on wide screens, verified by Lighthouse; no CSP is configured) landed after that capture. That change is kept as is.

Fixes for round 13, superseding earlier notes where they conflict:
- Search card distinguishability: an offer whose contents are a single item (the titled product itself; 366 of the 392 published offers) shows only its quantity, "Isi: N pcs", derived from the data. Mixed bundles keep their item list. On phones (≤700px) titles may use three lines, so same-family names such as "Paket 2 pcs Kaos Kata Lucu Sindiran …" keep their distinguishing words.
- Grid rhythm: card rows are 12px apart (R4), measured on this build as 930 → 942 at 1440. Inside a card, the subgrid tracks add no gap. An empty stock-note track has no height, so it collapses in rows without a note; this is pure CSS, with no script-driven layout shift.
- Home shelf: three cards per row at 768 (minimum 12.5rem), four at desktop, two on phones.
- Chip row: the end fade is now 64px, with 72px of end padding and scroll padding, so the cue is visible at 390 and 320 as well.
- Cart line: bundle items fold after the third, with the same "Lihat N barang lainnya" / "Sembunyikan barang lainnya" disclosure as the PDP.
- Footer note: "Pesanan, pembayaran, dan pengiriman masih simulasi lokal." The unsourced "katalog dan foto produk asli" claim is removed.
- `/categories` chip state: no chip is marked current there, and this is deliberate. Every chip links to `/search` or a category listing, so `aria-current="page"` on any of them would be false on `/categories`. The dock's "Kategori" tab carries the current-page state for this page.
- Evidence: the ordinary `pdp-*` capture is now a different product from `pdp-bundle-*` (the first listed product that is not the bundle, preferring three items or fewer).
- R3/R6 option pills: not verifiable with the current data. A full scan of all 392 published products on this build found none announcing more than one option, so no option-pill state can be captured. This remains UNVERIFIED by data, not by omission.

## Round 14 (coordinator accepted round 13 including the `/categories` aria-current reasoning; owner standing approval)

Round 13 is `docs/spec/design/reviews/shop-com-r2/review-round13.md`, verdict REVISE. All seven findings are fixed. These entries supersede earlier notes where they conflict:
- Product card titles: up to three lines at every width, so the 24 "Paket 2 pcs Kaos Kata Lucu Sindiran …" cards keep their distinguishing words. When the grid is a single column (a very narrow screen or enlarged browser text, where two columns of at least 8rem no longer fit, i.e. `max-width: calc(16rem + 44px)`), titles are unclamped. The four-row card subgrid still aligns prices wherever cards share a row, without layout shift.
- Home shelf: at tablet (three per row) it shows six of the eight newest products, so no row ends with an empty slot. Desktop shows all eight four-up, phones two-up.
- PDP bundle: the redundant "N jenis barang dalam pilihan ini" line is removed. The title and "Pilihan lengkap" already state the size, and the "Lihat N barang lainnya" disclosure still follows the first three items.
- The disclosure chevron flows inline right after its label (block summary with an inline icon), so it stays attached when the label wraps at 320/200%.
- Cart "Perbarui jumlah" uses the shared secondary button size and sizing; the cart-only 0.8rem and 14rem overrides are removed.
- `/masuk` "Batal" is a quiet text action (transparent fill and border, lavender hover), clearly secondary to the filled 52px "Masuk".
- Category tile names use a 1.3 line-height. Desktop footer links use 32px pointer targets with no extra gap; phones keep the 44px targets and 8px gap.

### Round 14 owner scope: "reduce over-design", "make it clean, with effects like shop.com"

Interaction contract (observed 2026-10-23 on shop.com search and home at 1440 and 390; read-only, chrome-devtools MCP; scratchpad evidence `shop-search-focus-1440.png`):
- Product card hover: no visible change. Media, title link and price showed no underline, shadow change, transform, opacity or filter (computed styles compared hovered and unhovered).
- Product media at rest: white, 20px radius, no border, one shadow `0 2px 8px rgba(0,0,0,.06)`. Title 14px/600 in black; price 12px/600; struck reference price at 56% ink.
- Filter chips: full pill, 40px tall, 1px `rgba(5,41,77,.1)` border with the same 2px/8px shadow, label 14px/600. Hover showed no visible change.
- Buttons: hover is a background fill change only (primary to a darker brand fill, outlined to a light fill); the primary is a 52px pill. No lift or scale.
- Transitions: 150ms `cubic-bezier(0.4, 0, 0.2, 1)` on colour, background, border and shadow; 200ms on the search field.
- Search field: a pill (white with a 1px border and the 2px/8px shadow at rest). Focus opens a suggestions panel instead of a ring: white at 75% over a 16px backdrop blur, 32px radius, `0 0 1px rgba(0,0,0,.12), 0 12px 64px rgba(0,0,0,.24)`. Placeholder at 56% ink; round purple submit or clear button. No suggestions endpoint exists here, so 99ribu transfers only the field look and gives focus a ring on the pill.
- Headings 600, never heavier; no hover underlines anywhere except running text.

Section composition: shop.com heads each shelf with a title and a "›" link and keeps sections in a flat rhythm. 99ribu mirrors that with plain "Semua kategori ›" / "Semua produk ›" text links in place of pills. No sections are invented for data the catalog lacks. The header layout, logo, nav and dock are owner-approved and unchanged; only the search field's look and focus state changed.

Removed or changed patterns (before → after), all in `src/app/globals.css` unless noted:
- Hover underlines on UI links (the global `a:hover`, `.product-link:hover h3`, `.footer-links a:hover`, breadcrumb and "Lanjut pilih produk" rest underlines) → no underline in the storefront, checkout, receipt and sign-in shells, with colour feedback only. Links in running prose keep the underline (WCAG 1.4.1); the admin keeps its hover underline.
- Field focus (a 3px purple outline offset 4px, and 1px → 2px invalid borders in four places) → one contract: 1px `#85858e` border (3:1), 12px radius, 44px minimum; focus = ink `#18181b` border plus a `0 0 0 3px rgba(24,24,27,.12)` ring. Invalid = error border plus a 1px inset, so the box never shifts. `CustomerChatView.tsx`'s inline field border is removed so the contract applies.
- Selects (native double arrows, filter selects as full pills) → `appearance: none`, one inline SVG chevron, 12px radius, 44px tall, padding clear of the chevron.
- Filter panel open state (24px radius plus a two-layer shadow) → flat white, 20px radius, one hairline.
- Shadow stacks on the help topic cards, cart summary, sign-in card and chat card → one `rgba(5,41,77,.1)` hairline, no shadow.
- The price card's yellow glow shadow → removed.
- Placeholder slot gradients (`.photo-slot`, `.department-photo`) and their borders → flat `#f4f3f8`.
- Product media: lavender fill plus a 1px border → the observed white 20px media with one 2px/8px shadow.
- Product cards: the contents/description line ("Isi: …", item lists, "· N pilihan") → removed. A card is image, title (three lines, unclamped in one column), price, and a stock note only when relevant (`products.tsx`).
- Card price weight 700 → 600 (observed).
- Shelf "see all" pills → plain text links with a chevron.
- Motion: none before → the observed 150ms colour/border/shadow transition only (disabled under reduced motion). No lifts, scale or animated underlines.
- Header search: double shadow, no border and a purple outline on the input → one hairline plus one 2px/8px shadow, a focus ring on the pill, and the placeholder at `#6b6b73` (shop.com 56% ink).

Kept on purpose:
- Pills where shop.com uses them: chips, buttons, the search field and option pills.
- The stock note, which has decision value.
- Owner-authored and state copy.
- The approved header and dock.
- The 44px touch targets, visible focus, and prose link underlines.

Round 14 also carries the seven round-13 fixes listed above.

## Round 15 (round 14 REVISE follow-up, plus owner-allowed light motion)

Round 14 is `docs/spec/design/reviews/shop-com-r2/review-round14.md`, verdict REVISE. It confirmed the de-over-design pass and the observed interaction contract. Fixes, superseding earlier notes where they conflict:
- Phone listing titles: in the two-up grid, titles clamp at five lines. Same-family names ("Paket 2 pcs Kaos Kata Lucu Sindiran …") then show their distinguishing words, and the card subgrid keeps prices aligned per row. Titles are three lines from tablet up and unclamped in a single column.
- One rule for standalone text links (not inside running prose): purple, weight 600, no underline, with a darker purple on hover. This covers "Lihat keranjang", "Pengiriman dan pengembalian", "Cara pesan dan pengembalian", "Lihat paket campuran", "Lanjut pilih produk", "Semua … ›" and "Lihat N barang lainnya". Links inside prose keep the underline.
- Header current page: colour and weight only (the underline on "Keranjang" is removed), the same on every page.
- Help chat disclosure: the chevron stays inline after its label at every width, as on the PDP.

Light motion (owner: "light animation … if possible and light, without sacrificing PageSpeed"). CSS only, transform and opacity, 150–250ms ease-out, as state feedback:
- Disclosure chevrons rotate in 200ms.
- After a successful add to cart, the success message settles in (200ms opacity plus a 4px rise) and its check icon draws itself (stroke-dashoffset, 250ms).
- Colour, border and shadow transitions run at the observed 150ms.

Everything above is disabled under `prefers-reduced-motion`, nothing animates on load or on the LCP image, and nothing moves layout. No GSAP use case exists that CSS cannot cover (no sequenced timelines or scroll-linked reveals are needed), so GSAP is not installed and the initial JavaScript is unchanged.

## Round 16 (owner: card without "pilihan lengkap", regular card titles, homepage sections like shop.com)

Owner feedback, verbatim intent: "product card doesn't need 'Pilihan lengkap'; product card title not bold, like shop.com; homepage sections don't match shop.com yet".
- Product cards on every listing (home shelves, search, category) show image, title, price ("Rp99.000"), and the stock note only when relevant. The "/ pilihan lengkap" basis is removed from cards; the PDP keeps its "Pilihan lengkap: …" line and price basis.
- Card titles are regular weight (400), per the owner's call, overriding the earlier 600 observation. The price keeps 600.

shop.com homepage section map (observed 2026-10-23, read-only; `docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png`, `docs/spec/design/references/shop-com/2026-10-23-home-390-full.png`):

| # | shop.com section | Type and composition (1440 / 390) | Heading and "see all" | 99ribu |
|---|---|---|---|---|
| 1 | Logo collage, search pill, category chips with thumbnails | Hero search entry | — | Approved 99ribu header (search pill and department chip row); unchanged |
| 2 | "Shop is all about you" value card with sign-in | Large rounded value/promo card (64px/800 heading) | — | The 99ribu fixed-price value card ("Pilihan lengkap. Harga tetap." plus the Rp99.000 card); kept |
| 3 | "Trending stores" | Horizontal carousel of store cards (cover, rating, 2 product thumbs) | 20px/600 title, no link | Skipped: single seller, no store or brand data |
| 4 | "Categories ›" | Grid of short tinted tiles (~112px desktop, 72px phone), name plus one product image; 5 per row desktop, 2 per row phone, 10 tiles | The 20px/600 title is the link, with a chevron | "Kategori ›": up to 10 department tiles; tinted lavender, name top-left, one real product photo; 5 per row tablet/desktop, 2 phone, 1 at 320/200% |
| 5 | Animated department wordmark marquee | Decorative | — | Skipped: decorative motion |
| 6 | Department product shelf (Beauty) | One horizontally scrolling row of product cards (about 7 visible desktop, 2.3 phone): 1:1 media, title, price | The department name works as the heading | "Terbaru ›" (newest eight), then two department shelves ("<Department> ›", eight newest each, deduplicated against "Terbaru"); one scrolling row with seven visible on desktop, about 2.4 on phones, prices aligned by subgrid |
| 7 | "Home ›" store carousel | Store cards with product thumbs | Title link with chevron | Skipped: no store data |
| 8 | "Discover something you love" editorial collections | 64px/800 heading, large editorial image cards | — | Skipped: no editorial content (no fake promos) |
| 9 | Footer | Columns | — | Approved 99ribu footer |

The sections between them use about 48px of vertical rhythm, and that is applied. The former "Sebelum memesan" block has no shop.com counterpart and is removed from the home page; its content lives on the help page, linked in the footer. Department tiles without a published photo show only the name, with no placeholder brief. Their photo is decorative (`alt=""`) because the tile name is the link text. The `storefront-http` 200%-text test asserted exactly four home tiles (the old cap); it now requires at least one tile and keeps the same-row baseline check.

### Round 17 (round 16 REVISE follow-up)

Round 16 is `docs/spec/design/reviews/shop-com-r2/review-round16.md`, verdict REVISE. It confirmed the new home composition and the regular-weight cards. Fixes:
- Category tiles at tablet (five per row, about 131px wide): the name stacks above the photo, so names never break inside words. Desktop and phone keep the name and photo side by side.
- Product shelves: cards are at least 9em wide (`grid-auto-columns: max(42%, 9em)` on phones), so enlarged text widens a card instead of letting prices collide at 320/200%. Shelf titles clamp at three lines, so the shared title track no longer opens dead space at 390. Full names are on the listing and the PDP.
- Header: the cart count sits on the cart icon (absolute), so a count never narrows the search pill.
- Bundle contents use filled disc bullets in the cart, the same as on the PDP.

### Round 18 (round 17 REVISE follow-up)

Round 17 is `docs/spec/design/reviews/shop-com-r2/review-round17.md`, verdict REVISE. Fixes:
- Category tiles: below 1050px (tablet and phone), the name sits above a full-width 4:3 photo. Names use the whole tile width, so "Kecantikan & Perawatan Diri" no longer breaks into four lines with an orphaned "&", and the photo is large enough to read. Desktop keeps the name beside a 64px photo, matching shop.com's short tiles.
- Shelf scroll cue: desktop shows 6.5 cards, so a cut card at the edge signals the row scrolls, as on shop.com (where the cut card sits beside a "›" button). At 320/200% a card is at most 85% wide, so the next card always peeks in, and shelf titles stay clamped at three lines there too.
- The 2026-10-23 full home captures are now cited under Reference evidence, so the reviewer sees the loaded shop.com shelves.

### Round 19 (round 18 REVISE follow-up)

Round 18 is `docs/spec/design/reviews/shop-com-r2/review-round18.md`, verdict REVISE (one material issue). Fixes:
- Home on phones: the "Kategori ›" block shows six tiles, and below 1050px each tile is a name over a 64px photo strip, not a 4:3 photo. The block stays short, as on shop.com's phone tiles, so "Terbaru" starts in the second screen at 390. Every department remains one tap away in the chip row and on `/categories` (which lists all of them).
- Desktop tiles: the photo inset is 80px (tile at least 112px), so pale product photos stay legible.
- PDP: "Lihat keranjang" appears only after a successful add to cart, not before anything has been added.

### Round 20 (round 19 REVISE follow-up)

Round 19 is `docs/spec/design/reviews/shop-com-r2/review-round19.md`, verdict REVISE (category tile imagery at ≤1050px). Fixes:
- Below 1050px, category tile photos fill their area edge to edge (`object-fit: cover`, no white inset). Home uses a 64px strip to stay short; `/categories` uses a 4:3 photo, so tiles show recognisable products.
- Help topic cards use `clamp()` inline padding, so the text keeps its width at 320/200%, as on `/masuk`.

## Round 21 (owner: card type sizes, hidden shelf scrollbars, 1:1 typography, category switcher, omnibox, category pills)

Observed live on shop.com 2026-10-23 (read-only, chrome-devtools, 390 to 2560 wide). Evidence: `2026-10-23-switcher-1440.png`, `2026-10-23-switcher-390.png`, `2026-10-23-omnibox-open-1440.png`, `2026-10-23-pills-1440.png` beside this file.

### Typography contract (observed)

shop.com serves **GT Standard Web** (Grilli Type, commercial licence; one variable woff2, 300-900, from `shopify-assets.shopifycdn.com`). It is not copied or hotlinked. Substitute: **Inter 4.1** (SIL OFL), self-hosted under `public/fonts/inter-4.1/` with its `LICENSE.txt`, `font-display: swap`; the closest open-licence neo-grotesque in metrics and weight range. From round 26 the storefront preloads a 44KB Latin subset of the same file (see Round 26, item 5). Sizes, weights, line heights and tracking below are matched 1:1.

| Role | shop.com observed (desktop; phone) | 99ribu |
| --- | --- | --- |
| Body / input | 16/22, 400, -0.5px | same |
| Value hero heading | 64/58, 800, -1px; 36/38 | same (48/48 at <=1050) |
| Hero paragraph | 16/22, 400, -0.5px | same |
| Section heading | 20/22, 600, -1px; 18/20, -0.5px | same |
| Category pill label (buttonLarge) | 16/20, 600, -0.5px | same |
| Card title (bodyTitleSmall) | 14/18, 600, -0.2px, one line | same (owner reversed the earlier 400 call) |
| Card price (captionBold) | 12/16, 600, -0.2px, black | same, #18181b |
| Merchant line | 12/16, 400, -0.2px | n/a (single merchant) |
| Footer link / heading | 16/22, 400 / 14/18, 500, -0.2px | same |
| Category switcher label | 96/96, 800, -1px; 42/42 | same |
| Omnibox caption (captionMedium) | 12/16, 500, rgba(0,0,0,.56) | same |

### Category switcher contract (observed)

- `role="tablist"` labelled "Trending product categories", 10 `button role="tab"`s, roving tabindex, `aria-controls` to one `role="tabpanel"` (`aria-labelledby`).
- Label 96/96 weight 800 at -1px (phone 42/42); selected ink #000, others #b0b0b0; tabs 64px apart (phone 40px); strip 240px tall (phone 132px).
- Medallion: a 156px (phone 68px) product cutout/video centred over the selected label (`translate(-78px,-78px)`, z-index 1); others `scale(0)`, opacity 0; transition opacity and transform 300ms `cubic-bezier(.16,1,.3,1)`.
- Edge mask: linear-gradient fade 120px each side (phone 40px). The row is an infinite JS transform carousel (`overflow: hidden`).
- Panel 24px (phone 16px) below: one product shelf (167px cards at 1440, 151px at 390).

99ribu: home section after the "Terbaru" shelf (shop.com's order: pill navigation at the top, switcher lower); it replaces the old "Kategori ›" tile grid so the home has one category block plus the header pill navigation. Up to 8 published departments, each panel = that department's newest products (deduped against "Terbaru") in the existing shelf card; no "see all" link in the panel (owner removed it; the grid tile and pill already link to the department). Server HTML: plain links to `/category/<slug>` plus all panels, the first visible and the rest `hidden` (no extra endpoint; hidden panels' images stay lazy). A client island upgrades the links to tabs (Left/Right wrap, Home/End, `scrollIntoView({inline:'center'})`, smooth unless reduced motion). Medallion = the department's first non-sample product photo in a circle, `aria-hidden`, explicit width/height, all lazy (deviation from "selected eager": the strip is below the first screen and an eager medallion competed with the phone LCP photo). Native scroll without snap (as shop.com; a snap point on a name wider than the row hid its start) and a hidden scrollbar.
Skipped: the infinite loop (YAGNI; native scroll reaches every tab), video medallions, transparent cutouts (we only have product photos). Deviation: inactive labels #858585 (3.7:1, large text) instead of #b0b0b0 (2.1:1).

### Omnibox contract (observed)

- Collapsed container 512x64, radius 32px, padding 12px, `rgba(255,255,255,.75)` + `backdrop-filter: blur(16px)`, shadow `0 0 1px rgba(0,0,0,.12), 0 12px 64px rgba(0,0,0,.2)`; transitions height/max-height/box-shadow 320ms `cubic-bezier(.2,0,0,1)`.
- Field: 1-row textarea `role="searchbox"`, 16/22 -0.5px, padding 8px 50px 8px 46px, max-height 90px, scrollbar hidden; 20px search icon (stroke 2.67) in a 40px box on the left.
- Focused: container grows to 576 wide, max-height 405px (45dvh): caption "Suggested searches" 12/16 weight 500 rgba(0,0,0,.56), margin 8px 16px 4px; rows 40px, padding 4px, radius max, 16/22, a 20px icon at 60% in a 32px box, hover 4% dark overlay; then a personalisation/privacy link. shop.com exposes the rows as `li role="button"`, not a listbox.

99ribu: the header search keeps GET `/search?q=`, the "Cari produk" label and a submit button named "Cari produk" (works without JS). The fixed-height form holds the field; the glass surface behind it is absolutely positioned and grows down over the page (no layout shift), widening 32px each side on desktop. Input `role="combobox"`, `aria-expanded`, `aria-controls` to a `role="listbox"` labelled "Saran pencarian", options `role="option"` with `aria-selected` via `aria-activedescendant`; Up/Down move, Enter submits the active option (else the typed text), Escape closes and keeps focus, blur/outside click closes. Suggestions are computed server-side from the live catalog only: the merchant's visible category names split at commas and "&" ("Botol Minum", "Mainan"), kept only when at least one current product name contains the term, ranked by how many names do; typed text filters them client-side. (Recurring product-name words were tried first and rejected: mostly brands and adjectives such as "Kata", "Lucu".) Focus shows the field contract (ink edge + 3px ring) on the surface. The surface is `rgba(255,255,255,.75)` with `backdrop-filter: blur(16px)` wherever the browser supports it, as on shop.com, so the page shows softly through the open panel; solid white is only the fallback for browsers without `backdrop-filter`. Phones use .9 white with blur 10px. Reduced motion: no expand animation.
Skipped: image-search buttons (no image search, so no dead control), the personalisation/privacy caption (no personalisation), the auto-growing textarea (a `textarea` would stop Enter from submitting without JS; the single-line `input type="search"` truncates with an ellipsis instead).

### Category pill contract (observed)

- Scroller: `overflow-x: auto`, `scroll-snap-type: x mandatory`, `scroll-behavior: smooth`, `scrollbar-width: none`, `justify-content: safe center`, padding 16px, gap 24px at 500 and 1440 wide (the owner's paste said 32px; live computed 24px).
- Count (fixed short list, not every category): 5 pills + the grid link at every width. 768, 1024, 1440: all 6 fit, centred, no scroll. 390: 3 pills fully visible and the row scrolls (726px of content in 390).
- Pill `<a>`: 36px tall, flex, gap 8px, radius full; 36px circle (radius 24, 0.5px `rgba(24,59,78,.06)` border, solid per-category colour) with a transparent cutout scaled 1.5 inside a crop; label 16/20 weight 600 at -0.5px; focus-visible ring 2px with 2px offset. Ends with a 36px grid icon link `aria-label="Explore"` to `/categories`. Hover video skipped.

99ribu: replaces the old chip row (one category navigation). `nav aria-label="Kategori produk"`, the top 5 departments by published products (`/kategori/<slug>`, `aria-current="page"` on its page), ending with a grid icon link `aria-label="Semua kategori"` to `/kategori` (`aria-current` there); centred when it fits, scrolling with a hidden scrollbar on phones. Every department stays on `/kategori` and in the home switcher. Icons are chosen from words in the department name (never slugs), so renamed departments keep theirs; unknown names get a tag icon. Image (owner, round 21; curated from round 26): the department's curated photo (`department-photos.ts`), the same as its grid tile, in the 36px circle with `object-fit: cover` (our photos have backgrounds; shop.com uses contain for transparent cutouts), the department tint behind it, a 0.5px edge drawn over it, `alt=""`, 36x36, `fetchpriority="low"`. No resized variant exists (no image pipeline yet), so each pill loads the original webp; a thumbnail pipeline is the upgrade path. The Lucide department icons were removed; the grid link keeps its icon. Links keep a 44px target with the 36px pill inside. Micro-motion: photo scales to 1.06 over 150ms on hover/focus-visible, off under reduced motion. Current department: soft lavender fill on the pill (round 35; previously an ink ring and underline).

### Product card contract (observed)

Measured on the home switcher panel and the search results grid (`/search/results?query=candle`) at 1440.
- Card: `flex flex-col gap-8`. Image link: square, radius 20px, `overflow: hidden`, white fill, shadow `0 2px 8px rgba(0,0,0,.06)`, a `0.5px` inner edge `rgba(5,41,77,.1)` as an absolute `aria-hidden` overlay; image `object-fit: cover`, scales to `--product-card-image-hover-scale` on card hover.
- Text link: `padding-left: 4px`, line height 16px. Vendor line 12/16 400 (one line), title 14/18 600 -0.2px `line-clamp: 1`, rating 12/16 500, price 12/16 600; sale + struck regular price pattern.
- Carousel: `scrollbar-hide`, `scroll-smooth`, `sm:snap-x sm:snap-mandatory`, items `sm:snap-start`, gap 16px (8px below sm), phones bleed (`-mx-16 px-16`). Measured whole cards in view: 5 at 768 and 1024, 7 at 1280, 1440, 1920 and 2560 (the pasted DOM's 2.3/3/4/6 classes did not match the computed widths; the measurement wins).
- Arrows: "Go to the previous/next item", 42px round (not square), white, 1px `rgba(5,41,77,.1)` border, 10px padding, shadow `0 4px 24px rgba(0,0,0,.12)`, 20px chevron, vertically centred, 16px outside the track; their wrapper is at opacity 0 at rest (revealed on hover) and the previous arrow is hidden at the start.
- Grid (search): `w-1/2 sm:w-1/3 md:w-1/4 lg:w-1/6`, 8px gaps (16px from md).

99ribu: same frame, overlay (`::after`, no extra DOM), cover photo with 1.05 hover scale over 300ms (off under reduced motion), 8px text gap, 4px inset, one-line title (ellipsis; a one-column grid at enlarged text shows the full name), single fixed price. Shelves: 7 cards from 1280px, 4.6 from 701px (a cut card cues the scroll), 2.3 on phones bleeding to the screen edge, 16px/8px gaps, mandatory snap from 701px. Arrows "Produk sebelumnya" / "Produk berikutnya" (44px for our target size), rendered only after hydration, shown from 701px on hover-capable devices while the shelf is hovered or focused, disabled at each end, one view per press. Grid: 6 columns from 1024px, 4 from 768px, 3 from 701px, 2 on phones (auto-fill, 8rem minimum). Skipped: vendor line (no brands), favourite button (no saved items), badges and ratings (no data), struck price (fixed price).
Owner flag: the owner earlier asked to remove the hover scrollbar; that is done. These arrows are shop.com's separate desktop control for mouse users and are kept per 1:1 pending the owner's confirmation.

### Layout width contract (observed)

shop.com has no top header: a fixed left rail (76px) from 1024px, a floating bottom bar between 640 and 1023px and a full-width bottom bar below 640px. Page container `page-layout-root`, max-width 2032 to 2192px.

| Viewport | Gutter (each side) | Content start / width | Product cards in view | Search grid columns |
| --- | --- | --- | --- | --- |
| 390 | 16 | 16 / 358 | ~2.3 (8px gap, bleed) | 2 |
| 640 | 16 | 16 / 608 | - | 3 |
| 768 | 16 | 16 / 736 | 5 | 4 |
| 1024 | 32 (+76 rail) | 108 / 884 | 5 | 6 |
| 1280 | 32 (+76 rail) | 108 / 1140 | 7 | 6 |
| 1440 | 48 (+76 rail) | 124 / 1268 | 7 | 6 |
| 1920 | 64 (+76 rail) | 140 / 1716 | 7 | 6 |
| 2560 | 96, centred 2192 max | 318 / 1682+ | 7 | 6 |

99ribu (no rail; T-17 keeps a distinct phone composition at <=700px): `--gutter` 16px to 1023px, 32px from 1024, 48px from 1440 (64/96px tokens kept for wider screens but unreachable at the cap); **content max 1250px, centred: owner decision ("too wide; 1250 is enough") overriding shop.com's wider pages.** Header, pill row, hero, category grid, shelves (arrows just outside the track), listings, PDP and footer share that container; phones keep edge-bleed shelves. The header is a three-column grid (1fr, omnibox up to 512px, 1fr) from 701px so the omnibox centre equals the viewport centre (measured offset 0px at 768, 1024, 1440, 1920); the open omnibox widens symmetrically (inset -32px both sides). Phones: brand and search share one wrapping row, cart and account live only in the bottom dock (safe-area inset kept), shelves bleed edge to edge, no hover-only UI. Not done: a sticky phone header (shop.com has no top header to copy; our header scrolls away and the dock stays).

### Header actions contract (observed)

shop.com shows no top header actions: cart ("View Cart", a filled cart glyph, 24px icon in a 56px round button, scale on press) and account (32px avatar "Sign in") sit in the left rail at desktop and the bottom bar on phones; no badge was shown (empty cart). Nothing is duplicated between header and bar.
99ribu: icon-only header actions from 701px: cart (Lucide `shopping-cart`, 24px, stroke 2, round caps) and account (Lucide `user`), 48px round hit areas, 4% ink hover fill, purple 8% fill for the current page, the count badge on the icon's top right (`aria-hidden`; the link's name carries the count: "Keranjang, N pilihan"); account is named "Akun" and keeps its `/akun` target. Deals: shop.com's rail puts "Deals" (filled tag glyph, 24px in the same 56px round button, `/offers`) directly after the cart; its phone bar has no Deals. 99ribu: an icon-only "Promo" link (Lucide `tag`) from 701px, to `/promo`, placed first (owner decision, round 29: Promo, then Cart, then Account, left to right and in DOM/tab order), rendered only when `/promo` has real content (an active shipping promotion or a published bundle); not on phones. `/promo` lists active shipping promotions with their stored terms and the published mixed bundles; prices stay Rp99.000, no invented discounts. Phones: no header actions; the bottom dock holds Beranda, Kategori, Keranjang (same cart glyph), Akun.

### Public URL map (Indonesian, round 21)

`/kategori`, `/kategori/<slug>`, `/produk/<title>-<id>` (resolved by id; a stale title part 308s to the canonical slug, query kept), `/cari`, `/keranjang`, `/pesanan/<id>`, `/bantuan` (anchors `#returns`, `#privacy` unchanged), `/akun`, `/afiliasi`; `/masuk`, `/checkout`, `/checkout/order/<id>` unchanged; `/api/v1/**` and `/admin/**` stay English. No redirects from the old paths (pre-launch).

### Hero contract (observed)

Signed-out home, `section[aria-label="Featured shops"]`, measured at 1440 and 390.
- 1440: card 1268x461 (aspect 2.75:1), radius 36px, shadow `0 8px 40px rgba(0,0,0,.24)`, `overflow: hidden`; background `<video>` (autoplay, muted, loop, poster, `object-fit: cover`) in an absolute, `aria-hidden` layer.
- 390: the track bleeds; each slide is 358x500 with a 16px inset, same radius and shadow.
- Copy overlay: absolute inset 0, `flex items-end`, padding 16px (md 32px), gap 24px; H2 posterLarge 64/58 weight 800 -1px (phone posterXS 36/38) with a manual line break; body 16/22 400 `text-wrap: balance`; actions: phone grid of 2 columns (159px each, 8px gap), md inline. Primary "Sign in" brand fill rgb(84,51,235), white 16/20 600, padding 12px, radius max, min-height 44px, inset highlight `-0.5px -0.5px 1px rgba(255,255,255,.32)`; secondary "What is Shop" white fill, shadow `0 2px 8px rgba(0,0,0,.06)`, icon + label.

99ribu (replaces the value card): `section.home-hero` labelled by its H1 "Semua / Rp99.000"; body "Harga tetap untuk setiap pilihan lengkap. / Bayar transfer, VA/QRIS, atau COD." (all three are offered in checkout: manual transfer, AutoLaris VA/QRIS simulated, COD); primary "Masuk" to `/masuk` (signed in: "Lihat produk" to `/cari`), secondary "Bantuan belanja" to `/bantuan` with an arrow icon. Heights reserved per breakpoint: 500px phones, 440px from 701px, 2.75:1 up to 685px from 1280px. Media: up to eight of our newest product photos (server-chosen, stable) as white rounded tiles on a lavender/yellow brand tint, each drifting 14px over 9 to 14s with staggered delays (`translate` only); static under reduced motion. The copy sits on a canvas-coloured scrim (near-opaque behind the text), so black text stays above 4.5:1. First photo eager with `fetchpriority="high"`, the rest lazy/low; explicit width/height. Optional `video` prop (poster, webm/mp4; muted, loop, inline, `preload="none"`, started after `load`, never under reduced motion or Save-Data); no video ships. No shop.com media is copied or hotlinked.

### Home category grid contract (observed)

shop.com "Categories" (H2), 10 tiles: links `/categories/<id>/<slug>`, each a 16px-radius card with a full-bleed cover image (its own colourful art; `object-fit: cover`, wrapper `group-hover:scale-105`) and a centred white label (phone 14/18 600 bodyTitleSmall, md 16/22 600 -0.5px bodyTitleLarge). Heights 72 / 84 (md) / 100 (lg) / 112px (xl). Columns 2 / 3 (sm) / 4 (md) / 5 (lg); gaps 8px on phones and 16px at 1440 (1268 = 5 x 241 + 4 x 16). Order on the signed-out home: category pills, hero card, trending stores, Categories grid, category switcher, more carousels.

99ribu: "Kategori ›" section directly under the hero: the top 10 departments by published products, `/kategori/<slug>`, same heights, columns (3 from 641px) and gaps. Our product photos are white-ground shots, so a full-bleed photo would put a white label on white; instead each tile uses the department tint (same palette as the pills) with a dark label (>=4.5:1) and the department's own photo clipped into the tile end, tilted -8deg; the photo scales to 1.05 on hover (off under reduced motion); focus ring 2px with 2px offset. Final home order: pills (header) -> hero -> Kategori grid -> Terbaru shelf -> category switcher. The switcher stays because shop.com shows both blocks, with a product carousel between them; its medallion uses a different photo than the grid tile.

### Footer contract (observed)

shop.com, 1440: white band (the page canvas is #fbfbfb), no top border. Brand block left: QR code, wordmark, tagline 14/18 400 rgba(0,0,0,.56). Right: four `nav` columns labelled by their heading ("Learn more", "Get started", "Social", "Legal"): heading `p` 14/18 500 black, 16px below it a list with 12px row gaps of 16/18 400 black links; columns 24px apart. Bottom row: app-store badges, "© Shopify Inc. 2026" 14/18 tertiary, "Language" link, "Powered by Shopify". 390: brand stacked, then the four navs in a 2-column grid (40px row / 24px column gaps), no accordion, then the bottom row.

99ribu: `footer.store-footer` (white band) inside the 1250px container. Brand block (wordmark, "Semua pilihan lengkap Rp99.000.", the local-simulation note). Menus as `nav`s labelled by `h2` headings: "Belanja" (Semua kategori, the top four departments, Cari produk), "Bantuan" (Bantuan belanja `/bantuan`, Pengembalian `/bantuan#returns`, Status pesanan `/akun`, Hubungi kami `/kontak`), "99ribu" (Tentang kami `/tentang`, Afiliasi `/afiliasi`). Bottom row: "© 2026 99ribu" and a "Legal" nav (Kebijakan privasi `/privasi`, Syarat dan ketentuan `/syarat`). Phones: same stacked order, menus in two columns, 44px link targets; desktop links are 30px tall in the 12px-gap rhythm. Skipped: QR code, app badges, social links and a language selector (no app, no social accounts, one language). `/tentang`, `/kontak`, `/privasi`, `/syarat` are placeholder pages ("Halaman ini sedang disiapkan." and a link to `/bantuan`), `noindex, follow`, and not in the sitemap.

### Round 21 review response (REVISE, `21 claude REVISE 03b2912ea4136abd`)

1. One-line card titles: kept. This is the owner's explicit round-21 call ("product-card UI/UX 1:1 with shop.com", title `line-clamp-1`, "remove the 3/5-line clamp rules"); the catalog agent shortened titles for it. The full name stays in the link's accessible name, on the PDP and in full in a one-column grid at enlarged text. Flagged to the coordinator as an owner decision the reviewer disagrees with.
2. Category tile names broke inside words: the grid now keeps a 10em minimum per column (auto-fill), so enlarged text gets fewer, wider tiles (one per row at 320/200%), and `overflow-wrap: anywhere` is gone; the label takes up to 58% and the photo 46%.
3. No cart at 768: the header's side columns are now at least 10rem each (equal), so the three icons always fit and the omnibox shrinks first; the centre still equals the viewport centre.
4. Hero price split at 320/200%: "Rp99.000" is `nowrap` and the heading uses `min(2.25rem, 12.5vw)` on phones, so the price stays whole.
5. Two tile treatments: `/kategori` now uses the same `CategoryGrid` component and the same photo pick (the department's newest product photo) as the home grid; the old lavender tiles and their CSS are deleted.
6. Pill photos: `object-fit: contain` with `mix-blend-mode: multiply`, so the photo's white ground takes the department tint and the whole product shows; the tint is always behind. At 768 the five pills scroll when the names are long (shop.com's short names fit; ours like "Perkakas & Elektronik" do not).
7. /promo: the bundle section is renamed "Paket campuran" (no saving claim). The Promo icon still shows when only bundles exist, per the coordinator's rule (hide only when there are neither promotions nor bundles).
8. Minor: suggestions skip terms under four letters ("Ibu"); phone footer lists get a 4px gap between links; task pages (PDP) now show the same footer menus.
9. Switcher medallion: now 112px (phones 56px) and placed above the selected name instead of on it (deviation from shop.com's overlap, for legibility).

### Round 22 review response (REVISE, `22 claude REVISE a8957acd1c4e27bc`)

- Hero "Cara belanja" at 320/200%: the arrow is sized in em and the label is its own shrinkable span, so icon and text stay inside the pill.
- Switcher at 320/200%: the phone label is capped at `min(2.625rem, 13vw)`, so the selected name fits the screen and its medallion sits centred above it.
- Home category grid at 768: whole rows only (8 tiles at four columns, 9 at three); `/kategori` keeps the full index.
- Filters at 1024: the four filter fields are four across from 1024px and two by two below (never three plus one).
- `/promo` "Paket campuran" lists only bundle offers with at least two different items.
- Not changed: pill photos that are mostly white ground stay as they are, because choosing a photo by its content would need image analysis we do not have; the multiply blend keeps them on the tint. The two-row dock in the 320/200% crop is the existing short-viewport rule working (checked: at 320x900 with a 32px default font, `max-height: 38rem` matches and the dock is `position: static`). The dock then sits in the page flow right under the header instead of covering content, so it does not hide anything.

### Round 23 review response (REVISE, `23 claude REVISE 271ea683886c4762`)

- Pill and tile imagery: product-centred crops. Pill photos are covered and scaled 1.5x inside the 36px circle, as shop.com scales its pill art. Tile photos are covered and scaled 1.35x, so white margins and banner text fall outside and the product fills the card. The white ground is still multiplied into the tint in the pills.
- Hero: no tile touches the card's top edge any more (only side bleed, as on shop.com). The phone heading leading follows its size (1.055), so "Semua" and "Rp99.000" stay one block at 320/200%.
- `/promo` "Paket campuran": the 12 most varied bundles, ordered by number of different items, instead of the newest 24 (which matched `/cari` page 1). Whether the Promo icon should also need an active shipping promotion is a coordinator/owner rule; it is unchanged (shown when there are promotions or bundles) and flagged.
- Signed-in hero evidence added (`hero-signed-in-390`).

### Round 24 review response (REVISE, `24 claude REVISE 23a0258659777f2b`)

- Photo consistency: a bug passed the switcher medallion photo to the home tile. The home tile, the `/kategori` tile and the header pill now all use the department's newest product photo, and the switcher medallion uses the next one.
- Tile crops: the cover scale is raised to 1.6x, so banner text and white margins fall outside the tilted card.
- Shelves 701-1279px: 4.6 cards in view, so a cut card signals the scroll (shop.com shows 5 whole cards plus hover arrows; our row needs a visible cue without hover).
- Omnibox glass: the contract text is corrected. The panel is translucent with blur wherever supported, as on shop.com; solid white is only the fallback.
- Not changed: hero and pill photos that are mostly white ground (picking photos by their content needs image analysis we do not have); the duplicated item list under "Deskripsi" on bundle PDPs (owner content); the Promo icon rule (coordinator's rule, flagged).

## Round 26 (coordinator decisions, owner-aligned; accepted deviations for review)

Decisions recorded here are the coordinator's/owner's and are accepted deviations, not open findings:
1. **Department imagery, curated:** one clean product photo per department, picked by eye from the Berlapak dataset (contact sheets of every department's product photos were inspected): plain or light ground, product clearly visible, no text banners or watermarks. The picks live in `src/modules/storefront/department-photos.ts` (slug -> dataset product key + photo hash + one-line reason) and feed the header pills, the home and `/kategori` grids, the switcher medallion and the hero. There is no automatic "newest" pick any more. A department whose pick is no longer on a current publication shows its tint without a photo. The switcher medallion therefore shows the same curated photo as the department's tile (one photo per department everywhere), superseding the round-24 "different photo" note.
2. **One-line card titles:** owner decision (1:1 with shop.com). Accepted deviation.
3. **Desktop shelf arrows:** owner confirmed ("panah carousel desktop pakai seperti shop.com aja"). Kept 1:1.
4. **Promo icon with only bundles:** kept; bundles are real content. Accepted.
5. **Performance:** the round-21 work had dropped home mobile from 99 to about 70-90. Root causes and fixes:
   - Photos were full-size originals (about 1000px). Every storefront image now asks Next's built-in optimizer for resized webp (`next.config.ts` `images.localPatterns` /media/catalog/** only, quality 60, widths 64-1080), with srcset/sizes bounded per slot: pills one 64px source, tiles 96-256, hero 128-384, cards 256-384, PDP 384-1080. These are plain server-rendered `<img>` elements; `next/image` would add a client component.
   - The 352KB variable Inter file put text paint behind the font in a throttled load. The storefront now loads a 44KB Latin subset, preloaded from the shell: Latin ranges, default features plus `tnum`, opsz axis pinned to its 14pt default, wght 100-900 kept. The full file remains as a fallback face for other characters. Accepted visual consequence: large headings use Inter's text optical size instead of its display size.
   - Hero photos are low priority and lazy (no preload), and each phone photo is smaller than the heading, so the heading text is the phone LCP.
   - The home reads in parallel, and lists products only for the five switcher departments (six cards each), which halved TTFB and trimmed the HTML.
   - Home sections below the hero use `content-visibility: auto`.

### Round 26 review response (REVISE, `26 claude REVISE 2ca272a889966e3c`)

- Re-picked by eye: **Kecantikan** is now a fanned set of make-up brushes, replacing the barber trimmer. **Wanita** is now women's sunglasses spread across the frame, replacing the off-centre orange bag that cropped to a fragment.
- Tile art now sits fully inside the tile (40% wide, 4% from the edge, 1.1x crop), and the pills crop at 1.15x. The curated photos have no banners to hide, so the whole product shows.
- The hero leads with six further curated photos (`HERO_PHOTOS`: teapot, torch, kids' jersey, oil pot, work gloves, sling bag). None of them is a department photo, and the hero shows only these six, so it no longer repeats the tiles and pills.
- Switcher panels hold seven cards, a full desktop row.
- The footer note is no longer narrowed to 24rem (now 30rem with `text-wrap: pretty`), so "lokal." does not sit alone.
- Omnibox focus: the ink edge and ring sit on the closed pill. Once the panel is open they move to the field row; the open surface keeps only the soft shadow, as in the reference.
- Not changed: the 320/200% placeholder truncation ("Cari prod...") is the single-line field at that size; the accessible name and the label are intact.

### Round 27 review response (REVISE, `27 claude REVISE 5605ecb160c57f30`)

- Category tile labels: each label owns the width left of the photo card (`calc(100% - min(40%, 112px) - 12px)`) with balanced wrapping. The photo card is capped at 112px. "&" is bound to the next word (`& Elektronik`), so it never sits alone.
- Pill row below 1024px: a 32px end fade signals that the row scrolls.
- Hero "Cara belanja" at 320/200%: 12px button padding (shop.com's) and an em-sized arrow, so the label stays on one line next to its icon.
- `/promo`: with no active shipping promotion, "Paket campuran" comes first and "Promo ongkir" with its sentence follows.
- Listing photos at one column: a `(max-width: 359px) 90vw` sizes hint, so a single-column card at enlarged text fetches a full-width candidate.
- Not changed, flagged to the owner/catalog: claims baked into merchant photos and names ("TERBUKTI AMPUH", before/after, "Anti Botak", "Pelangsing"), and the bundle PDP showing one photo for a multi-item bundle (a per-item thumbnail strip is new feature scope).
- Category grid columns: 2 on phones, 3 from 641px, 4 from 1024px and 5 from 1280px. shop.com shows 4 from 768px and 5 from 1024px, but a 170-180px tile cannot fit a name beside the photo card. The phone photo card is 32% of the tile, 40% from 768px.

### Round 28 review response (REVISE, `28 claude REVISE 01866ee6e50141a2`)

- Claims in home merchandising: the "Terbaru" shelf and the switcher panels leave out products whose photo or name carries an unsourced claim. The photos (before/after "terbukti ampuh", face-slimming, "pria kuat", "lebih ampuh", "wajah glow up") were found by inspecting every product shown on the home and are listed by content hash. Names are matched on pelangsing, anti botak, ampuh, tirus and glowing. They stay published and findable in listings; replacing their content is owner/catalog work (`department-photos.ts`, `homeSafe`).
- Switcher: the selected name is centred in the row on load and on every switch (row scroll only, never the page). Half-width side padding lets the first and last names centre with their neighbours visible, as on shop.com.
- Category tiles: the photo card is a square sized to the tile's own minimum height less a 10px inset (50/62/76/88px), tilted -6deg and vertically centred, so it stays inside the tile at every width. The label reserves the rest.
- `/promo`: the header tag icon takes the current-page fill there, like the cart on `/keranjang`.

### Round 29 review response (REVISE, `29 claude REVISE e90f97e20ab2ae9a`)

- Switcher on load: the first department starts at the row's start, clear of the 120px edge fade (40px on phones), so the row no longer opens on an empty half. Choosing a tab centres it (the half-width end padding lets later names centre). The loop stays skipped (YAGNI, recorded).
- PDP and cart media: merchant photos are cropped 8% each side with `object-view-box: inset(8%)`, so the product fills more of the panel without upscaling. The PDP srcset now sizes to half the viewport (up to the 1080 source), so the 740px panel gets a sharp candidate.
- On `/kategori/<slug>` the removable "Kategori: …" chip is gone, because the route is the filter.
- Footer links at enlarged text have a 0.5em gap, so a wrapped name does not read as two links.
- Header action order is an owner decision (round 29): Promo, Cart, Account, left to right and in tab order.
- Not changed, owner/catalog decision: unsourced claims in listing content. Home merchandising already leaves them out (round 28).

### Round 30 review response (REVISE, `30 claude REVISE 4387d0fb07027adf`)

- Claims in listings: within each listing page, products flagged by `homeSafe` (claim photo or claim word) now come after the others. Order is otherwise stable, and cursors and counts are unchanged, so the first screen of a category or search page leads with clean products. Replacing the flagged content stays with the owner/catalog.
- The PDP/cart `inset(8%)` crop is removed: it cut merchant text. The photos show whole, including their white margins (merchant content).
- Re-picked by eye: **Rumah Tangga** is a stainless floor-drain strainer and **Makanan & Kesehatan** a bottle of forest honey, replacing the "KOPI BALI" bottles and the dark date box.
- Phone footer links have no extra gap (44px targets only), so the footer is shorter.
- The phone switcher label is capped at `11vw`, so the next name peeks in at 320/200%.
- Not changed: the faded header text inside one merchant photo (CUKA APEL) is merchant content. The cart quantity row at 390 is unchanged this round.

### Round 31 changes (coordinator convergence decision)

- Search/category ordering is no longer touched (the round-30 within-page demotion is reverted). Flagged products stay where the catalog ranks them; see the compliance backlog above.
- Below 360px the environment banner shortens to "Data contoh: simulasi lokal.".
- The pill row's start padding has 2px extra, so a focused first pill's ring clears the gutter at 320/200%.
- Curated tile and pill photos show whole (no crop scale), so no merchant text is cut by a crop. Shelf cards were never cropped (square photos in square frames).
- The header Promo icon takes the current-page fill on `/promo`, and the order is Promo → Cart → Account.
- Round 31 review (`31 claude REVISE 76de65a4eb74a6e0`): `homeSafe` now also leaves out Gendes and Bright Glow (glow/whitening efficacy text on their photos) from the home switcher and shelves. Phone footer lists get a gap that is zero at the default size and half a line at enlarged text, so a wrapped name does not read as two links.
- Round 32 review (`32 claude REVISE 93199cd702597ed6`): the hero secondary and the footer link now read "Bantuan belanja", the `/bantuan` page title they lead to. The switcher label is 64px between 701 and 1023px, so the next name shows at 768. The hero primary stays as specified (accepted decision above).
- Round 33 review (`33 claude REVISE b720d8e7dcdd8f70`): on phones the hero actions stack full width, so "Bantuan belanja" stays on one line (shop.com's phone actions sit side by side, but its labels are shorter). Promo overlap is an accepted decision above. The cart "Hapus" row at 390 is unchanged.
- **Brand icons and share image (owner, round 33):** `src/app/icon.svg` is a hand-drawn "99" monogram: two geometric 9s, white on brand purple #5b35d5 with a yellow #f6c945 dot echoing the wordmark's ".", and no font. From it (one-off sharp script) come `src/app/favicon.ico` (16 + 32px PNGs), `src/app/apple-icon.png` (180px, full bleed) and `public/brand/logo-512.png`, which is the Organization JSON-LD `logo`. `src/app/opengraph-image.png` (1200x630) carries the wordmark, the monogram and "Semua Rp99.000" in Inter on the hero tint, with no product photos; its alt text is in `opengraph-image.alt.txt`. The old 204 `favicon.ico` route is removed. Evidence: `docs/spec/design/renders/shop-com-r2-20261022/favicon-sheet.png` (16, 32 and 180px).
- Performance regression found and fixed (round 33): the pill row's extra 2px start padding was not mirrored in its `scroll-padding`. The mandatory-snap row therefore snapped (scrolled) 2px on load, and that scroll ended Chrome's LCP recording. Both now share the same start offset. Home mobile is back to perf 99 with LCP about 2.0s (median of 3).
- Round 34 review (`34 claude REVISE 1256337a4d47a612`): `homeSafe` also matches whitening, detox and immunity names, which leaves out "Paket Detox & Imun Alami" and the Marlov whitening deodorant from home merchandising. The hero secondary's arrow sits inline with its label, so a wrapped label keeps the arrow on its first line at 320/200%. The phone/tablet pill row's end fade is 64px. The cart row layout at 390 is unchanged.
- **Current-state styling (owner, round 35):** the current category pill and the current "Semua kategori" link take the header's soft lavender current fill (`rgba(91,53,213,.08)`). There is no underline and no border change; shop.com's home pills have no selected state to copy, and the 0.5px edge stays on the photo circle only. No storefront current or active state uses an underline any more: the checkout progress step keeps weight and purple only. `aria-current="page"` is unchanged, and the keyboard focus ring stays.
- Round 35 review (`35 claude REVISE 44807a7257fc1136`): both Marlov photos (whitening text on the photo, name without the word) are in `CLAIM_PHOTOS`, which leaves the product out of home merchandising.

### Omnibox open/close (owner, round 36; re-observed live 2026-10-23)

- **shop.com, measured at 1440** (focus, then sampled every 40ms): the one container grows from 512x64 to 576x348 in about 80-120ms, with height and max-width transitions of 320ms `cubic-bezier(.2,0,0,1)`. The content does not fade (opacity 1 throughout). On blur it holds about 60ms, then collapses back to 512x64. The desktop scroll area has no mask; the owner's phone DOM shows a top fade.
- **99ribu:**
  - One surface: the field sits over the top of the same 32px-radius glass container. The body row animates `grid-template-rows: 0fr -> 1fr` over 320ms with the same curve (no JS measuring), and the container widens to 576px on desktop (the measured width; the brief's 600 was not observed).
  - The list fades and slides in 6px over 200ms after a 60ms delay. Closing reverses it at once.
  - The phone list scrolls under a 12px top fade.
  - Server HTML renders the panel collapsed and `inert`. Escape, outside click, blur and submit all close it, and focus stays on the input.
  - Rows: 44px targets (our contract, over shop.com's 40px), a 32px icon box with a 20px icon at 60% opacity, a 4% hover fill, and the same fill plus an ink inset for `aria-selected`. Up/Down keep the active row in view with `scrollIntoView({block:'nearest'})`.
  - Reduced motion: instant.
- **Suggestions:** the product-type phrases that open product titles (the first 1-3 words after pack prefixes). Each must appear in two or more categories (single-category leads are usually brands), mixed-case brand words stop a phrase, and multi-word phrases need three or more products. They are ranked by product count, deduplicated against department names and claim terms (`hasClaimTerm`), and cached with the 30s header chrome. The local catalog yields "Kaos, Alat, Kacamata, Lampu, Tas, Timbangan, …". Typing filters them by "contains", marks the matched part in bold, and adds a final row, "Cari “…”", that submits exactly what was typed.

### Header wordmark reveal (owner, round 37)

- **shop.com observed:** the logo is a static 24px "S" mark in the rail. Hovering does not change its transform or colour, and there is no reveal, so the motion follows the owner's brief.
- **99ribu:**
  - On a fine pointer, from 1024px, hover or `:focus-visible` grows "99rb." into "Serba 99ribu". "Serba " opens before "99"; "i" opens between "r" and "b" and "u" after "b", so the word reads "ribu"; the "." fades out.
  - Each part is a 0fr→1fr grid track with its glyphs fading in from 4px: 240ms in and 180ms out, on `cubic-bezier(.2,0,0,1)`, CSS only.
  - The logo stays in the header's left 1fr column, so the omnibox stays centred; the capture script asserts it while the logo is hovered.
  - Measured: the reveal widens the link from 69px to 180px. The gap to the omnibox is 155px at 1024 (44px left after the reveal) and 300px at 1440 (189px left). Below 1024 the gap drops to 115px, which would leave about 4px, so the reveal is skipped there and the static "99rb." stays. This is the brief's "skip where it does not fit". Touch keeps the static wordmark; reduced motion swaps it with no transition.
  - The link is always named "Serba 99ribu, beranda"; the animated parts are `aria-hidden`.
- **Evidence:** `docs/spec/design/renders/shop-com-r2-20261022/brand-rest-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/brand-hover-mid-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/brand-rest-1024.png`, `docs/spec/design/renders/shop-com-r2-20261022/brand-hover-1024.png`.

### Round 38: final marketplace taxonomy

- The local catalog now has the final 14 departments: Fashion Pria, Fashion Wanita, Ibadah, Kecantikan, Kesehatan, Ibu & Anak, Mainan & Hobi, Rumah Tangga, Dapur, Elektronik, Perkakas, Otomotif, Hewan Peliharaan, Makanan & Minuman. Product photos use SEO file names (`/media/catalog/<slug>-<12 hex>.webp`) with alt text.
- The curated map (`DEPARTMENT_PHOTOS`) follows the new slugs. Every department resolves its pick on `/kategori`. The two new picks were checked by eye:
  - **Elektronik:** TWS earbuds in their case on a white ground.
  - **Kesehatan:** two people wearing ankle supports on a white ground.
  - Neither photo has text or claims. Both show faint ghosting from the source images, which is part of the accepted merchant photo content.
- The header pills, the home grid (whole rows), `/kategori` and the switcher now render the new department names. The renders cited above were recaptured for this round.
- Search suggestions (round-38 review): the cleaned titles open with pack multipliers ("2 × 5 pcs Daster"), so a bare "Pcs" reached the suggestion list. The lead stripper now also removes `N ×`. Generic heads ("Alat", "Set", "Paket") appear only inside a longer phrase. A two-word phrase qualifies when it covers every product of its first word, so "Waist Bag" replaces "Waist". `storefront-http` asserts that no suggestion is a bare unit or generic head. The current list: Kaos, Kacamata, Madu, Lampu, Sarung, Summerspring (a product line sold in two departments), Tas, Timbangan, Waist Bag, Brush, Pipa, Rak, Sabun.
- The capture set now also cites the empty cart (`cart-390`) and `/bantuan` on a phone (`help-390`).
- Filled cart at 390 (round-39 review): the quantity pill is 5.5rem on phones, so "Perbarui jumlah" sits beside it in the 264px line column and the summary moves up 58px; "Hapus" keeps its own row. At 320, or with larger text, the controls still wrap. With a long bundle list, "Lanjut ke checkout" can still fall below the first screen, because the contents list ("Isi saat ditambahkan") is required content.
- `/promo` "Paket campuran" now applies `homeSafe` like every other curated surface, so claim-named bundles ("Paket Detox & Imun Alami") stay out of it. They remain findable in search and listings.
- Short-viewport dock (round-40 review): the dock `<nav>` now comes after `main` in the DOM. With the short-viewport rule (`max-width: 700px` and `max-height: 38rem`) the dock is static, so at 320px with 200% text the first screen shows the page and the dock follows the content, before the footer. On taller screens it stays fixed at the bottom, so the position is unchanged there; only the tab order moves (content first, then the dock).
