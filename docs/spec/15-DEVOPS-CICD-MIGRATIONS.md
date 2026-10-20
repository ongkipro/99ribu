# Delivery and Migration Plan

Status: Draft — planning only; no application or runtime verification.

Owner: Paduka Ongki. Updated: 2026-10-15.

### DEL-1 — Safe delivery
- Status: Proposal
- Owner: Engineering owner
- Source: CTX-11
- Statement: Release only after local transactional tests, sandbox provider evidence, scoped browser proof and a demonstrated restore; changes must have rollback handling.
- Acceptance: A rehearsal records release artifact, migration compatibility, restore result and rollback steps without making a production mutation.
- Constraints: None
- Evidence: None; execution pending.
- Changed at: 2026-10-15
- Change history: Initial planning declaration from owner discussion.

## Planning-to-repository handoff
Staging is ~/Documents/work/prd/99ribu/. Do not treat it as implemented runtime truth. After stack acceptance and explicit code-work scope, project-init promotes the pack to ~/Projects/99ribu/docs/spec/ and TASKS.md to repository root. A generated root PRD is an entrypoint only. Never maintain two editable PRDs or task queues. No deploy, DNS change, commit or push is implied by this pack.

## Sequencing
1. Confirm selected stack/local runtime and accepted visual direction; record independent semantic review. Issued provider contracts gate real external adapters, while the CTX-18 local simulator profile can proceed without merchant access.
2. Initialize repository with pinned compatible tooling and real validation scripts.
3. Implement transactional model/auth, then catalog/inventory, allocation/checkout and provider operations.
4. Implement returns and exception recovery, attribution, maturity, automatic eligibility queues, manual finance transfers and reconciliation. Outbound payout API automation is deferred behind T-19.
5. Implement the accepted screen/design contracts, complete rendered browser and accessibility proof.
6. Rehearse migration, backup restore and rollout; owner approves live release separately.

Use expand-contract schema changes where old/new process versions overlap. SQL is reviewed before migration; destructive changes require explicit authorization. Test local disposable databases first. Backups include database plus evidence/object references and encryption/key recovery; no untested restore claim. Numeric recovery objectives and provider costs are owner decisions before production.

CI checks types/lint, behavioral tests and build using actual repository scripts. Financial and inventory race tests require a disposable PostgreSQL instance. No secrets or production customer records in CI artifacts.


## Environment and toolchain contract
Status: Proposal; implementation and infrastructure are unprovisioned for the commerce product.

| Environment | Data and external effects | Intended proof |
|---|---|---|
| Local | Synthetic buyers, isolated disposable PostgreSQL, owned adapter fakes; outbound money/shipment creation disabled by default | Deterministic domain, authorization, concurrency and migration tests |
| Staging | Separate database, buckets, hostnames and secrets; provider sandbox accounts only when issued and authorized | Assembled browser journeys, issued provider contracts, recovery and deployment rehearsal |
| Production | Separate restricted service identities, backups, operator access and approved provider merchant accounts | Approved release plus bounded monitoring and read-only smoke checks |

The separate coming-soon site is not a commerce staging environment and its build or screenshots do not establish checkout, stock, provider or payout readiness. No production provider credential, customer dump or production database URL may enter local/CI/staging. Configuration must positively identify environment and refuse incompatible provider/account targets; a missing sandbox is a recorded blocker, not permission to use a live account.

During repository setup, pin a supported runtime, package-manager version, lockfile, PostgreSQL major, migration tool and compatible test/browser versions. Exact versions are Unknown until the accepted stack is initialized and checked against current official documentation. Reuse native platform functions and selected dependencies before adding runners or wrappers. The prospective `npm run test:integration -- --case=PR-*` and `npm run test:browser` commands in [TASKS.md](../../TASKS.md) become valid only after actual scripts and fixtures exist; setup must document argument forwarding, non-watch execution and required services. Never silently substitute in-memory storage for a required PostgreSQL race test.

## Verification layers and release evidence
Status: Proposal. [02-PRD.md](02-PRD.md) owns behavior; this section selects the smallest faithful proof. No runtime result is recorded here.

