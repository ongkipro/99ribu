# Storefront shop.com parity, round 2: visual context

Author: Claude (builder, storefront parity round 2, 2026-10-22)

This is the evidence companion for this round. The canonical contracts are still `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md` (tokens, MW1–MW7, the storefront notes section "shop.com storefront parity — 2026-10-22") and `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md`. This file scopes one independent review of the public storefront: home, search/listing with filters, product detail, cart, empty states and help. It does not redefine product, design or task ownership.

## Audience and job

Indonesian mobile-first buyers who browse a multi-category catalog where every complete option costs Rp99.000. They search or pick a category, compare options and contents, add complete options to the cart and continue to checkout. The page has to transfer shop.com's layout, spacing, type rhythm, component patterns and interaction behaviour. It must not transfer shop.com's name, logo, trademarks, copy or images. The 99ribu `99rb.` wordmark, Inter, purple `#5b35d5`, warm yellow `#f6c945`, Indonesian copy and every tested accessible name stay as they are.

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

These are round-2 captures from the coordinator's production build of source that includes the inspection-A fixes. They were taken with the scratchpad `shots-r2.mjs`: full page, light theme, reduced motion, overflowX=0 on every capture. The builder opened each image below. No multi-option product exists in the current local catalog, so no `pdp-options` capture was produced; the option-pill state (R3/R6) is covered by source and earlier S22 option renders only, and remains UNVERIFIED in this round.

- Home: `docs/spec/design/renders/shop-com-r2-20261022/home-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/home-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/home-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png`. The hero and fixed-price card keep the 99ribu identity. Shelf headings carry white chevron pills (R12); four-up product shelf at 1440, two-up at 390; the "/ pilihan lengkap" basis now drops as one phrase (R5 fix holds); columned footer (R9). At 1440 the off-white canvas with white raised omnibox and chips matches the shop.com home 1440 reference.
- Search/listing: `docs/spec/design/renders/shop-com-r2-20261022/search-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/search-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/search-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/search-active-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/search-active-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/search-active-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/search-filters-open-390.png`. The active filter renders as a removable white pill chip. At 1440 the open filter panel (white 24px radius, pill selects) sits above a 5-column full-width grid, which is the R4 transfer of the shop.com search 1440 reference without its left rail. At 390 the closed pill opens into an in-flow panel with Apply/Reset, a non-modal adaptation of the shop.com search-filters 390 reference. Finding from the previous capture, now verified fixed in this recapture: the `margin-top: auto` on card prices had pushed prices to the row bottom only on cards without the "Stok pilihan belum tersedia" note. Prices now stack directly under the contents and align across each row; the note sits below them, as on shop.com cards.
- PDP: `docs/spec/design/renders/shop-com-r2-20261022/pdp-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/pdp-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/pdp-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png`. The white media panel sits beside a narrow buy box with a full-width 52px primary pill, pill quantity and chevron accordions between hairlines, as in the shop.com pdp 1440 reference. At 390 the media spans the full content width (the shop.com pdp 390 reference). Finding from the previous capture, now verified fixed in this recapture: at 768 the 24rem buy-box cap had left the media column narrower than the buy box. At ≤1050px the two columns now share the width equally (≈344px media beside the buy box).
- Cart (empty): `docs/spec/design/renders/shop-com-r2-20261022/cart-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/cart-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/cart-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png`. Centred heading, text and one filled primary pill, as in the shop.com cart 390 reference. The canvas now fills the short page (no white band); the active dock tab shows the lavender pill (R10).
- Cart with lines (R7): `docs/spec/design/renders/shop-com-r2-20261022/cart-filled-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/cart-filled-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/cart-filled-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png`. The line stays unboxed: 20px-radius slot, identity, frozen contents, a pill quantity input with "Perbarui jumlah" and a quiet "Hapus". The summary is a white raised 20px card with a full-width 52px "Lanjut ke checkout" pill. At 390 the summary stacks under the line; at 1440 it sits in the right column. The header cart badge and the active dock pill both show the count.
- Help: `docs/spec/design/renders/shop-com-r2-20261022/help-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/help-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/help-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png`. Centred 45rem column with white topic cards (2-up plus a full-width privacy card) as in the shop.com help 1440 reference. The chat card (now builder-styled; see round-3 preparation) is a white raised card with pill actions, sentence-case copy and a wrapping hours line. At 320/200% the hours text wraps without clipping, and the two-line pill actions stay inside the card.
- Sign-in `/masuk` (restyled by the builder in round 5): `docs/spec/design/renders/shop-com-r2-20261022/masuk-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/masuk-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/masuk-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/masuk-error-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/masuk-error-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/masuk-error-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png`. The page inherits the storefront canvas, header chips, dock (Akun active) and footer. The error state shows a generic "Email atau kata sandi tidak cocok" alert above the form, and both fields are marked invalid. The page uses the centred white raised 20px card (max 28rem) with neutral copy, 48px inputs with a 12px radius, and full-width 52px "Masuk"/"Batal" pills. In the error state the rounded alert holds focus (purple ring) and both fields carry the error edge, at 1440 and at 320/200%.
- Enlarged text (320px with a 32px browser default font size): `docs/spec/design/renders/shop-com-r2-20261022/home-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/search-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/pdp-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/cart-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/cart-filled-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/help-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/masuk-320-text200.png`, `docs/spec/design/renders/shop-com-r2-20261022/masuk-error-320-text200.png`.
  - Capture-method fix: Playwright's `fullPage` capture resets CDP font preferences mid-capture. The coordinator's round-5 320 files therefore rendered at 16px inside a layout measured at 32px, leaving a blank tail.
  - The builder re-captured only these 320 files (read-only loads plus the authorised cart-add and fake-address sign-in flows). This time the viewport was grown to the document height with the preference re-applied. `find src -newer` reports nothing newer, and overflowX is 0.
  - Results: text is genuinely doubled; headings, prices, pills and the sign-in alert wrap without clipping; the price basis drops as one phrase; the dock (labelled 2×2 at this size) sits after the footer in the full-length capture instead of covering content.
- Not found: `docs/spec/design/renders/shop-com-r2-20261022/notfound-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/notfound-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/notfound-1440.png`. Centred recovery state with a single primary action.

- Round-11 additions, captured from the clean catalog: the real bundle PDP `docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-1440.png` and `docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-320-text200.png` (collapsed "Deskripsi" and "Lihat N barang lainnya"), plus `docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-390.png` and `docs/spec/design/renders/shop-com-r2-20261022/pdp-bundle-open-1440.png` (both opened). Category pages: `docs/spec/design/renders/shop-com-r2-20261022/categories-390.png`, `docs/spec/design/renders/shop-com-r2-20261022/categories-768.png`, `docs/spec/design/renders/shop-com-r2-20261022/categories-1440.png`, `docs/spec/design/renders/shop-com-r2-20261022/categories-320-text200.png`.

Not inspected this round: cart with lines (needs a guest-cart DB write; the S22 renders remain the last evidence), multi-option PDP, checkout and receipt (unchanged S26/S27 compositions).

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
