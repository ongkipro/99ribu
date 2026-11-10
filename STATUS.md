# Status — Serba 99ribu

Updated: 2026-11-10 16:00Z
Status: Production runs `450c2070` (2026-11-10): money path built, VA only (QRIS off), AutoLaris orders 2 hours (DEC-031), payments still closed.
State: READY
State-Detail: DEPLOYED `450c2070` (migration 0058; gate 708/201/389 executed by ledger RUN-20261110T103132Z-19e40ef0 PASS; Argon R4 APPROVE x2; backup 20261110T111924Z; live: closed checkout with a real cart). Waiting for the owner: open VA per ADR-0008 runbook (Super Admin payment policy; Coolify MONEY_CAPABILITIES=payments + AUTOLARIS_API_KEY + AUTOLARIS_ORDER_ORIGIN_ID=3517100 + AUTOLARIS_ORDER_DESTINATION_ID=3518010 together; one real VA payment by the owner). QRIS needs the QR image (npm setting blocks the dependency). COD production path not built.
Local-Acceptance at `dcd20fa6` + uncommitted helper repair: lint/typecheck exit 0; integration `all-current` PASS at `dcd20fa6` (exit 0, 228 files, 706/0, 2026-11-06 18:59Z; source untouched since, browser test files only, not rerun); `--case=local-providers` PASS 5/5 (12:05Z); browser `all-current` (gate 5, LOCAL worker, load 2.7 at start) FAIL exit 1: 42 files, 200 passed, 1 failed, 1 empty (`support-chat` S44-S45, 12:25Z); `npm test` NOT RUN (gate stopped on the failure; last 331/331 on `4fa50e67`). Evidence `/data/tmp/99ribu/evidence-20261107/`.
Review-Risk: R4 for money/auth/migrations; R0–R2 per DEC-030 "Process tiers".

STATUS holds only now, next and what waits for the owner (DEC-030). History: [`docs/history/STATUS-20261106-pre-slim.md`](docs/history/STATUS-20261106-pre-slim.md) (full state up to 2026-11-06), older archives in `docs/history/`. Evidence: BUILD-LOG; releases: RELEASE.

## Now

- **Production revision.** Verified: on 2026-11-06 a read-only `docker ps` on the production host listed the web and worker containers on image tag `8c3773e17b86…` (created 05:51Z, healthy); images for `39e7adc`, `08c9bfa` and `6f53743` were still present as rollback. Reported only: RELEASE.md and the earlier STATUS say `39e7adc`; RELEASE has no entry for `8c3773e1`, and the BUILD-LOG S179 line "Not deployed" is stale. No public smoke of S179 is recorded, and the live revision has not been re-read since.
- **Unreleased delta from `8c3773e1`.** One runtime change: S180 (default label templates attributed to `system`; `label-templates.ts`, `label-handler.ts`, `label-artifacts.ts`, `print-queue.ts`; R3, GPT-6.1 Sol APPROVE, ledger `RUN-20261106T071110Z-fd914be3`, no migration). The rest is tests (S131/S132, four integration tests aligned with S179, Chromium budget), tooling (`endDatabase` bounded end in `scripts/check-tests.ts`, `runner-shutdown` test) and docs.
- **Gate 4 failures resolved as test-helper races (2026-11-07, tests only, R0–R2, BUILD-LOG top entry).** `storefront-checkout` "unavailable COD…": `calculate()` clicked the order-step button after a slow quote and placed an order (forced 4 s hold reproduces it; control with no click: 0 orders). `floating labels … 1440px`: `note()` toggled the summary closed after hydration opened it (forced sequence reproduces it). Both unmodified files passed alone at low load (38/38). Repaired `calculate()` in storefront-checkout, storefront-floating-labels, local-providers-states and `note()` in the first two; affected files 38/38, local-providers 5/5. Failing log kept: `evidence-20261107/gate4-browser.FAIL.log`.
- **Gate 5 failure resolved as a test race (2026-11-07, tests only).** `support-chat.test.ts:473`: the test pressed "Kirim Pesan" before its harness had the new conversation id, so no message POST was sent (proven with a 1.5 s hold; BUILD-LOG). Fix: wait for the conversation row. `support-chat` alone 1/1; lint/typecheck exit 0. Failing log kept: `evidence-20261107/gate5-browser.FAIL.log`.
- **Campaign history at the final source line (kept).** #1 exit 143, 4 failures (S95/S164/S165/S169, tests behind S179's courier list; fixed in `b70b2d92`). #2 `ok:true` 704/0 but exit 143: the runner hung after its summary (postgres.js `max_lifetime` on the reserved lock connection; fixed in `3177b134`, `runner-shutdown` 2/2). #3 exit 1: `advertising-http` Chromium 30 s limit (the test needs 24–30 s; 90 s budget in `dcd20fa6`) and S85 TOTP drill 180 s limit (63 s alone at low load, so load-related). #4 integration PASS, browser FAIL as above. Earlier results (browser 201/201, providers 5/5 on the pre-S179 source) are history, not evidence for `dcd20fa6`.
- Test DB `99ribu_test` rebuilt 2026-11-10 (was 506 MB; S85 back to 78 s; dump in `/data/backups/99ribu-test-rebuild/`). Reopen the tmpfs test cluster plan (archive, "Test infrastructure") if it passes ~300 MB again or the S85 drill exceeds 180 s when run alone.
- Not checked live: a store voucher (none exists in production yet) and the signed-in guest-order link flow.

