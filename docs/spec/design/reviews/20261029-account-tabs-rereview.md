# Account tabs re-review (S126 renders, 2026-10-29)

**Verdict: REVISE.** This verdict covers only the five renders listed as inspected below. Six of the nine prior findings are resolved and two are partly resolved. Finding 3 is still open: the "ketentuannya sedang disiapkan" filler line is still on Profil.

## Evidence scope

Files: `.local/test-renders/s126/akun-*`. There are 10 files. Each `akun-*` render was written between 2026-10-29 00:42:01 and 00:42:14 +0700.

**Freshness against source mtimes.** These are the newest account sources:

- `src/app/styles/13-account.css`: 2026-10-28 22:45:19
- `src/components/storefront/buyer-account-client.tsx`: 22:44:56
- `profile-completion.tsx` and `account/orders.tsx`: 22:44:37
- `account/navigation.tsx`: 21:10:47
- `src/app/(storefront)/akun/**`: 21:10:36 or earlier

The latest `.next/BUILD_ID` is 2026-10-29 00:17:13. Every `akun-*` render postdates both the latest account source change and that build, so going by mtimes **none of them is stale**. The mtimes cannot prove which server produced the captures. However, the copy in the renders matches the current source: "Riwayat pesanan", "Promo lewat email", and the `profile-programs` text in `profile-completion.tsx` lines 482–486.

**Inspected (image actually viewed):**

| Render | Page shown |
|---|---|
| `akun-pesanan-1440.png` | Pesanan, empty, desktop |
| `akun-390-touch.png` | Profil, phone, Tanggal lahir disclosure open |
| `akun-pengaturan-1440.png` | Pengaturan, desktop, no promo consent |
| `akun-pengaturan-390-touch.png` | Pengaturan, phone, no promo consent |
| `akun-profile-390-touch.png` | Pengaturan, phone, after the email promo consent was saved (the name says "profile" but the image shows the Pengaturan tab) |

**Not inspected (present, but the image did not display in this session, so no claims are made about it):** `akun-1440.png`, `akun-768.png`, `akun-pengaturan-768.png`, `akun-pesanan-768.png`, `akun-pesanan-390-touch.png`.

**Missing views:**

- Profil at 1440 or 768 (only through the uninspected files above)
- Pesanan on a phone (only through the uninspected file)
- Pesanan with orders, filter chips or claim cards
- Any error, pending or validation state
- Keyboard and focus

Nothing below applies to those views.

## Prior findings 1–9

| # | Prior issue | Status | Evidence |
|---|---|---|---|
| 1 | Policy id "(local-privacy-v1)" shown to buyers | **Resolved** | `akun-profile-390-touch.png`: the hint after consent reads "Disetujui 29 Okt 2026 · access-…@example.invalid." with no policy id. `akun-pengaturan-1440.png` and `akun-pengaturan-390-touch.png`: no id in the Promo block. |
| 2 | Raw full email in Data diri and in the promo checkbox label | **Partly resolved** | The label is now "Promo lewat email" (`akun-pengaturan-1440.png`, `akun-pengaturan-390-touch.png`). The full raw address moved into the hint unmasked and is not cut with an ellipsis, so it still wraps to 2 lines at 390 (`akun-pengaturan-390-touch.png`, `akun-profile-390-touch.png`). Data diri still shows the full address over 2 lines at 390 (`akun-390-touch.png`), while the header shows the masked `a•••@example.invalid`. See N1. |
| 3 | Placeholder copy "ketentuannya sedang disiapkan…" / "Doorprize: segera." | **Unresolved (in part)** | `akun-390-touch.png`, bottom of Data tambahan: "Voucher ulang tahun dan promo kategori: ketentuannya sedang disiapkan dan akan…" is still visible. "Doorprize: segera." is kept on purpose under DEC-017, so it is not counted here. In this capture the dock covers that line, so the doorprize line itself is not visible. |
| 4 | "Belum diisi" badges and native black triangles make Data tambahan busy | **Resolved (markers); improved (badges)** | `akun-390-touch.png`: the summaries use the project chevron icon and no native triangles. "Belum diisi" is now muted inline text after Tanggal lahir, Jenis kelamin and Kategori favorit, not filled badges. The filled-pill badge is still used once, on "Tambah alamat utama" in Alamat (`completion-state-main_address`), so that row does not match the other rows. See N3. |
| 5 | Uneven checkbox rhythm | **Resolved** | `akun-pengaturan-1440.png`: the Promo rows (WhatsApp, email) each keep their hint directly underneath. The Kabar rows are spaced evenly at about 50px. There is no tight-then-loose jump. `akun-pengaturan-390-touch.png` has the same pattern. |
| 6 | Header actions wider than tabs and cards at 1440 | **Resolved** | `akun-pesanan-1440.png` and `akun-pengaturan-1440.png`: Keluar ends at the right edge of the tab hairline and the cards (about x=990). |
| 7 | Save banner above the identity header | **Resolved (allowed alternative)** | `akun-profile-390-touch.png`: "Persetujuan promo disimpan." sits under the tab row and above the Promo & notifikasi card. This is the fallback position the prior fix allowed, not the in-card placement. |
| 8 | Keamanan hint pressed onto the buttons | **Resolved** | `akun-pengaturan-1440.png`, `akun-pengaturan-390-touch.png`: there is a clear gap between "Masukkan kata sandi untuk keluar dari perangkat lain." and the action buttons. At 390 the buttons stack. |
| 9 | Card heading "Pesanan saya" repeats the tab name | **Resolved** | `akun-pesanan-1440.png`: the heading reads "Riwayat pesanan". |

## New findings

| # | Render | Issue | Sev |
|---|---|---|---|
| N1 | `akun-pengaturan-390-touch.png`, `akun-profile-390-touch.png`, `akun-pengaturan-1440.png` | The promo email hint ("Belum disetujui · access-…@example.invalid." / "Disetujui 29 Okt 2026 · access-…") shows the full raw address. It wraps 2 lines on phone and is the longest line in the Promo block. Prior fix 2 asked for one line cut with an ellipsis, or the masked address the header already uses. | P2 |
| N2 | `akun-390-touch.png` | Finding 3 is still open: the "ketentuannya sedang disiapkan dan akan diumumkan di sini" line is filler that DEC-017 does not cover. DEC-017 only allows the doorprize "segera" line. | P2 |
| N3 | `akun-390-touch.png` | In Alamat, the "Belum diisi" state is a filled pill badge next to "Tambah alamat utama", while the three Data tambahan rows use muted inline text. The same state is drawn two ways on one page. | P3 |
| N4 | `akun-pengaturan-1440.png`, `akun-pengaturan-390-touch.png` | Keamanan: the "Kata sandi akun" label sits almost on top of the input border (a few px). The Promo and Kabar groups have more breathing room. A 4–6px label gap would match the rest of the card. | P3 |

## What passes (inspected renders only)
- Inter type, purple primary ("Lihat produk", checkboxes, active-tab underline, centre dock button) and functional line icons, with no emoji, in all five inspected renders.
- Phone tab row: the three tabs share the width with no scroll (`akun-390-touch.png`, `akun-pengaturan-390-touch.png`).
- Empty Pesanan: one line plus one primary action (`akun-pesanan-1440.png`).
- Copy is short and contains no AI filler, apart from N2.
- The dock overlapping content in full-page phone captures comes from capturing a fixed element, not from the layout (unchanged from the prior review).

## To reach PASS
1. Fix N1 and N2, and optionally N3 and N4.
2. Re-render the views listed above as not inspected or missing, especially Profil at 1440, so a reviewer can view them.
