# 99ribu Admin Console — review and redesign plan (pre-development)

Date: 2026-10-29 · Author: Claude Code session (Opus 5.5) for the owner · Status: **PROPOSAL, report only — no code, spec or status file changed**

Owner direction (2026-10-29): admin **content like Shopify admin**, **UI/UX modern, Apple-like visual**. Write this document before any development so other terminals/agents are not disturbed.

## 0. Where this document lives and how it lands

- Lives outside the repository on purpose (`~/Documents/work/notes/`), so it cannot collide with concurrent edits to `STATUS.md`, `TASKS.md`, `BUILD-LOG.md` or spec 17.
- It is **not** a rival spec. Once the owner accepts it, the coordinator moves the accepted parts into the canonical owners: slices → root `TASKS.md`; IA/screen contracts → `docs/spec/17-UX-FLOWS-SCREEN-CONTRACTS.md` ("Admin console — IA" section); visual tokens → `docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md`; decisions → `DECISIONS.md`; active slice row → `STATUS.md` "Active workstreams". Then this file is archived.
- Evidence read: `main` at `5aec286` + working tree; `src/components/admin/admin-shell.tsx`; `src/modules/reporting/shared.ts`; spec 17 lines 668–742 and 889–1094; `02-PRD.md:449`; design reviews `20261028-admin-design-review.md`, `20261028-design-rereview.md`; `docs/history/STATUS-20261028-handoffs.md`; Shopify Help Center pages "Shopify admin overview", "Shopify reports" (analytics) and "Create orders" (draft orders), all fetched 2026-10-29.

## 1. Collision guard (read before any slice starts)

Observed 2026-10-29:

| Fact | Consequence |
|---|---|
| 206 dirty/untracked paths on `main` since `5aec286` | Nothing new starts on top of an uncommitted base |
| Practically every file under `src/app/admin/(console)/**` and `src/components/admin/**` is modified | Any admin slice overlaps another session's uncommitted work |
| `src/modules/reporting/{dashboard,exports,operations,queue,shared,sources,tokens}.ts` are **untracked** (module split, not committed) | Dashboard work would edit files that do not yet exist in Git |
| `src/components/ui/{badge,dialog,sheet,sidebar}.tsx` and `admin.css` modified | Visual/token work collides with the same files |
| Worktrees `99ribu-parallel` (385a53d, 10 days) and `99ribu-prebuilt` (e1d8ea3, 9 days): 0 admin paths dirty | No admin collision there; both stale, owner decision (d) in STATUS |
| STATUS: `Local-Acceptance: REVALIDATION_REQUIRED`; `npm run check` fails on UI/CSS lint; design re-review 0b open | Base is not green |

Rules for this programme:

1. **Gate 0:** owner decides the commit of the current working tree (STATUS open decision (a)). No admin slice starts before `git status` on `main` is clean or the overlap is explicitly authorized.
2. One slice = one worktree branch `s1NN-<slug>` from the committed `main`, with its row in STATUS "Active workstreams" *before* work starts, and `delivery-ledger start` with exact globs for R3/R4.
3. Shared files (`admin-shell.tsx` nav, `admin.css`, `components/ui/*`, `openapi.yaml`, `scripts/check-tests.ts`, STATUS/TASKS/BUILD-LOG) are edited by the coordinator at merge only; workers report the change.
4. Visual-token slice (§6, V1) runs **alone**: it touches `admin.css` and `components/ui/*` that every screen imports. Other admin slices wait or rebase after it merges.
5. Claude worktree paths are too long for the Postgres socket: DB/browser checks run from a short detached worktree under `/tmp/claude-1000/`. Integration and browser suites never run at the same time.

## 2. Current admin inventory (on disk, 2026-10-29)

