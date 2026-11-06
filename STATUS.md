# Status — Serba 99ribu

Updated: 2026-11-06
Status: Production runs `39e7adc` (deployed 2026-11-06, RELEASE top entry). Local branch `dec-025-min-contribution` is pushed; after `39e7adc` it carries tests, tooling and docs only.
State: BLOCKED
Local-Acceptance: integration `all-current` PASS (225 files, 2026-11-06); browser `all-current` 201/201 with the LOCAL worker; `--case=local-providers` 5/5 (provider-mode server); `npm test` 328/328.
Review-Risk: R4 for money/auth/migrations; R0–R2 per DEC-030 "Process tiers".

STATUS holds only now, next and what waits for the owner (DEC-030). History: [`docs/history/STATUS-20261106-pre-slim.md`](docs/history/STATUS-20261106-pre-slim.md) (full state up to 2026-11-06), older archives in `docs/history/`. Evidence: BUILD-LOG; releases: RELEASE.

## Now

- Production: `39e7adc` (S120 enumeration-safe guest-order link; vouchers S177 2A/2B; Shopify-style checkout). Backup `20261106T034606Z`. Rollback image `20261105T163729`.
- Not checked live: a store voucher (none exists in production yet) and the signed-in guest-order link flow.
- Test DB `99ribu_test` 120 MB (fresh 21 MB on 2026-11-06, `synchronous_commit=off`). Reopen the tmpfs test cluster plan (archive, "Test infrastructure") if it passes ~300 MB or the S85 drill exceeds 180 s again.

## Waiting for the owner

1. Create the dummy voucher in production (Pemasaran → Voucher → Voucher untuk: Harga produk; Rp1.000, kuota 1, 1 hari). Then the checkout check runs without placing an order and the voucher is switched off.
2. Scope (DEC-030 (4)): which features matter for selling now; the rest is maintained, not extended.
3. External gates, unchanged: AutoLaris live (S97: API key, egress IP, settled advice shape); Mengantar booking/tracking contract (S94/S95/S98); Berlapak stock sync agreement (S96); email provider (S124); province exclusion (S170, deferred); production Turnstile keys; switching COD to store-borne in production (the remittance booking is tested); physical printer/scanner (T-37).

## Next (local, no owner input)

- Small follow-ups S130/S131/S132 (BUILD-LOG 2026-10-28 notes), `label-handler.ts` split — R0–R2 unless a step touches money.
- Parked by DEC-030 until needed: S114 refactors (import-cycle ratchet holds the structure), S122(e) admin Lows (one design pass), S125 closed.

## How to work here

- Heavy work only via `npm run build|test:integration|test:browser|test:file` (`scripts/heavy.sh` → `heavy-run --lock 99ribu-env`); one suite at a time; long jobs in the background.
- Browser: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome` (`/snap/bin/chromium` is gone). Plain `npm start` for `all-current`; `LOCAL_PROVIDER_ORIGIN=http://127.0.0.1:18790 npm start` for `--case=local-providers`. Helper scripts: `/data/tmp/99ribu/{suite,browser-with-worker,browser-provider-mode}.sh`.
- Deploy (owner says "deploy"): off-host backup `ssh -i ~/.ssh/dotfiles-group root@149.28.129.53 'systemctl start 99ribu-backup.service'` → fast-forward `git push origin HEAD:main` (Coolify builds) → wait for healthy web/worker → Cloudflare purge (`CLOUDFLARE_99RIBU_API_TOKEN` via `secrets-env run`) → live check 390/1440 → RELEASE entry.
- Cross-vendor review (R3/R4): `pi -p --model 9router-fantastico/cx/gpt-6.1-sol` with `@file` arguments and `< /dev/null`; outputs in `/data/tmp/99ribu-reviews/`. High thinking can stall on long packets; then use short low-thinking questions and say so in BUILD-LOG.
