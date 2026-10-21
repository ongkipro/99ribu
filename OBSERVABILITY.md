# Observability — Serba 99ribu

Adopted at repository root on 2026-10-16; updated 2026-10-21 with all local operational reliability probes (`S63`) and assembled localhost readiness/restore checks (`S65`–`S68`) implemented and verified PASS. External remote monitoring and production alerting remain separate per `CTX-18`.

## Executable foundation readiness

Probe: local-foundation-ready|http://127.0.0.1:3099/api/health|200|ready|5000

Owner: application engineering, operated from this worktree. Run `npm run health -- ready` against `npm start` after migrations. Expected: HTTP200, no-store, exactly `{ "service": "99ribu", "status": "ready" }`. This proves the built web process can query the identity/outbox schema with its restricted local database role; no private records are read or returned. It does not prove worker liveness or commerce availability. The current root serves the S21 storefront HTML200; visual acceptance remains pending. Root availability does not establish full commerce readiness.

If unavailable: use `npm run db:status`, restore this worktree's preserved database with `npm run db:up`, apply reviewed missing migrations with `npm run db:migrate -- local`, and repeat the probe. Do not delete/reseed data as recovery. Wrong server/build/profile failures require correcting the recorded launcher/configuration before retry. Only during an owned outage drill, stop this database with `npm run db:stop` and assert `npm run health -- unavailable` returns503; always restart it afterward. S06 executed this drill and observed recovery to200 without restarting web.

`npm run test:integration -- --case=foundation` fails preflight when the required test database is absent. The browser registry in README fails on missing built web/browser/database. Unknown selectors, skipped/TODO checks and empty files cannot produce acceptance PASS. Aggregate output contains bounded test names/counts; request headers and private fixture values are not reflected in the health envelope. Evidence owner: RUN-20261015T192834Z-43478193.

The worker's `worker_ready target=local dispatch=simulated` startup line follows a successful outbox query. It is not a heartbeat or proof of later progress. Worker failure/restart behavior is tested by `npm run test:worker`; external leases/retry and ongoing supervision remain later slices. No uptime SLO, numerical alert or remote monitoring has been configured.

## Remaining probes to implement and record

Record actual safe command, expected result, owner and last evidence/run for each applicable probe during foundation and affected slices:

- Domain-level readiness beyond the implemented foundation probe.
- Worker heartbeat, backlog/oldest age, leases, bounded retry and restart recovery.
- Stock conservation and money/collection/refund/payout reconciliation using synthetic fixtures.
- Private receipt/access denial, consent suppression and simulated destination diagnostics.
- Synthetic database/artifact restore into a separate disposable target with invariant checks.
- Rendered browser journeys and client failures under the selected mobile/desktop contracts.

Commands and numerical alert thresholds are pending actual implementation; do not treat this list as configured monitoring. Preserve event occurrence versus ingestion time and correlation IDs. Logs/diagnostics exclude credentials, raw matching identifiers, contact/address, support bodies and private label/bank evidence.

## Evidence and release scope

Keep structured executed probe results in `.delivery/` and the current resume summary in root `STATUS.md`. Local fake-adapter delivery is not vendor acceptance or attribution. Remote uptime, production alerts, off-host restore and real carrier scanning require their own configured environment and evidence. `release-check` is applicable only after actual probes and release context are configured; no empty-probe PASS constitutes acceptance.


S29 executable fulfillment probes reuse the root registry: `npm run test:integration -- --case=PR-6` (12cases/4files), `npm run test:browser -- --case=PR-6` (1built Chromium case), and `npm run health -- ready`. Source signing, original source occurrence versus worker notice availability, failed booking history and original lease retry metadata are checked without printing private payloads. Exhausted creation recovery records prior status/attempts/error/dispatched time and whether source absence was proved while fencing creators. Notice availability means local durable worker delivery, never external send or customer read.

Current corrected build OKibCFYTyt6e-KhnWguMp and96-table/20-migration isolated databases pass these probes. Historical S29-candidate refuses applied0019 before starting its87-table rollback cases. These checks do not configure a worker heartbeat, numerical alert, off-host restore or remote uptime; S63/S65 retain supervision/operations ownership. Predecessor native/built regression refresh and final combined52-path S29 review pass; S29 ledger closure and chain verify are accepted.


S30 local reconciliation evidence uses the existing database outbox and privacy-safe host logs (target, source/job identity, finite counts). The current loopback health command is `npm run health -- ready`; it proves auth/outbox schema readiness, not complete commerce acceptance. PR-12 exercises source loss after commit, bounded genuine callback lock-timeout exhaustion, audited recovery of the same callback, original cash/fee/classification references and native/browser authority. No remittance/recovery event is a second Purchase. Original callback results retain observed head revision, so later source updates do not overwrite retry truth.

