# 99ribu

Indonesian commerce application. The accepted stack is Next.js/TypeScript, PostgreSQL/Drizzle and Better Auth, with shared domain modules and a separate durable worker.

The documentation pack was promoted on 2026-10-16. All 68 ordered localhost development slices (`S01`–`S68`) across the 38 local parent tasks (`T-1` through `T-39`, excluding deferred external `T-19`) are implemented, migrated (`0000`–`0024`, 204 PostgreSQL tables), built in `NODE_ENV=production` with `APP_ENV=local`, and verified against isolated local PostgreSQL (`99ribu_local` / `99ribu_test`), real Better Auth + MFA, durable outbox worker, and headless Chromium (`390x844`, `768x1024`, `1440x900`). External live-provider credentials, physical printer/scanner hardware, and production hosting/deployment remain explicitly gated outside localhost acceptance (`RELEASE.md`).

## Start here

- [STATUS.md](STATUS.md): current state and exact resume action.
- [TASKS.md](TASKS.md): sole execution queue, 39 parent tasks and 68 ordered development slices.
- [PRD.md](PRD.md) and [specification index](docs/spec/README.md): accepted product, API, data, design and UX contracts.
- [AGENTS.md](AGENTS.md): repository instructions for AI terminal development.
- [DECISIONS.md](DECISIONS.md): sole decision index, linking accepted decisions and proposals.
- [BUILD-LOG.md](BUILD-LOG.md): executed evidence and its limits.

Root contracts and `docs/spec/` are canonical. The former Documents staging copy and `docs/spec/handoff/root/` templates are historical inputs. [Promotion inventory](docs/spec/promotion-manifest.json) records original and reconciled hashes.

## Verified planning commands

Run from the repository root. Python 3 plus PyYAML and jsonschema are required for the OpenAPI checker; task/fixture checks use the standard library.

```bash
python3 docs/spec/scripts/development-task.py check
python3 docs/spec/scripts/development-task.py list
python3 docs/spec/scripts/development-task.py prompt S01
python3 docs/spec/scripts/development-task.py review S01
python3 docs/spec/scripts/check-openapi-contract.py
python3 docs/spec/scripts/check-localhost-fixtures.py
```

The task helper prints instructions; it does not execute tasks or mark them complete. The staging-only bootstrap rehearsal is retained as historical tooling and must not be run from this repository.

## Local runtime foundation

Use Node **24.21.0** and npm **12.2.0** (exact engines and `.node-version`). The `.env.example` profile contains only non-secret local settings. The one canonical origin is **http://127.0.0.1:3099**; aliases and alternate listener arguments are rejected. S03 uses PostgreSQL **18.6** through a private Unix socket, with isolated `99ribu_local` / `99ribu_test` databases and separate owner/application roles. No database TCP port is published. This supersedes the unprovisioned S02 port5499 proposal.

```bash
npm ci --ignore-scripts
npm run check
npm run build
npm start
# In a second terminal while the built server is running:
npm run test:smoke
```

`npm run dev` starts the development server at the same origin. Stop the foreground server with Ctrl+C. Both supported launch commands bind only to loopback. Next configuration also rejects direct CLI listeners outside this exact host/port. Do not add CLI overrides to these commands.

`npm test` runs non-watch Node-native configuration/startup and acceptance-runner regressions. `npm run typecheck` generates Next route types then runs TypeScript. `npm run lint` uses pinned Biome without fetching a transient runner. `npm run test:smoke` requires a running built server and fails if it is absent; the current `/` response is the S21 storefront HTML **200**. Storefront visual acceptance remains pending, and `/api/health` is the separate readiness probe.

`APP_ENV=local`, explicit simulated adapter modes and disabled external dispatch are required even with `NODE_ENV=production`. Inherited conflicting values fail validation rather than being silently replaced by `.env.example`. No provider/account configuration belongs in this profile. The guard is not an OS network sandbox; every future sender/worker must independently enforce simulated-only dispatch. Future credentials are supplied through the approved secret mechanism, never committed or printed.

The official create-next-app **16.4.1** `app-api` template was generated separately with no install/no Git; only the reviewed config/manifest/type files were adopted. The sample wildcard handler was omitted. Commerce pages and visual acceptance remain later slices. Cache Components were not enabled for this foundation; revisit only with a route-specific contract.

Pinned direct application/tool dependencies:

| Package | Version |
|---|---|
| `next` | 16.4.1 |
| `react` | 19.3.1 |
| `react-dom` | 19.3.1 |
| `drizzle-orm` | 0.45.4 |
| `postgres` | 3.4.9 |
| `better-auth` | 1.7.10 |
| `typescript` | 5.9.3 |
| `@types/node` | 24.19.2 |
| `@types/react` | 19.3.0 |
| `@types/react-dom` | 19.3.0 |
| `drizzle-kit` | 0.31.11 |
| `@playwright/test` | 1.64.1 |
| `@biomejs/biome` | 2.5.15 |

The lockfile pins transitive resolution and integrity. Lifecycle install scripts are disabled in `.npmrc`. A clean locked install and the resulting native binaries must pass before calling a new platform supported. Biome replaces the generated ESLint 9 dependency because that version is deprecated while the current React ESLint plugin does not accept ESLint 10; no peer-dependency override is used.

Known toolchain limit: the stable Drizzle Kit dependency chain currently includes the moderate esbuild development-server advisory [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99). No esbuild server or Drizzle Studio is enabled; migration generation/runtime tests are owned by S03. Do not apply npm's suggested incompatible Drizzle downgrade. Reassess the advisory before exposing any database tooling.