| Risk / traceability | Required behavioral evidence | Boundary |
|---|---|---|
| Fixed offers and stock components — PR-1, PR-2; T-1, T-2 | Every sellable choice totals IDR 99,000; unit/multipack/bundle contents reserve atomically from one complete warehouse. Concurrent offers sharing the final component cannot both reserve it; failure releases only that reservation. | Pure amount rules plus real PostgreSQL integration |
| Allocation, subsidy and COD — PR-3, PR-4, PR-5, PR-11; T-3 through T-5, T-11 | Split parcels preserve purchased quantities; collection amounts sum exactly to the order total; concurrent subsidy reservations respect the configured cap and budget. Stale quote/version conflicts require renewed buyer review. | Real transactions and public handler contract |
| Payment callbacks and recovery — PR-5, PR-16, PR-21; T-5, T-16, T-22 | Repeated/out-of-order events and crash after durable acceptance produce one financial effect. Same idempotency key with a different body conflicts. Late payment after order expiry enters reconciliation without silently reviving released stock. | Issued provider contract plus adapter fault injection and persistence |
| Packing milestone — PR-6; T-6 | Only a verified provider-issued waybill meets packing; booking acknowledgment, invented tracking text and timeout do not. Ambiguous booking is reconciled before recreation; valid issuance does not mark handover, receipt or COD settlement. | Adapter and shipment-state integration; issued sandbox where available |
| Returns and affiliate maturity — PR-7, PR-8, PR-9; T-7 through T-9 | Seven-day return and non-extending first-click windows; H+10 based on verified buyer receipt. Replacement receipt resets only affected offer quantities; duplicate delivery/return events cannot duplicate commission. | Clock-controlled policy and quantity-lineage integration |
| Manual payout — PR-10, PR-12; T-10, T-12 | IDR 99,000 inclusive creates exactly one reserved queue entry. Competing finance claims have one owner; private proof, frozen destination/amount and bank-reference deduplication gate verification. Unknown external outcome remains held across claim expiry/restart and cannot prompt blind retransfer. No bank API is invoked by eligibility. | Role/object authorization and real transactional tests; synthetic private evidence |
| Margin, policy and exceptions — PR-19 through PR-21; T-20 through T-22 | Missing cost inputs stay unknown; required approval is enforced. New policies preserve existing order snapshots. Stock gaps, COD refusal, mixed parcel outcomes and unavailable replacements have auditable, quantity-scoped recovery. | Policy tests and authoritative stored outcomes |
| Access and API compatibility — PR-13, PR-18; T-13, T-18 | Buyer/guest/affiliate/staff cannot cross object or warehouse scope; stale state and invalid transitions fail without side effects. Handlers match accepted OpenAPI statuses, schemas and idempotency semantics. | Public handlers and database inspection |

Use test clocks for cutoff boundaries and barriers/locks for races; do not wait ten days or rely on sleep timing. Include crash-after-commit/retry and crash-before-commit paths at meaningful side effects. Verify final stock, reservation, ledger and operation state rather than private helper calls. Keep fixtures isolated per worker; no secrets or real beneficiary/buyer records in failures, screenshots or traces.

Adapter fakes establish owned behavior under malformed payloads, timeouts, duplicates and reordered events. They do not prove provider signing, COD coverage, settlement timing, sandbox realism or outbound Virgo payout availability. Provider evidence must identify issued contract version, sandbox account mode, scenario, safe operation reference, observed result and limitations. T-19 remains a future capability validation and does not block the initial manual-transfer model. Unknown provider outcome is never treated as confirmed failure merely to make a test pass.

## Browser acceptance and minimal CI gates
Status: Proposal; distinct mobile/desktop design acceptance remains under T-14 and T-17, with runtime UI work scheduled by the root task queue after that acceptance.

Rendered checks cover browse → offer/variant selection → contents → cart → split-shipping checkout → payment return/order recovery, then return/exchange, affiliate hold/payout history and warehouse/finance exception handling. Verify the total for a bundle is IDR 99,000 and every included component is legible; two selected offers total IDR 198,000. No UI may imply a whole order has arrived when only one parcel has arrived.

Minimum viewport evidence is 390px mobile and 1440px desktop under NFR-2, augmented by the agreed small/large phone and landscape cases where those layouts change. Verify keyboard-only actions, visible focus, labels/errors and live status announcements, focus recovery after dialogs/errors, text zoom, safe areas, virtual-keyboard reachability, no essential horizontal clipping, and external payment/back/session recovery. Include a supported Safari/iPhone run before claiming iPhone compatibility; Chromium viewport emulation alone is insufficient. Future native/WebView bridge behavior is outside the first browser release unless separately scoped. Visual/browser evidence follows [17-UX-FLOWS-SCREEN-CONTRACTS.md](17-UX-FLOWS-SCREEN-CONTRACTS.md); automated accessibility results complement manual keyboard/browser proof.

The initial CI proposal uses the accepted repository's real scripts: locked dependency install; type/lint/build; OpenAPI/planning checks where affected; isolated PostgreSQL integration and migration checks; and critical assembled-browser acceptance. A single supported runner platform is enough initially; add matrix jobs only for demonstrated compatibility risks. Secret-dependent provider smoke checks run separately with explicit sandbox scope and do not silently pass when unavailable. CI must fail on absent required services, preserve redacted failure evidence and use bounded timeouts. No workflow, deployment pipeline or green CI is claimed by this specification.

## Migration, rollback and recovery rehearsal
Status: Proposal; DEL-1 and PR-16. Numeric RPO/RTO, backup retention, restore frequency, alert thresholds and availability/latency SLOs remain owner-held proposals until hosting/load and restore evidence are available. A target is not an SLA or measured result.

