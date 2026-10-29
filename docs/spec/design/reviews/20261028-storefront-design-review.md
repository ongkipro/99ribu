# 99ribu storefront visual review (2026-10-28)

Read-only review of existing PNGs. No server, DB or repo edits.

| Surface | Verdict | P1 | P2 | P3 | Notes |
|---|---|---|---|---|---|
| s126 `/akun` | REVISE | 0 | 4 | 3 | Only the signed-in, zero-order state was rendered. The signed-out view, order cards, WIB dates, status badges and thumbnails are not in the renders. |
| s141 checkout floating labels | REVISE | 0 | 1 | 2 | Rest, filled, focus and 320px/200% text all work. No error or autofill render exists among the 154 files. |
| s110 banners | REVISE | 1 | 2 | 1 | All 4 renders are the admin banner manager and its preview, not the storefront home. Renders are from 15:42. |

## s126 `/akun`

1. **P2, copy (internal leak).** `akun-1440.png` and `akun-768.png`: the Promo text shows "Kebijakan privasi (local-privacy-v1)". Profil shows "Doorprize: segera." and "ketentuannya sedang disiapkan dan akan diumumkan di sini". These are a version ID and placeholder copy. Fix: show the policy as a link without the version string (`LOCAL_PRIVACY_POLICY_VERSION`, `src/modules/consent/choices.ts`), and remove the voucher/doorprize note until terms exist (`profile-completion.tsx:485`).
2. **P2, repeated options.** `akun-profile-390-touch.png` (18:57, older than the others): "Kategori favorit" lists about 20 checkboxes all labelled "Busana". The user cannot tell them apart. Fix: dedupe by category name or show the parent path in `profile-completion.tsx`. Also check whether this comes from fixture data.
3. **P2, privacy inconsistency.** All 3 `akun-*` renders: the identity header masks the email (`a•••@example.invalid`), but Profil and the Promo checkbox print it in full. Fix: use the same masked form in the checkbox label (`buyer-account-client.tsx`) and keep the full value only in the editable field.
4. **P2, spacing rhythm.** `akun-1440.png`: card headings are spaced unevenly. "Pesanan saya" has about 12px under it, "Alamat" and "Keamanan" sit almost on top of their next line (Keamanan → "Kata sandi akun" is about 0px), and Profil → "Nama" is tight. Fix: one heading→content gap token (8–12px) on the account card `h2` in `globals.css` (account card block).
5. **P3, rail alignment.** `akun-1440.png`, `akun-768.png`: the section rail sits about 300px below the first card. This is probably the sticky offset frozen into the full-page capture. Confirm in a viewport-only capture that the rail lines up with the top of "Pesanan saya".
6. **P3, chip overflow cue.** `akun-390-touch.png`: the sticky chips cut off after "Promo & notifikasi", and "Keamanan" is hidden with no fade. Chip height is about 44px (fine). Fix: reuse the filter rail's edge fade on the account chip row.
7. **P3, truncation and format.** `akun-profile-390-touch.png`: the "Wilayah pengiriman" select clips to "Jawa Tin" with no ellipsis (add `text-overflow: ellipsis`). The address summary shows `+62812…` while the field shows `0812…`; pick one display format (`src/modules/storefront/format.ts`).

## s141 checkout floating labels

Reviewed the `AxZ92kov6Mvq017VWxMsS` set (newest, 19:18): rest, filled, summary at 390/768/1440, and filled 200%/320.

- What works: at rest the label sits inside the field. With a value it shrinks to the top without overlapping the value. Focus shows an ink edge and soft ring with no shift (`labels-*-390.png`, Catatan). At 320px with 200% text the labels fall back to sitting above the field, with no clipping (`labels-filled-text-200-320.png`).

1. **P2, missing select chevron.** `labels-rest-768.png`, `labels-filled-1440.png`: "Wilayah pengiriman" is a `<select>` (`checkout-field-select`, `checkout-forms.tsx:194`) but renders with no chevron, so it looks like a text input. Root cause: `.checkout-field :is(input, select, textarea) { background: #fff; }` (`globals.css` ~line 1823) uses the shorthand and wipes the `background-image` chevron set at ~line 3997. Fix: change it to `background-color: #fff`.
2. **P3, field naming.** `labels-rest-390.png`: "Cari wilayah (opsional)", the "Cari wilayah" button and "Wilayah pengiriman" read as three versions of the same field. In the filled state the hint repeats the chosen region on a second line. Fix: rename the search field to something like "Ketik kecamatan/kota", and drop the duplicate region line or merge it into the hint.
3. **P3, copy and spacing.** All `labels-*`: the payment options read "Pembayaran simulasi" and "simulasi AutoLaris", which names the provider and states that it is a simulation. This is acceptable for localhost but must change before any live use (`checkout-forms.tsx:197`, `payments/methods.ts`). "Draf tersimpan." sits about 4px under the 48px button; use 8px.

**Not visible in renders:** the error state (`--error` label, edge, message below), `:autofill`, an empty textarea after shrink, the receipt order-link fields. Add `labels-error-*` and an autofill render before closing S141.

## s110 banners (admin manager and preview)

1. **P1, contrast.** `banners-owner-1440.png`, `banners-owner-768.png`, `banners-editor-1440.png`: the preview card body text ("Setiap pilihan lengkap Rp99.000.") is nearly white on white, so it is unreadable. Likely root cause: the body colour rule is scoped to `.home-main .home-banners .banner-caption > span` (`globals.css:6015`), and the admin preview (`banners-client.tsx:354`) has no `.home-main` ancestor. Fix: drop `.home-main` from that selector, or give the preview that wrapper. Also confirm the live home page is unaffected; it has no render here.
2. **P2, broken images.** `banners-owner-390.png`: the thumbnails are broken-image icons. `banners-owner-768.png`: the preview shows alt text ("Foto Paket campuran"). `banners-owner-1440.png`: empty photo areas. `banners-owner-390.png` also shows the "Pratinjau beranda" card as a large blank box. This could be the render environment (missing optimizer or images); re-render with working media before judging the photo-led 410×520 rail.
3. **P2, column clipping.** `banners-owner-768.png`: the sticky actions column covers Status ("Tay…", "Ter…"), and Jadwal and Perubahan are hidden. Fix: at 768, collapse the actions into a menu or switch to the 390 card layout. This is an admin table, so follow the `admin-dashboard` responsive table pattern.
4. **P3, truncation.** `banners-owner-1440.png`: "Perubahan terakhir" ends in "13.42 WIB ·" and the author is cut off. Wrap to two lines as the 390 card does.

## design-gate.py

`--help` only (not run). Usage: `design-gate.py PROJECT [--design FILE] [--review FILE] [--src DIR]`. It checks evidence files and does not take a URL. It requires at least one cited reference capture, narrow and wide screenshots at least as new as the source, a `review.md` produced by `visual-review.py` through a separate `ai-ask` call with `Verdict: PASS`, and advisory source-level style counters. Exit codes: 0 pass, 1 fail, 2 not applicable. It does not judge appearance from PNGs.