Version/command references: [Next generator](https://nextjs.org/docs/app/api-reference/cli/create-next-app), [Next 16.4.1 security fixes](https://github.com/vercel/next.js/releases/tag/v16.4.1), [Node release policy](https://github.com/nodejs/Release/blob/main/README.md), [PostgreSQL version policy](https://www.postgresql.org/support/versioning/), [Biome installation](https://biomejs.dev/installation/quick-start/). Installed Next documentation lives in `node_modules/next/dist/docs/`.

Follow root STATUS and the sole TASKS map for the current slice; domain and rendered UI acceptance remain separate from these foundation checks.


[ARCHITECTURE.md](ARCHITECTURE.md) records what actually exists. [RELEASE.md](RELEASE.md) separates localhost acceptance from deployment. [OBSERVABILITY.md](OBSERVABILITY.md) records runtime probes once implemented. `.delivery/` contains tool-generated evidence.

## Isolated database and private files

On this POSIX/Docker host, the database uses a worktree-specific Compose project, digest-pinned official PostgreSQL image, no network interfaces and no published ports. Data and socket files live under ignored `.local/`, whose parent is mode0700 and owned by the current user. The socket is0700. The official image sets its socket directory to3775 at each start; access remains blocked by the private parent. Unix trust authenticates processes already authorized by that OS boundary; it is not a production credential scheme or isolation from the same OS user/root.

```bash
npm run db:up
npm run db:migrate -- local
npm run db:migrate -- test
npm run test:database
npm run test:storage
npm run db:status
npm run db:stop
```

`db:up` is idempotent for this worktree; `db:stop` preserves its data. No reset/drop/delete command is provided. Existing project containers are untouched. `db:generate -- --name=<change>` creates migration SQL for review; it does not apply it. `db:migrate` accepts only local/test, uses the owner role, and records applied history through Drizzle. Domain table definitions belong in `src/db/schema.ts` or their imported modules; existing applied SQL is never edited.

Application roles can use the app schema and its data but cannot create schema objects or connect to the other database. The client refuses DATABASE_URL and PG* connection overrides; only the validated private socket/profile is used. Database tests must fail if that service is unavailable. Storage routines write immutable random UUID artifacts at0600 under private `.local/artifacts/`, reject traversal/symlinks/broad permissions and expose no HTTP route. Future domain endpoints must authorize each artifact read/write before calling these routines.

Migration0000 initializes the private app schema. Migration0001 records that already-created schema in the generated Drizzle snapshot with an idempotent statement; the previously-applied0000 history stays intact. No commerce tables are claimed by this namespace foundation.


## Local identity foundation

Better Auth1.7.10 uses the real Drizzle/PostgreSQL adapter and migration0002. Browser signup, email verification, login, logout, session read and password recovery are explicitly allowlisted under /api/auth. Other built-in endpoints stay404 until their product contracts are implemented. Tokens are carried by host-only HttpOnly SameSite=Lax cookies, never returned in auth JSON. Secure is disabled only inside the validated HTTP loopback profile; a live HTTPS profile requires its separate review. Cookie session caching is disabled so revocation reads the database. This account-login requirement does not make buyer email mandatory for guest checkout. Signup never grants staff access; S09 owns explicit role/object grants and required staff MFA.

The runtime creates independent local/test signing material using48 random bytes, exclusively at0600 beneath0700 .local/auth/. It persists across process restart and refuses corrupt/broadened/symlinked files; there is no constant fallback or automatic overwrite. The agent never prints or opens these runtime values. External auth secrets/origin overrides are rejected. Recovery/backup must preserve this private material alongside the database. This local-only generation is not a production secrets-management scheme.

Only synthetic .test/.invalid email addresses are accepted. Verification/reset intents persist in private app.local_delivery; no SMTP or public inbox route exists. Links expire after30 minutes. Expired inbox rows are pruned on the next local delivery; scheduled retention and developer fixture access remain later worker/fixture owners. Passwords require12–128 characters. Password reset is single-use and revokes all sessions. Verification does not automatically create a session. Public signup/reset responses hide whether the address exists; source-backed Better Auth hashing and reset behavior remain authoritative.

```bash
npm run test:auth
# With the built server and database already running:
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:auth:http
```

The HTTP check uses the installed Chromium155.0.8059.39 on this host. Omit PLAYWRIGHT_CHROMIUM_EXECUTABLE when a matching Playwright-managed Chromium is installed. A missing browser/server/database is a failure, not a skipped result. Tests create/delete only their own synthetic actor rows; test:auth also resets its fixed test-database loopback rate buckets and must not run concurrently against that same test database. The HTTP test preserves local rate buckets, so repeated runs can correctly hit the configured rate limit. The probe now creates a pending message through the real web server, owns a separate local worker process, waits for delivery and stops that child. Run it with no other local worker; preserve rate-limit windows between repeats. This is a browser cookie/API probe, not storefront UI acceptance.

Next16.4.1 internally normalizes127.0.0.1 to localhost in NextRequest.url. The auth boundary accepts that representation only with the exact actual Host127.0.0.1:3099, rebuilds the canonical URL, and rejects browser-origin/Host aliases. Proxy IP headers supplied by callers cannot change the fixed local limiter identity. Persistent per-endpoint limits are enabled in development and production builds; request bodies are bounded to16KiB.

Sources checked against the installed package: [email/password](https://www.better-auth.com/docs/authentication/email-password), [Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle), [rate limits](https://www.better-auth.com/docs/concepts/rate-limit). Next normalization is verified by installed source and a real NextRequest regression plus the built browser check.


## Durable local worker

```bash
npm run worker
# One due job, then exit (an empty queue is a successful no-op):
npm run worker -- --once
npm run test:worker
```

Run from the same worktree as web and after applying migrations to local/test. The worker has no HTTP listener. Ctrl+C/SIGTERM finishes the current SQL transaction and closes its pool. Its readiness line appears only after the outbox table is reachable. Missing/live/mixed adapter profiles and unsupported arguments fail before readiness. Database errors exit nonzero without marking work complete; fix the cause and restart.

Migration0003 adds the durable outbox and inbox delivered_at marker. Auth delivery callbacks atomically insert a private delivery intent and a unique outbox reference in their own transaction; this does not claim atomicity with Better Auth's separately owned signup transaction. The worker revalidates the local profile at each dispatch, locks one due job with FOR UPDATE SKIP LOCKED, performs the local SQL delivery and marks completion in the same transaction. No URL/token payload is copied into the outbox and no external sender exists. Two consumers cannot complete the same job twice; process death before commit leaves the pending job available to its replacement. Invalid payload/recipient/destination and unknown job kinds become explicit failed rows.

This S05 worker only performs database-local effects. S12 owns leases, bounded retries, dead-letter recovery and unknown-outcome reconciliation before work can occur outside a transaction. Do not add network calls inside this handler. Worker tests use their own synthetic test-database IDs and actual child processes, including a bounded crash while a real database lock is held; do not run them concurrently with auth tests on that database.

Append-only migration0004 preserves pre-S05 inbox deliveries by copying created_at into delivered_at only when no corresponding outbox intent exists. New queued intents stay pending. The upgrade fixture verifies both sides; applied0003 is unchanged. Raw SQL JSON parameters are serialized explicitly because the installed Drizzle postgres.js adapter changes the client's JSON serializer. Both the raw worker and Better Auth adapter use this same connection contract.

Locking semantics: [PostgreSQL18 SELECT locking clause](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE). Future release orchestration and restart supervision remain separate tasks.


## Acceptance command registry

Run from this worktree with migrations applied to local and test. Use the exact commands below; selectors from later task procedures remain unimplemented until their owning slices add verified cases. Each implemented selector is documented in its checkpoint section below. The small wrapper selects Node-native test files and checks their events; it introduces no separate test framework. Missing/unknown/duplicate/extra selectors, skipped/TODO/cancelled tests, empty files and failed checks produce a nonzero exit. A missing database fails preflight before tests run. Files run serially; do not run another acceptance process against the same databases concurrently.

| Command | Required state | Executed scope |
|---|---|---|
| `npm run check` | Locked dependencies installed | Lint, generated Next types/TypeScript, 30 configuration/startup/runner tests |
| `npm run build` | Valid local profile | Production build; does not prove UI or database behavior |
| `npm run test:integration -- --case=foundation` | Isolated test DB migrated and running | 5 files, 24 database/storage/key/auth/worker checks |
| `npm start` | Successful build | Web at `http://127.0.0.1:3099` only |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=foundation` | Built web + local DB; no other local worker; Chromium installed | 2 files, 3 HTTP/cookie/worker-delivery checks |
| `npm run health -- ready` | Built web + local DB | Exact 200 readiness envelope and no-store |
| `npm run health -- unavailable` | Built web running; owned DB intentionally stopped | Exact 503 unavailable envelope and no-store |

The browser executable above is host-specific; use a verified installed path or omit the variable for Playwright-managed Chromium. Missing browser/server is a failure. Keep the auth rate-limit window between repeated browser runs. On suite failure, run its registered native `test:database`, `test:storage`, `test:auth`, `test:worker`, `test:smoke` or `test:auth:http` command to isolate the cause; the aggregate prints bounded test names/counts, not captured child output that may contain private fixtures.

`/api/health` reports only current web-to-database/schema availability. It checks access to identity and outbox tables without reading user rows. It does not attest worker liveness, commerce functionality or remote availability. The root remains503 until its storefront owner implements it. See [OBSERVABILITY.md](OBSERVABILITY.md) for failure and recovery commands. Browser cookie proof is not rendered storefront acceptance.


## Responsive composition prototypes (S08)

With the built loopback web running, open <http://127.0.0.1:3099/prototypes/index.html>. The screen selector exposes home/search, product, checkout, order/return, affiliate, warehouse and chat compositions. Every screen is labeled as prototype data. These static fixtures make no domain/API calls and create no orders, messages, transfers or auth sessions; the actual root storefront remains unimplemented. CSP denies outbound connections/form submissions. Keep this review surface out of a future live release unless explicitly retained.

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:prototype
```

The command runs pinned Biome plus36 Node/Playwright checks. It captures nine screens at390/768/1440 and exercises query/filter/Back, modal keyboard focus, checkout validation/stale-quote input retention, split COD review, pending payment return, unsent chat draft, warehouse filtered-zero and320px/200% text. Captures live under `docs/spec/design/renders/s08/`; the selected composition and critique remain in the canonical design document. A missing browser/server fails. Real OS virtual keyboard/IME, Safari/native WebView and full commerce behavior require their later evidence.

Inter4.1 is self-hosted with its OFL license. Functional inline Lucide SVGs are pinned to the recorded source commit with the ISC license; `public/prototypes/assets.json` owns source and hash details. Product photo slots are explicitly labeled pending owner-content assets. No emoji/emoticon icons or invented product photographs are used. Independent visual review and the design gate must pass before S08 is accepted; screenshots and green tests alone do not supply that approval.


## Staff access and MFA (S09)

Apply migration0005 to both isolated databases before starting this build. It adds explicit role grants, warehouse membership, encrypted Better Auth factor/recovery records, session-bound MFA proof, reauthentication proof and operation identity, plus append-only audit events. Existing migrations0000–0004 are unchanged. TOTP enrollment and verification/recovery are the only added public vendor auth paths; trusted-device, disable and factor-secret retrieval are refused. Staff sessions without a successful factor bound to that session fail with MFA_REQUIRED. Buyer/affiliate identities gain no staff authority through signup or request headers.

The built application now mounts GET /api/v1/me, GET /api/v1/admin/warehouses, POST /api/v1/me/reauthentication-proofs and POST /api/v1/admin/role-grants. Grant replacement is owner-only, requires a fresh password check plus MFA within five minutes, expected_version and an Idempotency-Key. Its proof is session/action/target bound, expires in five minutes and is consumed transactionally. Replaying the same operation returns the stored result; changed intent conflicts. Target sessions are revoked on successful role changes. Owner bootstrap, operator UI and domain-specific order/fulfillment/export handlers remain their later slices; no public owner-signup bypass exists.

```bash
npm run test:integration -- --case=PR-13
# With the newly built server, migrated local DB and installed Chromium:
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-13
```

The integration selector executes five real PostgreSQL scenario groups: all seven roles/guest and scoped projections; atomic grant concurrency/replay; expired proof/fresh-factor/persistent rate limits; exact-session MFA and recovery reuse; database-observed blocking during competing owner demotion/session deletion. The browser selector executes one actual built-server cookie/MFA/warehouse-scope probe. Integration fixtures use only the isolated test database and clear their own fixed auth rate buckets; do not run auth/integration suites concurrently against it. Browser probes preserve local rate limits. Tests retain append-only synthetic audit events and delete only their own mutable fixtures. Pure order/finance/export access predicates are verified, but actual business handlers and their acceptance must be tested when implemented.

S09 has no visible auth/admin screens. The static S08 prototypes remain a separate composition preview. The complete first-party OAS transport/error/operation registry alignment is S10; a structural planning-contract pass does not establish every proposed endpoint or native bearer support.


Local MFA limits use the fixed loopback address, so concurrent local users share each auth-path bucket. This is a local-profile constraint, not a production proxy/rate-limit design. Initial enrollment trusts the verified email/password session; controlled owner/staff onboarding must protect that first enrollment. Proof/operation retention and administrative audit retention remain explicit downstream operations/privacy work, not an implied deletion policy.


## Implemented API parity (S10)

The S10 checkpoint established four implemented access operations; S13 adds two policy operations. Canonical OpenAPI maps every implemented operation to its adapter and executable proof group. All operations have registered domain ownership; proposed visitor/guest/native transports remain unissued. The actual local origin is http://127.0.0.1:3099, and cookie-only access rejects mixed bearer/capability headers. JSON body limits, retry keys, pagination and private errors match the selected contract.

```bash
npm run test:integration -- --case=PR-18
# Requires the current production build running on127.0.0.1:3099:
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-18
python3 docs/spec/scripts/check-openapi-contract.py
npx --no-install @redocly/cli@2.64.0 lint docs/spec/openapi.yaml --extends recommended --format summary
```

PR-18 validates observed synthetic request/response exchanges against the canonical OAS through the already installed Python PyYAML/jsonschema packages. Missing dependencies fail. Integration uses isolated test PostgreSQL; the browser uses synthetic local fixtures and real cookies. Run database suites sequentially. No raw credentials/proofs are written to evidence. Domain-handler parity grows with implementation and is audited comprehensively in S64.


## Namespaced synthetic fixture harness (S11)

Migration0006 adds fixture namespace/principal/warehouse ownership mappings and a persisted business clock. It creates no seed data. Seed translates the existing eight synthetic principals and two warehouses only; catalog/stock/cost translation remains S18. Each namespace keeps stable real auth and warehouse IDs. Rerun preserves password recovery, factors, role edits, warehouse edits and clock advancement, and never wipes other rows. Namespaces isolate harness setup; owner company permissions retain their canonical scope.

```bash
npm run db:migrate -- local
npm run db:migrate -- test
npm run fixture -- seed local demo
npm run fixture -- clock local demo
# seconds and expected clock version are explicit:
npm run fixture -- clock local demo advance 86400 1
npm run test:integration -- --case=seed-foundation
```

The seed reports IDs and clock metadata only. Initial passwords are random, hashed with installed Better Auth crypto and discarded; seed does not print credentials or bypass staff MFA. Account recovery uses the real auth/outbox/inbox path. The trusted host-side inbox helper requires matching namespace/principal and returns only delivered, unexpired messages; `npm run fixture -- inbox local demo PRINCIPAL_ID` prints safe metadata, never private URLs. Rendered local account/recovery entry remains S52.

Business clock updates use optimistic versions and cannot move backwards. Each advance is at most366 days. They never change host time or real auth/session/MFA expiry. Future scenario consumers must explicitly use this clock through a trusted context. No reset command exists; unsafe/remote targets and mixed/live config fail. Run database integration suites sequentially. The full T-38 provider/domain scenario set remains unaccepted until its owned later slices pass.


## Durable job and recovery primitives (S12)

Migration0007 extends the existing outbox with processing/unknown states, token-fenced30-second leases, dispatch markers, finite attempts and bounded safe receipt metadata. Database-local notifications retain atomic effect/completion. Registered server adapters use the same worker entry point for effects outside that transaction; no vendor adapter is enabled by this checkpoint.

```bash
npm run db:migrate -- local
npm run db:migrate -- test
npm run test:integration -- --case=PR-16
```

The PR-16 integration selector currently proves S12 primitives only; full commerce reliability remains domain/assembled-localhost acceptance. Eleven checks include forced locked-row contention by two real worker processes, committed barriers and SIGKILL before/after effect, stale lease fencing, lost-response reconciliation, finite backoff/dead-letter, malformed outcome and adapter deadline. Test-only workers stay on the isolated test DB. A copied job ID is no public recovery credential; proposed operation HTTP recovery remains pending.

Worker leases renew only while owned/unexpired. Adapter calls have a25-second deadline/AbortSignal; raw errors map to UNKNOWN_OUTCOME. Unknown lookups wait30 seconds after uncertain results or expired started/reconciliation leases. Outcome status/code pairs are validated together; ambiguity stays unknown. The deadline remains referenced so a lost idle connection cannot end the worker before settlement. Retryable means verified no-effect, not an arbitrary network error; reconciliation must prove the original attempt cannot subsequently apply before allowing retry. Retries keep the original job/effect identity and use bounded1–60-second backoff, at most the persisted1–10 attempts (default5). Terminal failed rows remain as dead letters; uncertain results stay unknown even at the attempt cap. Domain adapters own issued-contract receipt validation, bounded requests and registration. Production manual affiliate payouts remain manual; this worker sends no money.


## Development contract formats

The API checker and in-memory probes require active date-time, date, URI, URI-reference and UUID formats. Missing optional format packages fail explicitly; canaries reject impossible dates and invalid URIs. Base Python provides PyYAML/jsonschema. Install the hash-pinned format dependencies into the private project tooling directory. On this development host, standalone pip26.2.1 was used for tooling setup:

```bash
curl --fail --location https://bootstrap.pypa.io/pip/pip.pyz --output .local/pip.pyz
python3 .local/pip.pyz --isolated install --no-input --no-cache-dir --index-url https://pypi.org/simple --require-hashes --only-binary=:all: --target .local/contract-formats -r tests/contract/requirements-formats.txt
python3 tests/contract/formats.test.py
```

The local foundation creates the private .local parent first. Tooling files are ignored by Git. The pins/hashes come from the published [RFC3986 validator](https://pypi.org/project/rfc3986-validator/) and [RFC3339 validator](https://pypi.org/project/rfc3339-validator/) distributions; the setup follows [PyPA standalone pip instructions](https://pip.pypa.io/en/stable/installation/#standalone-zip-application). No application runtime package was added.


## Versioned company and calendar policies (S13)

Migration0008 adds policy heads and immutable versions. Owner cookie/MFA is required for GET/POST /api/v1/admin/policy-versions. GET returns bounded history, latest_version for optimistic edits, and current for the effective policy. POST includes expected_version, reason, stable retry key and a five-minute purpose/subject-bound proof. Null effective_at activates at trusted server time; an explicit UTC millisecond instant must be prospective and not precede the latest scheduled version. Exact committed retry recovers the original version/instant.

Commercial values accept default_commission_bps and minimum_payout_idr. Fixed price99000, IDR and manual payout remain invariants. Calendar values match their warehouse timezone, carry year/weekdays/cutoff/closure dates and enforce TEST-ONLY/test_only. Historical versions and stream scope cannot be rewritten. Immutable calendar references retain archived synthetic test warehouses; tests never wipe policy history. Real order/commission/payout consumers still own their snapshot integration.

```bash
npm run test:integration -- --case=PR-20
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-20
```

The access proof endpoint now permits reviewed company_policy.version and warehouse_calendar.version purposes in addition to staff_roles.replace. Issuance idempotency spans purposes in the same session; changing purpose/subject with the same key conflicts. Calendar UUID subjects normalize case. Consumption uses wall time after a database lock wait; expiry rolls back the entire mutation. Rechecks lock current owner/session/factor rows. No raw proof/password is stored in policy/audit results. OAS proof groups cover access and settings independently while preserving complete implemented-operation registration.

S13 scheduling bound: prospective activation uses database wall time and rejects dates more than 366 days ahead with 400 POLICY_SCHEDULE_TOO_DISTANT. Earlier-than-last scheduled appends return 409 SCHEDULE_CONFLICT; failures roll back proof consumption. This bounded append-only schedule has no cancellation endpoint. Shipping consumers must independently verify calendar-year coverage for every calculated business day; S13 does not calculate shipping deadlines. Scenario setup must append its own explicit policy inputs rather than relying on policies left by earlier tests.

## Inactive catalog checkpoint (S14)

```bash
npm run test:integration -- --case=PR-1
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-1
```

The PR-1 selector covers inactive S14 catalog only. Eight private catalog operations create/list taxonomy and physical SKUs and create/read/edit products. Each unit, multipack or bundle is one IDR99000 offer; component quantities add no separate charge. Product edits use expected_version and explicit create/update/retire changes. Identity, original components and old revisions remain immutable. Catalog writes consume current real cookie/MFA/warehouse scope and atomic actor-scoped retry identity. Tests retain synthetic catalog history and archive only their own warehouses. Publication/media/category/HPP guard belongs to S16, real stock races to S15, and real order snapshots to checkout. No UI, published stock, order or full PR-1 acceptance is implied by this selector.

## Physical inventory checkpoint (S15)

```bash
npm run test:integration -- --case=PR-2
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-2
```

The PR-2 selector executes14 native checks across4 files and one built-browser flow. Twelve private HTTP operations cover scoped lots/positions/movements and transfer list/detail/create/dispatch/receipt/cancel. Transfers preserve batch identity, reserve before dispatch, remove source stock only on dispatch and credit destination only on explicit per-source-position receipts. Partial/zero receipts remain exceptions; damaged/expired incoming units are quarantined. At most100 source positions belong to one transfer; split larger manifests.

Reservation functions are trusted server consumers, not customer endpoints. They aggregate every complete offer component across cart lines, lock positions in deterministic order and roll back an insufficient cart entirely. FIFO prioritizes known earliest expiry, then unknown expiry. Checkout holds expire within one hour; same intent never extends a deadline. Payment-confirmed retention and per-shipment checkout consumption must be implemented/reverified in S27–S30 before use.

Apply immutable migration0010 before starting the inventory-aware worker. Database-only expiry shares the transaction with its outbox completion. Scenario clock advancement can make a job due before its wall schedule but cannot bypass a retry delay; real database timeouts/deadlocks have bounded backoff and finite attempts. Invalid jobs become dead letters without stock effects. Normal HTTP uses wall time even for fixture warehouses; only an explicit trusted scenario consumer may choose a namespace. Auth/MFA clocks remain real.

The native suite proves actual shared-component/receiver lock contention, aggregate rollback, retry/revoked scope, batch expiry and worker crash/restart after an uncommitted effect. The browser validates all twelve operation schemas through actual MFA cookies. S15 independent review approved39 final fingerprints and its ledger finishedPASS. This does not complete storefront, checkout or the later inventory UI. STATUS owns the active S16 work.

## Prospective costs and publication checkpoint (S16)

```bash
npm run test:integration -- --case=PR-19
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-19
```

The S16 selector executes9 native checks across4 files and one built-browser flow. It covers prospective component HPP, explicit nullable offer assumptions, private contribution estimates and guarded publication. Actual recognized contribution/expenses/lot acquisition costing remain S34/T-12. Immutable0011 adds six tables;42 total. Never rewrite applied SQL/snapshots.

Owner/finance with current finance.costs.read/write permissions can use GET/POST stock-items/{stockItemId}/cost-versions and offers/{offerId}/cost-assumption-versions, plus GET products/{productId}/contribution-reviews. Versions are append-only, prospective, monotonic and bounded366 days. Null effective_from selects server acceptance time. Null costs stay unknown; explicit zero stays known zero. Source/reason, expected_version and actor-scoped retry are required. Returned current and latest_version distinguish effective versus future scheduled values. The commercial policy optionally sets minimum_contribution_idr; historical versions without it use initial floor0 without rewriting their JSON.

Owner/ecommerce staff use GET/POST products/{productId}/publications within current warehouse scope. Preview is safe: draft/publication versions, current review state and first100 blockers with total/truncation; no private cost amounts or exception text. Publication rechecks inherited required facts/types, media, dimensions, complete stock and effective financial source versions. It freezes exact component/assumption/policy references and independently verified arithmetic. Unknown/below-floor contribution blocks automatic publication. Only a fresh catalog_publication.exception proof bound to owner/session/product can authorize a recorded financial exception; missing catalog/stock facts cannot be overridden.

Editing a draft preserves the earlier published content. Changed cost/assumption/policy versions require renewed financial review for new sales; prior immutable estimates remain unchanged. Trusted storefront/quote consumers must reuse salePublication and complete stock/order guards. This checkpoint supplies no public storefront UI or actual checkout; those consuming slices remain pending. Native9/browser1 and actual37-path R3 review pass; S16 ledger is closedPASS. STATUS owns active S17 work.


## Shipping promotion checkpoint (S17)

```bash
npm run test:integration -- --case=PR-11
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-11
```

The PR-11 selector executes12 native checks across4 files and one built-browser flow. Five private company configuration operations cover list/create/detail/version history/append, current cookie/MFA owner/ecommerce authority, immutable expected-version edits, bounded integer IDR, closed JSON and actor-scoped committed retry. Configuration edits never reset lifetime campaign budget or customer quota. The old configuration stays immutable; history budget_state reports current counters. Committed campaign budget is not cash/expense.

Trusted reservePromotions accepts actual immutable offer references and authoritative shipping snapshots from later S19/S20. It recomputes99000 merchandise, honors current window/method/eligibility, applies priority/stable-ID stacking against remaining eligible shipping and uses exact BigInt largest-remainder allocation. Zero effects are omitted; insufficient budget/quota fails the entire selected benefit. Exact retries recover the same hold/deadline. PostgreSQL independently seals source references, amounts, per-shipment rounding, current rule versions and exact budget/quota movements.

reservePromotions/resolvePromotionReservation are transaction primitives, not guest HTTP authority. Stable server-derived customer_key is a quota pseudonym, never a credential. Requotes lock the union of old/new campaign IDs before release/reserve. Held rules survive configuration changes through their issued deadline. Consume commits reserved budget once; terminal consumed funds are not automatically credited. Paid retention/booking/verified cancellation must extend and reverify this boundary in S20/S27/S30/S31. Actual allocated promotional subsidy must pass current PR-19 financial checks in S19/S20.

The actual database-local worker observes ordinary wall time or an explicit trusted fixture namespace, releases only its own reservation and commits job completion atomically. Native checks cover real two-waiter budget/quota races, failed combinations, large safe-integer values, unsealed/wrong SQL allocations, two worker processes, SIGKILL rollback/restart, timeout/backoff/cap and malformed-job dead letters. A failed expiry leaves an active hold requiring S63 operator recovery; no endless silent retries are claimed. Visible admin forms remain S49+.


## Synthetic commerce seed checkpoint (S18)

```bash
npm run fixture -- commerce local commerce-demo
npm run test:integration -- --case=seed-commerce
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=seed-commerce
```

This developer-only host harness extends the S11 namespace with3 actual StockItems,4 complete99000 offers,6 physical positions, prospective nullable HPP/assumptions and one actual initial stock hold. It reuses the repository BrowserSession/enroll helpers to create a temporary verified/MFA synthetic owner, invokes real guarded domain writers, then removes only its exact temporary identity, deliveries and operation records. Existing shared auth rate-limit buckets remain enabled and are never cleared by this CLI. Existing fixture principals, passwords/MFA, roles, clock and domain edits remain intact. Generated passwords, verification URLs, MFA setup and cookies stay in process memory; output contains IDs, publication/blocker metadata and scope only. It requires the repository test helpers and is not an application/guest HTTP endpoint.

Concurrent seed callers serialize through a transaction advisory lock on a dedicated database connection, separate from the domain pool. Lock waits retain the database client10s statement timeout; lock release is automatic on transaction exit/disconnect. Unique namespace-prefixed SKU/category slug identities recover a partial run after a domain commit without a second fake database or reset targets. Existing cost history, draft edits, stock movement revisions and publication history are preserved. Empty physical positions initialize with actual receive/quarantine movements; reserved units use an actual namespaced checkout hold. An expired initial hold is never re-created or extended on rerun. Its business deadline follows explicit fixture clock advancement; auth stays on real time.

The seed requires an existing current commercial policy for automatic publication; without it, valid draft products report POLICY_UNCONFIGURED. It never creates/backdates policy or grants an owner financial exception. Known valid shirt/cream offers publish through the existing guard; missing bag HPP stays null, leaving bag/mixed offers unapproved. Current owner/session/MFA gates protect entry, bootstrap, inventory, reservation and final completion. Each catalog/cost/publication writer also retains its actual canonical current-role/session/MFA rule; catalog permits scoped ecommerce_admin, while finance costs require owner or an explicitly granted finance role. No historical orders, receipts, refunds, finance postings or provider scenario effects are imported by this checkpoint; those illustrative inputs retain downstream scenario owners.

TEST-ONLY initial assumptions per offer are packaging1000, provider fee1000, subsidy5000 and returns reserve1000 IDR. These conservative estimates are documented synthetic inputs, not issued provider prices; existing assumption versions are never overwritten.

SIGINT/SIGTERM abort the host seed and clean up its exact temporary operator after any current domain transaction. It uses the normal refreshable Better Auth7-day expiry. SIGKILL/host failure cannot run cleanup and may leave an active session until normal expiry or explicit scoped revocation; a synthetic account may remain, identified by the namespace plus seed-op email/name. S63 owns explicit scoped orphan-operator inspection/recovery; no mass account deletion is authorized.

Executed acceptance:7 native tests cover concurrent stable identities, true SQL-backed balances/costs/publications, nonowner/target/namespace/mixed-transport denials, rerun after actual cost/stock/draft changes and real worker expiry, plus two actual CLI runs with fresh temporary MFA owners, six callers blocked on one namespace without domain-pool starvation, an existing sign-in limit preserved through failed bootstrap, and SIGTERM cleanup of a real MFA operator waiting on the lock. One built browser test renders all four accessible, explicitly synthetic local SVG resources. This media proof is not completed storefront UX; S21 owns actual buyer pages.


## Trusted shipping domain checkpoint (S19)

```bash
npm run test:integration -- --case=PR-3
```

This integration-only selector runs9 native tests across3 files. No S19 buyer HTTP/browser route exists; S20 wires actual cart capabilities, persisted quote/selection and order authorization. Address normalization resolves the versioned TEST-ONLY canonical destinations/postcodes, preserves legitimate Indonesian street/recipient text, normalizes +62 contact and rejects fee/region authority. Reference districts/postcodes are explicitly synthetic and do not claim national/provider coverage.

The shipping planner loads actual current published offers/cost sources and eligible PostgreSQL physical balances, including shared component use, holds/quarantine and expiry. Complete offer units stay indivisible; different complete units may use different parcels/warehouses. It enumerates conservative upright-stack parcel layouts, compares actual supported simulated charges, then fewer parcels, more default-warehouse units and stable identity. Distinct identical parcels keep distinct IDs. Limits are50 units,20k visited search attempts,1k candidates and500 unique rate requests. Exhaustion returns ALLOCATION_REVIEW_REQUIRED; no unproven cheapest quote or greedy stock split is returned.

TEST-ONLY package policy uses max20kg chargeable weight/max1000mm side and volumetric divisor6000mm³/gram. These explicit local simulation parameters do not assert carrier contracts. Read-only rate adapter timeout is2s per request, with a3s rate-phase deadline; malformed adapter output produces a dependency error. Unknown/unsupported origins/routes, COD-ineligible options, expired rates, stale publication/cost and timeout preserve stock/budget and require review/retry. Actual shipment booking/funding remains later owned work.

Native proof compares supported consolidated/split plans, exact per-parcel parent totals and quantity conservation, a shared-SKU shortage and a bundle that cannot borrow components across warehouses, physical parcel splitting/unique IDs, actual stale cost/publication, unavailable/COD-only/expired/timeout states and strict address/rate boundaries. Preview creates no stock or money effect.

checkShippingBenefit evaluates actual S17 configured rule allocations against current source-bound financial approval. It allocates exact shipment subsidy to line quantities, then checks the worst integer per-unit share within each parcel. Complete above-floor units may proceed; unknown/below-floor units need a current owner publication exception with a known sufficient per-unit subsidy allowance. Another unit/parcel cannot extend it. Actual native tests also observe warehouse deactivation under a real PostgreSQL row wait and use real owner proof/publication and configured promotion, including the8k-one-unit/0-other-unit case that an aggregate10k allowance would wrongly permit. Returned financial source metadata stays internal; S20 must use a closed public quote projection.


## Cart, checkout and pending order checkpoint (S20)

```bash
npm run test:integration -- --case=PR-4
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-4
```

The selector executes11 native tests across6 files and one built-browser flow. Applied additive0013 adds12 tables (63 total in each isolated database);0000–0012 remain immutable. Real guest/account ownership, versioned complete-offer carts, immutable authoritative quotes/selection, normalized Indonesian address and separate optional-email buyer contact, original per-unit fulfillment/lot snapshots and atomic stock/subsidy holds share PostgreSQL transactions. Twelve checkout operations have observed success and denial parity; OpenAPI has50 implemented operations in total. Two new read paths recover the current browser cart and an owned quote after navigation.

Browser creation returns CartCreated/OrderCreated without plaintext credentials. Its first anonymous401 only establishes an HttpOnly guest context; acknowledged retry with the same key creates the cart. Explicit header-mode clients receive purpose-specific cart/order capabilities, with only digests and fixed issuance/expiry persisted. Cart header operations also require the creating context; single-order header reads independently validate that context's current persisted authority. Account resources require their current owning verified session, including staff MFA where applicable. No staff ownership bypass, contact-based linking or account bearer issuance exists. Effective authority ends at the earlier resource/context expiry, using real time; business fixture clocks cannot extend authentication. Password sign-in success (including a pending MFA challenge) and sign-out revoke the previous guest context. Lost-all-credential linking/recovery remains S46's verified-contact workflow.

Quotes reserve nothing. Selection preserves the parent's deadline and accepts only issued allocation/rate options. Submit rechecks current sources after actual promotion/balance waits, including an already-scheduled cost becoming effective, and atomically freezes one pending order per cart/quote. Original complete offer units retain exact component/lot lineage. Merchandise is always99000 per purchased unit; shipping/subsidy/buyer allocations conserve integer IDR. Real expiry workers serialize on the owning order before either legacy reservation; crash rollback and concurrent stock/promotion/order jobs preserve one cancellation and release both holds. Only the claimed job completes.

Native proof includes current/revoked/expired/wrong-purpose/mixed credentials, account isolation, one combined two-warehouse concurrent/lost-response retry with disclosed total and exact original parcel quantities, a deterministic two-buyer physical-stock race with a positive owned subsidy and sufficient budget for both, current version/publication/rate/closed-input checks, a scheduled-cost transition under an observed PostgreSQL balance wait, immutable SQL seals and owned worker crash/race/expiry with an unconditional positive campaign and three expiry jobs. Browser proof exercises all12 operations, reload recovery, HttpOnly/order-path cookies, empty JS storage and shared-device sign-in/sign-out denial. Next's empty DELETE body stream is accepted; a nonempty DELETE body is rejected, with native and built-browser regression evidence.

The rate phase uses each request's remaining3s total budget (max2s individually). C1 and bidi-format recipient/address controls are rejected before labels. Destination IDs and prices remain explicitly TEST-ONLY; human hierarchy labels are not promotion region IDs. A server HMAC of unverified buyer contact is a quota heuristic, never identity or authorization. Anti-abuse/contact verification, payment receipts/retention/COD confirmation/partial stock consumption and buyer checkout screens remain their later tasks. General Order projections exclude private address/contact; the owned quote preserves these and S27 owns the separate receipt. No Purchase/financial posting, continuous-worker milestone, live provider or full storefront acceptance is claimed here. Synthetic account-order tests retain immutable account FKs but remove usable credentials/sessions.

## Dedicated checkout implementation (S26; acceptance pending)

```bash
npm run test:integration -- --case=T-31
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=T-31
```

The explicit selector registers five native files and one progressive checkout browser file; it selects no migration or candidate executor. Forms call the existing checkout/payment domains and preserve scoped drafts, no-JavaScript task exits, competing-tab conflict checks, exact unknown-result retry and native-only money/payment authority. Issued package allocations and per-package services use wrapping native radio rows; the closed HTML parser pairs each service with its parcel and rejects mixed, duplicate or orphaned encodings. Native request schemas remain unchanged. Implicit Enter searches destinations on contact and preserves the current shipping/review step; financial confirmation stays explicit.

Allocation descriptions come from the authorized immutable quote document and list complete-offer contents per origin/parcel. Buyer-equivalent options share a frontend choice retaining an actual native allocation ID. While a different native identity is pending, both issued and pending IDs remain explicitly selectable with stored/pending labels, even if their displayed grouping is equivalent. Native disclosure exposes the pending choice after reload/stay and preserves the buyer's open state until a new quote is issued. The single primary shipping action applies the checked native allocation before review; order confirmation is separate. Option headers describe changes from the stored allocation, and gross carrier fees are labeled Tarif before subsidy; the parcel cards disclose subsidy and buyer-paid shipping. Issued parcel controls remain in the document and checked state gates their display, so no-JavaScript reversion submits complete selections. Actual radio checked state exposes pending charges without JavaScript, and successful selection carries the previous authoritative total in its server response. Checked native controls select the matching action/warning text and hide only stale success notices, including without JavaScript. Gross fees use Tarif throughout checkout review, summary and payment; net buyer fees retain Ongkir. Restoring the issued service clears the pending warning. No public quote schema or native plan/pricing logic is replaced.

Browser fixtures create an owned namespace, align its new simulation clock for readable deadlines and capture settled draft state under the actual build ID, preserving earlier render batches. Coverage includes two independent parcel choices without JavaScript, 320px/200% reflow, pending/unknown recovery, revoked scope, quote/rate expiry and consent-aware milestones without typed payloads or UI Purchase. STATUS and the ledger hold current executed counts, build/source bindings and unresolved gates. Fresh renders, independent canonical visual PASS, design-gate exit0 and the final original/C1/C2/C3 union R3 are required before S26 closure. Safari/devices, native support, full S27 receipt and S68 acceptance retain their own requirements.

## Public discovery and purchase-path checkpoint (S21/S22)

```bash
npm run fixture -- storefront local commerce-demo
npm run test:integration -- --case=PR-17
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-17
python3 /data/ai/codex/skills/design-taste/scripts/design-gate.py . --design docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md --src src
```

The fixture command uses actual temporary owner/MFA and non-destructive writers, returns nonsecret IDs/blockers, and preserves prior stock/HPP/operator state. Current PR-17 explicitly selects24 native tests across6 files: public catalog/contract, protected integrated offer filters, new available-offer selection/native form parsing, live complete-stock guard and real cart bridge recovery. The four explicit browser files contain the prior9 discovery/recovery tests and16 purchase-path scenarios (25 total). Required empty/skipped/TODO files fail. The owned recovery fixtures use guarded synthetic publications and preserve catalog/stock history; cleanup releases only exact owned seed reservations/jobs and reverses only the fixture's recorded quarantine through release_quarantine, retaining baseline quarantine. Source/execution/design acceptance remains in STATUS and the active ledger. Four sample publications drive local home merchandising; ordinary merchant products remain searchable. Native PDP selection/cart mutation is implemented in S22; the current24-native/25-browser checks pass; localhost slice acceptance still requires independent current source/visual/design and final R3 gates, with S26 checkout/S27 receipt and S68 full delivery separate. Public APIs share current-publication/whole-offer stock guards and have no auth requirement or private source fields. Product photographs remain explicitly labeled missing owner assets; licensed Inter/Lucide assets remain self-hosted.


## Financial primitive and scoped history checkpoint (S23)

```bash
npm run db:migrate -- test
npm run db:migrate -- local
npm run test:integration -- --case=PR-12
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-12
```

Applied immutable0014 adds three finance tables; additive0015 adds truthful new order-event ingestion timestamps and keyset indexes. At S23 acceptance both isolated databases had66 application tables; S24 adds the six payment-domain tables. The7 native checks and1 built-browser check execute real PostgreSQL, cookie/MFA, whole-order warehouse scope, exact safe-integer journals, replay/race/crash recovery, original money allocations and linked full reversals. New timestamps are server-set; legacy ingestion stays null. Receipts record provider receivable/buyer-funds liability and never bank settlement, payment-state confirmation, revenue recognition or Purchase. Only trusted internal consumers can post receipts/journals. S24/S28 must validate durable simulator/provider evidence before use; S30/S34 own settlement/realized reporting. No generic financial-write endpoint exists.

Two history GET adapters are implemented with no-store/no-referrer/nosniff, explicit current role/permission/scope, bounded actor/filter/scope-bound cursors and safe audited projections. Owner sees company history; other authorized staff must cover every original parcel. Reference lookup is actor-bound30/minute. Current fulfillment/return filters have no matching child evidence and must be extended by their consuming slices. This checkpoint does not complete all of PR-12 or accept the blocked S21 visual state. Final independent R3 acceptance is recorded only in STATUS/the ledger.


## Prepaid simulator checkpoint (S24)

```bash
npm run test:integration -- --case=PR-5
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-5
```

At S24 acceptance, PR-5 selected16 native tests and1 built-browser test; the current selector also includes the S28 COD checkpoint described below. The original prepaid tests execute actual PostgreSQL attempts/events, signed local simulator evidence, receipt/posting transactions, private owned-order transport and callback recovery. S24 introduced0016 and72 app tables; S25 extends both isolated databases to82 tables/18 source-matching migrations and adds the canonical first-party Purchase/outbox. No bank settlement, live provider, recognized profit or complete commerce acceptance is implied.

For an existing issued attempt ID, these host-only commands use the fixed local profile and exact original identity:

```bash
node --env-file=.env.example scripts/worker.ts local --confirm-payment ATTEMPT_ID
node --env-file=.env.example scripts/worker.ts local --reconcile-payment ATTEMPT_ID
```

Replace ATTEMPT_ID with the UUID returned by the private payment-attempt API. Confirmation resolves the original creation job, simulates collection and processes its signed callback. Reconciliation never creates a replacement charge; it wakes the original unknown job or retries a failed callback with its previous status/count/error retained in operational audit. Native proof executes the reconciliation command; built-browser proof checks local confirmation and recovery after reload. These commands do not expose a public operator/provider endpoint or require merchant credentials.

Collection must precede the original deadline strictly. Equality is expired regardless of job order. A timely signed collection still awaiting processing protects its original hold; late or mismatched money is a durable recovery liability and cannot authorize unavailable stock or Purchase. Recovery cases remain conservative: no automatic refund, new charge or claimed cash settlement. S24 final digest-bound review and acceptance remain in STATUS/the delivery ledger.


## Canonical first-party signals — S25 checkpoint

```bash
npm run test:integration -- --case=T-26
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=T-26
```

At S25 acceptance, the checkpoint had12 native tests across9 files and1 build-backed Chromium test. The current selector also includes S28 COD proof described below. Five operations cover visitor bootstrap, consent read/write, closed observed funnel intake and the nested owned-order funnel path. Visitor context never grants commerce access; guest order cookies retain their narrow path. Verified prepaid receipt/postings/funding and one canonical merchandise Purchase/full original-item allocation/three platform decisions commit together. Browser observations cannot supply Purchase or money. Actual rollback, duplicate/reload, denial/no-backfill, withdrawal, original local sink reconciliation, stale sender fencing and concurrent worker checks pass. All payloads use canonical local metadata without raw buyer contact, order capabilities, HPP or chat data.

Applied0017 is immutable; the S25 checkpoint had82 app tables/18 migrations; S28 extends both isolated databases to87 tables/19 migrations. The first-party privacy policy is TEST-ONLY local-privacy-v1, with24-hour context/consent and10-minute inactive anonymous bootstrap. Bootstrap retries retain lifetime; user context binds the exact account session. The loopback-only bootstrap rate bucket is shared and must use trusted per-client keys before remote exposure. Real platform mappings/SDKs/destination activation remain S57–S60, COD Purchase is covered by the S28 checkpoint below; buyer consent/receipt UI remains S26–S27. This checkpoint does not claim live vendor or legal activation. Final S25 review and acceptance remain in STATUS/the ledger.


## Split COD checkpoint (S28)

```bash
npm run test:integration -- --case=PR-5
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-5
npm run test:integration -- --case=T-26
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=T-26
node --env-file=.env.example scripts/worker.ts local --collect-cod SHIPMENT_ID
node --env-file=.env.example scripts/worker.ts local --refuse-cod SHIPMENT_ID
node --env-file=.env.example scripts/worker.ts local --reconcile-cod SHIPMENT_ID
```

Use an original shipment UUID from the private owned-order API. Collection/refusal creates a signed local source effect; reconciliation only rereads the original source and processes its existing callback, with previous retry metadata audited. These host commands use synthetic local data and require no merchant credentials. Current PR-5 proof executes24 native tests across13 files and2 built-browser tests; T-26 executes17 native tests across10 files and2 built-browser tests. Final acceptance belongs to STATUS and the delivery ledger.

A valid complete COD checkout confirms server intent at its original creation time and returns `cod_due`/revision2. This acceptance protects original stock and positive subsidy holds past the checkout deadline. Unpaid prepaid checkout still expires and releases both holds. Three concurrent expiry-job kinds are tested for both cases. Each original COD parcel has its own frozen due; qualified collection atomically posts balanced receivable/liability, a receipt, the current payment head and a canonical merchandise Purchase with original per-parcel item quantities and three consent decisions. Partial collection is distinct from full payment, refusal, extra/mismatched recovery money, delivery and company settlement.

Native proof includes independent source commits/lost acknowledgement, signed callback rollback, exact original recovery in a fresh host process, concurrent collection of both parcels plus a duplicate, denied-consent no-backfill and an actual consented COD Purchase sent to the canonical local sink. Private `GET /api/v1/orders/{orderId}/cod-collections` uses current account or original single-order authority; visitor/cart capabilities do not grant access. Built Chromium proof checks the original narrow HttpOnly cookie, reload from partial to full collection and shared-device denial. Applied0018 and all predecessors remain immutable. S29 must extend actionable hold consumption and order lifecycle seals before fulfillment acceptance. Real carrier/platform mappings, buyer receipt UI and final assembled localhost acceptance retain their respective slice owners.


## Fulfillment verification (S29)

Historical pre-application proof ran while both isolated databases had87 tables/19 applied migrations:

```bash
npm run test:integration -- --case=S29-candidate
```

The existing test harness rejects skipped/TODO/empty files. The current candidate has4 calendar checks,2 rollback-only SQL/schema checks and2 complete rollback-only COD/prepaid domain scenarios. Nine new tables are generated (96 in the transaction); the entire candidate schema/business proof rolls back. This does not establish separate provider commits, app-role runtime, mounted HTTP/browser parity or S29 acceptance. Applied0019 now requires the PR-6 runtime selector. S29-candidate detects the applied schema and refuses before opening historical87-table rollback cases. Do not substitute this candidate command for full acceptance. See STATUS for the exact application/review gate and resume action.

S29 runtime commands (approved0019 now applied locally):

```bash
npm run test:integration -- --case=PR-6
npm run test:browser -- --case=PR-6
node --env-file=.env.example scripts/worker.ts local --issue-waybill BOOKING_ID
node --env-file=.env.example scripts/worker.ts local --fail-waybill BOOKING_ID
node --env-file=.env.example scripts/worker.ts local --reconcile-shipping BOOKING_ID
node --env-file=.env.example scripts/worker.ts local --initialize-fulfillment ORDER_ID
```

BOOKING_ID is the returned shipment booking operation UUID. Shipment reads retain the original parcel UUID. Initialization uses an original actionable order and preserves its actionability, including an explicit missing-calendar exception; it never confirms payment or creates cash. Local source commands use synthetic signed evidence only. Browser API proof is separate from the pending visual gate.

Current S29 evidence: native PR-6 12/4files, built Chromium PR-6 1/1file, corrected production build OKibCFYTyt6e-KhnWguMp and readiness pass. Both isolated databases96tables/20source-matching migrations,33 relevant TRUNCATE denials. Current cookie/MFA/warehouse scope, independent signed source commits, fresh-host lost-ack/exhaustion recovery, original per-parcel stock/one-benefit conservation, later payment and overdue/reschedule privacy are exercised. Affected native/built regressions and actual final combined independent review pass; full localhost and S21 visual acceptance remain incomplete.

Applied S29 regression refresh: native PR-5 24, T-26 17, PR-4 11, PR-12 7, PR-2 14, PR-11 12, PR-16 11 and foundation24; built PR-5 2, T-26 2, PR-4 1, PR-12 1 and smoke2. Current PR-6 native12 and built1 pass. Legacy one-shot worker tests require the documented actual ready-fixture drain; deterministic isolation remains S63, and it is not a production runtime guarantee. All52 S29 paths across the original run and three declared continuations received actual final combined independent APPROVE; a continuation-only review would not accept earlier source.

S29 is accepted in RUN-20261016T160027Z-32424464; its exact combined review and historical checks remain in STATUS, BUILD-LOG and the canonical ledger.

### S30 reconciliation checkpoint

S30 has a reviewed applied schema and accepted executable localhost implementation in RUN-20261016T194052Z-6dfa4b01 after actual final combined independent review and bound closure. Test/local each have105 app tables,21 source-matching migrations and42 relevant TRUNCATE denials. Applied0000–0020 SQL/snapshots and the original journal prefix are immutable. Current production-mode loopback build is LjQuXN6fhyhz-YzIVabtA at127.0.0.1:3099; readiness200 is executed.

The current finance selector covers immutable ledger/history, allocation and signed-source boundaries, current finance permissions/proofs, original COD/prepaid/recovery receivables, native cash/operation controls, five private API contracts, genuine process loss/exhaustion recovery, four actual PostgreSQL lock races and owned fixture isolation. Native34 tests/15 files pass. The built selector covers original private order history and the complete new reconciliation flow; current2/2 passes. Affected native worker11, foundation24, promotion12, payment24, signals17 and checkout11 pass; built payment2, signals2, fulfillment1 and checkout1 plus smoke2 also pass. STATUS and the ledger retain the exact current evidence.

```bash
npm run test:integration -- --case=PR-12
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-12
npm run health -- ready
```

Five cookie/MFA-only resources implement list/detail/decision/historical-match/source reads under `/api/v1/admin/reconciliation` and `/api/v1/admin/settlements/{sourceId}`. Decisions require both finance.reconciliation permissions, a subject/session-bound fresh finance.reconcile proof, original statement UUID, expected head version and required nullable current match UUID. Only this decision endpoint permits32KiB for100 allocations; older endpoints retain16KiB. Actor/key replay rechecks current authority and preserves the immutable original response. Unknown statement facts remain null; source signatures, credentials, customer contact and HPP are excluded.

Cash, authenticated fee expense and matching classification have separate immutable journals. Match correction reverses/replaces the original classification and any changed fees atomically; unmatch preserves cash/fees and stored historical allocation amounts. Authentic extra recovery funds are separate receivables and create no additional Purchase. Retained debit expenses can block parent fee correction; newer facts stay as an explicit finance exception under the selected separately evidenced S34 adjustment boundary.

Host commands are local/test simulators, implemented in `scripts/worker.ts`: `--observe-settlement` reads a bounded source object from JSON stdin; `--revise-settlement SOURCE_ID EXPECTED_VERSION` reads only the statement; `--reconcile-settlement SOURCE_ID` verifies existing deliveries and recovers the original callback jobs. The executable recovery/browser tests exercise these exact commands. No public source-writing endpoint or client bank/fee/paid flag exists. Real vendor adapters remain a later verified-provider gate.

Pre-application approval and evidence are preserved across original S30/C1: the final three-file owner-role native/operator/basis rollback gate passed3/3 with no skipped/TODO/empty cases, unchanged predecessor integrity was checked, and exact reviewed0020 was conditionally approved/applied to both isolated targets after rechecking54 current/40 predecessor fingerprints and HEAD. The pre-application reviewer verified file fingerprints without recomputing the combined digest; the final reviewer subsequently independently verified the complete56-file digest, boundary/event hashes,42 immutable files and original journal prefix. The historical `S30-candidate` selector refuses an applied schema and must never be used as applied runtime acceptance.

Accepted C2 RUN-20261016T194052Z-6dfa4b01 declared the necessary old promotion-fixture dependency before edits; final review covers original+C1+C2. Teardown follows immutable first-version actor provenance, including raw contract requests, retires only owned configurations through current authorized version writers, and preserves consumed reservations/lifetime budgets/history. An unrelated open fixture remains active in its regression. Exactly105 already-closed synthetic author campaigns were separately retired in isolated test through audited normal writes, with unchanged original version hashes, budgets, finance journals and Purchases. The production100-campaign review ceiling was not changed. The actual bounded default test worker drained276 ready synthetic jobs; continuous supervision and fully deterministic queue isolation remain S63/S65.

The complete68-slice localhost goal remains incomplete. Source-level financial/browser evidence does not accept the blocked public visual gate, later dashboard/HPP/period-close work, live providers or remote deployment. No commit or push is implied.


S31 quantity returns/inspection/refunds is accepted in RUN-20261018T190944Z-520bc988 after actual final independent full73-object combined review and bound ledger PASS. S32 replacement/affiliate-rate implementation is active in continuation RUN-20261018T192545Z-1ece5a89. The initial inventory predecessor preflight failed on an omitted global-next-job fixture; that failure and unchanged diagnostic are retained. The actual runtime selector excludes all historical unapplied-schema candidates:

```bash
npm run test:integration -- --case=PR-7
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-7
```

The current registered native run passes33 tests across13 explicit files: policy/signatures/current authority/original collection, separately committed COD/prepaid lifecycle, scoped readers, actual13-operation wire contracts, order/history projections, four uncertainty/recovery cases, four PostgreSQL contention cases and app-role native seals. Current build lqdvVaUI0ULANm_WiMvK_ passes the built Chromium/host case for all13 success/denial contracts and actual buyer order/history progress, plus9 affected built cases across8 files. STATUS owns acceptance and the running artifact identity. Parent PR-7 remains incomplete until S32 replacement lineage and effective affiliate override costing are implemented and accepted.

Reviewed0021 adds19 tables; both isolated databases have124 tables and22 exact source-matching migrations,61 relevant app-role TRUNCATE denials,76 effective CRUD grants over the new tables and zero unvalidated new constraints. All44 applied SQL/snapshot files and the22-entry journal prefix are immutable. S31-candidate is historical rollback evidence and must never execute on either applied target. Its first DDL42601 failure and actual superseding/renewed review remain preserved; corrected candidate2/2 and the separately reviewed exact application gate passed before runtime testing.

Thirteen private cookie-only operations implement buyer return creation/list/detail/eligibility/refund/destination and scoped staff list/detail/decision/inspection/refund/reconciliation. Writes recheck current authority after waits; money commands need both refund grants and a fresh subject/session-bound finance.refund proof. Finite lists use UUID anchors. Staff readers expose only currently assigned warehouse units; finance read access does not grant CS/warehouse actions. History excludes contact, HPP, freeform internal reasons, signatures and recipient certificates.

Host worker commands receive/reconcile original parcel receipts, verify a synthetic COD destination, confirm/fail signed bank results and reconcile the original refund. Genuine fresh CLI processes exercise loss after provider creation/collection and same-identity recovery. Unknown effects preserve original attempt/job identity; a new attempt requires established zero-money failure and explicit finance authority. Obligations debit buyer_funds_liability/credit refund_payable; confirmed signed bank success alone debits refund_payable/credits company_cash. Original Purchase is never rewritten or repeated. A genuine fresh-cluster prefix0000–0016 payment followed by exact0017–0021 upgrade and original-buyer cash refund now passes1/1, with zero Purchase/ad backfill. Its command is `node --env-file=.env.example --test tests/integration/return-upgrade.test.ts`; it creates a new uniquely owned private cluster and stops only that project, retaining temporary data/containers. The first missing-commercial-policy fixture failure and unchanged diagnostic remain recorded; the corrected prerequisite uses actual owner/MFA/fresh proof and guarded publication. Current runtime/build/shared evidence and final frozen combined-boundary approval are recorded; S31 closure PASS and the ledger chain are verified. Actual provider compatibility, UI composition and continuous supervision remain later owners.

S31 C2 adds an optional original job UUID to the existing host iteration: `node --env-file=.env.example scripts/worker.ts test --once JOB_ID`. The UUID is validated before readiness and passed through the existing database/lease/adapter filters. An unknown valid UUID is an idempotent no-op; selecting a completed job preserves attempts and effect identity. The unchanged no-ID mode uses the normal ready queue. Actual worker fixtures pass8/8, including older unrelated pending work, two independent processes observed concurrently on the same targeted job, and process death while holding the real delivery transaction. Full foundation25/5 now passes without draining unrelated work; static30 and the exact V3 isolated legacy upgrade1 also pass. Actual final full73-object review, matching boundary approval and closure PASS are recorded; the ledger chain is verified. Continuous supervision/operational recovery remain S63/S65.


S32 current foundations have these executed direct checks (not complete PR-7):

```bash
node --env-file=.env.example --test tests/integration/replacement-policy.test.ts tests/integration/affiliate-rate-policy.test.ts
node --env-file=.env.example --test tests/integration/affiliate-rate-authority.test.ts
```

Input/rounding6 and actual proof authority5 pass; the latter includes nonowner/current revocation and a PostgreSQL actor-row barrier. Draft0022/snapshot140 is deliberately stopped before DDL while both installed targets remain124/22. Do not run db:migrate or historical candidates against this incomplete draft. Root STATUS owns the native/domain/API/worker/financial gates still needed; no replacement or effective-rate writer/runtime/browser acceptance follows from these foundations.


S32 foundation command executed: `node --env-file=.env.example --test tests/integration/replacement-policy.test.ts tests/integration/replacement-stock-policy.test.ts tests/integration/replacement-receipt-policy.test.ts tests/integration/replacement-shipping-policy.test.ts` passes10 input/allocation/protocol checks. It does not execute replacement persistence or establish full PR-7 acceptance. The new replacement host flags are source only until independently gated0022 and actual CLI proof. Full foundation is currently failing with pending0022/migration parity and unresolved aggregate auth failures; STATUS owns the current diagnostics and next action. Do not run db:migrate, the historical candidate/upgrade commands or broad return-test globs against this draft.


S32 pending native source includes original replacement job/result/booking seals and current attributed quote/order cost bounds. New replacement/rate candidate executors and the history origin-lock race are authored but **not registered runtime commands**; their execution requires the exact independent0022 gates described in STATUS. Never invoke a candidate glob or strip its pre-DDL stop. Private handler source and proposal DTOs do not establish accepted mounted endpoints. Existing history2 and exact22 separate source repair approval cover the scoped history correction only.


Current S32 candidate evidence: first exact separately gated owner-role rollback execution compiled0022 DDL and passed the real rate/quote/order candidate; two replacement cases correctly awaited insufficient stock and failed an executor readiness assumption. Both installed targets remain124tables/22matching migrations with applied44/prefix22 exact. The stop is restored while the revised actual-intake/same-intent recovery candidate awaits renewed review. This is partial failed-candidate evidence, not application or runtime acceptance; consult root STATUS and the ledger for the exact next gate.


S32 installed runtime checkpoint: separately reviewed0022 is applied to both isolated databases (140tables/23matching migrations). All46 applied SQL/snapshots and prefix23 are immutable; never rerun historical S31/S32 candidates. PR-7 selects29 explicit runtime files and passes67 tests, including actual app-role lifecycles, effective rates, physical occurrence refunds, exact PostgreSQL races, recovery, native seals and closed handler contracts. S32 is accepted after its actual full combined independent review and bound closure; the parent/UI boundaries remain open.

The foundation auth fixture targets only actual recipient/kind-owned notification job IDs and verifies an older unrelated pending job remains untouched. Current foundation25/5 passes without global queue draining. Diagnostic report files are precreated0600; changing process umask invalidates the storage fixture's intentionally accessible-directory case.


Current S32 private API checkpoint mounts six replacement operations and POST /admin/affiliates/{affiliateId}/rates. Native handler exchanges pass with closed OpenAPI validation; new proof groups replacements and affiliate-rates own explicit success and denial coverage. All admin transports remain current session cookies; the inherited unissued bearerAuth alternative was removed only from the promoted rate operation. Explicit413/415/503 responses match the real16KiB private handlers. Structural OAS5959 passes.

Fresh production-mode artifact _QrrV_3pA-ni2qWWgJoVa runs on127.0.0.1:3099. Direct Chromium/host replacement1 passes all seven operations, actual stock-wait/intake/reserve, issued-waybill versus handover, partial/duplicate/final receipt and unchanged original buyer amounts/Purchase. The first browser test failed on its invented history kind; the corrected test verifies the exact replacement event ID under the existing fulfillment kind. This is API/browser persistence proof, not new storefront visual acceptance.

PR-7 selects29 explicit native files and two browser entries; actual native67/29 and built2/2 pass. The replacement browser also validates complete canonical buyer/staff read-model schemas. NEVER use a replacement-*.test.ts or return-*.test.ts glob: historical schema candidates and the isolated replacement-upgrade executor have separate exact review/invocation gates. One exact independently approved upgrade passed17->22->23 on a fresh owned socket cluster, retaining pre-signal collection/original buyer/pre0022 case through physical replacement receipt and original-source refund without Purchase/ad backfill. Its project is stopped with data retained; both installed targets and all46/prefix23 remain exact. This is bounded upgrade proof, not permission for another invocation or full parent/localhost acceptance. STATUS owns current affected-check/review freshness.


S33 exception recovery is active after accepted S32. The selected domain/authority/financial/UX contract and eight canonical proposal paths (ten operations/16 closed schemas) pass6299 structural/schema assertions at173paths/207operations/307schemas. All earlier operations/schemas retain their definitions. New routes are not mounted, PR-21 has no executable selector yet, and no0023 migration has been applied. STATUS owns the next native model/gate. Proposal checks are not exception runtime evidence.


S33 C4 current model draft:25 new relations plus eleven existing check expansions are generated in deliberately stopped0023/snapshot165. Installed test/local stay140tables/23migrations; all46 applied artifacts/prefix23 remain exact. The latest closed proposal supports multiple original-source refunds,100 complete units and bounded128KiB physical report/intake. Internal case/core writers and conditional original payment/COD callback hooks exist but their new installed branches remain unexecuted. Native action/effect/source/refund guards and remaining writers/worker/API are incomplete; PR-21 acceptance is pending. Original-collection resolution/case opening creates no obligation, cash transfer, stock change or sale. No command should execute the draft before its separate exact native gates.


Current S33 focused checks: `node --env-file=.env.example --test tests/integration/exception-policy.test.ts` executes8 pure mutation-policy cases, including aggregate shortage2m and int32 bounds. `node --env-file=.env.example --test tests/integration/exception-collection.test.ts` passes4 real PostgreSQL source-basis cases using existing140/23, signed local prepaid/COD producers and exact owned callback jobs. It covers late exact funds after expiry/reallocation, unallocated money, multiple original COD sources, and foreign/unverified/reversed source denial. These commands are not the PR-21 acceptance selector. OAS6319 passes; new0023/snapshot160 remains stopped/native-incomplete. No new SQL, obligation/cash workflow or API acceptance is established. STATUS owns current evidence.


S33 financial bridge check: `node --env-file=.env.example --test tests/integration/return-lifecycle.test.ts` passes2 existing app-role COD/prepaid refund/retry cases after routing adjustment totals/sequences through the shared original-journal helper. This proves the installed ordinary path only. The combined recovery branch and financial subset of six staged native function definitions/five triggers remain uncompiled/unexecuted behind S33_STOP. Native draft regeneration must preserve/review the custom tail; the owned temporary generator refuses to discard it. No full PR-21 or affected S31/S32 refreshed acceptance follows.


S33 physical compatibility uses the explicit command `node --env-file=.env.example --test tests/integration/return-lifecycle.test.ts tests/integration/replacement-refund.test.ts`; the intake checkpoint passes4 ordinary/replacement COD/prepaid scenarios on installed140/23. The subsequent event-time custody fence has a fresh current check in STATUS. Shared post0023 intake/custody branches and native source remain unexecuted; no candidate/upgrade wildcard is permitted.

S33 callback-basis proof: `node --env-file=.env.example --test tests/integration/exception-callback-basis.test.ts` passes3 real PostgreSQL cases. Original late prepaid and mismatched COD money qualify inside their still-pending exact callback. A deliberately unfinished callback fails23514 and rolls back its money/result; normal processing then completes the same owned source/job. This proves the installed compatibility/source boundary, not new exception case/native runtime or the PR-21 selector.


S33 proposal policy command: `node --env-file=.env.example --test --test-concurrency=1 tests/integration/exception-proposals.test.ts tests/integration/exception-policy.test.ts` passes13 pure cases (five new lifecycle/choice plus eight parsers). Current source command adds the explicit exception-collection.test.ts and exception-callback-basis.test.ts files and passes20 on installed140/23. CS proposal/buyer-choice writers and the native closed staff/buyer projection exist but are unexecuted; final staff application/cancellation/compensation and native/source closures remain pending. No new adapter or PR-21 selector is registered, and stopped0023 must not run from these checks.

S33 stock source command: `node --env-file=.env.example --test --test-concurrency=1 tests/integration/exception-stock-policy.test.ts tests/integration/exception-proposals.test.ts tests/integration/exception-policy.test.ts tests/integration/exception-collection.test.ts tests/integration/exception-callback-basis.test.ts tests/integration/fulfillment-lifecycle.test.ts` passes31 (pure19, original source4, callback basis3, installed original fulfillment5). `npm run check` passes lint/typecheck/static30, and the OpenAPI checker passes6325. New report/reinspection requires an explicit existing case ID/version as well as original fulfillment/balance versions; the internal writer/native guards are source only. No new S33 transaction, candidate or PR-21 acceptance follows.

The stock consent regression initially failed before correction: an all-zero reinspection could discard an accepted cancellation/refund and unblock dispatch. The writer now derives actual same-case acceptance; the native report seal uses pre-report immutable history. Both positive/zero counts retain the exact accepted proposal and awaiting_source. Unanswered proposals are invalidated; without accepted consent, zero can resolve the investigation. Full new-native/runtime proof remains pending.

S33 C2 declares source/receipt/Purchase dependencies before edits and retains the original/C1 source union. `node --env-file=.env.example --test --test-concurrency=1 tests/integration/exception-cod-basis.test.ts` passes5 (four exact unit/money policies and one real source→receipt→refund/Purchase/replay integration). Fresh current-r4 runs it with the explicit existing exception, COD, Purchase and refund files for42 passes; `npm run check` passes static30, the OpenAPI checker6332 and both installed integrity probes pass. New nullable source unit_ids/eight existing check extensions and37 new/ten replaced native functions remain stopped/uncompiled/unexecuted. No new PR-21 selector, API mount or full native/runtime acceptance follows.

S33 C3 original-unit subsidy policy command: `node --env-file=.env.example --test --test-concurrency=1 tests/integration/exception-promotion-basis.test.ts` executes6 pure production-policy checks: exact original unit/campaign partition, stable identities, conservation across cancellation subsets, zero/foreign/duplicate denials, safe integer limits and held/committed buyer usage. Actual current-r2 combines this with explicit existing promotion/exception/COD/Purchase/refund files for55 passes (29 pure/26 installed-schema cases); static30, OAS6332 and both installed integrity probes pass. New promotion metadata/cancellation business branches remain unexecuted. The40 new/13 replaced native functions/32 triggers stay incomplete behind source STOP, with one definition-only owned-rollback test now passing. The final apply action is unissued; no new endpoint, selector or full PR-21 acceptance follows.

S33 definition-only candidate at tests/integration/exception-compile-candidate.test.ts passed once under actual exact r13 review; its one invocation permission is consumed. It refuses accidental selection before creating any cluster unless N99_S33_DEFINITION_ONLY matches the58-input digest; that marker never substitutes for actual independent executor review. Keep it outside all runtime selectors. The exact historical invocation was `N99_S33_DEFINITION_ONLY=0cd800543585de02edfcc3ae934882587d1897ac4ab518bc075138ec192027d5 node --env-file=.env.example --test --test-concurrency=1 tests/integration/exception-compile-candidate.test.ts`. It installed prefix23 only on newly owned project99ribu-08cb40c5ad, proved source STOP55000, defined160 relations/53 functions, rolled back and stopped the project with data retained. Shared catalogs/source matched before/after and both installed targets remain140/23. Do not repeat this historical command without renewed exact review. Definition success does not prove new business paths, invariants or concurrency.


S33 C4 policy/source command: `node --env-file=.env.example --test --test-concurrency=1 tests/integration/exception-application-policy.test.ts tests/integration/exception-cancellation-source.test.ts` passes10 pure cases for exact current accepted proposal/unit scope, closed signed cancellation evidence, domain separation and surviving-unit COD request basis. Current C4 static30/focused81 and installed integrity pass in the ledger; the r14 cancelled-response mismatch is corrected with actual RED-to-GREEN2, OAS6346 and focused11. These do not execute the new carrier or application workflow. The stopped draft is25 new relations/snapshot165; historical definition permission is consumed. Staged cancellation CLI flags must not be treated as runtime-accepted commands.

Current C4 recovery/projection command: `node --env-file=.env.example --test --test-concurrency=1 tests/integration/exception-shipping-recovery.test.ts tests/integration/exception-waybill-projection.test.ts tests/integration/fulfillment-recovery.test.ts`. Original retry evidence retains real attempts and one source identity, audits bounded extra attempts after fenced absence and stops after ten actual failed dispatches. Pure current-label cases hide historical tracking during cancellation/rebooking. No historical candidate is selected; new cancellation/schema/application runtime acceptance remains pending.

C4 shipment read-coherence regression: `node --env-file=.env.example --test --test-concurrency=1 tests/integration/exception-shipment-read-race.test.ts`. It uses the actual mounted handler and original issuance callback, observes the exact PostgreSQL blocker and proves that status/tracking/booking/version share one parent-order snapshot. The actual RED and corrected PASS are retained; no new schema or cancellation transaction is executed.

S33 C4 now contains the internal explicit CS apply/retirement writer, internal not_created exhausted-request history and staged native per-unit stock/application guards. No exception HTTP adapter or PR-21 selector is mounted. All new0023 business/native paths remain stopped/uncompiled/unexecuted; existing parent/reservation/dispatch and source/intake/refund/cash/ACL closures plus exact new execution/application/runtime gates remain pending. Historical r17 approves the prior carrier/reader source only. Source checks and installed140/23 compatibility do not establish the new cancellation workflow; STATUS/the ledger retain actual current command results and review findings.

S33 C4 original parent integration now has source for surviving-unit dispatch, remaining hold resolution and completion from the actual last surviving buyer receipt. Existing responses stage read-only original cancelled_quantity and occurrence cancelled flags, keep frozen purchased amounts, separate current picks from handed history and include original/recovery actual refund aggregates. New native/business branches remain stopped/unexecuted. Current commands/results and separate source review are recorded in STATUS; complete replacement/source/intake/refund/cash/ACL/API/native/race/built acceptance remains pending.


S33 C4 actual r21 definition-only PASS1: the exact reviewed new executor defined165 relations/88 distinct functions (89 declarations) from stopped SQL54614548084e48ab065ea38ce359d90d76db906e199752dc2310b849e6ed9132 on a fresh owned socket cluster after proving intact STOP55000, then rolled back fully. Project99ribu-4b3f3e2401 is stopped; retained data /tmp/99ribu-exception-parent-definitions-moBDs3. Independent postcheck proves all59 bound objects and both installed140/23 targets/all46/prefix23 unchanged. Actual receipt /tmp/99ribu-s33-c4-parent-definition-execution-receipt-r1.json and raw /tmp/99ribu-s33-c4-parent-definition-execution-r1.txt retain execution provenance. Both r13 and r21 invocation permissions are consumed. Never repeat either executor or apply0023 from these results. No new cancellation, stock, refund, cash or other business branch was executed; full S33/localhost acceptance remains pending.


Current replacement delta follows that historical r21 checkpoint and changes SQL to82b97...; new definitions/business branches remain stopped/uncompiled/unexecuted. Surviving complete units now drive reserve, accepted booking scope, actual handover/receipt and per-parcel cancellation images. Preserve immutable original allocation/zero charges, actual release/consume conservation and unresolved original claim-finance work. Actual static30/serial22/OAS6374 compatibility plus corrected source-integrity-r2 PASS do not establish new runtime or current built proof. Separate r22 found two native P2s, exact originals/reports remain retained, and actual r23 bounded source review approves the correction. STATUS owns the next action; consumed definition executors must not run.


Subsequent replacement stock-case source now opens one original-intent case from the real reserve failure's stored stock_wait, preserves repeated-wait consent and reconciles only actual complete stock without pending proposals/retirement/finance. Actual r24 bounded source APPROVE and current-r1 static30/serial19/OAS6374/installed140/23 integrity PASS do not execute0023 branches. Latest SQL66cc0... is stopped/uncompiled/unexecuted; claim-finance, physical/finance/API/native/race/built/full acceptance remains pending. Never reuse either consumed definition executor. STATUS owns the precise next action.


Original replacement-retirement claim consequences are now staged: exact per-parcel accepted cancellation moves selected original replacing claims to held, preserves inspection/entitlement and rejects duplicate physical branching. It creates no received/refunded/released claim or money effect. Actual r25b bounded source APPROVE and static30/serial17 including5 new policy checks/OAS6374/installed140/23 integrity PASS do not execute new0023 or render its new private explanation. Latest SQL9be368... remains stopped/uncompiled/unexecuted. Original-source recovery finance/mixed claim closure and full acceptance remain pending; STATUS owns the next action and both definition executors remain consumed.


S33 recovery finance stages original-source obligations, owning-buyer COD recipient acceptance and signed local bank evidence. Actual corrected bounded r27 source review and one fresh-cluster definition-only PASS1 establish165relations/124functions and complete rollback, with installed140/23/all46/prefix23 intact. All r13/r21/r27 definition invocations are consumed; never rerun their executors. Unmounted recovery preparation/callback/mixed-claim source has static30/serial24 PASS after correcting two actual r28 P2s; actual bounded r29b source APPROVE follows. Native source/cash/retry/mixed runtime and full acceptance remain pending. The new exception-recovery-definitions.test.ts stays outside runtime selectors. STATUS owns exact current evidence and next work.


The subsequent S33 native bank/source framework stages137 function declarations/136 distinct names in stopped SQL24abb77c.... Its source-only17/OAS6374/installed-integrity checks pass; new definitions and transactions remain unexecuted. Actual r30 approves only that bounded engineering source. Earlier r27 definitions apply only to the retained prior SQL and grant no replay/application. Remaining native recovery-return/mixed/retry and full runtime acceptance stay in STATUS.