## Waiting for the owner

1. **Open VA payments** per the ADR-0008 runbook (2026-11-10): Super Admin payment policy, then the four Coolify variables together and redeploy, then one real VA payment by the owner before buyers are told. QRIS stays off until the QR image dependency is allowed (paste `grep -v -i -E "token|auth|password|_key" .npmrc`).
2. Create the dummy voucher in production (Pemasaran → Voucher → Voucher untuk: Harga produk; Rp1.000, kuota 1, 1 hari). Then the checkout check runs without placing an order and the voucher is switched off.
3. Scope (DEC-030 (4)): which features matter for selling now; the rest is maintained, not extended.
4. External gates: AutoLaris VA live proof (settled `advice` for a `submit` transaction and `payment_info.va`, both only from the owner's first real VA payment); Mengantar booking/tracking contract (S94/S95/S98); Berlapak stock sync agreement (S96); email provider (S124); province exclusion (S170, deferred); production Turnstile keys; switching COD to store-borne in production (the remittance booking is tested); physical printer/scanner (T-37).

## Next (local, no owner input)

1. Heavy turns: Clinic HYG-011 reported acceptance (2026-11-07 18:26 local); Clinic T-027 and Gerai jobs keep priority. Start a 99ribu heavy phase only with both pool slots idle and no Clinic/Gerai job queued (`/data/tmp/99ribu/gate5.sh` waits for that).
2. Rerun browser `all-current`, then `npm test` (`/data/tmp/99ribu/gate5.sh`, waits for an idle pool), stopping on failure. CLINIC HOLD is already removed from `browser-provider-mode.sh` (held copy in the evidence folder).
3. Only after browser `all-current` and `npm test` PASS: commit the helper repair and docs (owner asks), fresh off-host backup, ordinary fast-forward push to `main`, both web and worker on the new image healthy, public smoke at 390/1440 without orders, Cloudflare purge, log observation, then a separate docs commit with the RELEASE entry (include the missing `8c3773e1` entry). Push and deploy need the owner's explicit "deploy".
4. Small follow-ups (BUILD-LOG 2026-10-28 notes): `label-handler.ts` split, R0–R2 unless a step touches money. Done 2026-11-06 locally and unreleased: S131 negatives (pushed to the branch, `400edcde`), S132 superseded rate state (tests), S180 (R3, see above).
- Parked by DEC-030 until needed: S114 refactors (import-cycle ratchet holds the structure), S122(e) admin Lows (one design pass), S125 closed.

## How to work here

- Heavy work only via `npm run build|test:integration|test:browser|test:file` (`scripts/heavy.sh` → `heavy-run --lock 99ribu-env`); one suite at a time; long jobs in the background.
- Browser: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/google-chrome` (`/snap/bin/chromium` is gone). Plain `npm start` for `all-current`; `LOCAL_PROVIDER_ORIGIN=http://127.0.0.1:18790 npm start` for `--case=local-providers`. Helper scripts: `/data/tmp/99ribu/{suite,browser-with-worker,browser-provider-mode}.sh`.
- Deploy (owner says "deploy"): off-host backup `ssh -i ~/.ssh/dotfiles-group root@149.28.129.53 'systemctl start 99ribu-backup.service'` → fast-forward `git push origin HEAD:main` (Coolify builds) → wait for healthy web/worker → Cloudflare purge (`CLOUDFLARE_99RIBU_API_TOKEN` via `secrets-env run`) → live check 390/1440 → RELEASE entry.
- Cross-vendor review (R3/R4): `pi -p --model 9router-fantastico/cx/gpt-6.1-sol` with `@file` arguments and `< /dev/null`; outputs in `/data/tmp/99ribu-reviews/`. High thinking can stall on long packets; then use short low-thinking questions and say so in BUILD-LOG.
