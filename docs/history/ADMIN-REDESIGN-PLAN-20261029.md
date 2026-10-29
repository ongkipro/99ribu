# 99ribu Admin Console — redesign plan v2 (tokophi seller admin, 99ribu colours)

Date: 2026-10-29 · Status: **PLAN — direction accepted by the owner (D1, D10); development not started; no code, spec or status file changed** · Supersedes v1 (`docs/history/ADMIN-REDESIGN-PLAN-20261029.md`, commit `ec36ee3`): the "Shopify structure, Apple finish" direction is replaced by **tokophi admin as the primary UI/UX reference**, using 99ribu's own colours. Shopify stays a content comparison only.

Owner direction (2026-10-29):
- The admin is overkill today and must be tidied up with collapsible dropdown groups in the sidebar.
- Study the tokophi UI/UX as a whole and apply what fits.
- Use the 99ribu colour pattern.
- List every account type, its slug and what it contains.
- Write a document before any development, so other terminals and agents are not disturbed.
- The reference is the tokophi **seller admin** (`apps/admin`) including its sub-pages such as product creation. Slugs are tidied like tokophi.
- Accepted: "ya sesuaikan ulang dan sempurnakan" (D1 and D10 answered).

## 0. Where this lives and how it lands

- Kept outside the repository (`~/Documents/work/notes/`) while omp is active on `main`, so no shared file moves under it.
- After acceptance, the coordinator replaces the v1 copy at `docs/history/ADMIN-REDESIGN-PLAN-20261029.md`. The accepted parts then go to their canonical owners:

  | Accepted part | Canonical owner |
  |---|---|
  | Navigation per role | spec 17 "Navigation per role" |
  | Tokens | spec 10 + `admin.css` |
  | Slices | `TASKS.md` |
  | Decisions | `DECISIONS.md` |

- Sources read (read-only):
  - **tokophi** `~/Projects/tokophi` at `e659e2db`: `apps/admin/lib/nav.ts`, `apps/admin/components/admin/{nav-links,sidebar,topbar,admin-chrome,page-header,tab-strip,responsive-table,kpi-card}.tsx`, `apps/admin/components/admin/dashboard/{action-queue,kpi-tile,money-strip,return-by-courier}.tsx`, `apps/admin/app/(admin)/dashboard-client.tsx`, `apps/admin/app/globals.css`, `apps/super-admin/lib/nav.ts`, `packages/ui/src/components/ui/*`.
  - **tokophi seller sub-pages**: `apps/admin/app/(admin)/{produk,produk/baru,produk/[id]/product-editor,pesanan,pesanan/[id]/order-detail,pengaturan}`, `components/admin/pesanan/order-list-types.ts`.
  - **99ribu** `src/components/admin/{admin-shell,order-model,catalog-model}.ts(x)`, `src/modules/reporting/{shared,dashboard}.ts`, `src/proxy.ts`, `src/app/admin/(console)/admin.css`, `DESIGN.md`, `src/modules/access/policy.ts`, spec 17, and the local DB role grants.
- **Screenshots: not taken.** No tokophi server is running, and the `tokophi-47` session owns that repository. The study is from source, which gives exact classes and spacing. To capture later, ask the tokophi session to run `npm run dev:admin` + `npm run audit:responsive` (`apps/admin/scripts/audit-responsive.mjs`, viewports 360/390/414 + desktop) and share the PNGs.

## 1. Collision guard (unchanged from v1, still binding)

- `main` has around 216 uncommitted paths, nearly every admin file among them. `src/modules/reporting/*.ts` is untracked.
- omp (pid 10168) is working in this checkout: storefront, `STATUS.md`, `BUILD-LOG.md`, `DESIGN.md`, an "admin precision pass".
- **Gate 0:** omp finishes, the working tree is committed, and `npm run check` is green. Only then does any admin slice start.
- Each slice gets its own worktree and STATUS row. Shared files are merged by the coordinator only.
- The slug move (S-U1) and then the token/shell slice (S-V1) each run **alone**, because together they touch every admin page.

## 2. tokophi admin — what it is, element by element

tokophi is split into `apps/super-admin` (platform operator), `apps/admin` (store operator) and `apps/storefront`. Both admin apps use shadcn on Tailwind v4 (`@tokophi/ui`: avatar, badge, button, card, chart, checkbox, dialog, dropdown-menu, input, label, pagination, progress, rich-text-editor, scroll-area, select, separator, sheet, skeleton, switch, table, tabs, textarea, tooltip). 99ribu already has the same base (DEC-004), so patterns port without new dependencies.

### 2.1 Shell (`admin-chrome.tsx`)

- Layout: `flex min-h-screen`. A fixed sidebar sits on the left. The right column holds a sticky topbar, then banners, then `main` at `bg-muted/30 p-4 sm:p-6`.
- Content sits on a faint grey canvas; cards are white.
- Full-bleed editor routes are matched by **exact regex**, never by prefix. The note in the code: a prefix "always eats the index page".
- `sonner` toasts are pinned at top-center.

### 2.2 Sidebar (`sidebar.tsx`, `nav-links.tsx`, `lib/nav.ts`)

- `w-64 border-r bg-card`. The brand sits in a `h-16` row with a bottom border. The nav scrolls in `py-4`. The sidebar is hidden below `lg`; phones open the same nav in a left `Sheet` (`w-72`) from the topbar.
- **Collapsible dropdown groups.**
  - Each parent row is a link to its main page, plus a separate chevron button (`aria-expanded`, `aria-label "Buka/Tutup <label>"`, `ChevronRight` rotated 90° when open).
  - Children are indented under a left border (`ml-[26px] border-l pl-3`).
  - A group auto-expands when the current page is inside it. The user can toggle it without navigating.
