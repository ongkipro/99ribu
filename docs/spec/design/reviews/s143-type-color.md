# S143 storefront typography, colour and spacing: review context

Owner request (2026-10-25): make the public storefront simpler and cleaner, matching shop.com's typography, weights, colours, padding and margins; fix the PDP breadcrumb. The accepted design is DESIGN.md "Storefront typography, color and spacing (shop.com-aligned, 2026-10-25)" and visual-context.md "Typography, colour and spacing (measured 2026-10-25, owner request S143)". This file is the context the independent reviewer sees; it records no new decisions.

## Audience and job

Indonesian shoppers on phones first: find a product at the fixed Rp99.000 price, open it, add it to the cart and check out. The change is a refinement inside the accepted shop.com-derived composition (layout, components and copy unchanged): type scale, colour tokens, spacing and the PDP breadcrumb.

## Accepted decisions (reviewers judge type, colour, spacing and the breadcrumb only)

- Font: Inter 4.1 variable (self-hosted) stands in for shop.com's licensed GT Standard; sizes, weights, leading and tracking follow shop.com.
- Colour: ink `#000`; page canvas `#fcfcfc` on storefront pages; white surfaces; muted `oklch(0.552 0.026 290.5)`; captions `rgba(0,0,0,.56)`; the brand purple `#5b35d5` stays for primary actions and accents; "Beli sekarang" is the charcoal pill (DEC-020). Checkout and receipt stay on white.
- Type: page headings 36/38 800 -1px (28/30 on phones); category section headings 24/26; section headings and PDP accordions 20/22 600 -1px (18/20 on phones); PDP title 24/28 600; body 16/22 -0.5px; buttons 16/20 600; card title 14/18 600 (one line); card price 12/16 **600**; captions and the breadcrumb 12/16 500.
- Spacing on a 4px scale; card grids 16px apart (8px on phones), the 5-column PDP related grid 32px columns on desktop (S139); radii 8/12/20/28/9999; footer links 14/18 400 on a 30px pitch.
- PDP breadcrumb "Beranda › <Kategori>" above the title (shop.com puts its merchant row there).
- The home composition, the hero card, the category switcher, banners, filters, cart and checkout layouts are accepted from earlier rounds and are not under review here.
- Phone full-page captures show the fixed bottom dock where the viewport ended when the capture started; it is the real dock, not a layout bug.

## Reference evidence

Accepted project captures of shop.com (structural and typographic reference only; brand, imagery and copy are not transferred):

- `docs/spec/design/references/shop-com/2026-10-23-home-1440-full.png` and `docs/spec/design/references/shop-com/2026-10-23-home-390-full.png`: near-white canvas, black text, bold display hero, 20px section headings with a chevron, product rows with 14/18 titles over 12/16 bold prices. Transferred: canvas, ink, heading and card type, price weight.
- `docs/spec/design/references/shop-com/2026-10-24-search/1440.png` and `docs/spec/design/references/shop-com/2026-10-24-search/390.png`: chip rail above a six-column (two on phones) grid with generous gaps. Transferred: grid rhythm, chip type.
- `docs/spec/design/references/shop-com/2026-10-24-pdp/1440.png` and `docs/spec/design/references/shop-com/2026-10-24-pdp/390.png`: thumbnails beside one photo card, buy box with a small caption row above the 24/28 title, price, 52px actions, accordions between hairlines. Transferred: the small caption row slot (our breadcrumb), title/price type, accordion heading weight.
- `docs/spec/design/references/shop-com/2026-10-22-cart/1440.png`: plain heading over a centred column (its empty-state heading is 20/22 600). Transferred: the centred column only; the 36/38 800 page-heading weight comes from the measured category H1.

Measured on 2026-10-25 (computed styles, 1440px): body 16/22 400 -0.5px #000; canvas #fcfcfc; category H1 36/38 800 -1px; section H2 24/26 600 -1px; PDP H2 20/22 600 -1px; hero 64/58 800; PDP title 24/28 600; price 16/22 600; buttons 16/20 600; card title 14/18 600 -0.2px; card price 12/16 600; captions rgba(0,0,0,.56) 12/16 500; muted UI oklch(0.552 0.026 290.5); 4px spacing; radii 8/20/28/9999. Re-checked by the builder the same day on shop.app home (Playwright, computed styles): product rows `column-gap` 16px at 1440 and 8px at 390; footer link text a 14/18 400 -0.2px paragraph inside a 16/22 anchor, links 30px apart (tops 2451, 2481, 2511, 2541 at 1440; 2340, 2370, 2400, 2430 at 390), headings 14/18 500.

