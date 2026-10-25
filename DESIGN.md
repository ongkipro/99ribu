# 99ribu storefront design system

The public storefront (home, `/kategori`, `/kategori/<slug>`, `/cari`, `/produk/<slug>`, `/keranjang`, `/bantuan`, `/masuk`, `/promo`, placeholders) as implemented. Checkout, receipt, account and admin reuse the shared tokens but keep their own accepted compositions (`docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md`).

Sources, in order of authority:

1. Owner decisions recorded in `docs/spec/design/references/shop-com/visual-context.md` (the observed visual contract: shop.com measurements, what 99ribu ships instead, every override, and the render evidence the design gate reviews). When this file and that one disagree, that one wins and this file is corrected.
2. `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md` and `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md` (canonical design and screen contracts).
3. The code: tokens in `src/app/globals.css` (the "Design tokens" block at the top), components in `src/components/storefront/`.

Direction: shop.com's layout, spacing, type rhythm, component patterns and interaction behaviour, transferred 1:1 where it fits; never its name, logo, copy, imagery or trademarks. 99ribu keeps its `99rb.` wordmark, Inter, purple `#5b35d5`, warm yellow `#f6c945`, Indonesian copy and a distinct phone composition (T-17).

## Owner overrides (current)

These are decisions, not findings. Details and dates are in visual-context.md.