- **Exactly one active item.** `activeChildHref()` picks the longest matching path, and a matching query wins ties (`?tab=`). Two highlighted rows are treated as a bug.
- **Live badges, never literals.** `badgeKey: "perluDikirim"` is filled server-side and **hidden at zero**. The parent link lands on the exact tab the badge counts.
- Group headers: `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground`.
- Rows: `rounded-lg px-3 py-2 text-sm font-medium`, icon `size-[18px]`. Active is `bg-primary/10 text-primary`; idle is muted with `hover:bg-muted`.
- IA rules written into the code:
  - A nav row that opens onto nothing is removed until the page exists.
  - A sub-menu is not a tab bar with more clicks: each child answers a different question.
  - Indonesian sellers expect **Keuangan** in the sidebar (Shopee/Tokopedia/TikTok Shop pattern).
- Store admin nav: Dashboard · Pesanan ▸ · Keuangan ▸ · Produk ▸ · Pelanggan ▸ · Obrolan · CRM ▸ · Promo ▸ · Analitik · Pemasaran | **Toko Online**: Tema, Halaman, Blog, Files, Navigasi | Bantuan, Pengaturan. That is **12 top-level rows plus one group**, against 35 flat items in 99ribu today.
- Super-admin nav: Dashboard | **Operasional**: Toko, Pencairan, Tiket | **Pantau**: Analitik, Log Sistem, Update Log | **Konfigurasi**: Paket & Billing, Pengaturan.

### 2.3 Topbar (`topbar.tsx`)

- `sticky top-0 z-30 h-16 border-b bg-background/80 backdrop-blur-md`.
- Contents: mobile menu button (Sheet) · store switcher dropdown · command palette search (`command-palette.tsx`, static search index) · balance chip ("Saldo", tabular IDR, opens the balance page) · notifications bell · light/dark toggle · avatar dropdown (profile, security, billing, sign out).

### 2.4 Page building blocks

| Block | File | Contract |
|---|---|---|
| Page header | `page-header.tsx` | `h1` 24/bold/tight with `line-clamp-2`; muted description 14; actions right-aligned, wrapping on phones; `mb-5` |
| Tab strip | `tab-strip.tsx` | Tabs **scroll horizontally** on phones (`-mx-4 overflow-x-auto px-4`), never wrap or squeeze; `TabsList w-max` |
| Responsive table | `responsive-table.tsx` | Desktop `<Table>` from `md`; **below `md` the same rows render as cards** (`DataCard` with the whole card as tap target, `DataRow` label/value, lead slot for a checkbox) |
| KPI tile | `dashboard/kpi-tile.tsx` | Card `p-5`; header row = icon 14 + label 12/500 muted + pill; value 24/700/`tabular-nums`/`leading-none`; caption 12/400 muted 75%. Rhythm 20/12/8/4 px |
| Delta pill | `kpi-tile.tsx` `DeltaBadge` | Tones neutral/good/bad, arrow glyph + signed % + `sr-only` word ("naik/turun/tidak ada pembanding"); `null` → neutral "—", never green |
| Action queue | `dashboard/action-queue.tsx` | "Antrian Kerja" card: tiles grid 2/3/5 columns, each tile = icon chip (tone urgent/warn/info) + big count + label + hint, link to the filtered list; **0 → "Beres"** with a green check; an orphan tile spans the row; amber strip "Rp X tertahan di N pesanan" |
| Money strip | `dashboard/money-strip.tsx` | 4 sales tiles (fixed ranges) + return-rate tile, built on `KpiTile` |
| Return by courier | `dashboard/return-by-courier.tsx` | Return/RTS per courier with a bar and a fixed 44px numeric column |
| Others | `empty-state.tsx`, `list-pagination.tsx`, `date-range-switcher.tsx`, `search-input.tsx`, `order-status.tsx`, `sparkline.tsx`, `sales-chart.tsx`, `top-products.tsx`, `recent-orders.tsx`, `live-activity.tsx`, `confirm-delete.tsx`, `date-time-cell.tsx`, `product-thumb.tsx` | Reusable list/detail pieces |

### 2.5 Dashboard composition (`dashboard-client.tsx`)

The page is capped at `max-w-[1400px] space-y-5`. Top to bottom:

1. Header row: title, greeting, date-range switcher, Export.
2. **Antrian Kerja**: what to do now.
3. **Money strip**: money at a glance.
4. Grid of 3 columns: sales chart (2 columns) + live activity (1 column).
5. Grid: recent orders (2 columns) + top products (1 column).
6. Grid: sales channels · order status bars · returns by courier.

Every empty block shows a sentence ("Belum ada penjualan pada periode ini."), never a blank chart.

### 2.6 Tokens (`apps/admin/app/globals.css`)

- shadcn neutral base in OKLCH with an indigo brand override: `--primary: oklch(0.515 0.23 277)`, `--radius: 0.625rem`.
- Chart palette: indigo / teal / green / amber / rose.
- Dark mode is defined.
- Sidebar tokens mirror the primary.

### 2.7 Seller admin sub-pages (list → detail → create)

The owner names **tokophi seller admin** (`apps/admin`) and its sub-pages as the reference, including product creation.