44 routes. Sidebar groups (`admin-shell.tsx`): Ruang Kerja · Operasional (Pesanan, Pengiriman Manual, Pusat Cetak Label, Masalah Pengiriman, Retur & Penggantian, Kotak Masuk Pelanggan, Akun Pembeli) · Katalog & Stok (Produk, SKU Fisik, Kategori, Stok Gudang, Transfer Stok, Daftar Gudang) · Pemasaran (Promo Ongkir, Banner Beranda, Segmen Pembeli, Afiliasi) · Keuangan (Pembayaran Masuk, Setoran COD, Rekonsiliasi, Pembayaran Komisi, Pengembalian Dana, Laporan Keuangan) · Pengaturan (Log Audit, Kesehatan Sistem, Staf & Peran, Pembayaran & Biaya COD, Kebijakan Komersial, Template Label, Integrasi Iklan, Balasan & Tag CS) · account menu (Profil, Keamanan akun, Keluar).

Gaps against spec 17:

| Item | State | Gap |
|---|---|---|
| B8 new product draft (`createProductDraft`) | API only | No "Tambah produk"; catalog enters only through the Berlapak importer |
| B11 warehouse calendar | UI built | Production blocked: validator accepts `TEST-ONLY` only (S140) |
| B28 guest-order claims (S125) | not started | waits on S120 |
| B30 API-booking fulfillment | not built | correctly gated by Mengantar API (S94–S96) |
| Spec 17 inventory status column | stale ("missing 27") | never flipped (dev-log step 5) |
| Global search / command palette | none (no `cmdk`/CommandDialog in admin) | see §3 |

## 3. Content parity with Shopify admin

Shopify admin (Help Center, fetched 2026-10-29): sidebar = core areas (Orders, Products, Customers, Analytics & reports, Marketing, Discounts) + Sales channels/apps (Online Store) + Settings. **Home** shows real-time metrics (sales, traffic), task reminders, and urgent actions that open the related page. Facts verified 2026-10-29: the sidebar sections and Home contents above; analytics = a dashboard of metric cards (each links to a report), **Reports** (visualization + detail table, customizable) and **Live View**; **draft orders** let staff create orders for phone/email/in-person sales, apply a custom price, and get paid by invoice link or by marking paid, and a paid draft becomes a normal order. Items marked *(unverified)* are general knowledge and must be checked before being cited in a spec. The Help pages fetched do **not** mention abandoned checkouts.

| Shopify area | 99ribu today | Verdict | Proposal |
|---|---|---|---|
| **Home** (metrics + tasks + urgent actions) | `/admin` role lens: 4–18 KPI cards + work queue | Partial | Rebuild as Shopify-style Home: "Perlu tindakan" task list first, then period metrics with trend, then setup/readiness checklist (§4) |
| **Orders** (list, detail, draft orders; abandoned checkouts *(unverified)*) | Pesanan list/detail, separate payment/fulfillment/return states | Good | Draft orders (verified) = manual order entry for WhatsApp/phone sales: owner decision D5. It would reuse the checkout/order domain transaction, never a second fake order path. Abandoned checkouts: not in the fetched Help pages and no data source found in `src/modules`; excluded until the owner asks |
| **Products** (products, collections, inventory, transfers, purchase orders *(unverified)*) | Produk, SKU Fisik, Kategori, Stok Gudang, Transfer Stok | Partial | Add B8 "Tambah produk"; bulk edit is optional. Receipts already exist as inventory "Terima barang" |
| **Customers** (list, detail timeline, segments) | CS lookup by phone/email (DEC-018 privacy), Segmen counts | Deliberately narrower | Keep the privacy limit. Option: a read-only customer detail (orders + tickets) under the same lookup, no browsable full list |
| **Analytics / Reports** (dashboard cards linking to reports, Reports with chart + detail table, Live View — verified) | Laporan Keuangan only | **Largest gap** | New "Analitik" group, same shape: a card dashboard whose every card opens its report (chart + table). Reports: Penjualan (orders, NMR, method mix, trend), Produk (top offers, sell-through, stock cover), Pengiriman (COD refusal/RTS per carrier, handover lateness). Each report answers a named owner question (§7) |
| **Marketing** | Integrasi Iklan (settings), Afiliasi | Partial | Move "Integrasi Iklan" from Pengaturan to Pemasaran as a performance view only if ad attribution data exists; otherwise keep it in settings |
| **Discounts** | Promo Ongkir | Fit | Fixed Rp99.000 is a brand invariant, so product discounts stay out. Vouchers wait on S127 |
| **Online Store / Content** (themes, pages, menus, files *(unverified)*) | Banner Beranda | Partial | "Toko Online" group: Banner, Halaman statis (`/privasi` content pending), media library. Menus only if the owner wants editable navigation |
| **Finance** (payouts, billing) | Payments, COD, reconciliation, payouts, refunds, summary | Stronger than Shopify | Keep. Shopify has no COD-settlement equivalent |
| **Settings** (store, payments, shipping, locations, notifications, users, policies) | 8 settings pages + warehouses + staff | Partial | Missing: store details, notifications (needs S124 email provider), policy pages. Shopify keeps Settings as a separate full-page area. Proposal: one `/admin/settings` index page (Apple/Shopify grouped list) instead of 8 sidebar items |
| **Global search** (top bar) | none | Gap | Search bar in the header + ⌘K: order number, resi, product, page names. Respects role scope server-side |

