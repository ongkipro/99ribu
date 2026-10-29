# Design re-review after fixes (2026-10-28)

The source edits were made between 19:25 and 19:49. All the renders I used were captured between 19:53 and 20:09, after those edits. s141 has no new renders; its latest set is from 19:18.

| Item | Result | Evidence |
|---|---|---|
| s110 banner preview body text contrast (P1) | VERIFIED | `s110/banners-owner-1440.png`: "Setiap pilihan lengkap Rp99.000." is grey and readable |
| Checkout region select chevron | VERIFIED (no new s141 render; the s126 render shows it) | `s126/checkout-prefill-1440.png`: "Wilayah pengiriman" shows a chevron |
| s126 akun heading spacing | VERIFIED | `s126/akun-1440.png`: Alamat, Profil and Keamanan each have about 16px above their content |
| s131 "WIB WIB" | VERIFIED | `s131/finance-summary-1280.png`: "07.00 WIB s/d 25 Okt 2026, 07.00 WIB" |
| s131 renders at 1024/768/390 | PRESENT, 390 checked | `s131/finance-summary-390.png` stacks into cards with no clipping. The period tabs scroll sideways ("90 hari terakh…" is cut at the edge). 1024 and 768 exist but I did not open them |
| s133 uncertain refund tone | VERIFIED | `s133/detail-unknown-1280.png`: amber alert and badge with a warning icon. The next-action copy now points to the refund card |
| s135 date range error | MOSTLY VERIFIED | `s135/audit-owner-1440.png`: labels and borders are red, "Terapkan" is disabled and no empty state shows. The message text under the field is still grey (P3) |
| s136 tile tones | VERIFIED | `s136/system-health-owner-1440.png`: Kunci habis and Hasil belum pasti are amber; Gagal and Percobaan habis are red. The "Selesai" definition now says something useful |
| s137 dialog title at 390 | VERIFIED | `s137/staff-dialog-390.png`: the title wraps to 2 lines and stays clear of the × |
| s138 "Pesanan" count | VERIFIED | `s138/customers-cs-1440.png`: the heading reads "Pesanan" with no number |
| s128 nav labels | VERIFIED | `s128/nav-owner-1440.png` shows "Daftar Gudang"; `nav-finance-1440.png` shows "Pembayaran Masuk" and "Pengembalian Dana" |
| s132 search row | VERIFIED | `s132/affiliates-list-1440.png`: input and "Cari kode" sit inline on the tabs row |
| Status tones (status.tsx) | PARTIAL | `s131/payout-detail-1280.png`: "Selesai" now has a check icon but is still purple, not green. "Belum lengkap" (amber) and "Lengkap" (green) are correct |
| HPP stale success message (cost-versions) | NOT FULLY TESTABLE | `s134/stock-items-hpp-768.png` shows no stale message, but the fixture has only version 1, so the case where version 2 is in effect is not rendered |
| Sidebar mid-width transition | STILL WRONG (P2) | `s130/settings-commercial-1440.png`: the sidebar is about 150px wide with labels cut off ("Admin E-C…", "Synt…"). `s130/settings-support-1440.png`: the sidebar is a 64px rail, but the group labels ("Operasi", "Katalog & Stok") and the full "Konsol Operasional" brand text spill out of it |

## New or remaining P2 seen in these renders

1. **Sidebar width at 1440 (P2, still present).** See the last row of the table. Either the sidebar transition fix did not take effect, or the screenshot is taken before the sidebar settles. In the collapsed rail, the group labels and brand text are not hidden. Look at `src/components/ui/sidebar.tsx` and the shell's `group-data-[collapsible=icon]` hiding. Then capture again after `transitionend`.
2. **Affiliates table at 1440 (P2, newly visible).** The earlier render was a skeleton, so this could not be seen before. In `s132/affiliates-list-1440.png`, partner names wrap to 3 lines ("Mitra / Viewport / 50299CCC"). A cut-off column shows only "D" just left of the pinned "Buka" column. This is the same sticky-column overflow as cross-cutting item 2 of the first admin review (`data-table.tsx`).
3. **System health table still clipped (P2, not targeted).** `s136/system-health-owner-1440.png` shows "Jatuh tempo te…" and "27 Okt 2026, 08.1…".

I saw no P1 regressions. These issues were not targeted and are unchanged (P3): the account footer still shows a raw `access-…` ID; s138 still shows the email field in uppercase; the audit date inputs still show `mm/dd/yyyy`; "tereconcile" still appears in the s131 header.