| tokophi route | Pattern | Contents |
|---|---|---|
| `/produk` | Server page → `produk-client.tsx` | Status tabs with counts (Semua, Aktif, …); search; sort (Unggulan, Nama A–Z, Harga, Stok paling sedikit, Terlaris); date filter (7/30/90 hari); ResponsiveTable (cards below `md`) |
| `/produk/baru` | **The same `ProductEditor` as edit, empty** (8-line page) | One editor for create and edit, so the two never drift |
| `/produk/[id]` | Short product **number** in the URL; a UUID redirects to the number | `ProductEditor`: header with back arrow, **Hapus produk · Batal · Simpan** (Menyimpan… while pending). Two columns: main = Info (judul, deskripsi singkat, deskripsi), Media, Harga, Inventaris, Varian, Pengiriman, Pratinjau mesin pencari; side = Status, Organisasi (kategori/taksonomi). **Unsaved-changes guard** (`beforeunload` + in-app navigation). Photos can be added only after the first save |
| `/produk/kategori`, `/produk/kategori/baru`, `/produk/kategori/[id]` | List / create / edit | — |
| `/produk/inventori`, `/produk/pembelian` | List pages under Produk | — |
| `/pesanan` | `pesanan-client.tsx` | Tabs **Semua · Belum Bayar · Perlu Dikirim · Dikirim · Selesai · Pengembalian/Pembatalan** with counts (`TabStrip`); search field selector (No. Pesanan / Nama Pembeli / Produk / No. Resi); payment-method filter; bulk selection |
| `/pesanan/[id]` | `order-detail.tsx` | Cards: **Item pesanan · Linimasa · Pelanggan · Pengiriman · Pembayaran**; shipping label; return info |
| `/pesanan/massal` | Bulk shipping | — |
| `/pengaturan` | One page of setting cards | Profil toko, alamat pengirim, jasa kirim, rekening, pengguna, pajak, domain |
| `/akun/profil`, `/akun/keamanan` | Avatar menu | — |

99ribu adaptation of the product editor (one `ProductEditor` for `/admin/produk/baru` and `/admin/produk/[no]`):

- **Main column:**
  - **Info**: title ≤ 40 characters, description.
  - **Media**: photos, order, alt text.
  - **Penawaran Rp99.000**: replaces Harga and Varian. Offers are unit, multipack or bundle, each with its contents. The price is fixed and shown as a fact, never as an input.
  - **Stok & Gudang**: physical SKU components and origin warehouse.
  - **Pengiriman**: weight and dimensions.
  - **Pratinjau mesin pencari**: `/produk/<slug>`.
- **Side column:**
  - **Status**: draf / tayang / ditarik, with the blockers (stock, HPP, margin).
  - **Organisasi**: kategori.
  - **Kontribusi**: HPP and margin, visible only with `finance.costs.read`.
- **Actions:**
  - A below-margin publish creates a **Persetujuan** request for Super Admin instead of failing.
  - Hapus becomes **Tarik dari toko**, because product history is immutable.

### 2.8 Do not copy

- The greeting **"Halo … 👋"**. Emoji are forbidden in 99ribu UI (AGENTS.md).
- Subscription badge, store switcher, `/store/{slug}` prefix, balance chip, Tema, Langganan, Paket. These are SaaS tenant features; 99ribu is one company.
- **Flash Sale / Voucher discounts.** They conflict with the fixed Rp99.000 brand invariant. Promo stays shipping promotions; vouchers wait on S127.
- Dark mode. Spec 10 sets the admin to light-only. Adding it is owner decision D6.
- (Route slugs are **adopted**: the owner asked on 2026-10-29 for slugs tidied like tokophi. See §4.2.)

## 3. 99ribu colours applied to the tokophi pattern

Map tokophi's roles onto existing 99ribu tokens. Values come from `admin.css` and `DESIGN.md`; no new brand colour is introduced.

| Role in tokophi | tokophi value | 99ribu value | Notes |
|---|---|---|---|
| `--primary`, `--ring`, `--sidebar-primary`, active nav `bg-primary/10 text-primary` | indigo `oklch(0.515 0.23 277)` | purple `oklch(0.483 0.226 285)` = `#5b35d5` | Already in `admin.css`; 7.0:1 on canvas |
| `--accent` | neutral | lavender `oklch(0.963 0.02 298.2)` | Matches the storefront pill fill `rgba(91,53,213,.08)` |
| Highlight / attention | — | yellow `#f6c945` | **Fill only, with ink text** (yellow text on white fails contrast). Use for the "perlu tindakan" count chip and the wordmark dot |
| `main` canvas | `bg-muted/30` | `--background oklch(0.991 0.001 286.4)` | Keep, near `#fcfcfc` |
| Text | `oklch(0.145 0 0)` | ink `#18181b` (admin) | — |
| Borders | `oklch(0.922 0 0)` | line `#d8d8df` | — |
| Warning tone (amber) | `amber-500/12` | `--warning oklch(0.488 0.137 43.9)` / `--warning-surface` | Uncertain/held money, "Hasil belum pasti" |
| Urgent tone | destructive | `--error #8b241d` / `--error-surface #fff4f2` | Overdue, failed |
| Good tone | emerald | green (status "Selesai", "Beres") | Fixes the open P2: "Selesai" is still purple |
| Charts | indigo, teal, green, amber, rose | 1 purple `#5b35d5`, 2 teal, 3 green, 4 amber `--warning`, 5 rose `--error` | Each series needs a direct label or marker (WCAG 1.4.1); measure contrast before merge |
| Radius | `0.625rem` | `0.5rem` | Keep 99ribu |
| Font | Geist/sans | Inter variable | Keep 99ribu |

## 4. Accounts: types, slugs and what each one contains

7 roles (`src/modules/access/policy.ts:3`) plus guests. Staff (1–5) share one console `/admin`. The `?workspace=<slug>` lens and the role decide what is shown. Every staff sign-in requires TOTP. Buyers and affiliates never enter `/admin`.