Proposed sidebar after parity (labels Indonesian, routes English per DEC-010):

```
Beranda
Pesanan        (Pesanan · Pengiriman · Cetak Label · Masalah Pengiriman · Retur)
Produk         (Produk · SKU & HPP · Kategori · Stok · Transfer · Gudang)
Pelanggan      (Cari pelanggan · Segmen · Kotak Masuk)
Analitik       (Ringkasan · Penjualan · Produk · Pengiriman)          NEW
Pemasaran      (Promo Ongkir · Afiliasi · Iklan)
Toko Online    (Banner · Halaman)                                      NEW
Keuangan       (Pembayaran · COD · Rekonsiliasi · Komisi · Refund · Laporan)
─────
Pengaturan     → one grouped index page (Staf, Pembayaran, Kebijakan, Label, Balasan CS, Audit, Sistem, Notifikasi)
```

Role scoping, warehouse scope (`S`) and grant rules from spec 17 "Navigation per role" stay unchanged; the regroup changes labels and order only. Owner decision: workspace lens switcher (Ruang Kerja) moves to the header as a role chip, as in Shopify's store switcher.

## 4. Home (`/admin`) — content redesign

Shopify Home pattern applied to the existing role lenses:

1. **Perlu tindakan** (task list, top): one row per non-zero actionable count with a verb ("12 paket lewat batas resi → Proses"). Replaces the flat KPI grid for warehouse/CS/ecommerce lenses.
2. **Kinerja periode** (owner, finance): period picker (Hari ini / 7 / 30 hari, WIB stated), 3–4 headline metrics with delta vs previous period and one line chart (orders or NMR). Money metrics keep "Belum lengkap" instead of Rp 0.
3. **Posisi uang** (owner, finance): COD receivable, refund outstanding, affiliate payable, contribution (estimated vs realized).
4. **Kesiapan toko** (owner, first use): setup checklist from canonical records (warehouses, payment policy, label template, catalog published), distinct from "zero problems".

Functional fixes inside this slice:

- `METRIC_ACTION_HREF` (`src/modules/reporting/shared.ts:176-185`) still assumes inventory/returns screens are missing. Point drilldowns to the real screens with the same filter/period: `delivery_exceptions`→`/admin/exceptions`, `returns_pending`→`/admin/returns`, `stock_alerts`→`/admin/inventory`, `finance_unmatched`→`/admin/finance/reconciliation`, `refund_liability`→`/admin/finance/refunds`, `affiliate_liability`→`/admin/finance/payouts`, contribution/NMR→`/admin/finance/summary`, `orders_pending`→`/admin/orders`. Each target must accept the matching query params; spec 17 rule "no same-named card may use a different filter than its drilldown".
- `METRIC_QUEUE_MAP`: `refund_liability`→`returns` and `affiliate_liability`→`reconciliation` look mismatched; verify before changing.
- Test: each card's count equals its drilldown's row count for the same period (extend `admin-kpi-parity`).
- Blocker: **admin metric policy** `02-PRD.md:449` is TBD (Finance owner, "before dashboard acceptance").