Owned promotion-fixture teardown follows immutable first-version actor provenance, including raw contract requests, and deactivates only its own configurations through current authenticated version writers before removing actors. Preserve timestamps, lifetime reserved/committed counters, consumed holds and history; never raise the100-campaign production review ceiling. Historical test-state diagnosis/retirement of exactly105 closed-author synthetic campaigns and unchanged-money checks are retained in the S30 C2 ledger. Ready-job fixture backlog is drained only through the actual bounded test worker with external effects disabled; this is not continuous supervision or a substitute for S63 isolation.


S31 executable runtime probes now include `npm run test:integration -- --case=PR-7` (33tests/13files) and the one built Chromium/host case through `npm run test:browser -- --case=PR-7`. The selector names exact runtime files and never runs the historical S31-candidate. Both installed targets have124 tables/22 migrations; all44 applied SQL/snapshots and the22-entry prefix are immutable.

Actual fresh CLI processes prove original-provider creation/paid acknowledgement loss and same-source recovery. A queued head with an unknown creation job projects unknown; an exhausted known-unsent failed job projects failed and retains its obligation. Host reconciliation fences creators and preserves the same job/attempt counters while uncertainty remains. Only explicit currently authorized finance with a fresh bound proof can retry an established zero-money failure. Historical failed callback results remain unchanged after later success. Log only opaque refund/source/job identities, finite statuses/counts and safe error codes; never signatures, recipient certificates, proof values, cookies or bank payloads.

Actual PostgreSQL order-lock barriers prove duplicate claim exclusion, same-key response replay, competing finance retry exclusion and independent same-receipt cash/adjustment conservation. App-role direct writes cannot create orphan stock/cash or commit a signed-success callback without its own job completion. Read-only EXPLAIN ANALYZE on the genuine late-intake fixture returns two original-unit facts and two original receipt events using existing leading event/goods/allocation/parcel indexes; small fixture tables also use sequential scans. This is local query-plan evidence, not a production-volume benchmark. Continuous supervision, numerical alerts, deterministic shared-queue isolation and off-host recovery remain S63/S65; readiness still proves auth/outbox availability only. STATUS retains the current build and final-review boundary.

The buyer case list now takes the same shared case lock as detail readers before projecting child refunds. Its actual reader-versus-queue regression first failed without that lock, then passed with a blocked reader followed by coherent version2/no-refund and version3/exact-refund responses. The complete PR-7 selector passes33/13 after correction; no schema migration is involved. Historical source review CHANGES REQUIRED and the actual corrective approval remain separate ledger events.

S31 C2 host `--once JOB_ID` scopes ordinary database dispatch, lease expiry, creation and reconciliation through the existing UUID filter. It preserves original due times, attempts, source identity and uncertain outcomes. Worker fixture8/8 includes an actual locked-delivery waiter while a second process completes without taking the held job, then one effect per real job. An older unrelated notification and a valid missing UUID remain effect-free. The standard no-ID ready queue and continuous-supervision ownership remain unchanged.

C2 current foundation25/5 passes without a global ready-queue drain. Fresh production-mode PR-7 Chromium/host1 and affected built9/8 pass on lqdvVaUI0ULANm_WiMvK_; readiness200 remains auth/outbox-only. Exact V3 legacy upgrade1 passes after all68 approved input fingerprints were reverified; its stopped private project/data is retained. Final integrity confirms both targets124tables/22matching migrations/61TRUNCATEdenials/76new-table CRUDgrants/0unvalidated new constraints and immutable44/prefix22. Actual final full73 source/boundary approval and S31 closure PASS are recorded; STATUS now owns active S32.


S32 runtime probes use the explicit PR-7 registry: native67/29 and built2/2 pass on _QrrV_3pA-ni2qWWgJoVa. Actual fresh-host recovery4 preserves original replacement booking/source/job identity through source rollback and lost creation/issuance/receipt acknowledgement. Receipt recovery leaves pristine pending callbacks untouched and applies audited retry only to eligible error/unknown states. Host summaries contain opaque IDs, finite states/counts and safe codes; signatures, destination contacts and payloads remain private.

Observed PostgreSQL lock tests prove a single same-version preparation winner and one callback/first receipt under concurrent registration and dispatch. Native tamper proof rejects ten invalid mutations with no surviving head/stock/job/economic effects, including physical receipt effects without matching job completion. COD/prepaid occurrence-refund proof uses original receipt/unit/frozen shipping and confirms original Purchase/economic sources remain unchanged.

The exact separately reviewed isolated upgrade passed on a fresh owned socket cluster; raw execution/postchecks are retained in the ledger. Both installed targets remain140tables/23matching migrations/77TRUNCATEdenials/140relevant CRUDgrants/0unvalidated constraints, with all46 applied files/prefix23 exact. The owned cluster is stopped with data retained. This bounded test does not configure worker supervision, production-volume alerts, remote uptime or full localhost readiness. STATUS owns current affected-suite and final-review freshness; S63/S65 own continuous operations.


C4 stages local cancellation summaries with target/mode/opaque cancellation ID/callback and processed counts only. Recovery selects exact original/cancellation job IDs and preserves attempts without draining ready work. Signatures, source payloads and internal audit reasons remain private. Staged --cancel-waybill, --reject-waybill-cancellation and --reconcile-waybill-cancellation flags are not runtime-accepted while0023 is stopped. A deferred original-issuance dependency remains pending; processed count alone is not cancellation success.