| # | Account type | Role slug | Landing URL | Local fixture |
|---|---|---|---|---|
| 1 | Super Admin | `owner` | `/admin?workspace=owner` | `owner@99ribu.test` |
| 2 | Admin E-Commerce | `ecommerce_admin` | `/admin?workspace=ecommerce_admin` | `ecommerce@99ribu.test` |
| 3 | Gudang | `warehouse` | `/admin?workspace=warehouse` | `gudang@99ribu.test` |
| 4 | Layanan Pelanggan (CS) | `customer_service` | `/admin?workspace=customer_service` | `cs@99ribu.test` |
| 5 | Keuangan | `finance` | `/admin?workspace=finance` | `keuangan@99ribu.test` |
| 6 | Pembeli | `buyer` | `/akun` → `/akun/pesanan`, `/akun/profil`, `/akun/pengaturan` | `pembeli@`, `pembeli2@99ribu.test` |
| 7 | Afiliasi | `affiliate` | `/afiliasi` | `afiliasi@99ribu.test` |
| – | Tamu | — | Storefront, checkout, order lookup by number | — |

Extra grants on top of roles: `orders.history.read`, `finance.summary.read`, `finance.costs.read|write`, `finance.reconciliation.read|write`, `finance.refunds.read|write`, `exports.read|download`, `shipping.labels.read|generate|print`. Warehouse scope comes from `app.warehouse_membership`. The local `ecommerce@`, `gudang@` and `cs@` fixtures belong to the 49 Berlapak origin warehouses.

**"Advertiser" does not exist as an account in 99ribu.** The nearest things:

- **Afiliasi**: an external promoter with a referral link. They earn commission and never see buyer data.
- **Integrasi Iklan**: Meta/Google/TikTok destinations, owned by Super Admin as a setting, not a user.

If the owner wants a staff member who runs ads, banners and promotions without touching products or money, that is a **new role** (proposed slug `marketing`) with its own IAM change, R4 review and spec 07 update. This is decision D8.

### 4.1 What each account contains — tidy nav with tokophi-style slugs

Notation: `▸` marks a collapsible group (the parent row opens its main page and the chevron opens the children). **[baru]** means not built yet. (badge) is a live count, hidden at zero. Every route sits under `/admin`, so `/admin` is omitted below. Detail pages use the short number from S145 (`/pesanan/1042`).

**Super Admin (`owner`)** — **monitor, approver, governor; not an operator** (owner correction 2026-10-29: "super admin tidak perlu akses all produk, dia pemantau"). The owner does not edit products, move stock, input resi, reply to chats or confirm payments. Those jobs belong to Admin E-Commerce and staff (maker). The owner watches, approves exceptions (checker; never approves their own request) and sets the rules. This follows Shopify's split between owner-only account, billing and staff control and delegated operational permissions, and the maker-checker separation-of-duties pattern.

```
Beranda                 /                                  Pantauan: Antrian Keputusan, money strip, sales trend, health signals
Persetujuan (badge)     /persetujuan              [baru]   approve/reject exceptions (below-margin publication, …)
Pantauan ▸              /pantauan                 [baru]   READ-ONLY oversight hub, no edit controls
   Pesanan              /pesanan                           read-only view (no shipping/return actions)
   Katalog              /pantauan/katalog         [baru]   counts: terbit / siap / diblokir (reason) / ditarik, below-margin list; links open read-only product detail
   Stok                 /pantauan/stok            [baru]   stock health per warehouse (low stock, in transit), read-only
   Kendala & Retur      /pantauan/kendala         [baru]   open exceptions and returns, ageing, read-only
Keuangan ▸              /keuangan                          Ringkasan (read)
   Laporan Keuangan     /keuangan                          period flows, contribution completeness
   Rekonsiliasi         /keuangan/rekonsiliasi             read-only for owner (finance acts)
   Komisi Afiliasi      /keuangan/komisi                   read-only for owner (finance pays)
Analitik                /analitik                 [baru]
Pengaturan ▸            /pengaturan                        owner-only governance
   Staf & Peran         /pengaturan/staf
   Kebijakan Komersial  /pengaturan/komersial              margin floor, defaults
   Pembayaran & COD     /pengaturan/pembayaran
   Tarif Afiliasi       /afiliasi                          rate versions only
   Gudang               /produk/gudang                     warehouses, calendar (owner approves calendars)
   Integrasi Iklan      /pemasaran/iklan
   Log Audit            /pengaturan/audit
   Kesehatan Sistem     /pengaturan/sistem
```

Rules for the owner view:
- Every operational screen the owner can reach renders in **read-only mode**: no editor, no bulk bar, no action buttons. A note "Dikerjakan oleh Admin E-Commerce / Gudang / CS / Keuangan" points to the role that acts.
- Self-approval is refused. A request created by an account is never approvable by that same account (S-A0).
- Server authority is **unchanged in this programme**. The owner role keeps its existing API authority, which is needed for approvals, emergencies and the existing owner-exception publication path. Only the UI stops offering operational controls. Narrowing the owner's server permissions is decision **D11** (R4 IAM, later).
- A multi-role account (owner + ecommerce_admin) still gets the operator screens through its `ecommerce_admin` lens.
- **Transition (for S-V1):** the `/pantauan/*` pages and owner read-only mode are built by follow-up slice **S-O1**, after this run. Until S-O1 merges, S-V1 keeps the owner's existing Pesanan, Produk (list/detail), Stok and Kendala/Retur links visible under a "Pantauan" group pointing at the existing pages, and the `/pantauan/*` items stay behind the built flag.

**Admin E-Commerce (`ecommerce_admin`)** — products, content, merchandising:

```
Beranda                 /                                  Antrian Kerja: produk diblokir, stok menipis, pesanan perlu diproses
Pesanan ▸               /pesanan?tab=perlu_dikirim (badge)
   Semua Pesanan        /pesanan
   Retur                /pesanan/retur
Produk ▸                /produk
   Tambah Produk        /produk/baru              [baru]   same editor as /produk/[no]
   Kategori             /produk/kategori
   Inventori            /produk/inventori
   Transfer Stok        /produk/inventori/transfer
Promo ▸                 /promo/ongkir
   Banner               /banner
   Segmen Pembeli       /pelanggan/segmen
Toko Online ▸           /halaman                  [baru]
   Media                /media                    [baru]
```