## Render critique

Author: Claude Code (claude-opus-5-5), the builder; not an independent review.

Renders from the S143 production build on 127.0.0.1:3099 (seeded local catalog), Chromium, 390 touch and 1440; 768 renders sit beside them in the same folder. Scripted checks (`docs/spec/design/renders/s143/checks.json`): no horizontal overflow and no console errors on any page at 390, 768 or 1440.

- Home: `docs/spec/design/renders/s143/home-390.png`, `docs/spec/design/renders/s143/home-1440.png`. The hero heading is 64/58 800 (36/38 on phones); section headings "Kategori ›", "Terbaru ›" are 20/22 600; card prices now read as 12/16 600 in black, matching shop.com's captionBold rows; the canvas is the lighter #fcfcfc so white cards keep their edge through the hairline and shadow.
- Category: `docs/spec/design/renders/s143/kategori-detail-390.png`, `docs/spec/design/renders/s143/kategori-detail-1440.png`. "Kecantikan" is 36/38 800 at 1440 (28/30 on phones) above the chip rail; the six-column grid has 16px gaps at 1440, eight on phones; infinite scroll appended pages, so the phone capture is long.
- PDP: `docs/spec/design/renders/s143/pdp-390.png`, `docs/spec/design/renders/s143/pdp-1440.png`. "Beranda › Kecantikan" in 12/16 caption ink with the last crumb in black sits directly above the 24/28 title; price 16/22 600; accordions 20/22 600 between hairlines; the related grid "Lainnya di Kecantikan ›" uses the 20/22 heading.
- Cart: `docs/spec/design/renders/s143/keranjang-390.png`, `docs/spec/design/renders/s143/keranjang-1440.png`. "Keranjang" 36/38 800; the line title is 16/22 600; the summary card is 20px radius on white with the 20/22 heading; quantity and update controls share one 48px height.
- Checkout: `docs/spec/design/renders/s143/checkout-390.png`, `docs/spec/design/renders/s143/checkout-1440.png`. "Checkout" 36/38 800 on the white frame; field labels and body at 16/22 -0.5px instead of the old 1.6 leading, so the form is denser and closer to shop.com's rhythm; the summary card is 20px radius.

Known limits: the phone dock overlays full-page captures where the first viewport ended; checkout before an address is entered is the only state rendered.

### Round 1 response (REVISE, `design/reviews/s143/review-r1.md`)

- Grid rows about 70px apart at 1440: confirmed in Chromium. Each card spans four subgrid rows, so the 32px row gap was paid three more times inside every card (card 262px for a 166px photo and 44px of text). Rows are now 16px (`gap: 16px 32px` on the listing, search and PDP related grids), which leaves about 20px between a price and the next photo, close to the ~17px in the 2026-10-24 search capture; columns keep the 32px measured live on 2026-10-25.
- Checkout summary "└" beside the total at 1440: the summary chevron was captured mid-rotation (the disclosure opens on hydration with a 200ms transform transition). The renders now use reduced motion, as the browser tests do; the open summary shows the settled chevron.
- Description ending "lengkap....": the catalog sentence ends with its own period and the 8-line clamp adds the browser ellipsis after it (an S139 behaviour noted then); copy and the clamp are outside this type/colour pass.
- Footer headings 14/18 500 under 16/22 links: kept in round 1 on the old contract row; corrected in round 2 (below).

### Round 2 response (REVISE, `design/reviews/s143/review-r2.md`)

- Column gaps: re-measured on shop.app the same day (see "Reference evidence"): home product rows are 16px apart at 1440 (8px at 390), matching the search capture. Listing and search grids are back to 16px (8px on phones), the same as the home rows. The 5-column PDP related grid keeps its 32px desktop column gap from S139; its tablet and phone gaps now use the listing values (16px, 8px).
- Footer: re-measured; shop.com's link text is a 14/18 400 -0.2px paragraph inside a 16/22 anchor, 30px apart. Footer links are now 14/18 400 -0.2px on that 30px pitch; phones keep 44px targets (house rule in DESIGN.md "Accessibility"), so the phone footer stays taller than shop.com's.
- Phone band under the footer: the dock clearance below the footer now paints white, so the footer band runs to the end of the page.
- Cart reference: the page-heading weight is cited from the measured category H1, not the empty-cart capture.
- Not changed (optional findings outside this pass): the checkout payment fieldset look and the checkout summary title weight belong to the accepted S26 checkout composition.