1. Review generated SQL and state compatibility before release. Expand schema first; deploy code capable of old/new records; backfill in resumable bounded batches; validate invariants; remove obsolete fields only in a separate authorized contract phase. Test both empty and representative synthetic upgrade databases.
2. Before rollout, record immutable artifact/version, migration set, expected process compatibility, backup reference, operator and stop conditions. Database, private evidence objects and encryption-key recovery must be covered together. A backup job succeeding is not proof that a restore works.
3. Rehearse restore into an isolated target, check schema and stock/ledger/commission invariants, confirm private object links and restore access restrictions. Record elapsed recovery and observed data gap; compare with approved objectives when they exist. Never restore over a live database as a rehearsal.
4. Roll back application code only while its schema/data semantics remain compatible. An incompatible migration needs a reviewed forward repair or controlled maintenance decision, not an automatic destructive down migration.
5. Database rewind cannot undo bank transfers, payment captures, refunds or issued shipping labels. Preserve external operation identities, reconcile provider/bank results and apply auditable compensating entries/state corrections. Pause affected processing before cutover so restored reservations/jobs cannot resend old external effects.
6. After a release or recovery, verify read-only health, backlog/unknown-operation counts, environment isolation and critical invariants; resume affected queues only after reconciliation and owner-approved operational scope. Persist the rehearsal/run evidence with the actual repository release record.

Before commerce production release, hand off: assigned engineering/finance/warehouse incident owners; verified provider sandbox/account boundaries; actual commands and pinned versions; accepted timing/cutoff policies; redaction/retention decisions; successful migration/restore rehearsal; compatible rollback instructions; and a reviewed release artifact. These are readiness conditions, not permission to provision or deploy now.

## Continuous intake deployment and calendar checks
PR-16 requires continuous order intake independent of warehouse closures. Before launch, verify health/restart and durable worker catch-up, buyer-visible provider degradation, backup alerting and an observed off-host restore. Planned maintenance has a visible recovery path; 24/7 operating intent is not a 100-percent uptime SLA. Prefer CI-built images to avoid production build contention on the initial 8 GB host. Restore tests must recover orders, stock reservations, policy/calendar versions, finance/audit records and job identities together.

PR-6 verification includes a holiday between H0 and H+2, consecutive major-holiday closures, an order placed during a closure, the configured Sunday rule, local-midnight/timezone boundaries, corrected calendars and late callback replay. Use synthetic explicit holiday dates rather than pretending a hard-coded year is an authoritative national calendar. Confirm labels/handover independently and show truthful due dates. Test HPP updates after sale, immutable older order reports, unknown-cost margins, cost-write denial for ordinary ecommerce admin, warehouse-scope restrictions and deduplicated expense/correction posting.

## Native chat implementation evidence
T-24/T-25 must prove duplicate send after lost response, two-agent claim race, rejected unauthorized thread/order/upload/cursor access, staff-note absence from customer HTTP/events/read positions, session revocation, monotonic read markers, image scan rejection, reconnect/resync and server restart after durable commit. Render storefront mobile/desktop chat and the CS inbox; cover focus/keyboard/virtual-keyboard safe-area, preserved failed draft, unread counts and off-hours messaging. Exercise actual proxy streaming and bounded polling fallback; syntax/build alone does not prove realtime delivery. Use synthetic customers/images only; no real conversations or payment data in screenshots/fixtures.

## Advertising and post-checkout rollout gate
DEL-1 decision: adapters default disabled until approved destination/account setup, current vendor contracts, PRIV-1 retention/consent review, source/schema checks and synthetic integration evidence pass. Roll out one platform at a time with explicit destination/version and per-platform pause. Use existing app/worker/PostgreSQL; do not add sGTM infrastructure by default. Failure/rollback disables outgoing dispatch without breaking checkout or discarding already committed money/outbox references. Reconciliation decides replay only within valid time/consent rules.

Before production activation prove prepaid success without a returning browser, pending external return, duplicate callback, split COD collection/refusal, consent decline/withdrawal, worker restart/timeouts and refund differences. Provider test-tool receipt is separate from local mocks and actual attributed conversions. Browser evidence includes mobile/desktop/tablet checkout and thank-you, reload/Back, blocked scripts and privacy/network inspection. Current documents and contract lint are planning evidence only; no account setting, budget, real order or live tracking is changed.

## Current milestone: Localhost readiness — 2026-10-16
Decision under CTX-18: localhost first. Existing production release/hosting procedures remain future gates and do not require provisioning or live accounts to finish local development. Complete local behavior does not automatically complete a task's separate provider/hardware/production acceptance. Label local evidence as local/synthetic/simulated; no percentage of production readiness is inferred from lint or a local demo.

### Local foundation and run contract
After explicit implementation scope, T-23 promotes this pack once into the real repository, pins compatible versions, creates migrations and real package scripts, and records actual install/run/check commands in its README. App/web and worker use the same isolated local PostgreSQL and domain code. Loopback bindings are the default; no public/LAN exposure or deploy tunnel is implied. Use private local object storage/test filesystem for uploads/labels with the same access boundary. Do not include the separately deployed coming-soon project as localhost evidence.