The SKU & HPP page (`/produk/sku`) is shown only with `finance.costs.read`.

**Gudang (`warehouse`)** — assigned warehouses only:

```
Beranda                 /                                  Antrian Kerja: lewat batas resi, belum serah terima, retur untuk diperiksa
Pesanan ▸               /pesanan?tab=perlu_dikirim (badge)
   Input Resi           /pesanan/kirim
   Cetak Label          /pesanan/cetak-label
   Kendala Pengiriman   /pesanan/kendala
   Retur                /pesanan/retur                     inspection side
Produk ▸                /produk/inventori
   Transfer Stok        /produk/inventori/transfer
```

**Layanan Pelanggan (`customer_service`)**:

```
Beranda                 /                                  Antrian Kerja: chat belum diklaim, kendala, retur baru
Obrolan (badge)         /obrolan
Pesanan ▸               /pesanan
   Kendala Pengiriman   /pesanan/kendala
   Retur                /pesanan/retur
Pelanggan               /pelanggan                         cari pembeli
```

**Keuangan (`finance`)**:

```
Beranda                 /                                  Antrian Kerja: belum cocok, transfer mendekati batas, refund tertunda
Keuangan ▸              /keuangan
   Pembayaran Masuk     /keuangan/pembayaran
   Setoran COD          /keuangan/cod
   Rekonsiliasi         /keuangan/rekonsiliasi
   Pengembalian Dana    /keuangan/refund
   Komisi Afiliasi      /keuangan/komisi
Pesanan                 /pesanan                           read, own grants
```

**Every staff account, avatar menu (tokophi pattern):** Profil `/akun/profil` · Keamanan `/akun/keamanan` · Lihat Toko `/` (storefront) · Keluar. Multi-role accounts get a role chip in the topbar instead of the "Ruang Kerja" sidebar group, so `?workspace=<role>` stays as the lens parameter.

**Pembeli (`buyer`)** — storefront, unchanged: `/akun/pesanan`, `/akun/profil`, `/akun/pengaturan`, `/bantuan`.
**Afiliasi (`affiliate`)** — storefront, unchanged: `/afiliasi`.

Count: 35 flat sidebar items today become at most 9 top-level rows per role.

### 4.2 Admin route slug map (old → new, tokophi style)

Rules:

1. Indonesian, short, lowercase, hyphenated slugs grouped by parent: `/admin/<area>/<sub>`. Detail pages are `/<area>/<short number>`, create pages are `/<area>/baru`.
2. Every old English path answers **308 to the new path**, with query strings kept and detail numbers kept. Bookmarks, tests and links in sent emails keep working. Old UUID → number redirects (S145) still apply.
3. **APIs do not change**: `/api/v1/admin/...` stays English and OpenAPI is untouched. Only page routes move.
4. Storefront slugs are unchanged (they are already Indonesian).
5. This supersedes DEC-010 for admin page routes. The coordinator records a new DEC.

| Old route (today) | New route | Notes |
|---|---|---|
| `/admin` | `/admin` | Beranda |
| `/admin/queue` | `/admin/antrian` | "Lihat semua" of the work queue |
| `/admin/orders` · `/admin/orders/[orderNo]` | `/admin/pesanan` · `/admin/pesanan/[no]` | Tabs as `?tab=semua\|belum_bayar\|perlu_dikirim\|dikirim\|selesai\|retur` |
| `/admin/fulfillment` | `/admin/pesanan/kirim` | Manual resi input (Mengantar) |
| `/admin/print-center` | `/admin/pesanan/cetak-label` | — |
| `/admin/exceptions` · `[exceptionNo]` | `/admin/pesanan/kendala` · `/admin/pesanan/kendala/[no]` | — |
| `/admin/returns` · `[returnNo]` | `/admin/pesanan/retur` · `/admin/pesanan/retur/[no]` | — |
| `/admin/support` | `/admin/obrolan` | CS inbox (tokophi naming) |
| `/admin/customers` | `/admin/pelanggan` | Buyer lookup |
| `/admin/buyer-segments` | `/admin/pelanggan/segmen` | — |
| `/admin/catalog` · `[productNo]` | `/admin/produk` · `/admin/produk/[no]` | — |
| — | `/admin/produk/baru` | **New**, same editor |
| `/admin/catalog/categories` | `/admin/produk/kategori` | `+ /baru`, `/[no]` when rename/retire lands |
| `/admin/catalog/stock-items` | `/admin/produk/sku` | SKU fisik & HPP (grant-gated) |
| `/admin/inventory` | `/admin/produk/inventori` | — |
| `/admin/inventory/transfers` | `/admin/produk/inventori/transfer` | — |
| `/admin/warehouses` · `[warehouseNo]` | `/admin/produk/gudang` · `/admin/produk/gudang/[no]` | Pickup profile + calendar |
| `/admin/promotions/shipping` | `/admin/promo/ongkir` | — |
| `/admin/banners` | `/admin/banner` | — |
| `/admin/affiliates` · `[affiliateNo]` | `/admin/afiliasi` · `/admin/afiliasi/[no]` | — |
| `/admin/finance/summary` | `/admin/keuangan` | Ringkasan |
| `/admin/payments` | `/admin/keuangan/pembayaran` | — |
| `/admin/cod-settlements` | `/admin/keuangan/cod` | — |
| `/admin/finance/reconciliation` · `[itemNo]` | `/admin/keuangan/rekonsiliasi` · `/[no]` | — |
| `/admin/finance/refunds` · `[refundNo]` | `/admin/keuangan/refund` · `/[no]` | — |
| `/admin/finance/payouts` · `[payoutNo]` | `/admin/keuangan/komisi` · `/[no]` | — |
| — | `/admin/pengaturan` | **New** index of setting cards |
| `/admin/settings/staff` | `/admin/pengaturan/staf` | — |
| `/admin/settings/commercial` | `/admin/pengaturan/komersial` | — |
| `/admin/settings/payment` | `/admin/pengaturan/pembayaran` | — |
| `/admin/settings/label-templates` | `/admin/pengaturan/label` | — |
| `/admin/settings/advertising` | `/admin/pemasaran/iklan` | Moves under Pemasaran |
| `/admin/settings/support` | `/admin/pengaturan/balasan-cs` | — |
| `/admin/settings/audit` | `/admin/pengaturan/audit` | — |
| `/admin/settings/system` | `/admin/pengaturan/sistem` | — |
| `/admin/account` · `/admin/account/security` | `/admin/akun/profil` · `/admin/akun/keamanan` | Same as tokophi |
| — | `/admin/persetujuan`, `/admin/analitik`, `/admin/pemasaran`, `/admin/halaman`, `/admin/media` | **New** pages, each built in its own slice |

