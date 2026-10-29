# Admin console visual review: S128 to S138

Renders live in `.local/test-renders/sNNN/`. I opened 36 PNGs. Fixture text such as "Synthetic", "S131" and English reasons is test data, and I did not count it as a defect.

| Slice | Verdict | Worst | Main issue |
|---|---|---|---|
| s128 nav/account menu | REVISE | P2 | Two nav items named "Gudang"; account footer shows a raw access ID |
| s129 account/security | PASS | P3 | Minor heading and dialog hierarchy |
| s130 settings | REVISE | P2 | Sidebar caught mid-width; label-template table clipped at 768; commercial 390 shows only a skeleton |
| s131 finance | REVISE | P2 | "WIB WIB"; reconciliation table clipped at 1280; desktop-only renders |
| s132 affiliates | REVISE | P2 | Search field and button misaligned; 768 table clips dates; list-1440 is a skeleton |
| s133 exceptions | REVISE | P2 | Success icon shown for an uncertain refund; 390 dialog render is translucent |
| s134 stock/categories/warehouses | REVISE | P2 | HPP dialog shows a stale success message and a clipped column; 390 sheet is translucent |
| s135 audit log | REVISE | P2 | Date-range error looks like a hint, and the empty state shows beside it; dates show as mm/dd/yyyy |
| s136 system health | REVISE | P2 | "Hasil belum pasti" looks the same as "Gagal"; table clipped at 1440 |
| s137 staff & roles | REVISE | P2 | "Sesi terakhir" clipped; Super Admin badge uses a clock icon; 390 dialog title runs under × |
| s138 customers | REVISE | P2 | "Pesanan (0)" when the role has no access |

## Cross-cutting

1. **Sidebar shown at an in-between width (P2).** `s130/settings-support-1440.png`, `settings-commercial-1440.png`, `s134/warehouse-detail-768.png` and `s132/affiliates-list-768.png` show the sidebar at about 100–220px. Labels are cut off ("Sup…", "Ad…"), "Ruang Kerja" is clipped under the header and the footer shows "S…". The other renders show the full 256px sidebar. Either the sidebar animates its width after hydration (`transition-[width]` in `src/components/ui/sidebar.tsx:227`, with the state probably restored late), which users would see as a layout shift, or the screenshots were taken mid-transition. Fix: read the sidebar state on the server so first paint already has the final width, or wait for `transitionend` before capturing. Then capture again.
2. **Sticky action column hides data (P2).** `s131/reconciliation-list-1280.png` ("Waktu" shows as "W", "25"), `s137/staff-list-1440.png` ("Sesi terak", "28 Okt 20"), `s130/settings-label-templates-768.png` ("Privasi telep") and `s136/system-health-owner-1440.png` ("Jatuh tempo te…"). The table overflows even at desktop widths, and the pinned right column covers the data. Fix in `src/components/admin/data-table.tsx:219-230`: make the stacked layout kick in at a wider breakpoint, or drop low-priority columns before pinning. Wide dates should use `whitespace-nowrap` with a minimum width.
3. **Badges look the same for different states (P2).** "Menunggu" and "Diproses" (`s128/nav-owner-1440.png`) both use purple with a clock. So do "Selesai" (`s131/payout-detail-1280.png`), "Menunggu pencocokan" and "Super Admin" (`s137`). Fix in `src/components/admin/status.tsx:16`: keep the clock for pending only. Give in-progress, done (green check) and roles (neutral, no icon) their own tones.
4. **Loading or animating renders used as evidence (P2).** These were captured before data loaded: `s130/settings-commercial-390.png`, `s132/affiliates-list-1440.png` and the pickup profile block in `s134/warehouse-detail-768.png`. These were captured during the open animation, so the content behind shows through: `s133/detail-390.png` and `s134/stock-items-hpp-390.png`. `DialogContent` uses an opaque `bg-popover`, so this is probably capture timing, not a CSS bug. Capture again after the network is idle and the animation has finished.
5. **Card headings (P3).** Card `h2`s render tighter and in a different weight from body text, and dialog titles are body-sized (`s129/account-backup-codes-1440.png`). Check the heading class in `page-blocks.tsx`. Make dialog titles at least `text-base font-semibold`.