Required command purposes (exact commands are not claimed to exist today): install from lockfile; start local database/services; apply reviewed migrations; load explicit synthetic seed; start web; start separate worker; execute scenario/advance injected clock; run type/lint/build/integration/browser checks; stop services gracefully; back up and restore into another isolated local database. Define dependency/health checks and startup order, non-watch tests and port-conflict handling; do not kill unrelated processes or silently select a different server. Background workers and local test inbox are visible operational dependencies.

Use nonsecret .env.example with documented required variables and safe simulated defaults; no actual credential values in docs/fixtures. Provider SDKs are not proof of configured access. Reject production DB/object/provider targets in local scripts. Synthetic data/temporary artifacts are namespaced and their cleanup scoped; local work never authorizes reading existing secrets or resetting unrelated data.

### Local proof matrix
| Gate | Observable local evidence | Not established |
|---|---|---|
| Contract/fixture integrity | OAS and canonical traceability checks, fixture validator and rejected bad-data mutations | API handlers, migrations or simulator existence |
| Auth/persistence | Real local login/session and deny-by-default, migrations applied, web/worker share DB, principal switching clears private state | Production identity channels or real customer access |
| Core transaction journey | Catalog/physical stock/cost → cart/allocation → prepaid/COD → receipt/orders → return/refund/replacement, actual DB assertions and races | Issued merchant protocol/real cash or shipment |
| Operator/affiliate work | Role-scoped queues, settings/audit, HPP/history, reconciled simulated COD/refunds, H+10/threshold/manual-transfer evidence flow | Bank transfer, carrier pickup or tax compliance |
| Communications/signals | Real durable chat + private notes/files/read recovery, local notification inbox and ads event sink with consent/dedupe | Message sent to real recipient, live Pixel/CAPI attribution |
| Failure/restart | Provider fakes fail/timeout/reorder/duplicate, worker restart catches up, unknown operations reconcile original IDs | Upstream availability or acceptance |
| Browser/print UX | Mobile/tablet/desktop rendered flows, keyboard/zoom, checkout return, private TEST label preview/reprint | Physical carrier scanner/template approval unless separately tested |
| Local restore | Restore synthetic DB/artifacts into separate target and verify money/stock/job/history invariants | Off-host disaster recovery/production RPO/RTO |

Acceptance covers all approved feature domains; work may be delivered in slices without dropping requested scope. First prove one real vertical slice (catalog/stock → guest order → simulated prepaid → private receipt), then add split COD/fulfillment, admin/account, return/refund, affiliates, chat and ads/labels with respective negative cases. Integrate selected mobile design throughout rather than leaving all UI validation until the end. Run focused checks for each slice, then one assembled regression pass.

### AI terminal task boundary
Repository AGENTS.md owns startup instructions and safe local commands; root TASKS.md is the only queue. Before each coding slice read its primary requirement, canonical contract and actual code; constrain files, identify invariants and a runnable done check. Break coarse tasks into small numbered subtasks under their existing parent when beginning implementation, without renumbering accepted task IDs or creating a rival queue. Record actual changes/commands/results and unresolved local/provider gaps in repository STATUS/BUILD-LOG as those artifacts are introduced; memory never substitutes for execution truth.

A coding agent cannot mark a feature done from documentation, a build, a fake successful return or HTTP200 alone. It must exercise the affected public boundary and inspect resulting persistence/side effects; visible flows require real browser proof. Use synthetic fixtures and actual domain code, not a second simulated business implementation that bypasses money/auth invariants. Runtime tests and command names are created and executed during foundation, not fabricated in planning.

Local scope excludes provision/deploy/DNS, real merchant/ad credentials, campaign spend, real payments/shipments/messages, live data import, commit/push and destructive reset without their specific authorization. External sandbox acceptance is a later explicit gate; it does not block running the complete local fake-adapter journey.

Fixture promotion detail: the current planning-only validator runs from the staged pack. At repository promotion, verify fixtures/ and scripts/ are preserved alongside the canonical pack under docs/spec/; adapt root package commands to those actual paths. Seed implementation reads the canonical fixture there or records an explicit one-time move into the application's fixtures directory; do not maintain divergent editable copies. Inspect project-init behavior rather than assuming ancillary files were copied. The README must name working directories and actual commands after setup.


## Repository Promotion and Reconciliation — T-23

Observed bootstrap contract: `/home/ongki/dotfiles/bin/project-init` suite mode recognizes CONTEXT-RECORD.md +02-PRD.md, copies every regular staged file, routes only top-level TASKS.md/PLAN.md to repository root and all other files to docs/spec/, and creates a root PRD.md pointer. It does not automatically reconcile the suite DECISIONS/ADR layout with generated repository contracts. The existing planning-only --plan inspection is not an executed bootstrap. Reinspect actual tool behavior and destination conflicts before authorizing any implementation step.