Implementation note for slice S-U1: move the route folders in one commit, add a single old→new redirect table in `src/proxy.ts`, whose matcher already covers `/admin` and `/admin/:path*`, update `admin-shell.tsx` nav, every internal `href`, `METRIC_ACTION_HREF`, and the browser tests. A test asserts that every old path answers 308 to its new path and that no internal link still points to an old one. Risk R2. It runs **first and alone**, because it moves every admin page folder. S-V1 starts on the moved tree.

### 4.3 List tabs (tokophi tab strip, 99ribu states)

tokophi keeps one status per order. 99ribu keeps **payment, parcel and return states independent**: an order can be COD-due, half shipped and have a return open at once. So each tab is a saved filter on the axis the operator works on, and the row shows the other axes as separate badges.

**Pesanan** (`/admin/pesanan?tab=…`, each tab with a count):

| Tab | `tab=` | Filter (existing states in `order-model.ts`) |
|---|---|---|
| Semua | `semua` | All, including cancelled and refunded history |
| Belum Bayar | `belum_bayar` | payment `pending` (manual transfer, VA/QRIS) |
| Perlu Dikirim | `perlu_dikirim` | a parcel in fulfillment `ready`, `picking`, `packed`, `handover_pending` or `exception`. This is the sidebar badge |
| Dikirim | `dikirim` | a parcel `handed_over` and not all delivered |
| Selesai | `selesai` | every parcel `delivered` |
| Retur/Batal | `retur` | an open return case, or order `cancelled` |

Search field selector as in tokophi: **No. Pesanan · No. Resi · Nomor HP (4 digit terakhir)**. Buyer-name search is left out for privacy (DEC-014: phone suffix only). Extra filters: payment method (COD, transfer manual, VA/QRIS), warehouse (scoped), period.

**Produk** (`/admin/produk?tab=…`): Semua · Terbit (`published`) · Siap Terbit (`ready`) · Diblokir (`blocked`, with the blocker reason: stok, HPP, margin) · Ditarik (`withdrawn`). Sort: Terbaru, Nama A–Z, Stok paling sedikit. Price sorting is dropped because every offer is Rp99.000.

**Retur** (`/admin/pesanan/retur?tab=…`): Diajukan · Ditinjau · Menunggu Barang · Diperiksa · Selesai/Ditolak.
**Kendala** (`/admin/pesanan/kendala?tab=…`): Terbuka · Menunggu Keputusan · Selesai.
**Keuangan → Rekonsiliasi**: Belum Cocok · Cocok Sebagian · Bermasalah · Cocok.

### 4.4 Beranda per role: Antrian Kerja tiles and Money strip

Tiles reuse the **existing metric keys** (`src/modules/reporting/shared.ts`, definitions in `dashboard.ts`), so no new counting is invented. Each tile links to the exact filtered list behind its count. A count of 0 shows "Beres" with a green check.

| Tile (label) | Metric key | Opens | Super Admin | Admin E-Com | Gudang | CS | Keuangan |
|---|---|---|---|---|---|---|---|
| Pesanan perlu diproses | `orders_pending` | `/admin/pesanan?tab=perlu_dikirim` | Y | Y | — | Y | — |
| Paket belum diserahkan | `fulfillments_due` | `/admin/pesanan?tab=perlu_dikirim` | Y | Y | Y | — | — |
| Perlu input resi | `manual_booking_pending` | `/admin/pesanan/kirim` | Y | Y | Y | — | — |
| Kendala pengiriman | `delivery_exceptions` | `/admin/pesanan/kendala` | Y | Y | Y | Y | — |
| Retur menunggu | `returns_pending` | `/admin/pesanan/retur` | Y | Y | Y | Y | — |
| Stok menipis (≤ 5) | `stock_alerts` | `/admin/produk/inventori?stok=menipis` | Y | Y | Y | — | — |
| Chat belum diklaim | `support_unassigned` | `/admin/obrolan?tab=belum_diklaim` | Y | — | — | Y | — |
| Mutasi belum cocok | `finance_unmatched` | `/admin/keuangan/rekonsiliasi` | Y | — | — | — | Y |
| Transfer mendekati batas | `transfers_near_deadline` | `/admin/keuangan/pembayaran?tab=transfer` | Y | — | — | — | Y |
| VA/QRIS belum lunas | `autolaris_pending` | `/admin/keuangan/pembayaran?tab=autolaris` | Y | — | — | — | Y |
| Menunggu persetujuan [baru] | new count (S-A0) | `/admin/persetujuan` | Y | — | — | — | — |

