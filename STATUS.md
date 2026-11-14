# Status — Serba 99ribu

Updated: 2026-11-14 02:40Z
Status: Production runs `3ea839a4` (2026-11-14): VA payments open (AutoLaris submit, VA only, 2-hour orders); buyer-pays fee formula B (DEC-032, migration 0059); one company warehouse in Surabaya in the dataset (DEC-033) and a tidier courier list (DEC-034); QRIS off; COD gated.
State: READY
State-Detail: DEPLOYED `3ea839a4` (ledgers RUN-20261112T022334Z-ecbf4ecd and RUN-20261113T074300Z-12931b46 PASS; integration 712/712, browser 201/201; Argon APPROVE). Production data still ships from the old origin warehouses until the owner runs the DEC-033 runbook (rehome -> resolve-warehouses -> import), and the buyer pays the AutoLaris fee only after the owner sets the payment policy.
Review-Risk: R4 for money/auth/migrations; R0–R2 per DEC-030 "Process tiers".

STATUS holds only now, next and what waits for the owner (DEC-030). History: [`docs/history/STATUS-20261114-pre-deploy-3ea839a4.md`](docs/history/STATUS-20261114-pre-deploy-3ea839a4.md) (state before this deploy), older archives in `docs/history/`. Evidence: BUILD-LOG; releases: RELEASE.

## Now

- Live check 2026-11-14 (no order placed): checkout with a real product and a Surabaya address at 390/1440 shows five couriers from Rp8.500 and "Lihat 3 kurir lain", one parcel "Dikirim dari Depok" (the product still sits at its old origin), Virtual Account selectable, 0 page errors.
- Test DB `99ribu_test` has grown again (414 MB, ~36k synthetic users); the S85 drill alone needs ~3–7 min, so its test timeout is 420 s. Rebuild it (README "Rebuilding the local databases") before the next long gate campaign.
- Leftover restore database `99ribu_restore_55255f…` (354 MB) from an interrupted drill in the local cluster; dropping it waits for the owner's go-ahead.

## Waiting for the owner

1. **DEC-033 production runbook** (in RELEASE "Deployed 2026-11-14"): rehome production (dry run, then `--apply`), `mengantar-areas resolve-warehouses production --apply`, `catalog import production`, then the Surabaya warehouse's pickup profile and "Terapkan kalender default" in admin.
2. **Payment policy (DEC-032):** Super Admin → Pembayaran: "Biaya admin dibayar oleh: Pembeli", "Potongan omset AutoLaris (%)": 1.
3. **First real VA payment** (proves `payment_info.va`, the settled advice for submit, and shows the payout shape needed for the production settlement entry, ARCHITECTURE Known differences 7).
4. QRIS image: paste `grep -v -i -E "token|auth|password|_key" .npmrc` so `uqr` can be installed.
5. External gates unchanged: Mengantar booking/tracking contract (S94/S95/S98); Berlapak stock sync (S96); email provider (S124).

## Next (local, no owner input)

1. Admin console polish A1–A4 (Carbon audit `/data/tmp/99ribu-reviews/carbon-admin-report.clean.md`, claims verified against code): A1 shared primitives (PageHeader `<header>`, mobile select 16px, table gradient, skeleton), A2 one job-grouped sidebar (owner gets Pembayaran Masuk and Pengiriman Manual), A3 per-page action fixes, A4 shadcn Tabs/Alert/Empty.
2. Test hygiene: synthetic owned checkout campaign left active by interrupted runs (S65/S67 `source_not_eligible`); `tests/browser/sign-in.test.ts` "staff signs in through /portal" intermittent.
3. Gateway items deferred from the AdsBookCMS comparison (`/data/tmp/99ribu-reviews/carbon-adsbook-report.clean.md`).

## How to work here

- Heavy work only via `npm run build|test:integration|test:browser|test:file` (`scripts/heavy.sh` → `heavy-run --lock 99ribu-env`); one suite at a time; long jobs in the background.
- Browser: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome` (`/snap/bin/chromium` is gone). Plain `npm start` for `all-current`; `LOCAL_PROVIDER_ORIGIN=http://127.0.0.1:18790 npm start` for `--case=local-providers`. Helper scripts: `/data/tmp/99ribu/{suite,browser-with-worker,browser-provider-mode}.sh`.
- Deploy (owner says "deploy"): off-host backup `ssh -i ~/.ssh/dotfiles-group root@149.28.129.53 'systemctl start 99ribu-backup.service'` → fast-forward `git push origin HEAD:main` (Coolify builds) → wait for healthy web/worker → Cloudflare purge (`CLOUDFLARE_99RIBU_API_TOKEN` via `secrets-env run`) → live check 390/1440 → RELEASE entry.
- Cross-vendor review (R3/R4): `pi -p --model 9router-fantastico/cx/gpt-6.1-sol` with `@file` arguments and `< /dev/null`; outputs in `/data/tmp/99ribu-reviews/`. High thinking can stall on long packets; then use short low-thinking questions and say so in BUILD-LOG.