| Staged material | Initial suite destination | Required one-time reconciliation |
|---|---|---|
| TASKS.md; optional PLAN.md | Repository root | Root TASKS.md is the sole queue. Repair its links to domain docs; do not retain another editable docs/spec/TASKS.md. |
| 02-PRD.md and numbered domain specifications | docs/spec/ | Canonical detailed requirements; root PRD.md stays an entrypoint, not a rival PRD. |
| DECISIONS.md | docs/spec/DECISIONS.md | Reconcile with generated root DECISIONS.md; root is the sole accepted decision index. Preserve all accepted decisions, not only bootstrap placeholders. Replace former suite index with a redirect/reference or remove the task-owned duplicate after reviewed reconciliation. |
| ADR-0001 through existing numbered ADRs | docs/spec/ | Move once to docs/adr/ without renumbering accepted records; root DECISIONS.md points there. Repair every incoming ADR/index and outgoing domain/ADR/task link. |
| Staged README/context/sources/OAS | docs/spec/ | Keep suite README as a specification index distinct from executable root README. Update canonical references/paths; no second runtime command registry. |
| fixtures/, scripts/, design/ reference assets | docs/spec/ relative subtree | Preserve hashes and all referenced ancillary files. Commands use verified promoted paths; any deliberate one-time relocation has a manifest entry and repaired references, never two editable fixture/checker copies. |
| Staged repository handoff and root-contract templates | docs/spec/ relative subtree initially | Use the actual supplied template paths to reconcile root AGENTS/README/STATUS/BUILD-LOG/ARCHITECTURE/DECISIONS and .delivery contracts. Templates are inputs, not independent runtime truth or another queue. |

Before copying, record source/destination inventory, file hashes, intended canonical owner and conflicts. After promotion, record copied/moved/reconciled paths and new hashes, verify links and run suite/OAS/fixture checks from actual locations. Preserve accepted ADR substance; path repair is not permission to silently change decisions. Inspect generated root files before replacing task-owned placeholders; overlapping pre-existing work requires scope reconciliation. No database migration is executed by this document promotion.

The staged Documents pack becomes a dated nonauthoritative snapshot after verified promotion. Ongoing requirements/status/commands/evidence live in the repository. Do not write changing implementation status back into the snapshot or create a bidirectional sync. Record this authority switch in the root handoff and specification index.

Bootstrap safety: current project-init uses generator @latest, creates an unborn Git repository and has destructive cleanup_partial on some failure paths. Do not run it blindly or regard --no-install as eliminating filesystem risk. Review the exact resolved plan, pinned-generator alternative, destination and cleanup behavior before execution; choose an authorized path preserving user work. Feature implementation follows the worktree rule. A normal HEAD-based worktree needs a commit, but inspected Git 2.43 help also supports an orphan worktree and the installed delivery-ledger handles an unborn base. Evaluate that supported path with an exact, reviewed bootstrap-file inventory and boundary; do not silently omit generated untracked source or copy secrets/dependency caches. Verify the actual worktree and ledger behavior before claiming it works. An initial commit is another option only if the user separately requests it; do not manufacture a commit-approval prerequisite. Provision/deploy/push remain outside local bootstrap scope.

## S01 bootstrap sequence — isolated scaffold, existing-repository promotion

Observed update — 2026-10-16: the owner requested the initial documentation commit/push before application coding. The real repository now exists and document promotion/root-contract reconciliation is complete, using existing-repository mode without a native generator. S01 remains partial. Resume its native-scaffold work without recreating the anchor, repeating promotion, or overwriting the adopted root contracts. The sequence below preserves the original bootstrap design; root STATUS is current execution authority.

Decision for this handoff: use the installed project-init existing-repository promotion path after creating a task-owned orphan worktree. This avoids the inspected new-project wrapper's cleanup_partial path and does not require an initial commit. The accepted application stack is unchanged. No generator version or runtime is selected by this document alone.

1. Inspect the intended repository/control-directory paths and any existing files. Resolve the exact native generator version and supported local runtime before invoking it; S02 will pin the complete application/dependency/service versions afterward. Do not invoke @latest as a substitute for that decision.
2. Create a task-owned empty Git anchor and its orphan feature worktree using the installed Git's supported flags. Verify the actual top-level path and unborn HEAD; never rely on the accidental home-directory Git repository. No commit, stage or remote is needed for this bootstrap route.
3. Run the exact pinned native generator separately in an owned empty scratch directory, with supported no-install/no-Git flags verified from that version's help. Inspect its output before copying an explicit source inventory into the worktree; preserve .git linkage, reject secret files and omit dependency/build caches. A failed generator leaves its output for diagnosis; it does not authorize deleting an existing destination or repeating with force flags.
4. Inspect the existing-repository promotion plan. That profile rejects database/auth/deploy flags: omit them here. Generated none/unselected placeholders are bootstrap metadata, not cancellation of the already accepted PostgreSQL/Better Auth/Coolify decisions.
5. Run the reviewed promotion only within authorized implementation scope, with no other active ledger run. Its --no-install mode deliberately returns exit2/BLOCKED because application checks were not run. Inspect the actual reason; unexpected failure still needs diagnosis. Never convert this expected lack of verification into application PASS.
6. Reconcile root contracts/decisions/ADRs and all links according to the matrix above. Adopt the supplied root templates as actual repository contracts: replace their staging preambles with a dated adoption note, preserve their factual limitations, and remove generic generated claims that conflict with observed state. Retain docs/spec/handoff/root as historical template inputs, not a second current status authority.
7. Record actual paths, tool versions, source/generated/promoted hashes, runtime gaps and next S02 action. Subsequent feature runs start their own exact ledger boundary. If initial untracked files overlap that boundary, inspect only those task-owned files and use a specific accepted-dirty path; never blanket-accept unrelated initial dirt.