## 5. Visual direction — "Shopify structure, Apple finish"

Constraint check: spec 10 and DESIGN.md fix Inter, purple `#5b35d5`, yellow accent, light-only admin, shadcn/ui (DEC-004). Apple-like is a **finish** on that system, not a new brand. A real new direction needs inspected references and a rendered comparison of 2–3 compositions (design-taste / admin-dashboard rule) before tokens change.

Principles (Apple HIG-inspired, to be confirmed with references):

| Principle | Admin translation |
|---|---|
| Clarity, content first | Fewer borders and nested cards; hierarchy from type size/weight and whitespace; one surface level per region (fixes the "cards inside frames" finding) |
| Large title | Page title 28/34 semibold, subtitle muted 15; title condenses into the header on scroll |
| Grouped inset lists | Settings index and detail pages as iOS Settings-style grouped rows (label left, value right, chevron) |
| Materials | Header and sidebar on a subtle translucent material (`backdrop-blur`, 80–85% surface) only where content scrolls beneath; never on data tables |
| Segmented controls | Period and status tabs as segmented controls instead of underline tabs |
| Soft depth | Radius 10–12 on containers, 8 on controls; one soft shadow level for popovers/sheets; hairline 1px dividers at low contrast |
| Motion | 150–200 ms ease-out for state; sheets slide with a spring-like curve; respects `prefers-reduced-motion`; no chart entry animation on refresh |
| Symbols | Lucide stays (consistent line icons, AGENTS.md); 1.5 stroke, 18/20 px; no emoji |
| Numbers | `tabular-nums`, Rp right-aligned, compact headline values ("Rp 3,8 jt") with exact value in the tooltip/table |
| Dark mode | Spec 10 says light-only. Apple-like often implies dark mode: owner decision, separate slice |

Do not trade density for looks: queues and finance tables keep 40 px rows (32 compact toggle for long scanning), sticky header + identifier column, as in the admin visual contract.

## 6. Open design debt (fix first, inside V1)

From the 2026-10-28 re-review, still open:

- P2: the sidebar paints at an in-between width / the collapsed rail leaks labels at 1440 (`components/ui/sidebar.tsx` first-paint state).
- P2: the sticky action column covers data on affiliates 1440 and system health 1440 (`data-table.tsx:219-230`).
- P2: the "Selesai" status tone is still purple, should be green (`status.tsx`).
- P3: the account footer shows a raw `access-…` id; the email shows uppercase in customers; audit dates show as `mm/dd/yyyy`; the copy says "tereconcile"; the audit error text is grey.
- Never done for admin: `design-gate.py`, a keyboard + axe pass, and an admin geometry check.

## 7. Owner decisions needed (blocking)

| # | Question | Blocks |
|---|---|---|
| D0 | Commit the current working tree (STATUS (a))? | everything |
| D1 | Accept the "Shopify structure, Apple finish" direction and the regrouped sidebar in §3? | V1, N1 |
| D2 | Admin metric policy: period basis, WIB day boundary, contribution completeness (PRD:449) | H1 acceptance |
| D3 | Which 2–3 business questions get trend charts (e.g. orders/day by method; NMR vs realized contribution weekly; COD aging)? | H1, A1 |
| D4 | B8 manual "Tambah produk": yes, or is the importer the only source? | P1 |
| D5 | Manual order entry (Shopify draft-order style) for WhatsApp orders? | future slice |
| D6 | Dark mode for admin (spec 10 currently light-only)? | V2 |
| D7 | Ten admin-wave decisions in `docs/history/STATUS-20261028-handoffs.md` | per slice |

