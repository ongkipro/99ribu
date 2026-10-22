# Observability — Serba 99ribu

Adopted at repository root on 2026-10-16; updated 2026-10-21 with all local operational reliability probes (`S63`), public mutation abuse limits (`G6`), and assembled localhost readiness/restore checks (`S65`–`S68`) implemented and verified. External remote monitoring and production alerting remain separate per `CTX-18`. Historical S29–S33 checkpoint narrative is archived in [`docs/history/S32-S33-CHECKPOINTS-20261021-pre-audit.md`](docs/history/S32-S33-CHECKPOINTS-20261021-pre-audit.md).

## Executable foundation readiness

Probe: local-foundation-ready|http://127.0.0.1:3099/api/health|200|ready|5000

Owner: application engineering, operated from this worktree. Run `npm run health -- ready` against `npm start` after migrations. Expected: HTTP 200, `no-store`, `{ "service": "99ribu", "status": "ready" }`. This proves the built web process can query the identity/outbox schema with its restricted local database role; no private records are read or returned.

If unavailable: use `npm run db:status`, restore this worktree's preserved database with `npm run db:up`, apply reviewed missing migrations with `npm run db:migrate -- local`, and repeat the probe. Do not delete/reseed data as recovery. Wrong server/build/profile failures require correcting the recorded launcher/configuration before retry. Only during an owned outage drill, stop this database with `npm run db:stop` and assert `npm run health -- unavailable` returns 503; always restart it afterward.

`npm run test:integration -- --case=foundation` fails preflight when the required test database is absent. The browser registry in README fails on missing built web/browser/database. Unknown selectors, skipped/TODO checks and empty files cannot produce acceptance PASS. Aggregate output contains bounded test names/counts; request headers and private fixture values are not reflected in the health envelope.

The worker's `worker_ready target=local dispatch=simulated` startup line follows a successful outbox query. Worker failure/restart behavior, leases, bounded retry, and hold expiry reconciliation are verified by `npm run test:worker` and `npm run test:integration -- --case=PR-16`.

## Evidence and release scope

Keep structured executed probe results in `.delivery/` and the current summary in root `STATUS.md`. Local simulated-adapter delivery is not vendor acceptance or live attribution. Remote uptime, production numerical alerts, off-host restore and real carrier scanning require their own configured environment and evidence. Preserve event occurrence versus ingestion time and correlation IDs. Logs and diagnostics exclude credentials, raw matching identifiers, contact/address PII, support message bodies and private label/bank evidence.

## S63 operational reliability probes, rate limits, and S65–S68 assembled readiness verification

`src/jobs/probes.ts`, `src/modules/access/rate-limit.ts`, and `/api/v1/admin/operations/probes` implement the local operational reliability, abuse-control, and recovery probes required by `S63` (`T-16` / `PR-16` / `PR-18`):

- `inspectWorkerHealth`: reports outbox queue depth (`pendingCount`, `processingCount`, `failedCount`, `deadLetterCount`), oldest pending age in seconds, active expired leases, and failed expiry holds whose inventory or promotion reservations remain active.
- `reconcileFailedExpiryHolds`: identifies failed `inventory.reservation.expire` and `promotion.reservation.expire` outbox jobs whose underlying reservation is still `active` and safely rearms them to `pending` so the worker converges physical stock and promotion budget without duplicate release.
- `cleanupOrphanSeedOperators`: inspects and revokes sessions/grants for namespace-tagged orphan synthetic seed operators left behind by uncatchable host interruption, targeting explicit synthetic identities only.
- `recoverInterruptedAuthTransition`: detects and revokes undelivered sign-in sessions when guest-context revocation is interrupted (`503`), preventing split or unacknowledged identity transitions.
- `verifyRedactedDiagnosticLog`: recursively scrubs credentials, cookies, tokens, signatures, raw contact/address PII, support message bodies, and bank/payout evidence from diagnostic log payloads while preserving correlation IDs and occurrence vs ingestion timestamps.
- `rateLimit` (`src/modules/access/rate-limit.ts`): enforces fixed-window database-backed rate limits (`429 RATE_LIMITED` with `Retry-After`) across public and unauthenticated mutation surfaces (guest order access challenges/verifications, buyer identity challenges/verifications, guest support sessions/messages/challenges/verifications, return evidence uploads, and referral touches), plus durable 5-attempt challenge lockouts.

Executable probe commands:

- `npm run test:integration -- --case=PR-16`: runs `tests/integration/jobs.test.ts` and `tests/integration/public-rate-limits.test.ts`.
- `npm run test:integration -- --case=T-38`: runs `tests/integration/scenarios-14.test.ts` (all 14 canonical scenarios + real PostgreSQL race).
- `npm run test:integration -- --case=localhost-readiness`: runs `tests/integration/localhost-readiness.test.ts` (including isolated `pg_dump -Fc` / `pg_restore` rehearsal into disposable database `99ribu_restore_<uuid>` with table/row parity and post-restore `finance_posting_guard` / `finance_transaction_immutable` enforcement).
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=localhost-readiness`: runs `tests/browser/localhost-readiness.test.ts` across mobile (`390x844`), tablet (`768x1024`), and desktop (`1440x900`) viewports.
