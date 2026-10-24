# 99ribu storefront design system

The public storefront (home, `/kategori`, `/kategori/<slug>`, `/cari`, `/produk/<slug>`, `/keranjang`, `/bantuan`, `/masuk`, `/promo`, placeholders) as implemented. Checkout, receipt, account and admin reuse the shared tokens but keep their own accepted compositions (`docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md`).

Sources, in order of authority:

1. Owner decisions recorded in `docs/spec/design/references/shop-com/visual-context.md` (the observed visual contract: shop.com measurements, what 99ribu ships instead, every override, and the render evidence the design gate reviews). When this file and that one disagree, that one wins and this file is corrected.
2. `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md` and `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md` (canonical design and screen contracts).
3. The code: tokens in `src/app/globals.css` (the "Design tokens" block at the top), components in `src/components/storefront/`.

Direction: shop.com's layout, spacing, type rhythm, component patterns and interaction behaviour, transferred 1:1 where it fits; never its name, logo, copy, imagery or trademarks. 99ribu keeps its `99rb.` wordmark, Inter, purple `#5b35d5`, warm yellow `#f6c945`, Indonesian copy and a distinct phone composition (T-17).

## Owner overrides (current)

These are decisions, not findings. Details and dates are in visual-context.md.

- Product card price: 12/16 at weight **400** (regular), full ink (2026-10-24; shop.com uses 600).
- Product card title: one line with an ellipsis, 14/18 weight 600 (shop.com `line-clamp-1`).
- Content width capped at **1250px**, centred (shop.com is wider).
- Phone header has **no logo**; the omnibox takes the width, home is the dock's first tab.
- Header actions order: Promo, Cart, Account; Promo shows only when `/promo` has content.
- Desktop shelf arrows kept (shop.com's desktop carousel control).
- Current category pill: soft lavender fill `rgba(91,53,213,.08)`, no underline (round 35).
- Home banners: "Temukan pilihan" rail of 410x520 photo-led cards, caption and action pill below the photos (rounds 50-53).
- Wordmark reveal: "99rb." grows into "Serba 99ribu." on hover/focus from 1024px with a fine pointer.

## Tokens

All in `:root` at the top of `src/app/globals.css`. Use the token, not the literal.

| Token | Value | Use |
|---|---|---|
| `--ink` | `#18181b` | Text, filled active chips, focus edges |
| `--purple` | `#5b35d5` | Brand, primary buttons, links in prose, focus outline |
| `--purple-hover` | `#4823b6` | Primary hover, standalone link hover |
| `--yellow` | `#f6c945` | Wordmark dot, hero tint |
| `--muted` | `#5b5b63` | Secondary text (4.5:1 on white) |
| `--line` | `#d8d8df` | Dividers (checkout/account) |
| `--hairline` | `rgba(5,41,77,.1)` | shop.com's 1px/0.5px edge on white surfaces: chips, card frames, popovers, help cards, secondary pills |
| `--field-border` | `#85858e` | Form-field boundary and inactive dock icons (3:1+) |
| `--error`, `--error-surface` | `#8b241d`, `#fff4f2` | Error text/edge and its surface |
| `--warning`, `--warning-surface` | `#9c3f0a`, `#fff5ed` | Warning text and surface |
| `--tint-rose` … `--tint-slate` | `#fde8ec`, `#fdf0d5`, `#e2f3e5`, `#e2ecfb`, `#ede7fd`, `#ddf3ef`, `#ececef` | Department tints: pill circles, category tiles, banner cutouts. A department's tint is chosen from words in its name (`departmentTint` in `sections/category-pills.tsx`) |
| `--page-size/-leading` | 28/36 (24/32 ≤700px) | Global h1 |
| `--section-size/-leading` | 20 / 1.4 | Global h2 |
| `--card-size/-leading` | 18/26 | Global h3 (storefront cards override) |
| `--gutter` | 16px; 32 from 1024; 48 from 1440; 64 from 1920; 96 from 2560 | Page gutters (`.wrap`) |
| `--bottom` | 0; dock height + safe area ≤700px | Scroll padding above the phone dock |

Canvas: storefront shells paint `#fafafa` (`:root:has(body > .store-header)`); raised surfaces are white. Checkout and receipt stay white.

### Type

Inter 4.1 (SIL OFL), self-hosted; the storefront preloads a 44KB Latin subset. Storefront body is 16/22 at -0.5px (`body:has(> .store-header)`). Observed shop.com roles matched 1:1 (table in visual-context.md, "Typography contract"):

| Role | Size/leading, weight, tracking |
|---|---|
| Hero heading | 64/58 800 -1px (phones 36/38) |
| Section heading (`.shelf-heading`) | 20/22 600 -1px (phones 18/20 -0.5px) |
| Category pill label | 16/20 600 -0.5px |
| Card title | 14/18 600 -0.2px, one line |
| Card price | 12/16 **400** -0.2px, ink |
| Buttons | 16 600 -0.5px |
| PDP title / price | 24/28 600 -1px / 16/22 600 -0.5px |
| Field labels (PDP, filters) | 12/16 600 -0.2px |
| Filter chip label | 14/16 600 -0.2px |
| Omnibox caption | 12/16 500, 56% ink |
| Switcher label | 96/96 800 -1px (phones 42/42) |

### Shape, elevation, motion

- Radius: pills and buttons `9999px`; product frames and help cards 20px; PDP photo cards, filter popovers and sheets, and banners 28px; filter rows 16px; omnibox 32px; hero 36px; thumbnails 8px; fields 12px.
- Shadows: resting surface `0 2px 8px rgba(0,0,0,.06)` (cards, chips, secondary pills, desktop filter popover); shelf and gallery arrows `0 4px 24px rgba(0,0,0,.12)`; hero and phone filter sheet `0 8px 40px rgba(0,0,0,.24)`; omnibox open `0 12px 64px rgba(0,0,0,.24)`; PDP primary pill: inner highlights plus `0 4px 24px rgba(91,53,213,.24)`.
- Motion: CSS only, transform/opacity/colour. Controls 150ms `cubic-bezier(.4,0,.2,1)` on colour, background, border and shadow (no lifts). Omnibox and wordmark 240-320ms `cubic-bezier(.2,0,0,1)`. Photo hover scale 1.05-1.08 (150-300ms ease-out). Everything is off under `prefers-reduced-motion: reduce`.

### Layout

- Container `.wrap`: `min(1250px, 100% - 2 × gutter)`.
- Breakpoints in use: ≤700px phone composition (dock, no header actions, bleeding shelves) / ≥701px header grid; 1023/1024 (gutter, grid columns); 1050 (PDP columns); 1279/1280 (shelf 7 cards, category grid 5 columns); 1440 (gutter).
- Product grid: 6 columns from 1024px, 4 from 768, 3 from 701, 2 on phones; 16px gaps (8px on phones). Shelves: 7 cards from 1280, 4.6 from 701, 2.3 on phones bleeding to the screen edge.

## Components

`src/components/storefront/`:

| Path | Role |
|---|---|
| `ui/icon.tsx` | The icon set: `Icon` (outline, Lucide geometry, 2px stroke, `size` attribute) and `FilledIcon` (filled variants of home/category/cart/user for the active dock tab). Every storefront glyph comes from here; no inline SVG in pages. |
| `ui/brand.tsx` | `Wordmark` ("99rb." inside a `.brand` element) and `SiteNotice` (skip link + local-simulation notice), shared by the shell and the checkout frame. |
| `ui/media.tsx` | `CatalogImage` (a catalog `<img>` with srcset candidates from Next's image optimizer; plain server-rendered markup) and `optimizedUrl`. |
| `ui/product-card.tsx` | `ProductGrid` (cards as a grid or a shelf row), `Media` (photo or the photo slot), naming helpers. The card: square 20px frame with the hairline overlay, one-line title, price. |
| `ui/shelf-arrows.tsx` | Carousel arrows for any `.shelf-row`/`.banner-row` (hydration-only, disabled at the ends, one view per press). |
| `sections/` | Page sections: `home-hero`, `hero-video`, `category-grid`, `category-switcher` (tabs), `promo-banners`, `category-pills` (header pill row), `search-box` (omnibox combobox), `filter-chips` (chip rail + popover/sheet), `filter-panel` (no-JS form), `listing`, `listing-more` (infinite scroll), `catalog-listing` (server data for `/cari` and `/kategori/<slug>`), `product-gallery` (PDP photo row, thumbnails, arrows). |
| top level | Page chrome and flows: `shell`, `navigation` (product links, task Back), `checkout-*`, `cart-forms`, `order-receipt`, `offer-picker`, `sign-in-form`, `sign-out-button`, `buyer-account-client`, `placeholder-page`, `json-ld`. |

Buttons, chips and fields are CSS roles, not components: `.button` (primary purple pill), `.button.secondary` / `.button-secondary` (white hairline pill in storefront shells), `.filter-chip`, the field look (below). Add a component only when a second caller exists.

## Interaction rules

- Links: running prose keeps its underline (WCAG 1.4.1); standalone storefront links change colour on hover, no underline. Admin keeps hover underlines.
- Current page: `aria-current="page"` plus the lavender fill (header icons, pills, "Semua kategori"); dock tabs swap to the filled icon.
- Fields: 1px `--field-border`, 12px radius, 44px minimum; focus shows an ink edge plus a 3px soft ring at the same width (no shift); invalid adds the error edge. Selects carry one custom chevron.
- Filters (shop.com 2026-10-24): a scrolling chip rail (8px gaps, 4px on phones, bleeding to the screen edge on phones, edges fading only toward the side that still scrolls). Each chip opens a 300px popover centred 5px under it on desktop (whole pixels, 16px inside the viewport, above it near the bottom) or a bottom sheet with title and close on phones (40% scrim). Rows are 44px with a radio on the right (a check box for multi-choice facets); choosing a row applies at once (a GET link, owner decision); "Atur ulang" clears the filter, "Selesai" closes. Focus starts on the selected row, arrows/Home/End/typeahead move, Escape and light dismiss close and focus returns to the chip. Without JS, the native GET form in `<noscript>` replaces the rail.
- Product page (shop.com 2026-10-24): media column (48px thumbnail strip from 1051px, a scroll-snap row of square 28px photo cards with hover arrows from 701px, sticky from 701px; phones: the row bleeds with the next photo peeking) beside a buy box in shop.com's order: category line, title, price, field labels, option pills, contents, stock, quantity pill (native number field between minus/plus), 52px primary pill, Spesifikasi, 52px accordions.
- Omnibox: one glass surface grows down over the page on focus (no layout shift); combobox with listbox options; Escape/blur/outside click close; works as a plain GET form without JS.
- Carousels: native scroll and snap, hidden scrollbars, arrows only on hover-capable desktop, no autoplay (WCAG 2.2.2).
- Listings: the first page is server HTML with a crawlable `rel="next"`; the next pages append automatically three times, then "Lihat produk lainnya" keeps the footer reachable.

## Accessibility

- Targets at least 44px (chips, pills, dock tabs, omnibox chips, arrows).
- Contrast: body and labels ≥4.5:1; large text and icons ≥3:1 (inactive switcher labels `#858585`, inactive dock icons `--field-border`).
- Focus is always visible: a 3px purple outline globally, 2px ink rings on pills and tiles, an inset ink ring on dropdown items.
- Names: icon-only links carry `aria-label` (e.g. "Keranjang, N pilihan"); decorative images are `alt=""` and `aria-hidden`; tests depend on these names, so keep them.
- Patterns: WAI-ARIA combobox (omnibox), tabs with roving tabindex (switcher), popover dialogs (filters), carousels with `aria-roledescription`.
- Everything works at 320px with 200% text: chips wrap inside their pill, grids drop to one column, the dock becomes static at short heights.
- Reduced motion disables every animation and transition listed above.

## Changing the design

1. Record the owner decision or the shop.com observation in visual-context.md first, then change tokens/components, then this file.
2. Keep one rule per selector and context in `globals.css`; put a new value in a token when a literal repeats.
3. Prove a refactor has no visual change by diffing computed styles (every element and its `::before`/`::after`/`::marker`/`::placeholder`, custom properties excluded) and screenshots of the storefront page set at 390/768/1100/1440 before and after, as S111 did, and prove a visual change with fresh renders and the design gate (`design-gate.py . --design docs/spec/design/references/shop-com/visual-context.md --src src`).