The Super Admin home shows the **decision tiles first**: Menunggu persetujuan, Mutasi belum cocok, Kendala. Operational tiles follow and are collapsible, so the owner is not drowned in daily work.

**Money strip** (Super Admin, Keuangan), from the existing money metrics. "Belum lengkap" is shown instead of Rp 0 when sources are incomplete.

| Tile | Metric key | Opens |
|---|---|---|
| Pendapatan bersih | `net_merchandise_revenue` | `/admin/keuangan` |
| COD belum disetor | `cod_receivable` | `/admin/keuangan/cod` |
| COD sudah disetor | `cod_remitted` | `/admin/keuangan/cod` |
| Refund berjalan | `refund_liability` | `/admin/keuangan/refund` |
| Komisi afiliasi tertunda | `affiliate_liability` | `/admin/keuangan/komisi` |
| Kontribusi (estimasi · realisasi) | `estimated_contribution`, `realized_contribution` | `/admin/keuangan` |

Below the strip, the Super Admin home adds **one** sales trend (orders per day by payment method) once D3 confirms it. "Pesanan per metode bayar" (`orders_by_payment_method`) becomes that chart's breakdown instead of a tile.

This fixes the stale `METRIC_ACTION_HREF` and `METRIC_QUEUE_MAP` mismatches found in v1: every link is a real screen with the same filter and period.

### 4.5 Pengaturan index (`/admin/pengaturan`, tokophi card page)

One page of setting cards. Each card shows its current version and links to its page. Super Admin only, except where noted.

| Card | Opens | Content |
|---|---|---|
| Staf & Peran | `/admin/pengaturan/staf` | Staff list, roles, grants, warehouse scope, MFA reset |
| Kebijakan Komersial | `/admin/pengaturan/komersial` | Margin floor, defaults (versioned) |
| Pembayaran & COD | `/admin/pengaturan/pembayaran` | COD fee, manual bank accounts (versioned) |
| Gudang | `/admin/produk/gudang` | Warehouses, pickup profile, shipping calendar |
| Template Label | `/admin/pengaturan/label` | Label templates (Admin E-Com and Gudang read) |
| Balasan CS | `/admin/pengaturan/balasan-cs` | Saved replies and tags (CS reads) |
| Integrasi Iklan | `/admin/pemasaran/iklan` | Ad destinations, diagnostics |
| Log Audit | `/admin/pengaturan/audit` | Append-only trail |
| Kesehatan Sistem | `/admin/pengaturan/sistem` | Outbox and worker health |

## 5. Port plan — tokophi code to 99ribu (for the development phase, not done now)

Same owner, same stack, so copying is allowed. Every port swaps `@tokophi/ui` imports for 99ribu's `src/components/ui/*`, swaps `@tokophi/lib/format` for 99ribu `rupiah`/`Intl` helpers, removes emoji and SaaS bits, and keeps 99ribu tokens.

| tokophi source | 99ribu target | Change |
|---|---|---|
| `lib/nav.ts` + `components/admin/nav-links.tsx` | `src/components/admin/admin-shell.tsx` nav data + item renderer | Per-role `NAV_GROUPS` (§4.1) derived from existing `consoleAccess`; keep `activeChildHref`; badges from `reporting` counts |
| `components/admin/sidebar.tsx` | shadcn `Sidebar` in `admin-shell.tsx` | Drop the subscription badge; keep `w-64`, brand row `h-16`; tablet rail behaviour stays (spec 10). The rail fix also clears the open sidebar-width P2 |
| `components/admin/topbar.tsx` (structure only) | new `src/components/admin/topbar.tsx` | Sheet nav for phones, command search, notifications (later), avatar menu; no balance chip, no store switcher |
| `components/admin/command-palette.tsx` | `src/components/admin/command-search.tsx` | Search orders/resi/products **through role-scoped server APIs**, not a static index (R3) |
| `components/admin/page-header.tsx` | `src/components/admin/page-blocks.tsx` | Align to 24/bold/tight + muted 14 + right actions |
| `components/admin/tab-strip.tsx` | `src/components/admin/tab-strip.tsx` | As is |
| `components/admin/responsive-table.tsx` | `src/components/admin/data-table.tsx` | Cards below `md` instead of the sticky action column; fixes the open "sticky column hides data" P2 |
| `dashboard/kpi-tile.tsx` (+ `DeltaBadge`, `pillClass`) | `src/components/admin/kpi-card.tsx` | Same rhythm and tones with 99ribu good/warning/error tokens; money keeps "Belum lengkap" instead of Rp 0 |
| `dashboard/action-queue.tsx` | new `src/components/admin/action-queue.tsx` | Fed by existing `WORKSPACE_METRICS` per role; each tile links to the **real screen** (fixes the stale `METRIC_ACTION_HREF`) |
| `dashboard/money-strip.tsx` | new `src/components/admin/money-strip.tsx` | COD receivable, refund outstanding, affiliate payable, contribution (estimated vs realized) |
| `dashboard/return-by-courier.tsx` | Analytics / owner home | COD refused / RTS per carrier |
| `empty-state.tsx`, `list-pagination.tsx`, `date-range-switcher.tsx`, `sparkline.tsx`, `sales-chart.tsx`, `top-products.tsx` | `src/components/admin/*` | Check each against existing `states.tsx`; reuse what is already there first |
| `globals.css` brand block | `src/app/admin/(console)/admin.css` | Token mapping per §3; no dark block unless D6 |

Each port is checked by `npm run check`, the browser tests per role, renders at 390/768/1440 and an independent admin design review.