## 8. Proposed slices (not in TASKS yet; the coordinator inserts them after acceptance)

| Slice | Scope | Owned paths (globs) | Risk | Order |
|---|---|---|---|---|
| **V0** reference pass | Inspect Shopify admin + Apple HIG references, render 2–3 compositions of Home and Settings, owner picks | `docs/spec/design/refs/admin-apple-*/**`, `docs/spec/design/prototypes/admin-v2/**` | R1 | after D0 |
| **V1** visual tokens + debt | Tokens in `admin.css`, sidebar/header material, page header, status tones, §6 fixes; runs alone | `src/app/admin/(console)/admin.css`, `src/components/ui/{sidebar,badge,dialog,sheet,tabs}.tsx`, `src/components/admin/{admin-shell,page-blocks,status,data-table,kpi-card}.tsx` | R2 | after V0 |
| **N1** IA regroup + Settings index + global search | Sidebar groups per §3, `/admin/settings` grouped index, header search/⌘K | `src/components/admin/admin-shell.tsx`, `src/app/admin/(console)/settings/page.tsx`, `src/components/admin/command-search*.tsx`, `tests/browser/admin-nav.test.ts` | R2 (search scope = R3) | after V1 |
| **H1** Home v2 | §4 sections, drilldown fixes, parity test | `src/app/admin/(console)/page.tsx`, `src/components/admin/admin-workspaces-client.tsx`, `src/components/admin/home-*.tsx`, `src/modules/reporting/{shared,dashboard}.ts`, `tests/**/admin-kpi*` | R2 | after V1, D2/D3 |
| **A1** Analitik reports | Penjualan / Produk / Pengiriman reports + read APIs (OpenAPI + parity) | `src/app/admin/(console)/analytics/**`, `src/components/admin/analytics-*`, `src/modules/reporting/analytics*.ts` | R3 | after H1, D3 |
| **P1** Tambah produk (B8) | Create draft screen over `createProductDraft` | `src/app/admin/(console)/catalog/new/**`, `src/components/admin/catalog-new-*` | R3 | after D4; parallel to H1 |
| **C1** Toko Online content | Static pages editor (`/privasi`), media library | `src/app/admin/(console)/content/**` | R3 | later |

Every slice ends with: `npm run check` + `npm run build`; its integration/browser selectors; renders at 390/768/1440 (`CAPTURE_EVIDENCE=1`); an independent admin design review; `design-gate.py` for redesigned surfaces; `check-boundary`; then a BUILD-LOG entry, and the spec 17 inventory flips.

## 9. Definition of done and risks

Done when, for the whole programme: every admin route renders at 390/768/1440 with no horizontal overflow and passes `scripts/admin-geometry.mjs`; keyboard + axe pass on Home, a list, a detail and a dialog; per-role nav test (5 roles + multi-role) passes; every KPI equals its drilldown count; independent design review PASS; `design-gate.py` exit 0 on redesigned surfaces.

| Risk | Mitigation |
|---|---|
| V1 token change regresses 44 screens at once | V1 alone on the branch; geometry check + render diff per route before merge |
| Apple-like translucency hurts contrast/perf on data screens | Material only on header/sidebar; contrast measured with `design-taste/scripts/contrast.py`; no blur under tables |
| Analytics numbers disagree with finance ledger | Reuse `reporting` sources; show completeness and as-of; parity test vs ledger |
| Global search leaks out-of-scope rows | Server-side role/warehouse scope, rate limit, audited; R3 review |
| Scope creep into Shopify features 99ribu does not need (themes, apps, multi-currency) | Parity table lists only items with an owner use; everything else is excluded in writing |

## 10. Tooling check

Playwright is ready: `@playwright/test` 1.64.1 (project) and the global CLI 1.64.1. Bundled Chromium 156 (`chromium-1248`) and `/snap/bin/chromium` 156 both launched headless and rendered a page on 2026-10-29. Browser suites use `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium`.