## Per slice

- **s128.** "Gudang" appears under both Ruang Kerja and Katalog & Stok (`nav-owner-1440.png`), P2. Rename the catalog item to "Daftar Gudang". The account footer shows `access-0421e…`, which is meaningless to an operator, P3. Show the email instead.
- **s129.** Passes. The backup-code dialog has no copy or download action, P3. Codes render in the browser's default Courier, not a designed mono font, P3.
- **s130.** "(append-only)" is English in Indonesian copy (`settings-payment-1440.png`), P3. Use "tidak dapat diubah". Every page repeats a stray small "Waktu dalam WIB" line, P3. Header descriptions run 3–4 lines, P3.
- **s131.** `finance-summary-1280.png`: the period line reads "07.00 WIB WIB", P2. In `finance-summary-client.tsx:263`, `formatWib` already adds "WIB", so remove the literal. "Belum lengkap" appears three times per row (badge, value, source), P3. "tereconcile" is mixed English, P3. Use "terekonsiliasi". The two KPI cards sit inside another card frame, P3. The sidebar files Afiliasi and Pembayaran Komisi under "Pemasaran" in `payout-detail` but under "Keuangan" in `reconciliation-list`, P2 for IA. All renders are 1280 only, so **phone and tablet coverage is missing**.
- **s132.** At 1440 the "Kode rujukan" input floats top-right and its "Cari kode" button sits on a separate row, P2. Put the input and button inline on the same row as the tabs. At 768, names wrap to three lines and dates are cut off ("10.46 WI"), P2.
- **s133.** `detail-unknown-1280.png`: a check-circle alert announces "Status refund: Hasil belum pasti", P2. Use the warning tone. The page shows a "Rekonsiliasi" button while "Tindakan berikutnya" says there is no action for this role, P2. "direfund" is mixed language, P3.
- **s134.** The HPP dialog reports "Versi biaya 1 … tersimpan" while version 2 is in effect, P2. The "Alasan" column is clipped ("Versi tersela"). Calendar holidays show as ISO `2026-12-25` instead of "25 Des 2026", P3. On categories at 390, the attribute row is aligned differently from the other rows and there is a large gap under the name, P3.
- **s135.** On `audit-owner-1440.png` the invalid-range error is grey hint text, "Terapkan" stays enabled and the empty state shows at the same time, P2. Use the destructive colour with `aria-invalid`, and hide results while the filter is invalid. Native date inputs show `mm/dd/yyyy`, P2. Set `lang="id"` or confirm the test browser locale.
- **s136.** All four problem tiles use the same amber style, so "Hasil belum pasti" (uncertain) looks the same as "Gagal" (failed), P2. Use red for failed or exhausted, amber for uncertain or locked. The left-border stripe tiles (`system-health-client.tsx:61`, `kpi-card.tsx:59`) are decorative, P3. The definition "Selesai: Selesai." says nothing, P3. At 390 there are 8 tiles in one column, P3. Use a 2-column grid.
- **s137.** On `staff-dialog-390.png` the long title runs under the × button, P2. Add `pr-8` and `break-words` to the title. Each row in the action column has two stacked buttons, which makes rows tall, P3.
- **s138.** "Pesanan (0)" next to "Peran Anda belum memegang akses" reads as if the buyer has zero orders, P2. Drop the count when the role has no access. Ticket rows lead with a raw UUID that is not a link, P3. The email field shows the value in uppercase (`customers-cs-1440.png`), P3.

I saw no emoji. Icons are consistently Lucide line icons. Money uses `Rp` with dot thousands separators, and Rp columns are right-aligned. I could not check focus rings, contrast ratios or target sizes from these renders. They need a keyboard and axe pass.