## 6. Slices (replace v1 §8; the coordinator inserts them after acceptance)

| Slice | Scope | Risk | After |
|---|---|---|---|
| **S-U1** slugs | Move admin page routes per §4.2, 308 redirects in `src/proxy.ts`, internal links, tests | R2 | Gate 0; first, alone |
| **S-V1** shell + tokens | Port the sidebar (collapsible, per-role nav §4.1), topbar, page header, tab strip (§4.3 tabs), responsive table, KPI tile; apply §3 tokens; Pengaturan index (§4.5); close the open P2s | R2 | S-U1; alone |
| **S-H1** role home | Antrian Kerja + Money strip per role per §4.4, drilldowns to real screens, tile = drilldown count test | R2 | S-V1, D2 |
| **S-P1** Tambah Produk + editor | One `ProductEditor` for `/produk/baru` and `/produk/[no]` (§2.7 sections), unsaved guard, over `createProductDraft`/`updateProductDraft`; below-margin goes to Persetujuan | R3 | D4, S-U1 |
| **S-A0** Persetujuan | Owner queue for exceptions (margin, MFA reset requests) | R3 | S-V1 |
| **S-N1** command search | Role-scoped search for order, resi and product | R3 | S-V1 |
| **S-A1** Analitik | Sales trend, top offers, COD refused/RTS per courier | R3 | S-H1, D2, D3 |
| **S-C1** Toko Online | Static pages + media | R3 | later |
| **S-O1** owner oversight | `/pantauan` hub + katalog/stok/kendala read-only pages, owner read-only mode on operational screens, self-approval refusal check with S-A0 | R3 | after this run |
| **S-R1** marketing role | Only if D8 = yes | R4 (IAM) | D8 |

## 7. Owner decisions

| # | Question |
|---|---|
| D0 | Commit the current working tree after omp finishes |
| D1 | ~~tokophi as reference~~ — **accepted 2026-10-29**: tokophi seller admin, 99ribu colours, per-role nav (§2–§4) |
| D2 | Admin metric policy (period basis, WIB day boundary, contribution completeness; PRD:449) |
| D3 | Which trends get charts on the owner home and Analitik |
| D4 | Tambah Produk for Admin E-Commerce: yes/no |
| D5 | Manual order entry for WhatsApp/phone sales (draft orders): yes/no |
| D6 | Dark mode for the admin: yes/no (spec 10 says light-only) |
| D7 | The ten admin-wave decisions in `docs/history/STATUS-20261028-handoffs.md` |
| D8 | A separate `marketing` (advertiser) staff role: yes/no |
| D9 | Catalog scope of Admin E-Commerce: per warehouse (today) or company-wide |
| D11 | Narrow the owner's server-side catalog/operations write permissions to match the monitor role (R4 IAM) — later; UI-only in this programme |
| D10 | ~~Admin route slugs~~ — **answered 2026-10-29: Indonesian slugs like tokophi** (§4.2) |

Build order after Gate 0: **S-U1 → S-V1 → S-H1**, then S-P1 / S-A0 / S-N1 in parallel worktrees (disjoint paths), then S-A1, S-C1. S-R1 only on D8.

## 8. Definition of done (programme)

- Per-role nav test (5 roles + multi-role) asserts the exact visible items and their collapsed state.
- No horizontal overflow at 390/768/1440, with tables turning into cards below `md`.
- Each Antrian Kerja tile count equals its drilldown row count (§4.4).
- Every old admin path answers 308 to its new path, and no internal link points to an old one (§4.2).
- No emoji anywhere in the admin; every icon is a Lucide line icon.
- Keyboard + axe pass on the shell, home, one list, one detail and one dialog.
- Independent admin design review PASS, and `design-gate.py` exits 0 on redesigned surfaces.

## 9. Tooling

- Playwright 1.64.1 is ready: bundled Chromium 156 and `/snap/bin/chromium` 156 both verified on 2026-10-29.
- The 99ribu dev server runs at `http://100.127.67.86:3099` (tailnet).
- Storefront `/` takes about 4.5 minutes in dev. It loads products one by one in `listProducts`; this is a separate performance follow-up.

## 10. Execution defaults (owner: "jalankan keseluruhan paralel", 2026-10-29)

The owner ordered the whole programme to run in parallel without further questions. The open decisions take these defaults. Each one can be reversed later in its own slice.

| # | Default applied |
|---|---|
| D0 | Done: omp committed the working tree as `6160726` (pushed). omp was stopped by the owner's order. |
| D2 | Use the existing metric definitions in `src/modules/reporting/dashboard.ts` unchanged; WIB day boundary; every money tile states its basis and completeness |
| D3 | One trend chart on the Super Admin home and Analitik: orders per day by payment method. Analitik adds top offers by units and COD refused/RTS per courier, each with an accessible table |
| D4 | Yes: Tambah Produk for `owner` and `ecommerce_admin` (S-P1) |
| D5 | No manual order entry in this programme |
| D6 | No dark mode; the admin stays light-only (spec 10) |
| D7 | Keep the current behaviour of the ten admin-wave decisions |
| D8 | No `marketing` role; S-R1 is not built |
| D9 | Keep per-warehouse catalog scope for `ecommerce_admin` |
| D10 | Indonesian admin slugs per §4.2 |

Migration numbers are reserved up front so parallel slices do not collide: **0042 = S-A0 Persetujuan**, **0043 = S-C1 Toko Online**. No other slice adds a migration.

Execution: **S-U1 → S-V1** run sequentially and are merged into local `main`. Then **S-H1, S-P1, S-A0, S-N1, S-A1, S-C1** run in parallel worktrees, each with an independent review, and are merged one at a time. Then serial verification (build, integration, browser) and an admin design review. Nothing is pushed until the owner has seen the result.
