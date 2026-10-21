# Release — Serba 99ribu

Adopted at repository root on 2026-10-16; updated 2026-10-21 upon completion of all 68 local slices (`S01`–`S68`) and assembled localhost readiness (`T-39`). External live-provider, physical hardware, and production deployment gates remain separate per `CTX-18`.

Release-ID: LOCAL-20261021-S68
Base: 02da9f9
Environment: local
Declared-Risk: R3
Rollback-Ref: 02da9f9
Rollback-Command: pg_restore --clean --if-exists --no-owner --no-privileges -d <disposable_restore_db> <backup_artifact.dump>
Backup-Proof: PASS (S67 isolated pg_dump/pg_restore rehearsal into disposable database 99ribu_restore_<uuid>; 204 tables, stock/money/commission/job/access invariants and fresh-XID finance_tx_open_guard immutability verified)
Status: LOCAL_ACCEPTED
Local-Acceptance: PASS (S01-S68, T-39 localhost-readiness integration 2/2 PASS, browser 1/1 PASS)
Target: localhost production-mode application with synthetic data and simulated external effects

## Local acceptance boundary

Deliver all approved domains through real application/auth/PostgreSQL/worker code, with the S01–S68 slice acceptance and assembled regression in sole `TASKS.md`. Built production-mode web (`NODE_ENV=production`, `APP_ENV=local`) and worker startup, scoped access, financial/stock invariants, restart recovery, synthetic backup/restore, and rendered responsive journeys across `390x844`, `768x1024`, and `1440x900` are verified PASS.

## Recovery and evidence

- Rollback reference/command: `git checkout 02da9f9` for source; `pg_dump -Fc` / `pg_restore` into a separate disposable database target (`99ribu_restore_<uuid>`) as exercised in `tests/integration/localhost-readiness.test.ts`.
- Synthetic backup and restore proof: PASS (`npm run test:integration -- --case=localhost-readiness` `2/2` PASS; verified row parity across orders, receipts, finance transactions/postings, commissions, payouts, support conversations, and label artifacts, plus post-restore `finance_tx_open_guard` enforcement rejecting historical ledger mutation on a fresh transaction ID).
- OpenAPI and test runner contract: PASS (`python3 docs/spec/scripts/check-openapi-contract.py` -> 173 paths, 207 operations, 6,842 checks PASS; `npm run test:runner-contract` -> 46/46 PASS; `python3 ~/.gemini/config/skills/design-taste/scripts/design-gate.py` -> exit 0).
- Local production-mode build/start and health evidence: PASS (`npm run build`, `npm run health -- ready` -> HTTP 200 `{ "service": "99ribu", "status": "ready" }`, and `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=localhost-readiness` -> `1/1` PASS).

Do not run destructive restore against a working database; always rehearse into a separate disposable target.

## External release gates

Local completion does not authorize provision/deploy/DNS, live provider calls, credentials, real payments/shipments/messages, campaign spend, commit or push. Issued contracts, actual account consent/configuration, physical printer/scanner/carrier approval, remote backup/monitoring and explicit deployment authorization remain separate gates. Use production-gate/release-check only when their repository prerequisites and target are actually configured; never mark DEPLOYED from a localhost test.