S33 C4 actual r21 definition-only PASS1: the exact reviewed new executor defined165 relations/88 distinct functions (89 declarations) from stopped SQL54614548084e48ab065ea38ce359d90d76db906e199752dc2310b849e6ed9132 on a fresh owned socket cluster after proving intact STOP55000, then rolled back fully. Project99ribu-4b3f3e2401 is stopped; retained data /tmp/99ribu-exception-parent-definitions-moBDs3. Independent postcheck proves all59 bound objects and both installed140/23 targets/all46/prefix23 unchanged. Actual receipt /tmp/99ribu-s33-c4-parent-definition-execution-receipt-r1.json and raw /tmp/99ribu-s33-c4-parent-definition-execution-r1.txt retain execution provenance. Both r13 and r21 invocation permissions are consumed. Never repeat either executor or apply0023 from these results. No new cancellation, stock, refund, cash or other business branch was executed; full S33/localhost acceptance remains pending.


Current replacement delta follows that historical r21 checkpoint and changes SQL to82b97...; new definitions/business branches remain stopped/uncompiled/unexecuted. Surviving complete units now drive reserve, accepted booking scope, actual handover/receipt and per-parcel cancellation images. Preserve immutable original allocation/zero charges, actual release/consume conservation and unresolved original claim-finance work. Actual static30/serial22/OAS6374 compatibility plus corrected source-integrity-r2 PASS do not establish new runtime or current built proof. Separate r22 found two native P2s, exact originals/reports remain retained, and actual r23 bounded source review approves the correction. STATUS owns the next action; consumed definition executors must not run.


Subsequent replacement stock-case source now opens one original-intent case from the real reserve failure's stored stock_wait, preserves repeated-wait consent and reconciles only actual complete stock without pending proposals/retirement/finance. Actual r24 bounded source APPROVE and current-r1 static30/serial19/OAS6374/installed140/23 integrity PASS do not execute0023 branches. Latest SQL66cc0... is stopped/uncompiled/unexecuted; claim-finance, physical/finance/API/native/race/built/full acceptance remains pending. Never reuse either consumed definition executor. STATUS owns the precise next action.


Original replacement-retirement claim consequences are now staged: exact per-parcel accepted cancellation moves selected original replacing claims to held, preserves inspection/entitlement and rejects duplicate physical branching. It creates no received/refunded/released claim or money effect. Actual r25b bounded source APPROVE and static30/serial17 including5 new policy checks/OAS6374/installed140/23 integrity PASS do not execute new0023 or render its new private explanation. Latest SQL9be368... remains stopped/uncompiled/unexecuted. Original-source recovery finance/mixed claim closure and full acceptance remain pending; STATUS owns the next action and both definition executors remain consumed.

## S63 operational reliability probes and S65–S68 assembled readiness verification

`src/jobs/probes.ts` and `/api/v1/admin/operations/probes` implement the local operational reliability and recovery probes required by `S63` (`T-16` / `PR-16`):

- `inspectWorkerHealth`: reports outbox queue depth (`pendingCount`, `processingCount`, `failedCount`, `deadLetterCount`), oldest pending age in seconds, active expired leases, and failed expiry holds whose inventory or promotion reservations remain active.
- `reconcileFailedExpiryHolds`: identifies failed `inventory.reservation.expire` and `promotion.reservation.expire` outbox jobs whose underlying reservation is still `active` and safely rearms them to `pending` so the worker converges physical stock and promotion budget without duplicate release.
- `cleanupOrphanSeedOperators`: inspects and revokes sessions/grants for namespace-tagged orphan synthetic seed operators left behind by uncatchable host interruption, targeting explicit synthetic identities only.
- `recoverInterruptedAuthTransition`: detects and revokes undelivered sign-in sessions when guest-context revocation is interrupted (`503`), preventing split or unacknowledged identity transitions.
- `verifyRedactedDiagnosticLog`: recursively scrubs credentials, cookies, tokens, signatures, raw contact/address PII, support message bodies, and bank/payout evidence from diagnostic log payloads while preserving correlation IDs and occurrence vs ingestion timestamps.

Verified executable probe commands and results (2026-10-21):

- `npm run test:integration -- --case=PR-16`: `2/2` PASS (`tests/integration/jobs-reliability.test.ts` and `tests/integration/operational-reliability.test.ts`).
- `npm run test:integration -- --case=localhost-readiness`: `2/2` PASS (`tests/integration/scenarios-s62.test.ts` and `tests/integration/localhost-readiness.test.ts`, including all 14 canonical scenarios and isolated `pg_dump`/`pg_restore` rehearsal into disposable database `99ribu_restore_<uuid>` with post-restore `finance_tx_open_guard` XID immutability verification).
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=localhost-readiness`: `1/1` PASS across mobile (`390x844`), tablet (`768x1024`), and desktop (`1440x900`) viewports.