Verified planning command shape (paths in angle brackets are intentionally unresolved targets, not paste-ready shell input):

```text
project-init --repo <actual-worktree> --stack existing-repository --from-docs <accepted-pack> --no-install --plan
```

After scope/path review, the same command without --plan performs document promotion. This path neither generates the Next.js application nor installs dependencies; the separately pinned generator and later S02–S06 prove those capabilities. Do not add --database, --auth or --deploy to the existing-repository profile.

Historical pre-promotion handoff rehearsal (do not run from the promoted repository): the staged pack ran `python3 scripts/check-bootstrap-handoff.py`. It uses an owned temporary orphan Git worktree, actual existing-repository promotion and a synthetic ledger probe. It checks plan nonmutation, byte-preserving file placement, source preservation, expected BLOCKED state and zero commits, then removes only its own temporary sandbox. It does not run a native generator, install packages, provision a DB, access credentials or build the app. The rehearsal is not completion of S01 on the actual target. Freeze pack edits while it runs because source hash changes fail the check. This initial-import rehearsal is staging-only and refuses a promoted docs/spec directory. Keep its observed result as history after promotion; do not reconstruct another live staging pack or use the rehearsal as an application check.

## Built-Server Localhost Acceptance — T-39

Local operating profile remains APP_ENV=local with every external adapter simulated and dispatch guarded. Build and runtime use NODE_ENV=production to exercise the actual built application, not next dev; NODE_ENV is a runtime optimization mode, never authority to activate merchant/ad endpoints. Recheck local-only controls before build, process startup and worker dispatch. No live secrets, browser pixels or remote notification/money/shipment requests are permitted.