- Product card price: 12/16 at weight **600**, full ink, as shop.com (owner request 2026-10-25, S143; replaces the 2026-10-24 regular-weight call).
- Product card title: one line with an ellipsis, 14/18 weight 600 (shop.com `line-clamp-1`).
- Content width capped at **1250px**, centred (shop.com is wider).
- Phone header has **no logo**; the omnibox takes the width, home is the dock's first tab.
- Header actions order: Promo, Cart, Account; Promo shows only when `/promo` has content.
- Desktop shelf arrows kept (shop.com's desktop carousel control).
- Current category pill: soft lavender fill `rgba(91,53,213,.08)`, no underline (round 35).
- Home banners: "Temukan pilihan" rail of 410x520 photo-led cards, caption and action pill below the photos (rounds 50-53).
- Wordmark reveal: "99rb." grows into "Serba 99ribu." on hover/focus from 1024px with a fine pointer.

## Storefront typography, color and spacing (shop.com-aligned, 2026-10-25)

Measured live on shop.app on 2026-10-25 (Chromium, 1440px) and applied in S143 to every public page: home, `/kategori`, `/cari`, the PDP, `/keranjang`, checkout, receipts, `/masuk`, `/akun`, help/static pages, header, footer and dock. Admin keeps its own Tailwind tokens. All tokens live in `:root` at the top of `src/app/globals.css`; use the token, not the literal.

**Font.** shop.com sets GT Standard Web (Grilli Type, variable 300–900, a commercial licence), so it is not copied or hotlinked. 99ribu keeps the self-hosted Inter 4.1 variable (SIL OFL, `public/fonts/inter-4.1/`, 44KB Latin subset preloaded) and matches shop.com's sizes, line heights, weights and tracking; no font dependency is added.

### Color

| Token | Value | Use | Contrast (canvas / white) |
|---|---|---|---|
| `--ink` | `#000` | Text, filled active chips, focus edges, last breadcrumb | 20.5 / 21:1 |
| `--muted` | `oklch(0.552 0.026 290.5)` | Secondary UI text, inactive labels, help lead | 4.72 / 4.84:1 |
| `--caption` | `rgba(0,0,0,.56)` | Captions 12/16 500: breadcrumb, omnibox caption, text on light tints (readonly field, receipt step tags, affiliate figures) | 4.90 / 4.93:1 |
| `--canvas` | `#fcfcfc` (oklch .988 0 0) | Storefront page background (`:root:has(body > .store-header)`) | — |
| `--surface` | `#fff` | Cards, popovers, sheets, footer, checkout and receipt frames | — |
| `--purple` / `--purple-hover` | `#5b35d5` / `#4823b6` | Brand: primary pills, prose links, focus outline, accents (7.0:1 on canvas) | — |
| `--yellow` | `#f6c945` | Wordmark dot, hero tint | — |
| `--line` | `#d8d8df` | Dividers (checkout, receipt, account) | — |
| `--hairline` | `rgba(5,41,77,.1)` | shop.com's 1px/0.5px edge on white: chips, card frames, popovers, help cards, secondary pills | — |
| `--field-border` | `#85858e` | Form-field boundary, inactive dock icons (3:1+) | — |
| `--error`, `--error-surface` / `--warning`, `--warning-surface` | `#8b241d`, `#fff4f2` / `#9c3f0a`, `#fff5ed` | Error and warning text, edges and surfaces | — |
| `--tint-rose` … `--tint-slate` | `#fde8ec`, `#fdf0d5`, `#e2f3e5`, `#e2ecfb`, `#ede7fd`, `#ddf3ef`, `#ececef` | Department tints (pill circles, category tiles, banner cutouts), chosen by `departmentTint` in `sections/category-pills.tsx` | — |

`--muted` drops below 4.5:1 on tinted fills darker than `#f7f6fa` (4.38:1 on `#f4f3f8`), so text on those fills uses `--caption` or `--ink`. Disabled controls keep their own greys.

### Type scale

Body on storefront, checkout and receipt shells is 16/22 at -0.5px (`body:has(> .store-header, > .checkout-header, > .receipt-shell)`); text without its own role inherits the 22/16 ratio. Tracking follows size: -1px from 20px, -0.5px at 16–18px, -0.2px at 12–14px (`--tracking-tight/-body/-small`).

| Role | Token | Size/leading, weight, tracking |
|---|---|---|
| Home hero heading | `--hero-size/-leading` | 64/58 800 -1px (phones 36/38) |
| Page heading (global `h1`: category, search, cart, help, checkout, receipt, account) | `--page-size/-leading` | 36/38 800 -1px (phones 28/30) |
| Category/search section heading (`.listing-main h2`, `.categories-main h2`) | `--heading-size/-leading` | 24/26 600 -1px (phones 18/20) |
| PDP title | `--heading-size` | 24/28 600 -1px |
| Section heading (global `h2`, `.shelf-heading`, PDP sections and accordions) | `--title-size/-leading` | 20/22 600 -1px (phones 18/20 -0.5px) |
| Phone title, sheet title, card headline | `--subtitle-size/-leading` | 18/20 600 -0.5px |
| Body, inputs, PDP price, card headings (global `h3`) | `--body-size/-leading` | 16/22 400 (headings and price 600) -0.5px |
| Buttons, category pill label | `--body-size` | 16/20 600 -0.5px |
| Card title, chips, secondary text | `--small-size/-leading` | 14/18 600 (text 400) -0.2px; 14/20 in running text |
| Card price (captionBold) | `--caption-size/-leading` | 12/16 **600** -0.2px, ink |
| Field labels, captions, breadcrumb | `--caption-size/-leading` | 12/16 600 (labels) or 500 (captions, `--caption`) -0.2px |
| Switcher label | literal | 96/96 800 -1px (phones 42/42) |

Weights in use: 400, 500, 600, 800 (the wordmark keeps its own 850–900).

### Spacing and radii

- Spacing is a 4px scale: 2, 4, 6, 8, 12, 16, 20, 24, 28, 32, then 40/48/56/64 for section rhythm. Groups: 8px inside a group, 16px between related groups, 24px between buy-box groups, 48px between home sections (40 on phones), 64px before the footer (40 on phones). Off-scale values left on purpose: shop.com's 10px banner-rail gap, omnibox field geometry, badge insets, and the receipt's ≤22rem first-screen compression (S27).
- Card grids: 16px gaps (8px on phones); the PDP related grid uses shop.com's 32px desktop gap.
- Radii: 8px thumbnails and small boxes (checkout choices, receipt code box, status panels); 12px fields; 20px cards and photos (product frames, PDP photos, help cards, cart and checkout summaries, receipt and account cards); 28px hero cards, banners, popovers and sheets; 32px omnibox; 36px home hero; 9999px pills and buttons.

### Breadcrumb

PDP (and any page that needs one): `<nav class="breadcrumb" aria-label="Lokasi halaman">` with an `<ol>` of real links, "Beranda" (`/`) then the category (`/kategori/<slug>`), 12/16 500 in `--caption`, the last crumb in ink, a 14px chevron (`Icon name="forward"`, aria-hidden) kept with the crumb after it; each link keeps a 44px target while the row takes one 16px line. The product title (`h1`) sits 8px below. The visible trail matches the `BreadcrumbList` JSON-LD (Beranda → category → product). Mobile and desktop are the same; on phones the category rail is hidden on the PDP (DEC-019), so the breadcrumb carries the category.

### Shape, elevation, motion

- Radius: the scale under "Spacing and radii" above; filter rows 16px.
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
| top level | Page chrome and flows: `shell`, `navigation` (product links, task Back), `checkout-*`, `cart-forms`, `order-receipt`, `offer-picker`, `sign-in-panel` (server: session state and role redirect), `sign-in-form` (client form, also posts without JS), `sign-in-modal` (the `<dialog>` for the intercepted `/masuk`), `sign-up-form` (S123: `AuthForms` holds the Masuk/Daftar mode, the sign-up form, the check-email state and `ResendForm`), `sign-in-copy` (failure copy and `/masuk` URLs for both sides), `order-account` (S123 receipt cards: save to account, link order), `sign-out-button`, `buyer-account-client`, `placeholder-page`, `json-ld`. |

Buttons, chips and fields are CSS roles, not components: `.button` (primary purple pill), `.button.secondary` / `.button-secondary` (white hairline pill in storefront shells), `.filter-chip`, the field look (below). Add a component only when a second caller exists.

## Interaction rules

- Links: running prose keeps its underline (WCAG 1.4.1); standalone storefront links change colour on hover, no underline. Admin keeps hover underlines.
- Current page: `aria-current="page"` plus the lavender fill (header icons, pills, "Semua kategori"); dock tabs swap to the filled icon.
- Fields: 1px `--field-border`, 12px radius, 44px minimum; focus shows an ink edge plus a 3px soft ring at the same width (no shift); invalid adds the error edge. Selects carry one custom chevron.
- Filters (shop.com 2026-10-24): a scrolling chip rail (8px gaps, 4px on phones, bleeding to the screen edge on phones, edges fading only toward the side that still scrolls). Each chip opens a 300px popover centred 5px under it on desktop (whole pixels, 16px inside the viewport, above it near the bottom) or a bottom sheet with title and close on phones (40% scrim). Rows are 44px with a radio on the right (a check box for multi-choice facets); choosing a row applies at once (a GET link, owner decision); "Atur ulang" clears the filter, "Selesai" closes. Focus starts on the selected row, arrows/Home/End/typeahead move, Escape and light dismiss close and focus returns to the chip. Without JS, the native GET form in `<noscript>` replaces the rail.
- Product page (shop.com 2026-10-24, S139 2026-10-25): media column (48px server-rendered thumbnail links from 1051px, a scroll-snap row of square 20px photo cards with hover arrows from 701px, sticky from 701px; phones: the row bleeds with the next photo peeking and a "N / M" counter) beside a buy box in shop.com's order, groups 24px apart: breadcrumb ("Beranda › <kategori>"), title, price; "Pilihan lengkap <value>" with option pills that are links (switch at once); contents, stock, quantity pill (native number field between minus/plus), 52px primary pill; Spesifikasi; 52px accordions (20/22 600 -1px): open Deskripsi (with "Isi yang diterima" closed under it) (clamped, "Baca selengkapnya") and "Pengiriman dan pembayaran" icon rows, closed Pengembalian; then the "Lainnya di <kategori>" shelf. Phones add a buy bar above the dock while the main button is out of view. PDP-only rules live in `src/app/(storefront)/produk/[slug]/product.css` on top of the globals block.
- Omnibox: one glass surface grows down over the page on focus (no layout shift); combobox with listbox options; Escape/blur/outside click close; works as a plain GET form without JS.
- Carousels: native scroll and snap, hidden scrollbars, arrows only on hover-capable desktop, no autoplay (WCAG 2.2.2).
- Sign-in (shop.com 2026-10-24, S112): one centred 344px column (wordmark, 32/35 800 heading, 16/22 muted lead, labelled 52px pill fields with the 4% ink fill, the 52px primary pill, a 12/16 footnote). Errors sit under the fields (14/20, error edge on the field) and take focus. `/masuk` is the page; storefront links open the same content as a modal (`@modal/(.)masuk`): a native `<dialog>` centred from 701px, a bottom sheet on phones, focus kept inside, Escape/close/scrim go back and focus returns to the opener. Without JS the form posts to `/masuk/kirim` and comes back with the step or error in the URL.
- Sign-up (owner decisions 2026-10-25, S123): the same column and modal with a "Masuk / Daftar" pill switch (real links `/masuk` and `/masuk?langkah=daftar`, `aria-current`; with JS the form swaps in place). Nama, Email, Nomor WhatsApp, consent footnote; no password: a new and a registered email both land on "Cek email Anda untuk verifikasi" (60 s resend cooldown) and the emailed link opens `/masuk/atur-sandi` ("Buat kata sandi", 44px show/hide toggle, live hint), which activates the account and signs in back to `next`. Errors name their cause. Receipts show "Simpan pesanan ini ke akun" to the guest holding the order (email, name and phone pre-filled) and "Hubungkan pesanan ini ke akun" to a signed-in buyer who does not own it. Without JS the forms post to `/masuk/kirim` (`step=signup|resend|reset`).
- Contact inputs (owner 2026-10-25, every storefront form with a phone or email): phones keep digits only, a pasted `+62…`/`62…` shows as `08…` (`inputmode="numeric"`, `autocomplete="tel"`, a `pattern` for no-JS) and are stored `+62…`; a WhatsApp number must be a mobile number (08); emails are trimmed with a lowercased domain on blur, and a common-domain typo gets a one-tap "Maksud Anda …?" fix under the field (never a block). Rules: `src/modules/storefront/contact.ts`; inputs: `ui/contact-fields.tsx`.
- Listings: the first page is server HTML with a crawlable `rel="next"`; the next pages append automatically three times, then "Lihat produk lainnya" keeps the footer reachable.

## Accessibility

- Targets at least 44px (chips, pills, dock tabs, omnibox chips, arrows).
- Contrast: body and labels ≥4.5:1; large text and icons ≥3:1 (inactive switcher labels `#858585`, inactive dock icons `--field-border`).
- Focus is always visible: a 3px purple outline globally, 2px ink rings on pills and tiles, an inset ink ring on dropdown items.
- Names: icon-only links carry `aria-label` (e.g. "Keranjang, N pilihan"); decorative images are `alt=""` and `aria-hidden`; tests depend on these names, so keep them.
- Patterns: WAI-ARIA combobox (omnibox), tabs with roving tabindex (switcher), popover dialogs (filters), a modal dialog (sign-in), carousels with `aria-roledescription`.
- Forms: visible labels, `autocomplete` hints (`name`, `username`, `current-password`, `new-password`, `one-time-code`), `aria-invalid` plus `aria-describedby` on the field an error names.
- Everything works at 320px with 200% text: chips wrap inside their pill, grids drop to one column, the dock becomes static at short heights.
- Reduced motion disables every animation and transition listed above.

## Changing the design

1. Record the owner decision or the shop.com observation in visual-context.md first, then change tokens/components, then this file.
2. Keep one rule per selector and context in `globals.css`; put a new value in a token when a literal repeats.
3. Prove a refactor has no visual change by diffing computed styles (every element and its `::before`/`::after`/`::marker`/`::placeholder`, custom properties excluded) and screenshots of the storefront page set at 390/768/1100/1440 before and after, as S111 did, and prove a visual change with fresh renders and the design gate (`design-gate.py . --design docs/spec/design/references/shop-com/visual-context.md --src src`).
