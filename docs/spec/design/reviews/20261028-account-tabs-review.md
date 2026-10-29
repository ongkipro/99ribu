# Account tabs review (S126 renders, 2026-10-28)

**Verdict: REVISE.** The structure works: identity header, one underlined tab row and short card pages read as Shopify-like, and Pesanan is clean. What still makes it noisy is copy and repetition inside Profil and Pengaturan, plus one width mismatch on desktop.

| # | Render | Issue | Sev |
|---|---|---|---|
| 1 | akun-pengaturan-*, akun-profile-390-touch | Internal policy id "(local-privacy-v1)" shown to buyers, twice after consent | P1 |
| 2 | akun-*, akun-pengaturan-* | Raw full email repeated in Data diri and in the promo checkbox label; wraps 3 lines on phone | P2 |
| 3 | akun-* (Profil) | Placeholder copy "ketentuannya sedang disiapkan…" / "Doorprize: segera." | P2 |
| 4 | akun-* (Profil) | Four "Belum diisi" badges and native black triangles make Data tambahan feel busy | P2 |
| 5 | akun-pengaturan-* | Uneven checkbox rhythm: Promo rows are tight with hints between them, Kabar rows ~56px apart | P2 |
| 6 | akun-*-1440, akun-pengaturan-768 | Header actions span the full page while tabs and cards stop at 56rem, so the right edges do not line up | P2 |
| 7 | akun-profile-390-touch | The save banner shows above the identity header, far from the checkbox the buyer just ticked | P2 |
| 8 | akun-pengaturan-768/390 | Keamanan: hint sits right on top of the buttons, so the field, hint and buttons have no spacing | P3 |
| 9 | akun-pesanan-* | Card heading "Pesanan saya" repeats the current tab "Pesanan" | P3 |

## What passes
- **Hierarchy:** the 56px avatar and the heading-size name sit above a hairline tab row, with cards under it. The levels are clear and nothing feels stacked on Pesanan.
- **Tabs:** they use `aria-current`, an ink 600 label and a 2px purple underline, while inactive tabs are muted. On phones the three tabs share the width (`flex: 1 1 0`) and fit at 390px without scrolling. Targets are at least 44px.
- **Read-only Data diri:** it is a label/value list with one "Ubah" pill. Values stack on phones and form a two-column list from 701px. This is good.
- **Empty orders:** one line plus "Lihat produk". It is short and correct. Filter chips are hidden when there are no orders, which is right. Populated order cards are not visible in these renders.
- **Card widths:** all cards on a page share one width.
- **Not a real issue:** the dock overlapping content mid-page in full-page captures comes from capturing a fixed element, not from the layout.

## Fixes
1. **Policy id.** In `profile-completion.tsx` around line 763, drop `({consents.policy_version})`. Around line 784, change to `Disetujui ${date(...)}.`. Keep the version only in "Riwayat persetujuan" (around line 804), or remove it there too.
2. **Raw email.** Change the label to "Promo lewat email" and put the address in the hint below it, cut with an ellipsis (`text-overflow: ellipsis` on a `.account-meta` line). In `.account-facts dd`, keep `overflow-wrap: anywhere` but show the masked address the header already computes (`maskedContact`, `buyer-account-client.tsx` around line 357), or accept that a real email is short.
3. **Placeholder copy.** Delete the `profile-programs` block (`profile-completion.tsx` around lines 479–486) until the terms exist. AGENTS.md bans filler.
4. **Data tambahan noise.** Show the badge only when a field is filled ("Terisi"), or drop the badges and let the summary say "Tanggal lahir · belum diisi" in `--muted`. Replace the native markers with the project chevron icon: `.account-section summary { list-style: none }` plus `::-webkit-details-marker { display: none }`, as `.account-guest-summary` already does at line 361.
5. **Checkbox rhythm.** Give all consent rows one `min-height: 44px` and an 8px gap, and keep each hint directly under its own row with a 4px top margin (`:where(.account-promo)`, line 145).
6. **Header width.** Add `max-width: 56rem` to `.account-header` (line 15) so Belanja and Keluar end at the card edge.
7. **Save banner.** Show the `account-status` output inside the card that changed, or at least under `.account-navigation` (`buyer-account-client.tsx` around line 365).
8. **Keamanan spacing.** Put an 8px margin under the hint and a 12px gap before the action row. The two buttons can stay side by side from 701px.
9. **Card heading.** Make `#account-orders-title` `sr-only` on Pesanan (`account/orders.tsx` line 76), or rename it "Riwayat pesanan". The tab already names the page.

## Optional (not required)
- On phones the header has about 48px to the tabs and the Belanja/Keluar pills form their own row. Consider moving "Keluar" into Pengaturan, the way Shopify keeps sign-out in the menu, so the header is just the identity.