Official references inspected for the command design: [Next.js deployment](https://nextjs.org/docs/app/getting-started/deploying), [Next CLI](https://nextjs.org/docs/app/api-reference/cli/next), [Playwright CLI](https://playwright.dev/docs/test-cli). Pin installed compatible versions and verify their actual CLI help. A standalone Docker output, if selected, has its own verified startup command; do not assume next start and standalone server entrypoints are interchangeable.

| Checkpoint | Required executed evidence |
|---|---|
| Build/start | Locked install, reviewed migrations and explicit synthetic seed; successful application build; actual built web server bound to chosen loopback address/port; separate real worker using the same isolated PostgreSQL. Record exact environment-variable names/modes and commands, never secret values. |
| Browser/API | Execute assembled buyer/operator/affiliate and negative-access scenarios against that built server. Verify fonts/assets, authoritative updates, private response cache behavior, real auth/CSRF/session isolation, denied cross-principal scope and mobile/tablet/desktop navigation. A build exit0 alone is insufficient. |
| Chat/stream | Actual built-server SSE or approved transport, authorized reconnect/replay, polling fallback, session revocation, independent private notes/read markers and restart recovery; no assertion from development mode alone. |
| Money/jobs | Simulated boundaries with actual PostgreSQL transactions/outbox; callback retry/order/unknown, stock/payout races, paid-versus-collected distinctions and consent suppression; instrument no external dispatch. |
| Restart | Graceful stop/start of web and worker independently; committed orders/messages/jobs survive and converge once; unknown outcomes retain original operation IDs. Do not kill unrelated processes or change host time. |
| Restore | Restore synthetic database plus private artifacts into a different positively verified local target; keep external dispatch off; recheck ledger/stock/order/commission/job identities, permissions and artifact access before resuming jobs. Never overwrite the source DB as a rehearsal. |
| Evidence | Record commands, selected cases, test counts, process versions, scope, screenshots/interaction evidence and limitations in repository BUILD-LOG/STATUS with canonical task references. Independent visual review/design gate applies to built UI. Missing physical/in-app browser evidence remains explicit. |

Sunday/cutoff remain owner-held production-policy questions. Local scenarios may use an explicit versioned TEST-ONLY weekday/cutoff calendar and injected clock to exercise boundaries without claiming the owner selected that rule. Production calendar activation remains blocked until confirmed; local fixture/mock execution is not blocked by that missing decision. Shipping closures never extend payment TTL or create receipt/money proof.

## Executed Command Registry and Runner Filtering

Root README owns one actual command registry after T-23 setup; root AGENTS points to it. For each install/start/build/migrate/seed/test/browser/worker/backup/restore command, record working directory, exact command, required local service/mode, purpose, expected nonzero-on-failure behavior and safe evidence location. Task records reference those commands and their case identifiers; replace prospective examples only after actual scripts exist and run. Documentation examples are never claims of installed tools.

Do not assume generic `--case` is supported. Select the project's installed runner, inspect its help, and use verified native filtering (file/project/test-name or equivalent). For browser checks Playwright supports its documented test selection/project options, but configure and inspect actual projects before using them. Do not invent unit/integration frameworks, project names or flags to preserve an old planning command. Update task command references to the real registry while preserving requirement IDs and test meaning.

Every required filtered run must prove a nonzero intended test count and identify selected cases. Reject unknown/unmatched filters, zero tests, silently skipped required services, required cases marked skip/todo, and success-by-fallback to a different server. A runner's permissive empty-run setting cannot turn a required checkpoint green. Report optional unavailable physical/provider environments separately; they do not waive required local cases or imply provider PASS. Run focused checks after each slice and one assembled regression when the application is integrated; repeat broader checks only for changed code or unresolved findings.


Local identity configuration must use one recorded canonical loopback origin (scheme, host and port) consistently across web, browser tests and auth callbacks. Do not alternate localhost and127.0.0.1 while assuming their cookies are shared. Test actual installed Better Auth cookie/origin behavior in the production build; if the chosen secure transport needs local TLS, verify and document that local setup. Never relax production trusted origins, session validation or CSRF globally to make a local test pass.


## S01–S02 implementation record — 2026-10-16

The canonical repository foundation now uses the separately inspected `create-next-app@16.4.1` API template, exact direct dependencies and a lockfile. See root README for the actual command/version registry. The local launcher and Next config enforce the canonical `http://127.0.0.1:3099` listener/profile; config tests reject absent/live/mixed modes, provider settings and non-isolated database URLs. PostgreSQL 18.6 is selected for S03, with loopback port 5499 and isolated local/test database names; its runtime/migration proof remains pending. Lifecycle install scripts are disabled; Node's built-in runner exercises the configuration/startup boundary. No application UI, login, domain transaction or worker acceptance follows from this bootstrap.

The owner additionally confirmed SVG-only functional iconography and concise, specific product copy without emoji/emoticon decoration or AI filler. The design-system contract owns this rule; AGENTS carries it into future implementation slices.


S03 refinement — the planned local TCP database port was superseded before use by a private Unix-socket profile on this POSIX host. Docker network_mode none, no published ports, owner-only parent/socket permissions and separate database/application roles isolate the synthetic data without creating or reading credentials. The official image's3775 socket directory remains behind a0700 parent and its socket is0700. Same-user/root isolation and production credential policy are not claimed. Root README owns exact start/migrate/stop commands and the pinned image digest remains in compose.yaml.


## S11 implemented local identity/clock harness

Root README registers the executable fixture command and integration-only seed-foundation selector. Apply additive migration0006 to isolated local/test databases; existing migrations0000–0005 are unchanged. Seed creates only its explicitly named synthetic identity/warehouse dataset, preserves rerun state and provides no reset/import/live mode. Concurrent first runs serialize. Private credentials/factors/URLs are neither printed nor stored in execution artifacts. Recover seeded accounts through real auth and durable local delivery; rendered recovery remains its frontend slice.

Clock advancement is per namespace, positive, bounded to366 days per call and compare-and-set versioned. It never changes the OS clock or real session, MFA or recovery-token expiry. A copied namespace or clock does not grant application access. Domain scenario consumers must explicitly bind the trusted local namespace clock. The S11 integration suite proves real PostgreSQL identity/rerun/concurrency, auth/MFA, worker delivery, inbox isolation, clock conflict/reconnect and invalid target/reset refusal. This checkpoint does not claim the fourteen later provider/business scenarios or full localhost acceptance.


## S12 implemented worker claim/recovery primitives

Root README registers the integration-only PR-16 primitive checkpoint. Additive migration0007 enlarges the existing outbox status constraint and adds lease/dispatch/attempt/receipt fields; no history or business row is removed. Existing atomic notification worker tests remain required. Leased outside-transaction calls use30-second ownership tokens and a25-second abortable deadline. Unstarted expiry may requeue within the finite cap; started expiry or a thrown/malformed/timeout response becomes unknown. Reconciliation claims the original identity and delays unresolved lookups30 seconds. Only verified no-effect/final result settles it; failed dead letters retain their row.

Controlled test workers use real independent PostgreSQL connections/processes and committed barriers before SIGKILL, without sleep-based race assumptions or host-clock changes. Tests inspect effect/receipt counts, lease fencing, restart, no redispatch after a committed unknown effect, safe backoff and exhausted attempts. No live provider protocol or automatic bank transfer is inferred. Domain handler registration, issued receipt verification and full PR-16 economic invariants remain later consuming proof.


## S13 policy/version and contract-tool checkpoint

Apply reviewed additive migration0008 to both isolated databases. Historical policy versions reject update/delete; stream scope is immutable and head revision requires its appended version. Reproducible tests preserve history and archive only their own calendar warehouses. Root README owns PR-20 integration/browser commands and hash-pinned local format-tool setup. Source remains unchanged after final code checks; fresh document-sensitive traceability binds the final review surface.

S13 proofs include owner/MFA and all-role denial, two-owner conflict, request/response contracts, old immutable version lookup, TEST-ONLY calendar/purpose/warehouse binding and proof expiry during an observed database lock wait. They do not substitute for future actual order/commission/payout snapshot checks or production calendar approval. Sunday/cutoff and authoritative holiday activation retain their prior production gate. No external dispatch, secrets or remote deployment is involved.

## S15 inventory worker/migration checkpoint

Migration0010 is applied to both isolated local/test databases and immutable; any corrective SQL requires a new migration. Apply it before starting the inventory-aware worker because its selector references actual reservation/fixture tables. Database-only expiry processes a locked outbox row, releases the exact hold and records completion in one transaction. Its recoverable savepoint checks deferred inventory constraints before completing. Database timeout/deadlock/lock failures retry with capped1–60 second backoff and a finite max_attempts; malformed/state-invalid work becomes a retained failed row. No external provider is called.

Explicit fixture-clock deadlines may override a future wall schedule only when last_error is null; a retry delay always takes precedence. Not-yet-due work reschedules without consuming attempts. Tests launch actual workers and a shared production-processor crash fixture, kill only their controlled child after effect/completion but before commit, then prove one committed release after restart. A real100ms PostgreSQL timeout proves rollback, backoff and the attempt cap while another connection holds the actual stock row. No host clock, authentication clock or OS service is changed.

## S16 applied costs/publication checkpoint

Migration0011 is applied to both isolated databases and immutable. Candidate/applied rollback-only proof exercises exact source/version/completeness/arithmetic/history/sealing and owner exception restrictions. It adds six tables without rewriting earlier migrations. Current app schema has42 tables. The registered PR-19 selector executes9 native tests across4 files and one built Chromium flow; required empty/skipped/TODO and missing dependencies still fail.

Actual core proofs use PostgreSQL locks and real cookie/MFA/grant replacement for concurrent cost/publication reviewers, revoked finance permission and warehouse-scoped publication recovery. Browser proof includes actual unknown-cost transition and product-bound owner reauthentication through the built handlers. Synthetic browser auth bucket cleanup is limited to the isolated loopback profile; production rate controls remain enabled. Public storefront/admin visual work is not changed here. Final bound independent R3 review is required before S16 acceptance; no remote deployment/provider compatibility is inferred.


## S17 implemented boundary

S17 additive0012_shipping_promotion_budget.sql and its snapshot were probed rollback-only before isolated local/test apply. Applied0000–0012 remain immutable;51 actual tables each. Worker promotion expiry uses the actual shared transaction/savepoint/completion path, scenario-aware due selection with retry-backoff preservation and finite dead letters. S63 must detect failed expiry jobs with active holds and provide explicit operator recovery; ordinary live release remains unauthorized.


## S18 host seed runtime

No migration is introduced; immutable0000–0012 remain51 actual tables per isolated target. fixture commerce is a developer-host command using repository auth acceptance helpers, not a container startup hook or public route. Its temporary synthetic verified/MFA operator is removed after the run, with generated private material confined to memory. It never resets existing credentials/roles/clock. Dedicated transaction advisory locking outside the domain pool plus unique natural identities allows rerun after partial domain commits; an expired initial stock hold is preserved, not extended. Missing current policy or unknown cost leaves draft/blocker metadata. Actual localhost commerce-demo, native7 and built SVG browser1 are required evidence; historical fixture money/provider events remain input-only until owned domain scenarios execute.

Seed CLI does not reset shared loopback auth rate limits. SIGINT/SIGTERM abort and clean up the exact temporary operator; real auth sessions retain normal refreshable Better Auth7-day expiry. SIGKILL/host failure can leave a namespace-tagged synthetic account and active session until normal expiry or explicit scoped revocation, requiring S63 inspection/recovery. The actual client10s statement timeout bounds advisory lock waits; no permanent domain-pool reservation is used. Native proof includes six simultaneous blocked callers, preserved sign-in limit, and SIGTERM while a verified/MFA operator waits on the namespace lock.


## S20 acceptance and additive migration boundary

Review candidate0013 before applying to isolated test/local PostgreSQL;0000–0012 remain byte-for-byte immutable. Rollback-only SQL probes must reject partial/seal failures, changed history, foreign quote/fulfillment/lot links, invalid money and unapplied transitions. Real HTTP/domain/browser checks cover normal wall time plus explicit host scenario clocks, guest bootstrap, current account/context/capability isolation, revoked/expired/wrong-purpose/mixed credentials, version/publication/rate/promotion/stock conflicts and duplicate/concurrent/unknown-result submit recovery. No credential-bearing HAR/trace/log artifacts.

Built localhost browser evidence establishes transport behavior; checkout UI belongs to S26 and storefront S21/S22. Rate phase has a bounded total acceptance deadline with each request using the remaining budget. Recipient/address input rejects control and bidi-format characters before later shipping labels. Worker crash/rollback/racing expiry must conserve both holds and order event/job effects. Independent actual R3 review binds the final surface before S20 acceptance. No live provider, payment, DNS, release or remote deployment is authorized.
