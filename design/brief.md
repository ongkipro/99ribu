# UI brief — Dashboards (wave 4), 2026-11-02

Scope (owner 2026-11-02): all three dashboards on one system. (1) The staff console under `/admin/**` (dashboard, product catalog and listing, tables, editing, sign-in budgets). (2) The buyer account under `/akun/**`. (3) The affiliate dashboard at `/afiliasi`. The public storefront keeps the `DESIGN.md` "Storefront" sections; this brief extends that file with a dashboard system, it does not replace it.

## Niche
Serba 99ribu: an Indonesian online store selling complete bundle offers, each offer priced at most Rp99.000 (DEC-025), supplied from partner warehouses, paid by COD, manual transfer or AutoLaris VA/QRIS, shipped through Mengantar. The console runs the daily operation of that store in Indonesian (WIB).

## Audience
Buyers (often on a phone, often guests who may later open an account) and affiliates (content creators and resellers, mostly on a phone) use the account and affiliate dashboards; they must trust that an order status or a commission amount is honest, reversible amounts are labelled, and their data is minimal and theirs. Five staff roles: Super Admin (`owner`, monitors and approves), Admin E-Commerce (catalog, promos), Gudang (stock, labels, shipping), Layanan Pelanggan (chat, orders, returns), Keuangan (reconciliation, refunds, payouts). They work on a laptop in the office and on a phone on the warehouse floor. Before acting they must trust that: a count equals the rows behind it, money is never shown as Rp0 when inputs are missing, every change is reversible or audited, and they only see what their role is allowed to see.

## Primary job
Show what needs action now and let staff finish it in few steps: process orders and shipments, keep the catalog correct (add a listing, edit offers, stock, HPP), and reconcile money. Reading comes first, writing is deliberate (reason, version check, confirmation for irreversible actions).

## Primary action
One purple action per view: on the owner home, open the queue that needs attention; on list pages, the main add or save action ("Tambah produk", "Simpan perubahan"); on detail pages, the next step of that record. Secondary actions are neutral outline buttons.

## References wanted
- **shop.com storefront** (market-leader look the owner chose): already measured in `docs/spec/design/references/shop-com/visual-context.md`. Transfer neutral surfaces, hairline separators, charcoal text, one purple action, pill filters and 44 px targets to admin. shop.com has **no public seller or admin console**, so no admin teardown exists; the transfer is of its visual language, not of its screens.
- **Seller-admin pattern accepted 2026-10-29 (tokophi, plan D1)**: shell, per-role nav, page header, tab strip, list → detail → create, KPI tile (`docs/history/ADMIN-REDESIGN-PLAN-20261029.md` §2, §4).
- **AdsBookCMS admin** (patterns only, never code): dashboard period comparison with delta chips, URL-held filters, promise-based confirm dialog (`~/Documents/work/research/99ribu-vs-adsbookcms-comparison-2026-11-02.md`).
- **Indonesian market research (2026-11-02)**: how Shopee, Tokopedia and TikTok Shop, Lazada, Blibli order dashboards and affiliate programmes (and the networks Involve Asia and AccessTrade) work; secondary sources only, numbers unverified, conventions used (see `DESIGN.md` "References").
- **ui-skills.com**: four pages read as low-weight reference (its `robots.txt` says `use=reference`); nothing copied.
- **shadcn/ui and Tailwind v4** for the staff console, through the CLI (`DESIGN.md` "Console component stack").
- Mood references: none chosen by the owner yet. No gallery was scraped.

## Non-goals
Not a copy of shop.com chrome or any seller dashboard pixel for pixel. No marketing hero, photo feed or decorative chart in admin. No emoji or emoticon icons (functional SVG only). No dark mode for now (spec 10 is light-only; plan decision D6 open). No invented KPIs, fake data or placeholder numbers. No new colour beyond the existing purple, yellow and neutral tokens. No replacement of the accepted per-role navigation.
