# 99ribu

Indonesian commerce application. The accepted stack is Next.js/TypeScript, PostgreSQL/Drizzle and Better Auth, with shared domain modules and a separate durable worker.

The documentation pack was promoted on 2026-10-16. The ordered localhost development slices (`S01`–`S81`, `S90`–`S93`; terminal gate `S68` under final review — see [STATUS.md](STATUS.md)) across the 38 local parent tasks (`T-1` through `T-39`, excluding deferred external `T-19`) and the 2026-10-21 post-S68 architecture & QA remediation (`G1`–`G10`) are implemented, migrated (`0000`–`0034`), built in `NODE_ENV=production` with `APP_ENV=local`, and verified against isolated local PostgreSQL (`99ribu_local` / `99ribu_test`), real Better Auth + MFA, durable outbox worker, and headless Chromium (`390x844`, `768x1024`, `1440x900`). External live-provider credentials, physical printer/scanner hardware, and production hosting/deployment remain explicitly gated outside localhost acceptance (`RELEASE.md`).

## Start here

- [STATUS.md](STATUS.md): current state and exact resume action.
- [TASKS.md](TASKS.md): sole execution queue, 39 parent tasks and 85 ordered development slices, plus the separately gated production (S82–S89) and provider (S94–S98) tables.
- [PRD.md](PRD.md) and [specification index](docs/spec/README.md): accepted product, API, data, design and UX contracts.
- [AGENTS.md](AGENTS.md): repository instructions for AI terminal development.
- [DECISIONS.md](DECISIONS.md): sole decision index, linking accepted decisions and proposals.
- [BUILD-LOG.md](BUILD-LOG.md): executed evidence and its limits.

Root contracts and `docs/spec/` are canonical. The former Documents staging copy and `docs/spec/handoff/root/` templates are historical inputs. [Promotion inventory](docs/spec/promotion-manifest.json) records original and reconciled hashes.

## Where things live

[ARCHITECTURE.md](ARCHITECTURE.md) is the map of the code as built: runtime topology, [folder structure](ARCHITECTURE.md#folder-structure), [module map](ARCHITECTURE.md#module-map) (one row per `src/modules/*` with tables, routes and jobs), [worker job registry](ARCHITECTURE.md#worker-and-job-registry), request-flow diagrams for checkout, payments, consignment fulfillment and COD remittance, the [catalog pipeline](ARCHITECTURE.md#catalog-pipeline), [roles and MFA](ARCHITECTURE.md#identity-roles-and-access), the [storefront](ARCHITECTURE.md#storefront-architecture) and a [core data ERD](ARCHITECTURE.md#data-domains).

- Pages and route handlers: `src/app/` (`(storefront)/` Indonesian public routes, `admin/` console, `api/v1/` business API, `api/auth/` Better Auth).
- Business rules and transactions: `src/modules/<domain>/`; durable jobs: `src/jobs/worker.ts` (registry) and `scripts/worker.ts` (adapters, simulator commands).
- Schema history: `migrations/` (raw SQL, immutable once applied); typed mirror: `src/db/schema.ts`.
- Catalog content: `data/catalog/berlapak/`; operator commands: `scripts/*.ts` (registered below).
- Private runtime state: `.local/` (database, socket, signing key, artifacts, catalog photos); never committed.

## Local quick start (end to end)

From a clean checkout on this host (Node 24.21.0, PostgreSQL 18.6; details in the sections below):

```bash
npm ci --ignore-scripts
npm run db:up                                   # private Unix-socket cluster, 99ribu_local + 99ribu_test
npm run db:migrate -- local                     # 0000–0037
npm run db:migrate -- test
npm run fixture -- commercial-terms local demo  # commercial policy baseline required for publication (idempotent)
npm run fixture -- payment-terms local demo     # DEC-008/009 payment terms: manual bank transfer, COD fee
npm run catalog:import -- local                 # DEC-005 dataset: categories, products, photos, origin warehouses
npm run catalog:initial-stock -- local          # needs the raw Berlapak snapshot (BERLAPAK_DATA_DIR); see "Live catalog"
npm run catalog:import -- local                 # guarded publication of products that now have stock and HPP
npm run fixture -- login local                  # dummy sign-in accounts (table below), staff TOTP enrollment
npm run build && npm start                      # http://127.0.0.1:3099
npm run worker                                  # second terminal: durable worker (simulated dispatch)
```

Without the raw snapshot, `catalog:initial-stock` refuses and the imported products stay draft (blockers `COMPLETE_STOCK_REQUIRED` and unknown HPP): the admin catalog shows them, the storefront does not. Sign in at `/masuk`; staff need the TOTP code from `npm run fixture -- login-codes local`. To open it from your tailnet, see "Open from your tailnet (IP)".

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

Use Node **24.21.0** and npm **12.2.0** (exact engines and `.node-version`). The `.env.example` profile contains only non-secret local settings. The one canonical origin is **http://127.0.0.1:3099**; aliases and alternate listener arguments are rejected. S03 uses PostgreSQL **18.6** through a private Unix socket, with isolated `99ribu_local` / `99ribu_test` databases and separate owner/application roles. No database TCP port is published. This supersedes the unprovisioned S02 port 5499 proposal.

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

On this POSIX/Docker host, the database uses a worktree-specific Compose project, digest-pinned official PostgreSQL image, no network interfaces and no published ports. Data and socket files live under ignored `.local/`, whose parent is mode 0700 and owned by the current user. The socket is 0700. The official image sets its socket directory to 3775 at each start; access remains blocked by the private parent. Unix trust authenticates processes already authorized by that OS boundary; it is not a production credential scheme or isolation from the same OS user/root.

```bash
npm run db:up
npm run db:migrate -- local
npm run db:migrate -- test
npm run test:database
npm run test:storage
npm run db:status
npm run db:stop
```

`db:up` is idempotent for this worktree; `db:stop` preserves its data. No reset/drop/delete command is provided. Existing project containers are untouched. `db:generate -- --name=<change>` creates migration SQL for review; it does not apply it. `db:migrate` accepts `local`/`test` (this socket profile) and `production` (S83, see "Production profile"), uses the owner role, holds a PostgreSQL advisory lock for the whole run so concurrent runs serialise (the second applies nothing), prints `newly applied: <n>`, and records applied history through Drizzle. Domain table definitions belong in `src/db/schema.ts` or their imported modules; existing applied SQL is never edited.

Application roles can use the app schema and its data but cannot create schema objects or connect to the other database. The client refuses DATABASE_URL and PG* connection overrides; only the validated private socket/profile (or, under `APP_ENV=production`, the validated TCP target) is used, and a database target that does not match `APP_ENV` is refused. Database tests must fail if that service is unavailable. Storage routines write immutable random UUID artifacts at 0600 under private `.local/artifacts/`, reject traversal/symlinks/broad permissions and expose no HTTP route. Future domain endpoints must authorize each artifact read/write before calling these routines.

Migration 0000 initializes the private app schema. Migration 0001 records that already-created schema in the generated Drizzle snapshot with an idempotent statement; the previously-applied 0000 history stays intact. No commerce tables are claimed by this namespace foundation.


## Local identity foundation

Better Auth 1.7.10 uses the real Drizzle/PostgreSQL adapter and migration 0002. Browser signup, email verification, login, logout, session read and password recovery are explicitly allowlisted under /api/auth. Other built-in endpoints stay 404 until their product contracts are implemented. Tokens are carried by host-only HttpOnly SameSite=Lax cookies, never returned in auth JSON. Secure is disabled only inside the validated HTTP loopback profile; a live HTTPS profile requires its separate review. Cookie session caching is disabled so revocation reads the database. This account-login requirement does not make buyer email mandatory for guest checkout. Signup never grants staff access; S09 owns explicit role/object grants and required staff MFA.

The runtime creates independent local/test signing material using 48 random bytes, exclusively at 0600 beneath 0700 .local/auth/. It persists across process restart and refuses corrupt/broadened/symlinked files; there is no constant fallback or automatic overwrite. The agent never prints or opens these runtime values. External auth secrets/origin overrides are rejected. Recovery/backup must preserve this private material alongside the database. This local-only generation is not a production secrets-management scheme.

Only synthetic .test/.invalid email addresses are accepted. Verification/reset intents persist in private app.local_delivery; no SMTP or public inbox route exists. Links expire after 30 minutes. Expired inbox rows are pruned on the next local delivery; scheduled retention and developer fixture access remain later worker/fixture owners. Passwords require 12–128 characters. Password reset is single-use and revokes all sessions. Verification does not automatically create a session. Public signup/reset responses hide whether the address exists; source-backed Better Auth hashing and reset behavior remain authoritative.

```bash
npm run test:auth
# With the built server and database already running:
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:auth:http
```

The HTTP check uses the installed Chromium 155.0.8059.39 on this host. Omit PLAYWRIGHT_CHROMIUM_EXECUTABLE when a matching Playwright-managed Chromium is installed. A missing browser/server/database is a failure, not a skipped result. Tests create/delete only their own synthetic actor rows; test:auth also resets its fixed test-database loopback rate buckets and must not run concurrently against that same test database. The HTTP test preserves local rate buckets, so repeated runs can correctly hit the configured rate limit. The probe now creates a pending message through the real web server, owns a separate local worker process, waits for delivery and stops that child. Run it with no other local worker; preserve rate-limit windows between repeats. This is a browser cookie/API probe, not storefront UI acceptance.

Next 16.4.1 internally normalizes 127.0.0.1 to localhost in NextRequest.url. The auth boundary accepts that representation only with the exact actual Host 127.0.0.1:3099 (or the opt-in tailnet Host below), rebuilds the canonical URL, and rejects browser-origin/Host aliases. Proxy IP headers supplied by callers cannot change the fixed local limiter identity. Persistent per-endpoint limits are enabled in development and production builds; request bodies are bounded to 16KiB.

Sources checked against the installed package: [email/password](https://www.better-auth.com/docs/authentication/email-password), [Drizzle adapter](https://www.better-auth.com/docs/adapters/drizzle), [rate limits](https://www.better-auth.com/docs/concepts/rate-limit). Next normalization is verified by installed source and a real NextRequest regression plus the built browser check.

### Open from your tailnet (IP)

Opt-in only. The app still listens on 127.0.0.1:3099; `tailscale serve --tcp` forwards this machine's Tailscale IP to it. Set one value, a Tailscale CGNAT IPv4 (100.64.0.0/10) with port 3099 and nothing else (no hostname, https, path or wildcard; anything malformed stops startup):

```bash
LOCAL_TAILNET_ORIGIN=http://100.127.67.86:3099 npm run dev
# or: npm run build && LOCAL_TAILNET_ORIGIN=http://100.127.67.86:3099 npm start
# Same variable for the worker, so tailnet verification/reset links pass its destination check:
LOCAL_TAILNET_ORIGIN=http://100.127.67.86:3099 npm run worker
tailscale serve --bg --tcp=3099 tcp://127.0.0.1:3099
# Stop exposing it:
tailscale serve --tcp=3099 off
```

Then open http://100.127.67.86:3099 from a tailnet device. Every Host/Origin check (API mutations, Better Auth, Server Actions) accepts exactly {http://127.0.0.1:3099, the configured IP origin}; the browser's Host (the raw TCP forward keeps `100.127.67.86:3099`) must match and a mutation's Origin must equal that same origin. Other tailnet IPs, https or another port are refused. Better Auth uses a host allowlist of these two hosts with loopback fallback, so verification/reset links follow the origin the request came through. `next dev` additionally allows HMR for that IP (`allowedDevOrigins`). Without the variable nothing changes.

Cookies: browsers refuse `Secure` cookies on plain http to a non-loopback IP. Session cookies were already non-Secure (host-only, HttpOnly, SameSite=Lax) and behave the same on both origins; sessions are per origin, so sign in separately on each. The guest order capability cookie stays `__Host-99ribu_order` (Secure) on loopback; only a request through the validated tailnet origin gets the non-prefixed `99ribu-local.guest_order_access` cookie (HttpOnly, SameSite=Lax, Path=/, host-only) that the receipt already accepts. Trade-off: on an IP host there are no subdomains or Domain cookies to defend against, and the tailnet transport is WireGuard-encrypted, but cookies are not port-scoped, so any other service you expose on the same Tailscale IP can read this app's cookies. No flow is loopback-only. Still loopback-anchored by design: affiliate referral links, catalog feed/product canonical links, the existing-account email link, and the host-side fixture inbox. `npm run health`, browser suites and `test:auth:http` stay loopback; `test:integration -- --case=localhost-readiness` asserts the default profile, so run it without `LOCAL_TAILNET_ORIGIN` exported.


## Durable local worker

```bash
npm run worker
# One due job, then exit (an empty queue is a successful no-op):
npm run worker -- --once
npm run test:worker
```

Run from the same worktree as web and after applying migrations to local/test. The worker has no HTTP listener. Ctrl+C/SIGTERM finishes the current SQL transaction and closes its pool. Its readiness line appears only after the outbox table is reachable. Missing/live/mixed adapter profiles and unsupported arguments fail before readiness. Database errors exit nonzero without marking work complete; fix the cause and restart.

Migration 0003 adds the durable outbox and inbox delivered_at marker. Auth delivery callbacks atomically insert a private delivery intent and a unique outbox reference in their own transaction; this does not claim atomicity with Better Auth's separately owned signup transaction. The worker revalidates the local profile at each dispatch, locks one due job with FOR UPDATE SKIP LOCKED, performs the local SQL delivery and marks completion in the same transaction. No URL/token payload is copied into the outbox and no external sender exists. Two consumers cannot complete the same job twice; process death before commit leaves the pending job available to its replacement. Invalid payload/recipient/destination and unknown job kinds become explicit failed rows.

This S05 worker only performs database-local effects. S12 owns leases, bounded retries, dead-letter recovery and unknown-outcome reconciliation before work can occur outside a transaction. Do not add network calls inside this handler. Worker tests use their own synthetic test-database IDs and actual child processes, including a bounded crash while a real database lock is held; do not run them concurrently with auth tests on that database.

Append-only migration 0004 preserves pre-S05 inbox deliveries by copying created_at into delivered_at only when no corresponding outbox intent exists. New queued intents stay pending. The upgrade fixture verifies both sides; applied 0003 is unchanged. Raw SQL JSON parameters are serialized explicitly because the installed Drizzle postgres.js adapter changes the client's JSON serializer. Both the raw worker and Better Auth adapter use this same connection contract.

Locking semantics: [PostgreSQL18 SELECT locking clause](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE). Future release orchestration and restart supervision remain separate tasks.

## Container image and backups (S84/S85)

Status: S84 is **CODE** — the image builds and its checks pass; its default command runs the S83 advisory-locked `migrate.ts production`, then serves on `0.0.0.0:$PORT` under the S82 production profile without the owner password in its environment. S85 is CODE; its DEPLOY part is gated. Topology, volumes, env names and the gated DEPLOY steps are in [RELEASE.md](RELEASE.md) "Container topology (S84)" and "Backups and restore drill (S85)". Nothing here deploys or touches a server.

```bash
# Image (pinned Node 24.21.0 / PostgreSQL 18.6 client, non-root uid 10001, node-only HEALTHCHECK on /api/health).
# The build needs no database and no secret (storefront pages render per request).
docker build -t 99ribu:<commit> .
docker run --rm --entrypoint node 99ribu:<commit> scripts/image-audit.ts   # no keys, .env*, tests, docs, prototypes; .local empty and uid 10001
# Commands (both need S82/S83): web = image default (migrate production, then next start on 0.0.0.0:$PORT);
#           worker = node scripts/worker.ts production, with WORKER_HEARTBEAT_FILE=/tmp/worker-heartbeat.
# PID 1 is tini (signal forwarding, zombie reaping).

# Backup set (database + role globals + .local/{catalog-media,artifacts} + escrowed auth secret, SHA-256 manifest).
# BACKUP_STORE is file:///abs/dir or s3://bucket/prefix (+ BACKUP_S3_ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY);
# BACKUP_ESCROW_PUBLIC_KEY is the owner's RSA-3072+ public key (PEM or base64 DER). Never commit either.
npm run backup -- create local|test                 # production inside the image: node scripts/backup.ts create production
npm run backup -- list
npm run backup -- prune                             # dry run; --apply deletes per BACKUP_KEEP_DAILY (7) / BACKUP_KEEP_WEEKLY (4).
                                                    # file:// stores only; S3 retention is a bucket lifecycle rule (server has no DeleteObject)
npm run backup -- drill latest --escrow-private-key <owner-held key file>
npm run backup -- extract <set-id> <new-dir>        # verified media/artifacts extraction for a real volume restore (explicit id, never latest)
```

The drill restores into a fresh `99ribu_restore_<uuid>` database (this checkout's compose cluster for local/test sets, or the disposable server in `RESTORE_ADMIN_URL`) and a temporary volume. It refuses a restore server that holds `99ribu_production`, shares host:port with `BACKUP_DATABASE_URL`, or reports the same `pg_control_system()` identifier as it. It then requires: object checksums, archive = manifest, every photo hashing to its name with `0600`/`0700` modes, role globals, row counts per table equal to the backup snapshot, zero unbalanced journals, the ledger immutability triggers, every referenced catalog photo and private artifact file (allowlisted file-key columns) present (reported only for `test` sets, whose suites use temporary storage), and every staff TOTP secret and backup-code set decrypting with the escrowed `BETTER_AUTH_SECRET`. It drops what it created, pass, fail or on `SIGTERM`/`SIGINT`. Temporary files go under `TMPDIR`.

The checksums detect a corrupted, truncated or edited object; they are not an authenticity guarantee against someone who can rewrite a whole set including its manifest. That protection is the bucket setup required before any real data (RELEASE.md S85): write-only server credentials, versioning/Object Lock, lifecycle retention, read-only operator credentials for restores.


## Production profile (S82/S83)

`APP_ENV=production` is a second runtime profile beside the unchanged local profile (`src/config/runtime.ts`). It exists for the Vultr + Coolify migration (`RELEASE.md` "Production migration"); nothing here deploys anything. Every value comes from the container environment; nothing is read from `.local/`, and no value is ever printed (validation errors name the variable, never its value).

| Variable | Rule |
|---|---|
| `APP_ENV` | `production` |
| `APP_ORIGIN` | Exact `https://` origin of a public DNS host (OD-1: `https://99ribu.com`): no path, trailing slash, query, credentials, IP literal, `localhost`, `*.ts.net`, `.local`/`.internal` |
| `BETTER_AUTH_URL` | Required, equal to `APP_ORIGIN`; `BETTER_AUTH_TRUSTED_ORIGINS`, if set, must also equal it (no second origin) |
| `BETTER_AUTH_SECRET` | ≥32 random bytes, base64/base64url/hex (`openssl rand -base64 48`); `BETTER_AUTH_SECRETS`/`AUTH_SECRET` refused. It also encrypts staff TOTP secrets: escrow it with the backups (S85) |
| `PAYMENT_ADAPTER`, `SHIPPING_ADAPTER`, `ADS_ADAPTER`, `NOTIFICATION_ADAPTER`, `PAYOUT_ADAPTER` | Each exactly `disabled`. `simulated` would create fake effects; any live value is refused until that provider's gate passes |
| `EXTERNAL_DISPATCH` | `disabled` |
| `CLIENT_IP_HEADER` | The one trusted proxy's client-address header: `cf-connecting-ip` only when the origin's ports 80/443 accept nothing but Cloudflare's published IP ranges (or Authenticated Origin Pulls); `x-real-ip` only behind a proxy that overwrites any client-sent copy (Traefik, the Coolify default, does by default; Caddy needs the header set explicitly from the peer address). OD-9 picks one; `X-Forwarded-For` is never read |
| `DATABASE_HOST`, `DATABASE_PORT` | Private-network database host (Docker service name or IP) and port (default 5432); `DATABASE_URL` and `PG*` are refused |
| `DATABASE_SSL` | `disable` (default), `require` or `verify-full`. An external database requires TLS: `disable` is accepted only for loopback, RFC 1918 / IPv6 ULA literals and Docker-network names (single label, `.internal`, `.local`); any other host is refused unless `require`/`verify-full` (prefer `verify-full`) |
| `DATABASE_APP_PASSWORD`, `DATABASE_OWNER_PASSWORD` | SCRAM passwords of `99ribu_production_app` (web, worker) and `99ribu_production_owner` (migrations only), ≥16 characters. The owner password is removed before the web server starts and is never given to the worker |
| `PORT` | Listener port inside the container (default 3000); the listener is `0.0.0.0:<PORT>` |

Also refused: `LOCAL_TAILNET_ORIGIN`, provider credentials (`AUTOLARIS_`, `MENGANTAR_`, `META_`, …). The process environment wins over the `--env-file=.env.example` that the npm scripts pass, and every adapter must be set explicitly, so a missing variable fails closed.

What the profile does: Better Auth uses the env secret, `__Secure-` Secure cookies and the configured origin as its only trusted origin; app cookies (`commerce_guest`, `cart_access`, …) share the `__Secure-99ribu-production` prefix. Mutations need the exact `APP_ORIGIN` Host and Origin. Sign-in and the Better Auth ceilings key on the trusted proxy's client IP, guest bootstrap on its IPv4 address or IPv6 /64 (`30/min`, under the global `600/min`) (`503 CLIENT_IP_UNAVAILABLE` without it). Order placement answers `503 CHECKOUT_CLOSED` and money postings `PRODUCTION_MONEY_PATH_GATED` (OD-7: catalog-only launch); sign-up, password reset and verification email answer `503 NOTIFICATION_DISABLED` (S86/OD-8). `public/prototypes/` is rewritten to the 404 page. Every `src/modules/local/*` command, the in-process `local-fixture-command` flows, `fixture`/`login`/`login-codes`/`prune-accounts` and the simulated worker commands keep calling the local reader and refuse. The worker runs only its job loop with every adapter disabled.

Database (S83), once per server, as the PostgreSQL superuser (no password in the file, a shell argument or history):

```bash
psql -v ON_ERROR_STOP=1 -U postgres -f src/db/bootstrap-production.sql   # roles + 99ribu_production + revokes; a second run fails
psql -U postgres -c '\password "99ribu_production_owner"'                # SCRAM verifier, typed interactively
psql -U postgres -c '\password "99ribu_production_app"'
```

Commands inside the container (production environment set):

```bash
npm run build                        # image build: NODE_ENV=production; no database needed at build time
npm run db:migrate -- production     # one-shot `migrate` service only (the only container with the owner password)
npm start                            # web: next start on 0.0.0.0:$PORT, no owner password in the container
node --env-file=.env.example scripts/worker.ts production   # job loop only, dispatch=disabled
npm run health -- ready              # probes http://127.0.0.1:$PORT/api/health inside the container
```

The production pool is 5 connections with `statement_timeout` 10 s, `lock_timeout` 5 s and `idle_in_transaction_session_timeout` 30 s; `/api/health` reuses the web process's app pool. Database TLS follows `DATABASE_SSL` (off by default only on the private network). The pool timeouts also bound migrations: a migration statement waiting more than 5 s for a lock fails (55P03) instead of queueing behind live traffic, and the run exits non-zero so the previous container stays. Future CHECK widening on populated tables should use `ADD CONSTRAINT … NOT VALID` then `VALIDATE CONSTRAINT` in a separate step, so the validation scan does not hold an exclusive lock (`0035` drops and re-adds because every production table is still empty). Migration `0035` adds `'production'` only to the `environment` CHECKs of the 8 tables real production flows write (`autolaris_payment`, `cod_remittance`, `economic_receipt`, `finance_transaction`, `local_cod_operation`, `local_parcel_receipt`, `local_payment_operation`, `local_settlement_operation`: manual-bank confirmation, AutoLaris attempts/advice, COD remittance with its settlement source and collected-COD source, the ledger, and manual delivery receipts). The 11 pure simulator stores keep the database guarantee `environment IN ('local','test')` (`local_autolaris_transaction`, `local_parcel_outcome`, `local_recovery_destination`, `local_recovery_operation`, `local_refund_destination`, `local_refund_operation`, `local_replacement_operation`, `local_replacement_receipt`, `local_tracking_observation`, `local_waybill_cancellation`, `local_waybill_operation`); their only writers are simulated adapters, host simulator commands or tests. Expand-only; nothing else in those constraints changes. Still open before exposure: whether the chosen proxy overwrites a client-sent `X-Real-Ip`/`CF-Connecting-IP` (S84/S88), the 2FA budget review against load evidence, the container image and topology (S84), backups (S85), real staff accounts (S86) and the production catalog load (S87).

## Acceptance command registry

Run from this worktree with migrations applied to local and test. Use the exact commands below; selectors from later task procedures remain unimplemented until their owning slices add verified cases. Each implemented selector is documented in its checkpoint section below. The small wrapper selects Node-native test files and checks their events; it introduces no separate test framework. Missing/unknown/duplicate/extra selectors, skipped/TODO/cancelled tests, empty files and failed checks produce a nonzero exit. A missing database fails preflight before tests run. Files run serially; do not run another acceptance process against the same databases concurrently.

| Command | Required state | Executed scope |
|---|---|---|
| `npm run check` | Locked dependencies installed | Lint, generated Next types/TypeScript, configuration/startup/runner tests (including the S82 production-profile refusals) |
| `npm run test:integration -- --case=backup-restore` | Isolated test DB migrated; this checkout's compose cluster running | S85: backup set of `99ribu_test` + drill into a disposable database (counts, ledger, photos, staff TOTP with the escrowed secret), verified extract, detection of an edited archive object (checksum mismatch), refusal of a wrong escrow key, an undecryptable TOTP secret and a restore server holding `99ribu_production`, restore-database cleanup on `SIGTERM`, and label artifact keys (file keys checked, label-job row ids ignored, a missing label file reported and failing non-test targets); restore databases dropped |
| `docker build -t 99ribu:<tag> .` then `docker run --rm --entrypoint node 99ribu:<tag> scripts/image-audit.ts` | Docker without sudo | S84 image build (no database or secret needed) and image content audit |
| `npm run build` | Valid local profile | Production build; does not prove UI or database behavior |
| `npm run test:integration -- --case=foundation` | Isolated test DB migrated and running | 5 files, 24 database/storage/key/auth/worker checks |
| `npm run test:integration -- --case=all-current` | Isolated test DB migrated (`0000`–`0037`); built web running on `127.0.0.1:3099`; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` set | All 178 current runtime integration test files (historical pre-migration candidates live in `tests/historical/`) |
| `npm run test:integration -- --case=localhost-readiness` | Built web + local/test DB migrated | Assembled S65–S68 localhost readiness + real `pg_dump -Fc` / `pg_restore` into disposable DB |
| `npm start` | Successful build | Web at `http://127.0.0.1:3099` only |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=foundation` | Built web + local DB; no other local worker; Chromium installed | 2 files, 3 HTTP/cookie/worker-delivery checks |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=localhost-readiness` | Built web + local DB; Chromium installed | Multi-viewport (`390`/`768`/`1440`) buyer/affiliate/staff localhost readiness |
| `npm run health -- ready` | Built web + local DB | Exact 200 readiness envelope and no-store |
| `npm run health -- unavailable` | Built web running; owned DB intentionally stopped | Exact 503 unavailable envelope and no-store |
| `npm run catalog:dataset` | Raw Berlapak snapshot on this host (`BERLAPAK_DATA_DIR`, default `/data/99ribu-berlapak-data`) | Regenerates the committed DEC-005 dataset `data/catalog/berlapak/` (catalog.json, manifest.json, photos/<sha256>.webp); deterministic, a rerun on the same snapshot changes no file |
| `npm run catalog:import -- local\|test [dataset-dir]` | Migrated target DB (`0030`); current commercial policy for publication | Idempotent import of the committed dataset through the real catalog/publication services; creates/reuses the DEC-006 origin warehouses by `origin_key` and binds each offer to its origin; never creates stock, cost or order rows (see "Deploying the catalog") |
| `npm run catalog:initial-stock -- local\|test [dataset-dir]` | Raw Berlapak snapshot on this host (`BERLAPAK_DATA_DIR`); catalog and origin warehouses already imported; migrated target DB | S81/S90: one initial `receive` movement into the item's origin warehouse and one component HPP version per catalog stock item from the raw snapshot (nothing committed) plus S69 default assumptions per offer, through the real inventory/finance services as a temporary audited owner; only for items without stock history in any warehouse, so reruns add nothing; refuses a snapshot that is not the dataset's |
| `npm run catalog:rehome -- local\|test [--apply]` | Migrated target DB (`0030`); committed dataset | S90 (DEC-006 transition): read-only dry run (default) of origin warehouses to create, catalog units held outside their origin warehouse to move (and reserved/quarantined units that stay), open transfers and offers the next import rebinds; `--apply` creates missing origins and moves available units through audited warehouse transfers (create, dispatch, receive) as a temporary audited owner; reruns converge. Run `catalog:import` afterwards |
| `npm run catalog:withdraw -- local\|test [--apply]` | Migrated target DB (`0029`) | S81: lists (read-only dry run, default) or withdraws (`--apply`, temporary audited owner, real publication service) every current publication outside the committed catalog, grouped by origin |
| `npm run test:integration -- --case=manual-fulfillment` | Isolated test DB migrated (`0031`) | S91: Berlapak references, manual shipment (own Mengantar resi), tracking statuses/corrections, pickup profile scope |
| `npm run test:integration -- --case=db-hygiene` | Isolated test DB migrated (`0037`); a current commercial policy in the test DB (any catalog/payment suite creates it) | S104/S105: admin categories limited to categories used by a current draft or live product plus ancestors; staff support inbox keyset pages (activity/id order, SQL unread filter, unknown cursor refused); retention jobs in one rolled-back owner transaction — bounded 500-row batches and idempotent reruns, kind/action allowlists, 30/90-day windows, catalog-read FK references kept, expired sessions with their MFA rows, verifications, idle rate buckets, and the visitor purge (unreferenced graph removed, order-linked visitor and money/attribution/audit counts untouched, app role refused the window override and direct deletes even with the purge setting on) |
| `npm run test:integration -- --case=admin-orders` | Isolated test DB migrated (`0034`) | S100: staff order search by order number, current/superseded resi and phone suffix; detail without contacts; spec-07 scope, warehouse-role denial, shared search limiter |
| `npm run test:integration -- --case=cod-remittance` | Isolated test DB migrated (`0031`) | S91: COD collectible parcels, remittance matching and settlement |
| `npm run test:integration -- --case=payment-methods` | Isolated test DB migrated (`0032`) | S92: manual bank transfer (unique code added, 24h), COD fee 3.33% of goods + shipping |
| `npm run test:integration -- --case=production-profile` | Isolated test DB migrated (`0035`); Docker with the pinned `postgres:18.6` image | S83: `0035` recorded and a test-DB re-run applies nothing; the 8 real-flow `environment` CHECKs list `local`/`test`/`production` and the 11 simulator stores exactly `local`/`test` (a simulator store rejects `production`); plus a disposable TCP + SCRAM container: `bootstrap-production.sql` applies once (second run fails, nothing changed), two concurrent `db:migrate -- production` runs both exit 0 with one applying, app role refused DDL/`TRUNCATE`/other databases, a real-flow table accepts `production` there while a simulator store rejects it, per-IP guest budget, production worker starts with dispatch disabled; container removed afterwards |
| `npm run test:integration -- --case=autolaris-payments` | Isolated test DB migrated (`0034`) | S93: AutoLaris VA/QRIS simulated contract, advice, store-borne fee |
| `npm run fixture -- payment-terms local <ns>` | Migrated local DB | DEC-008/009 payment terms for local checkout (idempotent) |
| `npm run fixture -- demo-orders local [<ns>]` | Migrated local DB, payment/commercial terms, catalog with initial stock, `fixture -- login local` | Local-only demo orders in every order state through the real flows ("Local demo orders"); idempotent per namespace, no reset |
| `npm run test:integration -- --case=demo-orders` | Isolated test DB migrated | The demo-orders fixture in its own TEST namespace: each state visible in the buyer order projection and admin queues; rerun creates nothing |
| `npm run fixture -- commercial-terms local <ns>` | Migrated local DB | Commercial policy baseline (1000 bps default commission, IDR 99,000 minimum payout) through the owner policy route, required for catalog publication (idempotent) |
| `npm run worker -- --autolaris-paid <ATTEMPT_ID>` | Local worker profile | Simulate an AutoLaris paid advice for one local attempt (refused outside local/test) |
| `npm run worker -- --track-parcel <FULFILLMENT_ID> <PROVIDER_STATUS>` | Local worker profile | S91: simulated courier feed reports `PICKED_UP`/`IN_TRANSIT`/`FAILED`/`DELIVERED` for a manual parcel's current resi and runs its due tracking poll (refused outside local/test) |
| `npm run test:integration -- --case=PR-1` | Isolated test DB migrated | S14 catalog plus S80 `catalog-import` (generator determinism/sanitization, malformed-dataset refusal, idempotent rerun, guarded publication, revisions, preserved staff edits, photo serving), S81 initial stock/HPP, guarded publication, publication withdrawal, test-run teardown and read-only withdraw dry run, and S90 origin warehouses (per-offer origin keys, generic kecamatan names, origin binding, initial stock into origins, `rehome` dry run/apply/convergence and rebinding import) |

Browser and storefront suites rewrite their captures under `docs/spec/design/renders/<slice>/` on every run: a dirty render directory after a run is expected, and refreshed renders are committed only with the change they evidence. The S27 design-review baseline (`design/review.md`, `design/review-slices/`) is separate and must stay byte-identical. The browser executable above is host-specific; use a verified installed path or omit the variable for Playwright-managed Chromium. Missing browser/server is a failure. Keep the auth rate-limit window between repeated browser runs. On suite failure, run its registered native `test:database`, `test:storage`, `test:auth`, `test:worker`, `test:smoke` or `test:auth:http` command to isolate the cause; the aggregate prints bounded test names/counts, not captured child output that may contain private fixtures.

`/api/health` reports only current web-to-database/schema availability. It checks access to identity and outbox tables without reading user rows. It does not attest worker liveness, commerce functionality or remote availability. The root `/` renders the storefront home page (`200`). See [OBSERVABILITY.md](OBSERVABILITY.md) for failure and recovery commands. Browser cookie proof is not rendered storefront acceptance.


## Responsive composition prototypes (S08)

With the built loopback web running, open <http://127.0.0.1:3099/prototypes/index.html>. The screen selector exposes home/search, product, checkout, order/return, affiliate, warehouse and chat compositions. Every screen is labeled as prototype data. These static fixtures make no domain/API calls and create no orders, messages, transfers or auth sessions; the actual root storefront remains unimplemented. CSP denies outbound connections/form submissions. Keep this review surface out of a future live release unless explicitly retained.

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:prototype
```

The command runs pinned Biome plus 36 Node/Playwright checks. It captures nine screens at 390/768/1440 and exercises query/filter/Back, modal keyboard focus, checkout validation/stale-quote input retention, split COD review, pending payment return, unsent chat draft, warehouse filtered-zero and 320px/200% text. Captures live under `docs/spec/design/renders/s08/`; the selected composition and critique remain in the canonical design document. A missing browser/server fails. Real OS virtual keyboard/IME, Safari/native WebView and full commerce behavior require their later evidence.

Inter 4.1 is self-hosted with its OFL license. Functional inline Lucide SVGs are pinned to the recorded source commit with the ISC license; `public/prototypes/assets.json` owns source and hash details. Product photo slots are explicitly labeled pending owner-content assets. No emoji/emoticon icons or invented product photographs are used. Independent visual review and the design gate must pass before S08 is accepted; screenshots and green tests alone do not supply that approval.


## Staff access and MFA (S09)

Apply migration 0005 to both isolated databases before starting this build. It adds explicit role grants, warehouse membership, encrypted Better Auth factor/recovery records, session-bound MFA proof, reauthentication proof and operation identity, plus append-only audit events. Existing migrations 0000–0004 are unchanged. TOTP enrollment and verification/recovery are the only added public vendor auth paths; trusted-device, disable and factor-secret retrieval are refused. Staff sessions without a successful factor bound to that session fail with MFA_REQUIRED. Buyer/affiliate identities gain no staff authority through signup or request headers.

The built application now mounts GET /api/v1/me, GET /api/v1/admin/warehouses, POST /api/v1/me/reauthentication-proofs and POST /api/v1/admin/role-grants. Grant replacement is owner-only, requires a fresh password check plus MFA within five minutes, expected_version and an Idempotency-Key. Its proof is session/action/target bound, expires in five minutes and is consumed transactionally. Replaying the same operation returns the stored result; changed intent conflicts. Target sessions are revoked on successful role changes. Owner bootstrap, operator UI and domain-specific order/fulfillment/export handlers remain their later slices; no public owner-signup bypass exists.

```bash
npm run test:integration -- --case=PR-13
# With the newly built server, migrated local DB and installed Chromium:
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-13
```

The integration selector executes five real PostgreSQL scenario groups: all seven roles/guest and scoped projections; atomic grant concurrency/replay; expired proof/fresh-factor/persistent rate limits; exact-session MFA and recovery reuse; database-observed blocking during competing owner demotion/session deletion. The browser selector executes one actual built-server cookie/MFA/warehouse-scope probe. Integration fixtures use only the isolated test database and clear their own fixed auth rate buckets; do not run auth/integration suites concurrently against it. Browser probes preserve local rate limits. Tests retain append-only synthetic audit events and delete only their own mutable fixtures. Pure order/finance/export access predicates are verified, but actual business handlers and their acceptance must be tested when implemented.

S09 has no visible auth/admin screens. The static S08 prototypes remain a separate composition preview. The complete first-party OAS transport/error/operation registry alignment is S10; a structural planning-contract pass does not establish every proposed endpoint or native bearer support.


Better Auth path buckets use the fixed loopback address and act only as global ceilings; brute-force budgets are per account in `src/modules/access/handler.ts` (`ACCOUNT_LIMITS`, keyed by HMAC of the email, reset token or exact 2FA/session cookie). A known email can still be locked out for up to 60 seconds. This is a local-profile constraint, not a production proxy/rate-limit design. Initial enrollment trusts the verified email/password session; controlled owner/staff onboarding must protect that first enrollment. Proof/operation retention and administrative audit retention remain explicit downstream operations/privacy work, not an implied deletion policy.


## Implemented API parity (S10)

The S10 checkpoint established four implemented access operations; S13 adds two policy operations. Canonical OpenAPI maps every implemented operation to its adapter and executable proof group. All operations have registered domain ownership; proposed visitor/guest/native transports remain unissued. The actual local origin is http://127.0.0.1:3099, and cookie-only access rejects mixed bearer/capability headers. JSON body limits, retry keys, pagination and private errors match the selected contract.

```bash
npm run test:integration -- --case=PR-18
# Requires the current production build running on 127.0.0.1:3099:
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-18
python3 docs/spec/scripts/check-openapi-contract.py
npx --no-install @redocly/cli@2.64.0 lint docs/spec/openapi.yaml --extends recommended --format summary
```

PR-18 validates observed synthetic request/response exchanges against the canonical OAS through the already installed Python PyYAML/jsonschema packages. Missing dependencies fail. Integration uses isolated test PostgreSQL; the browser uses synthetic local fixtures and real cookies. Run database suites sequentially. No raw credentials/proofs are written to evidence. Domain-handler parity grows with implementation and is audited comprehensively in S64.


## Namespaced synthetic fixture harness (S11)

Migration 0006 adds fixture namespace/principal/warehouse ownership mappings and a persisted business clock. It creates no seed data. Seed translates the existing eight synthetic principals and two warehouses only; catalog/stock/cost translation remains S18. Each namespace keeps stable real auth and warehouse IDs. Rerun preserves password recovery, factors, role edits, warehouse edits and clock advancement, and never wipes other rows. Namespaces isolate harness setup; owner company permissions retain their canonical scope.

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

### Local dummy sign-in accounts

Sign in at <http://127.0.0.1:3099/masuk>. These stable accounts are separate from the namespaced fixture principals (`<namespace>.<x>@example.test`, random passwords) and exist only after the explicit, local-only `login` command. Every account shares one dummy password, `99ribu123456` (`LOCAL_DUMMY_PASSWORD` in `src/modules/local/logins.ts`; 12 characters, the auth policy minimum). Dummy credentials for the local profile only.

| Role | Email | Password | 2FA | Landing after sign-in |
|---|---|---|---|---|
| Super Admin (owner) | `owner@99ribu.test` | `99ribu123456` | yes (TOTP) | `/admin` |
| Admin E-Commerce (ecommerce_admin, every active origin warehouse) | `ecommerce@99ribu.test` | `99ribu123456` | yes (TOTP) | `/admin` |
| Gudang (warehouse, every active origin warehouse) | `gudang@99ribu.test` | `99ribu123456` | yes (TOTP) | `/admin` |
| Layanan Pelanggan (customer_service, every active origin warehouse) | `cs@99ribu.test` | `99ribu123456` | yes (TOTP) | `/admin` |
| Keuangan (finance) | `keuangan@99ribu.test` | `99ribu123456` | yes (TOTP) | `/admin` |
| Pembeli (buyer) | `pembeli@99ribu.test` | `99ribu123456` | no | `/akun` |
| Pembeli 2 (buyer) | `pembeli2@99ribu.test` | `99ribu123456` | no | `/akun` |
| Mitra Afiliasi (affiliate) | `afiliasi@99ribu.test` | `99ribu123456` | no | `/akun` |

```bash
npm run fixture -- login local                   # create/refresh: passwords, roles, warehouse scope, staff TOTP enrollment
npm run fixture -- login-codes local             # current 6-digit TOTP code per staff account
npm run fixture -- prune-accounts local          # dry run: counts of leftover synthetic test accounts that would be deleted
npm run fixture -- prune-accounts local --apply  # delete them
```

Every staff role requires an MFA-verified session, so `login` enrolls TOTP through the real auth handler and prints `totp_uri`/`totp_secret` (add to an authenticator app) and `current_code`; backup codes are printed only on first enrollment, and reruns keep the enrollment. After the password, `/masuk` asks for the authenticator code (or a backup code). A validated same-origin `?next=` overrides the landing page. Staff get the permissions their workspace needs (labels/exports/order history/finance); `gudang@`, `ecommerce@` and `cs@` are scoped to every active origin warehouse (S109: order history/search and return review show only orders whose every parcel is in the reader's warehouses; the CS dashboard itself is company-wide and unchanged) once the catalog is imported (S90), else to the `demo` namespace's Malang warehouse (or the oldest active Malang warehouse). The command is subject to the normal per-account sign-in limit (5 per minute).

`prune-accounts` only considers `@example.invalid`/`@example.test` users: unmapped test users (`access-*`, `browser-*`, orphan seed operators) and principals of per-run fixture namespaces (8-hex run suffix, plus the retired `signin-check`). It keeps any user still referenced by orders, carts, audit, operations, support or buyer/affiliate data, every principal of a fixed namespace (`demo`, `berlapak`, `commerce-demo`, ...; their seed reruns need the full mapping), and users created in the last 15 minutes; an FK refusal skips the user. All commands refuse the `test` target and any non-local profile. Browser check: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=foundation`.

Business clock updates use optimistic versions and cannot move backwards. Each advance is at most 366 days. They never change host time or real auth/session/MFA expiry. Future scenario consumers must explicitly use this clock through a trusted context. No reset command exists; unsafe/remote targets and mixed/live config fail. Run database integration suites sequentially. The full T-38 provider/domain scenario set remains unaccepted until its owned later slices pass.

### Local demo orders

One command fills every storefront and admin order screen with realistic orders, created only through the real flows: checkout handlers (cart → quote → order), the payment/AutoLaris/COD/tracking simulators of `scripts/worker.ts`, the finance transfer and COD-statement routes, manual fulfillment, commerce exceptions, returns, support and affiliate referral. Nothing is inserted into business tables and no trigger is disabled. It uses the published DEC-005 catalog (single-unit offers with stock in their origin warehouses) and the dummy accounts above: `pembeli@`/`pembeli2@` buy, a few orders are guests, `afiliasi@` brings one buyer through its referral link (enrolled once with code `MITRA99`), and staff steps are signed in as `keuangan@` (transfer confirmation, COD statement), `gudang@` (resi entry), `cs@` (return decision) and `owner@` (stock shortage, stock transfer).

```bash
npm run fixture -- demo-orders local                 # default namespace demo-orders
npm run fixture -- demo-orders local demo-oct        # another, separate set
npm run test:integration -- --case=demo-orders       # TEST database, own namespace
```

Prerequisites: migrated LOCAL database, `fixture -- commercial-terms`/`payment-terms`, the catalog imported with initial stock (Local quick start) and `fixture -- login local`. The command refuses the `test` target and any non-local profile; the module accepts `test` only for its integration test. It prints a table of state, order number, buyer and a short detail; no IDs, tokens or credentials.

| State (scenario) | Flow |
|---|---|
| Transfer awaiting payment (`transfer_awaiting`) | manual bank transfer, instructions issued, 24 h window from now |
| Transfer near deadline (`transfer_near_deadline`) | manual bank transfer placed 20 h before the anchor: under 6 h left |
| Transfer expired (`transfer_expired`) | placed 24 h 05 min before the anchor, no instructions requested; its own expiry job cancels it |
| Transfer confirmed (`transfer_confirmed`) | finance confirmation with reauthentication; paid parcel waits in "Perlu dipesan kurir" |
| AutoLaris pending / paid (`autolaris_pending`, `autolaris_paid`) | simulated VA BCA issued / QRIS paid through the advice poll (`--autolaris-paid` steps) |
| COD awaiting manual booking (`cod_awaiting_booking`) | confirmed COD parcel in the S91 queue |
| Manual shipment (`manual_shipped`) | resi + Berlapak purchase reference entered |
| In transit (`in_transit`) | simulated tracking `IN_TRANSIT` (`--track-parcel` steps) |
| Delivered (`delivered`) | paid transfer, resi, tracking `DELIVERED`, buyer receipts recorded |
| COD collected + remitted (`cod_remitted`) | delivered, Mengantar COD statement recorded and matched (COD settlement screen) |
| COD refused (`cod_refused`) | tracking `FAILED`, COD refused (`--refuse-cod` steps) |
| COD partially cancelled (`cod_partial_cancel`) | 2 units; one reported short at packing, cancellation proposed, accepted by the buyer, applied: booking shows the reduced COD basis (S99) |
| Return requested / decided (`return_requested`, `return_decided`) | delivered orders; buyer return request; `cs@` approves the refund (awaiting goods) |
| Support conversation (`support_conversation`) | `pembeli@` asks about the in-transit order, order context card attached |
| Affiliate order (`affiliate_order`) | guest arrives through `afiliasi@`'s referral link; COD order attributed, commission accrued |

Time: all scenarios except the two past-dated transfers run on the wall clock (no clock namespace), against the catalog's origin warehouses, so scoped staff (`gudang@`, `ecommerce@`, `cs@`) see them and the worker treats them like live orders: the awaiting transfer expires about 24 h later if the worker runs. The near-deadline and expired transfers need an order time in the past, which only a fixture business clock allows: they run in the namespace's own clock and fixture warehouse (one unit per order moved there from an origin warehouse by an audited transfer), at anchor − 24 h 05 min and anchor − 20 h, after which the clock moves to the anchor. The anchor is now when the manual-bank payment terms were already in force 24 h ago; otherwise it is the current terms' start + 24 h 10 min (that namespace clock then runs ahead of the wall clock and the near-deadline state holds at the anchor, not yet at wall time). The namespace clock then stands still, so the worker never cancels the near-deadline order; measured against the wall clock (admin "Transfer mendekati batas" KPI, finance queue) it is past due about 4 h after the run. Those two orders live in the namespace's fixture warehouse, outside the origin-warehouse scope of `cs@`/`gudang@` order search (owner and finance see them).

Rerun and reset: a rerun with the same namespace is idempotent (each order is recorded once as a `local_fixture.demo_order` audit row of `local-demo-orders:<namespace>`) and resumes unfinished steps of account orders; a guest step interrupted mid-run cannot be resumed (its order capability lived only in that run), and a namespace whose clock already passed the past-dated order times skips them; use a new namespace. There is no reset or cleanup: orders, stock movements (consumed, reserved, one unit reported short, transferred units), finance postings and audit history are immutable business history, so demo data accumulates in the local database only. A buyer that already holds two open manual-bank orders (e.g. from an earlier namespace) is replaced by a guest for a new transfer order.


## Durable job and recovery primitives (S12)

Migration 0007 extends the existing outbox with processing/unknown states, token-fenced 30-second leases, dispatch markers, finite attempts and bounded safe receipt metadata. Database-local notifications retain atomic effect/completion. Registered server adapters use the same worker entry point for effects outside that transaction; no vendor adapter is enabled by this checkpoint.

```bash
npm run db:migrate -- local
npm run db:migrate -- test
npm run test:integration -- --case=PR-16
```

The PR-16 integration selector currently proves S12 primitives only; full commerce reliability remains domain/assembled-localhost acceptance. Eleven checks include forced locked-row contention by two real worker processes, committed barriers and SIGKILL before/after effect, stale lease fencing, lost-response reconciliation, finite backoff/dead-letter, malformed outcome and adapter deadline. Test-only workers stay on the isolated test DB. A copied job ID is no public recovery credential; proposed operation HTTP recovery remains pending.

Worker leases renew only while owned/unexpired. Adapter calls have a25-second deadline/AbortSignal; raw errors map to UNKNOWN_OUTCOME. Unknown lookups wait 30 seconds after uncertain results or expired started/reconciliation leases. Outcome status/code pairs are validated together; ambiguity stays unknown. The deadline remains referenced so a lost idle connection cannot end the worker before settlement. Retryable means verified no-effect, not an arbitrary network error; reconciliation must prove the original attempt cannot subsequently apply before allowing retry. Retries keep the original job/effect identity and use bounded 1–60-second backoff, at most the persisted 1–10 attempts (default 5). Terminal failed rows remain as dead letters; uncertain results stay unknown even at the attempt cap. Domain adapters own issued-contract receipt validation, bounded requests and registration. Production manual affiliate payouts remain manual; this worker sends no money.


## Development contract formats

The API checker and in-memory probes require active date-time, date, URI, URI-reference and UUID formats. Missing optional format packages fail explicitly; canaries reject impossible dates and invalid URIs. Base Python provides PyYAML/jsonschema. Install the hash-pinned format dependencies into the private project tooling directory. On this development host, standalone pip 26.2.1 was used for tooling setup:

```bash
curl --fail --location https://bootstrap.pypa.io/pip/pip.pyz --output .local/pip.pyz
python3 .local/pip.pyz --isolated install --no-input --no-cache-dir --index-url https://pypi.org/simple --require-hashes --only-binary=:all: --target .local/contract-formats -r tests/contract/requirements-formats.txt
python3 tests/contract/formats.test.py
```

The local foundation creates the private .local parent first. Tooling files are ignored by Git. The pins/hashes come from the published [RFC3986 validator](https://pypi.org/project/rfc3986-validator/) and [RFC3339 validator](https://pypi.org/project/rfc3339-validator/) distributions; the setup follows [PyPA standalone pip instructions](https://pip.pypa.io/en/stable/installation/#standalone-zip-application). No application runtime package was added.


## Versioned company and calendar policies (S13)

Migration 0008 adds policy heads and immutable versions. Owner cookie/MFA is required for GET/POST /api/v1/admin/policy-versions. GET returns bounded history, latest_version for optimistic edits, and current for the effective policy. POST includes expected_version, reason, stable retry key and a five-minute purpose/subject-bound proof. Null effective_at activates at trusted server time; an explicit UTC millisecond instant must be prospective and not precede the latest scheduled version. Exact committed retry recovers the original version/instant.

Commercial values accept default_commission_bps and minimum_payout_idr. Fixed price 99000, IDR and manual payout remain invariants. Calendar values match their warehouse timezone, carry year/weekdays/cutoff/closure dates and enforce TEST-ONLY/test_only. Historical versions and stream scope cannot be rewritten. Immutable calendar references retain archived synthetic test warehouses; tests never wipe policy history. Real order/commission/payout consumers still own their snapshot integration.

```bash
npm run test:integration -- --case=PR-20
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-20
```

The access proof endpoint now permits reviewed company_policy.version and warehouse_calendar.version purposes in addition to staff_roles.replace. Issuance idempotency spans purposes in the same session; changing purpose/subject with the same key conflicts. Calendar UUID subjects normalize case. Consumption uses wall time after a database lock wait; expiry rolls back the entire mutation. Rechecks lock current owner/session/factor rows. No raw proof/password is stored in policy/audit results. OAS proof groups cover access and settings independently while preserving complete implemented-operation registration.

S13 scheduling bound: prospective activation uses database wall time and rejects dates more than 366 days ahead with 400 POLICY_SCHEDULE_TOO_DISTANT. Earlier-than-last scheduled appends return 409 SCHEDULE_CONFLICT; failures roll back proof consumption. This bounded append-only schedule has no cancellation endpoint. Shipping consumers must independently verify calendar-year coverage for every calculated business day; S13 does not calculate shipping deadlines. Scenario setup must append its own explicit policy inputs rather than relying on policies left by earlier tests.

## Deploying the catalog (S80, DEC-005)

The Berlapak snapshot is the production starting catalog. `data/catalog/berlapak/` is committed content, reviewed like code: `catalog.json` (14 departments, 368 physical SKU identities, 392 IDR 99,000 offers: 122 unit, 244 multipack, 26 bundles), `manifest.json` (catalog digest plus SHA-256/size/dimensions of every photo) and 708 hash-named WebP photos (~48 MB). It holds public names only; the generator refuses output that names a supplier or supplier warehouse in product text, and contains no HPP, stock, supplier name or supplier warehouse id/name. DEC-006 (`99ribu.catalog/v2`): each offer names its origin warehouse by an opaque hashed key, and `warehouses` lists 49 generic `Gudang <Kecamatan>, <Kota>` warehouses with province/city/district only. Departments are marketplace-style (`DEPARTMENTS` in `src/modules/local/berlapak-dataset.ts`, e.g. `fashion-pria` "Fashion Pria", `kesehatan` "Kesehatan"); every product is classified by what it is, not by the supplier's category: `DEPARTMENT_RULES` match product-type phrases in the uncut public name and variant (earliest match wins, so the head noun decides), the supplier department is only a weak prior (unisex fashion gender, fallback), a bundle follows its dominant component purpose, and `CATEGORY_OVERRIDES` holds reviewed exceptions. The generator refuses an unclassified product, a department under 8 products and an override naming no product. Each department and, where a rule names a more specific node, each product carries a `google_product_category` id pinned from the official Google Product Taxonomy (version 2021-09-21, `GOOGLE_CATEGORIES`; unknown ids refuse generation); the local feed (`src/modules/catalog/feed.ts`) emits it with the Indonesian department path as `product_type`. Product titles are one-line card titles of at most 40 characters (48 for a few listed overrides) (`cardTitle`: supplier noise removed, multipack count as `N pcs`, the offer's own variant after a comma, e.g. `Papan Tulis Tab untuk Anak, Hijau`; the generator refuses invented words, equal titles within a department and a title that loses its product-type phrase, and `TITLE_OVERRIDES` holds the reviewed exceptions). Descriptions are the offer contents plus the supplier's marketplace description tidied by `cleanDetails` (seller promises, contact/links, stock/shipping notes, store/maker names, emoji and shouting removed; facts kept; claim terms kept as written and reported for the DEC-013 backlog). Photo alt text is the card title (`, foto N` from the second photo; a bundle photo names its component, claim words left out); the importer serves photos as `/media/catalog/<title-slug>-<first 12 hex>.webp` while storage stays content-addressed. The full public name stays in the offer contents (stock item name) and, for a shortened bundle, the first description line. Regenerate only on a host with the raw snapshot (`npm run catalog:dataset`), review the diff, then commit.

Deploy step, after migrations, on the target host from the repository root:

```bash
npm run catalog:import -- local
```

The command verifies the whole dataset (digest, exact photo set, per-photo hash/size/WebP header) before any write, stores photos through the storage module in `.local/catalog-media/<sha256>.webp` (same path locally and on the server, outside `public/`; served by `GET /media/catalog/<sha256>.webp`), then runs as a temporary audited MFA owner (the S18 seed operator, removed afterwards) through `createCategory`/`createStockItem`/`createProduct`/`patchProduct`/`publishProduct`. Every offer uses its dataset origin warehouse as its default fulfilment warehouse (DEC-006): missing origin warehouses are created once (audited `catalog.warehouse.create`), existing ones are reused by `origin_key`, and a stored origin with a different name/location or inactive refuses the import before any write. One `catalog.import` audit row is written per run that changes anything; product revisions whose actor is such a run are importer-owned.

- Idempotent and resumable: category slug, stock-item SKU (`B99_<rank>`) and offer SKU (`B99_<key>_OFFER`) are the checkpoint. A rerun with the same dataset writes no catalog row; a run interrupted mid-way converges on the next run. Concurrent runs are refused by an advisory lock.
- Revisions: a changed dataset appends a new product revision through `patchProduct`; published and older revisions stay immutable. A product whose current revision was written by staff is preserved and listed in `products.preserved`. Existing categories and stock items are immutable: a different name under an existing slug or SKU refuses the whole import before any write. Renaming a department therefore means a new slug: the import creates the new category and moves importer-owned products to it in their next revision (republished in the same run when ready); the old category row stays, unused, and leaves the storefront once it has no public product. Offers removed from the dataset are left untouched.
- Publication: drafts are published only through the real guard. On a fresh server every product reports blockers (`COMPLETE_STOCK_REQUIRED`, unknown HPP, missing assumptions/policy). Load initial stock and HPP (below), then rerun the import to publish the products that became ready.
- Image URLs embed `APP_ORIGIN` at import time; a changed origin produces one new revision per product on the next import.
- Include `.local/catalog-media/` in backups alongside private artifacts.

### Live catalog (S81)

Initial stock and HPP come from the raw snapshot at run time and are never committed. Ordered steps on a host with the snapshot, after migrations (`npm run db:migrate -- <target>`, includes `0029_publication_withdrawal`):

```bash
npm run catalog:import -- local                         # origin warehouses + catalog rows (no-op when unchanged)
npm run catalog:initial-stock -- local                  # receive into origin + HPP + default assumptions, once per item/offer
npm run catalog:import -- local                         # guarded publication of ready products
npm run catalog:withdraw -- local                       # dry run: non-catalog publications still public
npm run catalog:withdraw -- local --apply               # withdraw them through the publication service
```

- Each item is received into its origin warehouse (DEC-006). An item that already has stock history in any warehouse, or a cost with history, is skipped: a rerun or a newer snapshot never double-receives or overwrites HPP; `differs_from_snapshot` counts drift to correct through normal receiving/adjustment/cost flows. A raw snapshot other than the dataset's `source_snapshot` is refused before any write (regenerate the dataset and import first).
- The storefront shows only current publications: home lists the newest publications and the departments with the most published products; header, categories and search have no fixed SKUs or slugs. Product photos are served same-origin from `/media/catalog/<sha256>.webp`.
- Withdrawal (`withdrawPublication`) appends an immutable, audited `publication_withdrawal` for the current publication; carts flag the change, quotes and new carts refuse it, placed orders keep their snapshots. Republishing is an ordinary guarded publication against the unchanged `latest_version`.
- Browser suites use the local database: `npm run test:browser` ends with a `teardown` summary after withdrawing the non-catalog publications that synthetic or removed principals made during that run. Publications from runs started directly with `node --test`, or by an interrupted runner, are found by the withdraw dry run.

### Origin warehouses (S90, DEC-006)

A database whose catalog was imported before DEC-006 has every offer and all initial stock in one import warehouse. Transition it through domain services only (no history is edited; HPP is per stock item and does not move):

```bash
npm run db:migrate -- local                 # 0030_warehouse_origin (expand-only)
npm run catalog:rehome -- local             # read-only plan: origins to create, units to move/held, offers to rebind
npm run catalog:rehome -- local --apply     # create origins; audited transfers create -> dispatch -> receive per position
npm run catalog:rehome -- local             # expect units.to_move 0
npm run catalog:import -- local             # new revision binds each importer-owned offer to its origin; guarded republish
npm run catalog:rehome -- local             # expect offers.to_rebind 0
```

Reserved or quarantined units stay where they are (open orders keep their shipments). Staff-edited drafts are reported in `offers.preserved` and keep their warehouse. Each origin warehouse still needs an owner-approved `warehouse_calendar` policy version before fulfillment deadlines apply.

The S69 `npm run fixture -- berlapak` command stays a local-only fixture tool (namespaced copies with stock, HPP and dummy orders, images under `public/catalog-local/`); it is not used for deployment.

## Search indexing

One switch and one route table decide indexing. `SITE_INDEXING` (`src/config/site.ts`) is `index` when unset in every profile, including the S82 production profile; set `SITE_INDEXING=noindex` on a rehearsal or staging host to make every page `noindex, nofollow` and serve `robots.txt` as `Disallow: /` with an empty sitemap. Any other value throws. Canonical, Open Graph, sitemap and JSON-LD URLs derive from `APP_ORIGIN`, never a hard-coded domain.

`routePolicy` in `src/modules/storefront/seo.ts` classifies every page route. The root layout defaults to `noindex, nofollow`, so an unclassified route stays private.

| Route | Robots | Canonical / notes |
| --- | --- | --- |
| `/`, `/kategori`, `/bantuan` | index, follow | self |
| `/kategori/<slug>` | index, follow; listing state (filter, sort, cursor): noindex, follow | clean category URL; tracking parameters (`utm_*`, `gclid`, `fbclid`) are ignored; pagination stays on `/kategori/<slug>?cursor=`; BreadcrumbList |
| `/produk/<title>-<id>` | index, follow | `/produk/<title>-<id>` without `?offer=`/`?from=` (the id resolves the page; a stale title part 308s to the canonical slug, query kept); Product (one offer) or ProductGroup (several) + BreadcrumbList |
| `/cari` (any query) | noindex, follow | none; not in the sitemap |
| `/keranjang`, `/checkout/**`, `/pesanan/**`, `/akun`, `/afiliasi`, `/masuk`, `/admin/**` | noindex, nofollow | `robots.txt` Disallow (plus `/api/`) |

`/sitemap.xml` and `/robots.txt` are request-time. The sitemap lists home, `/kategori`, `/bantuan` (no lastmod claimed), categories with a sellable product, and every product whose current publication passes the sale guard, with the publication time as lastmod and its photos; withdrawn publications drop out. Missing products and categories redirect to the server-rendered `/404` page (status 404, noindex); Next 16.4 renders an in-page `notFound()` as an empty shell that needs JavaScript. The Merchant feed links a single-offer product to its canonical URL and keeps `?offer=` only when a product has several offers. Titles (55–70 characters with ` - 99ribu`) and descriptions (120–155, ending with a full stop) are generated by `seo.ts`. Proof: `npm run test:integration -- --case=PR-15` (`tests/integration/storefront-seo.test.ts`).

## Inactive catalog checkpoint (S14)

```bash
npm run test:integration -- --case=PR-1
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-1
```

The PR-1 selector covers inactive S14 catalog only. Eight private catalog operations create/list taxonomy and physical SKUs and create/read/edit products. Each unit, multipack or bundle is one IDR 99000 offer; component quantities add no separate charge. Product edits use expected_version and explicit create/update/retire changes. Identity, original components and old revisions remain immutable. Catalog writes consume current real cookie/MFA/warehouse scope and atomic actor-scoped retry identity. Tests retain synthetic catalog history and archive only their own warehouses. Publication/media/category/HPP guard belongs to S16, real stock races to S15, and real order snapshots to checkout. No UI, published stock, order or full PR-1 acceptance is implied by this selector.

## Physical inventory checkpoint (S15)

```bash
npm run test:integration -- --case=PR-2
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-2
```

The PR-2 selector executes 14 native checks across 4 files and one built-browser flow. Twelve private HTTP operations cover scoped lots/positions/movements and transfer list/detail/create/dispatch/receipt/cancel. Transfers preserve batch identity, reserve before dispatch, remove source stock only on dispatch and credit destination only on explicit per-source-position receipts. Partial/zero receipts remain exceptions; damaged/expired incoming units are quarantined. At most 100 source positions belong to one transfer; split larger manifests.

Reservation functions are trusted server consumers, not customer endpoints. They aggregate every complete offer component across cart lines, lock positions in deterministic order and roll back an insufficient cart entirely. FIFO prioritizes known earliest expiry, then unknown expiry. Checkout holds expire within one hour; same intent never extends a deadline. Payment-confirmed retention and per-shipment checkout consumption must be implemented/reverified in S27–S30 before use.

Apply immutable migration 0010 before starting the inventory-aware worker. Database-only expiry shares the transaction with its outbox completion. Scenario clock advancement can make a job due before its wall schedule but cannot bypass a retry delay; real database timeouts/deadlocks have bounded backoff and finite attempts. Invalid jobs become dead letters without stock effects. Normal HTTP uses wall time even for fixture warehouses; only an explicit trusted scenario consumer may choose a namespace. Auth/MFA clocks remain real.

The native suite proves actual shared-component/receiver lock contention, aggregate rollback, retry/revoked scope, batch expiry and worker crash/restart after an uncommitted effect. The browser validates all twelve operation schemas through actual MFA cookies. S15 independent review approved 39 final fingerprints and its ledger finishedPASS. This does not complete storefront, checkout or the later inventory UI. STATUS owns the active S16 work.

## Prospective costs and publication checkpoint (S16)

```bash
npm run test:integration -- --case=PR-19
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-19
```

The S16 selector executes 9 native checks across 4 files and one built-browser flow. It covers prospective component HPP, explicit nullable offer assumptions, private contribution estimates and guarded publication. Actual recognized contribution/expenses/lot acquisition costing remain S34/T-12. Immutable 0011 adds six tables;42 total. Never rewrite applied SQL/snapshots.

Owner/finance with current finance.costs.read/write permissions can use GET/POST stock-items/{stockItemId}/cost-versions and offers/{offerId}/cost-assumption-versions, plus GET products/{productId}/contribution-reviews. Versions are append-only, prospective, monotonic and bounded 366 days. Null effective_from selects server acceptance time. Null costs stay unknown; explicit zero stays known zero. Source/reason, expected_version and actor-scoped retry are required. Returned current and latest_version distinguish effective versus future scheduled values. The commercial policy optionally sets minimum_contribution_idr; historical versions without it use initial floor 0 without rewriting their JSON.

Owner/ecommerce staff use GET/POST products/{productId}/publications within current warehouse scope. Preview is safe: draft/publication versions, current review state and first 100 blockers with total/truncation; no private cost amounts or exception text. Publication rechecks inherited required facts/types, media, dimensions, complete stock and effective financial source versions. It freezes exact component/assumption/policy references and independently verified arithmetic. Unknown/below-floor contribution blocks automatic publication. Only a fresh catalog_publication.exception proof bound to owner/session/product can authorize a recorded financial exception; missing catalog/stock facts cannot be overridden.

Editing a draft preserves the earlier published content. Changed cost/assumption/policy versions require renewed financial review for new sales; prior immutable estimates remain unchanged. Trusted storefront/quote consumers must reuse salePublication and complete stock/order guards. This checkpoint supplies no public storefront UI or actual checkout; those consuming slices remain pending. Native 9/browser 1 and actual 37-path R3 review pass; S16 ledger is closedPASS. STATUS owns active S17 work.


## Shipping promotion checkpoint (S17)

```bash
npm run test:integration -- --case=PR-11
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-11
```

The PR-11 selector executes 12 native checks across 4 files and one built-browser flow. Five private company configuration operations cover list/create/detail/version history/append, current cookie/MFA owner/ecommerce authority, immutable expected-version edits, bounded integer IDR, closed JSON and actor-scoped committed retry. Configuration edits never reset lifetime campaign budget or customer quota. The old configuration stays immutable; history budget_state reports current counters. Committed campaign budget is not cash/expense.

Trusted reservePromotions accepts actual immutable offer references and authoritative shipping snapshots from later S19/S20. It recomputes 99000 merchandise, honors current window/method/eligibility, applies priority/stable-ID stacking against remaining eligible shipping and uses exact BigInt largest-remainder allocation. Zero effects are omitted; insufficient budget/quota fails the entire selected benefit. Exact retries recover the same hold/deadline. PostgreSQL independently seals source references, amounts, per-shipment rounding, current rule versions and exact budget/quota movements.

reservePromotions/resolvePromotionReservation are transaction primitives, not guest HTTP authority. Stable server-derived customer_key is a quota pseudonym, never a credential. Requotes lock the union of old/new campaign IDs before release/reserve. Held rules survive configuration changes through their issued deadline. Consume commits reserved budget once; terminal consumed funds are not automatically credited. Paid retention/booking/verified cancellation must extend and reverify this boundary in S20/S27/S30/S31. Actual allocated promotional subsidy must pass current PR-19 financial checks in S19/S20.

The actual database-local worker observes ordinary wall time or an explicit trusted fixture namespace, releases only its own reservation and commits job completion atomically. Native checks cover real two-waiter budget/quota races, failed combinations, large safe-integer values, unsealed/wrong SQL allocations, two worker processes, SIGKILL rollback/restart, timeout/backoff/cap and malformed-job dead letters. A failed expiry leaves an active hold requiring S63 operator recovery; no endless silent retries are claimed. Visible admin forms remain S49+.


## Synthetic commerce seed checkpoint (S18)

```bash
npm run fixture -- commerce local commerce-demo
npm run fixture -- berlapak local berlapak   # local supplier snapshot (BERLAPAK_DATA_DIR, default /data/99ribu-berlapak-data) + 16 dummy orders
npm run test:integration -- --case=seed-berlapak
npm run test:integration -- --case=seed-commerce
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=seed-commerce
```

This developer-only host harness extends the S11 namespace with 3 actual StockItems,4 complete 99000 offers,6 physical positions, prospective nullable HPP/assumptions and one actual initial stock hold. It reuses the repository BrowserSession/enroll helpers to create a temporary verified/MFA synthetic owner, invokes real guarded domain writers, then removes only its exact temporary identity, deliveries and operation records. Existing shared auth rate-limit buckets remain enabled and are never cleared by this CLI. Existing fixture principals, passwords/MFA, roles, clock and domain edits remain intact. Generated passwords, verification URLs, MFA setup and cookies stay in process memory; output contains IDs, publication/blocker metadata and scope only. It requires the repository test helpers and is not an application/guest HTTP endpoint.

Concurrent seed callers serialize through a transaction advisory lock on a dedicated database connection, separate from the domain pool. Lock waits retain the database client 10s statement timeout; lock release is automatic on transaction exit/disconnect. Unique namespace-prefixed SKU/category slug identities recover a partial run after a domain commit without a second fake database or reset targets. Existing cost history, draft edits, stock movement revisions and publication history are preserved. Empty physical positions initialize with actual receive/quarantine movements; reserved units use an actual namespaced checkout hold. An expired initial hold is never re-created or extended on rerun. Its business deadline follows explicit fixture clock advancement; auth stays on real time.

The seed requires an existing current commercial policy for automatic publication; without it, valid draft products report POLICY_UNCONFIGURED. It never creates/backdates policy or grants an owner financial exception. Known valid shirt/cream offers publish through the existing guard; missing bag HPP stays null, leaving bag/mixed offers unapproved. Current owner/session/MFA gates protect entry, bootstrap, inventory, reservation and final completion. Each catalog/cost/publication writer also retains its actual canonical current-role/session/MFA rule; catalog permits scoped ecommerce_admin, while finance costs require owner or an explicitly granted finance role. No historical orders, receipts, refunds, finance postings or provider scenario effects are imported by this checkpoint; those illustrative inputs retain downstream scenario owners.

TEST-ONLY initial assumptions per offer are packaging 1000, provider fee 1000, subsidy 5000 and returns reserve 1000 IDR. These conservative estimates are documented synthetic inputs, not issued provider prices; existing assumption versions are never overwritten.

SIGINT/SIGTERM abort the host seed and clean up its exact temporary operator after any current domain transaction. It uses the normal refreshable Better Auth 7-day expiry. SIGKILL/host failure cannot run cleanup and may leave an active session until normal expiry or explicit scoped revocation; a synthetic account may remain, identified by the namespace plus seed-op email/name. S63 owns explicit scoped orphan-operator inspection/recovery; no mass account deletion is authorized.

Executed acceptance:7 native tests cover concurrent stable identities, true SQL-backed balances/costs/publications, nonowner/target/namespace/mixed-transport denials, rerun after actual cost/stock/draft changes and real worker expiry, plus two actual CLI runs with fresh temporary MFA owners, six callers blocked on one namespace without domain-pool starvation, an existing sign-in limit preserved through failed bootstrap, and SIGTERM cleanup of a real MFA operator waiting on the lock. One built browser test renders all four accessible, explicitly synthetic local SVG resources. This media proof is not completed storefront UX; S21 owns actual buyer pages.


## Trusted shipping domain checkpoint (S19)

```bash
npm run test:integration -- --case=PR-3
```

This integration-only selector runs 9 native tests across 3 files. No S19 buyer HTTP/browser route exists; S20 wires actual cart capabilities, persisted quote/selection and order authorization. Address normalization resolves the versioned TEST-ONLY canonical destinations/postcodes, preserves legitimate Indonesian street/recipient text, normalizes +62 contact and rejects fee/region authority. Reference districts/postcodes are explicitly synthetic and do not claim national/provider coverage.

The shipping planner loads actual current published offers/cost sources and eligible PostgreSQL physical balances, including shared component use, holds/quarantine and expiry. Complete offer units stay indivisible; different complete units may use different parcels/warehouses. It enumerates conservative upright-stack parcel layouts, compares actual supported simulated charges, then fewer parcels, more default-warehouse units and stable identity. Distinct identical parcels keep distinct IDs. Limits are 50 units,20k visited search attempts,1k candidates and 500 unique rate requests. Exhaustion returns ALLOCATION_REVIEW_REQUIRED; no unproven cheapest quote or greedy stock split is returned.

TEST-ONLY package policy uses max 20kg chargeable weight/max 1000mm side and volumetric divisor 6000mm³/gram. These explicit local simulation parameters do not assert carrier contracts. Read-only rate adapter timeout is 2s per request, with a3s rate-phase deadline; malformed adapter output produces a dependency error. Unknown/unsupported origins/routes, COD-ineligible options, expired rates, stale publication/cost and timeout preserve stock/budget and require review/retry. Actual shipment booking/funding remains later owned work.

Native proof compares supported consolidated/split plans, exact per-parcel parent totals and quantity conservation, a shared-SKU shortage and a bundle that cannot borrow components across warehouses, physical parcel splitting/unique IDs, actual stale cost/publication, unavailable/COD-only/expired/timeout states and strict address/rate boundaries. Preview creates no stock or money effect.

checkShippingBenefit evaluates actual S17 configured rule allocations against current source-bound financial approval. It allocates exact shipment subsidy to line quantities, then checks the worst integer per-unit share within each parcel. Complete above-floor units may proceed; unknown/below-floor units need a current owner publication exception with a known sufficient per-unit subsidy allowance. Another unit/parcel cannot extend it. Actual native tests also observe warehouse deactivation under a real PostgreSQL row wait and use real owner proof/publication and configured promotion, including the 8k-one-unit/0-other-unit case that an aggregate 10k allowance would wrongly permit. Returned financial source metadata stays internal; S20 must use a closed public quote projection.


## Cart, checkout and pending order checkpoint (S20)

```bash
npm run test:integration -- --case=PR-4
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-4
```

The selector executes 11 native tests across 6 files and one built-browser flow. Applied additive 0013 adds 12 tables (63 total in each isolated database);0000–0012 remain immutable. Real guest/account ownership, versioned complete-offer carts, immutable authoritative quotes/selection, normalized Indonesian address and separate optional-email buyer contact, original per-unit fulfillment/lot snapshots and atomic stock/subsidy holds share PostgreSQL transactions. Twelve checkout operations have observed success and denial parity; OpenAPI has 50 implemented operations in total. Two new read paths recover the current browser cart and an owned quote after navigation.

Browser creation returns CartCreated/OrderCreated without plaintext credentials. Its first anonymous 401 only establishes an HttpOnly guest context; acknowledged retry with the same key creates the cart. Explicit header-mode clients receive purpose-specific cart/order capabilities, with only digests and fixed issuance/expiry persisted. Cart header operations also require the creating context; single-order header reads independently validate that context's current persisted authority. Account resources require their current owning verified session, including staff MFA where applicable. No staff ownership bypass, contact-based linking or account bearer issuance exists. Effective authority ends at the earlier resource/context expiry, using real time; business fixture clocks cannot extend authentication. Password sign-in success (including a pending MFA challenge) and sign-out revoke the previous guest context. Lost-all-credential linking/recovery remains S46's verified-contact workflow.

Quotes reserve nothing. Selection preserves the parent's deadline and accepts only issued allocation/rate options. Submit rechecks current sources after actual promotion/balance waits, including an already-scheduled cost becoming effective, and atomically freezes one pending order per cart/quote. Original complete offer units retain exact component/lot lineage. Merchandise is always 99000 per purchased unit; shipping/subsidy/buyer allocations conserve integer IDR. Real expiry workers serialize on the owning order before either legacy reservation; crash rollback and concurrent stock/promotion/order jobs preserve one cancellation and release both holds. Only the claimed job completes.

Native proof includes current/revoked/expired/wrong-purpose/mixed credentials, account isolation, one combined two-warehouse concurrent/lost-response retry with disclosed total and exact original parcel quantities, a deterministic two-buyer physical-stock race with a positive owned subsidy and sufficient budget for both, current version/publication/rate/closed-input checks, a scheduled-cost transition under an observed PostgreSQL balance wait, immutable SQL seals and owned worker crash/race/expiry with an unconditional positive campaign and three expiry jobs. Browser proof exercises all 12 operations, reload recovery, HttpOnly/order-path cookies, empty JS storage and shared-device sign-in/sign-out denial. Next's empty DELETE body stream is accepted; a nonempty DELETE body is rejected, with native and built-browser regression evidence.

The rate phase uses each request's remaining 3s total budget (max 2s individually). C1 and bidi-format recipient/address controls are rejected before labels. Destination IDs and prices remain explicitly TEST-ONLY; human hierarchy labels are not promotion region IDs. A server HMAC of unverified buyer contact is a quota heuristic, never identity or authorization. Anti-abuse/contact verification, payment receipts/retention/COD confirmation/partial stock consumption and buyer checkout screens remain their later tasks. General Order projections exclude private address/contact; the owned quote preserves these and S27 owns the separate receipt. No Purchase/financial posting, continuous-worker milestone, live provider or full storefront acceptance is claimed here. Synthetic account-order tests retain immutable account FKs but remove usable credentials/sessions.

## Dedicated checkout implementation (S26)

```bash
npm run test:integration -- --case=T-31
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=T-31
```

The explicit selector registers five native files and one progressive checkout browser file; it selects no migration or candidate executor. Forms call the existing checkout/payment domains and preserve scoped drafts, no-JavaScript task exits, competing-tab conflict checks, exact unknown-result retry and native-only money/payment authority. Issued package allocations and per-package services use wrapping native radio rows; the closed HTML parser pairs each service with its parcel and rejects mixed, duplicate or orphaned encodings. Native request schemas remain unchanged. Implicit Enter searches destinations on contact and preserves the current shipping/review step; financial confirmation stays explicit.

Allocation descriptions come from the authorized immutable quote document and list complete-offer contents per origin/parcel. Buyer-equivalent options share a frontend choice retaining an actual native allocation ID. While a different native identity is pending, both issued and pending IDs remain explicitly selectable with stored/pending labels, even if their displayed grouping is equivalent. Native disclosure exposes the pending choice after reload/stay and preserves the buyer's open state until a new quote is issued. The single primary shipping action applies the checked native allocation before review; order confirmation is separate. Option headers describe changes from the stored allocation, and gross carrier fees are labeled Tarif before subsidy; the parcel cards disclose subsidy and buyer-paid shipping. Issued parcel controls remain in the document and checked state gates their display, so no-JavaScript reversion submits complete selections. Actual radio checked state exposes pending charges without JavaScript, and successful selection carries the previous authoritative total in its server response. Checked native controls select the matching action/warning text and hide only stale success notices, including without JavaScript. Gross fees use Tarif throughout checkout review, summary and payment; net buyer fees retain Ongkir. Restoring the issued service clears the pending warning. No public quote schema or native plan/pricing logic is replaced.

Browser fixtures create an owned namespace, align its new simulation clock for readable deadlines and capture settled draft state under the actual build ID, preserving earlier render batches. Coverage includes two independent parcel choices without JavaScript, 320px/200% reflow, pending/unknown recovery, revoked scope, quote/rate expiry and consent-aware milestones without typed payloads or UI Purchase. STATUS and the ledger hold current executed counts, build/source bindings and unresolved gates. Fresh renders, independent canonical visual PASS, design-gate exit 0 and the final original/C1/C2/C3 union R3 are required before S26 closure. Safari/devices, native support, full S27 receipt and S68 acceptance retain their own requirements.

## Public discovery and purchase-path checkpoint (S21/S22)

```bash
npm run fixture -- storefront local commerce-demo
npm run test:integration -- --case=PR-17
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-17
python3 /data/ai/codex/skills/design-taste/scripts/design-gate.py . --design docs/spec/10-DESIGN-SYSTEM-WHITELABEL.md --src src
```

The fixture command uses actual temporary owner/MFA and non-destructive writers, returns nonsecret IDs/blockers, and preserves prior stock/HPP/operator state. Current PR-17 explicitly selects 24 native tests across 6 files: public catalog/contract, protected integrated offer filters, new available-offer selection/native form parsing, live complete-stock guard and real cart bridge recovery. The four explicit browser files contain the prior 9 discovery/recovery tests and 16 purchase-path scenarios (25 total). Required empty/skipped/TODO files fail. The owned recovery fixtures use guarded synthetic publications and preserve catalog/stock history; cleanup releases only exact owned seed reservations/jobs and reverses only the fixture's recorded quarantine through release_quarantine, retaining baseline quarantine. Source/execution/design acceptance remains in STATUS and the active ledger. Four sample publications drive local home merchandising; ordinary merchant products remain searchable. Native PDP selection/cart mutation is implemented in S22; the current 24-native/25-browser checks pass; localhost slice acceptance still requires independent current source/visual/design and final R3 gates, with S26 checkout/S27 receipt and S68 full delivery separate. Public APIs share current-publication/whole-offer stock guards and have no auth requirement or private source fields. Product photographs remain explicitly labeled missing owner assets; licensed Inter/Lucide assets remain self-hosted.


## Financial primitive and scoped history checkpoint (S23)

```bash
npm run db:migrate -- test
npm run db:migrate -- local
npm run test:integration -- --case=PR-12
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-12
```

Applied immutable 0014 adds three finance tables; additive 0015 adds truthful new order-event ingestion timestamps and keyset indexes. At S23 acceptance both isolated databases had 66 application tables; S24 adds the six payment-domain tables. The 7 native checks and 1 built-browser check execute real PostgreSQL, cookie/MFA, whole-order warehouse scope, exact safe-integer journals, replay/race/crash recovery, original money allocations and linked full reversals. New timestamps are server-set; legacy ingestion stays null. Receipts record provider receivable/buyer-funds liability and never bank settlement, payment-state confirmation, revenue recognition or Purchase. Only trusted internal consumers can post receipts/journals. S24/S28 must validate durable simulator/provider evidence before use; S30/S34 own settlement/realized reporting. No generic financial-write endpoint exists.

Two history GET adapters are implemented with no-store/no-referrer/nosniff, explicit current role/permission/scope, bounded actor/filter/scope-bound cursors and safe audited projections. Owner sees company history; other authorized staff must cover every original parcel. Reference lookup is actor-bound 30/minute. Current fulfillment/return filters have no matching child evidence and must be extended by their consuming slices. This checkpoint does not complete all of PR-12 or accept the blocked S21 visual state. Final independent R3 acceptance is recorded only in STATUS/the ledger.


## Prepaid simulator checkpoint (S24)

```bash
npm run test:integration -- --case=PR-5
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-5
```

At S24 acceptance, PR-5 selected 16 native tests and 1 built-browser test; the current selector also includes the S28 COD checkpoint described below. The original prepaid tests execute actual PostgreSQL attempts/events, signed local simulator evidence, receipt/posting transactions, private owned-order transport and callback recovery. S24 introduced 0016 and 72 app tables; S25 extends both isolated databases to 82 tables/18 source-matching migrations and adds the canonical first-party Purchase/outbox. No bank settlement, live provider, recognized profit or complete commerce acceptance is implied.

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

At S25 acceptance, the checkpoint had 12 native tests across 9 files and 1 build-backed Chromium test. The current selector also includes S28 COD proof described below. Five operations cover visitor bootstrap, consent read/write, closed observed funnel intake and the nested owned-order funnel path. Visitor context never grants commerce access; guest order cookies retain their narrow path. Verified prepaid receipt/postings/funding and one canonical merchandise Purchase/full original-item allocation/three platform decisions commit together. Browser observations cannot supply Purchase or money. Actual rollback, duplicate/reload, denial/no-backfill, withdrawal, original local sink reconciliation, stale sender fencing and concurrent worker checks pass. All payloads use canonical local metadata without raw buyer contact, order capabilities, HPP or chat data.

Applied 0017 is immutable; the S25 checkpoint had 82 app tables/18 migrations; S28 extends both isolated databases to 87 tables/19 migrations. The first-party privacy policy is TEST-ONLY local-privacy-v1, with 24-hour context/consent and 10-minute inactive anonymous bootstrap. Bootstrap retries retain lifetime; user context binds the exact account session. The loopback-only bootstrap rate bucket is shared and must use trusted per-client keys before remote exposure. Real platform mappings/SDKs/destination activation remain S57–S60, COD Purchase is covered by the S28 checkpoint below; buyer consent/receipt UI remains S26–S27. This checkpoint does not claim live vendor or legal activation. Final S25 review and acceptance remain in STATUS/the ledger.


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

Use an original shipment UUID from the private owned-order API. Collection/refusal creates a signed local source effect; reconciliation only rereads the original source and processes its existing callback, with previous retry metadata audited. These host commands use synthetic local data and require no merchant credentials. Current PR-5 proof executes 24 native tests across 13 files and 2 built-browser tests; T-26 executes 17 native tests across 10 files and 2 built-browser tests. Final acceptance belongs to STATUS and the delivery ledger.

A valid complete COD checkout confirms server intent at its original creation time and returns `cod_due`/revision2. This acceptance protects original stock and positive subsidy holds past the checkout deadline. Unpaid prepaid checkout still expires and releases both holds. Three concurrent expiry-job kinds are tested for both cases. Each original COD parcel has its own frozen due; qualified collection atomically posts balanced receivable/liability, a receipt, the current payment head and a canonical merchandise Purchase with original per-parcel item quantities and three consent decisions. Partial collection is distinct from full payment, refusal, extra/mismatched recovery money, delivery and company settlement.

Native proof includes independent source commits/lost acknowledgement, signed callback rollback, exact original recovery in a fresh host process, concurrent collection of both parcels plus a duplicate, denied-consent no-backfill and an actual consented COD Purchase sent to the canonical local sink. Private `GET /api/v1/orders/{orderId}/cod-collections` uses current account or original single-order authority; visitor/cart capabilities do not grant access. Built Chromium proof checks the original narrow HttpOnly cookie, reload from partial to full collection and shared-device denial. Applied 0018 and all predecessors remain immutable. S29 must extend actionable hold consumption and order lifecycle seals before fulfillment acceptance. Real carrier/platform mappings, buyer receipt UI and final assembled localhost acceptance retain their respective slice owners.


## Fulfillment verification (S29)

Historical pre-application proof ran while both isolated databases had 87 tables/19 applied migrations:

```bash
npm run test:integration -- --case=S29-candidate
```

The existing test harness rejects skipped/TODO/empty files. The current candidate has 4 calendar checks,2 rollback-only SQL/schema checks and 2 complete rollback-only COD/prepaid domain scenarios. Nine new tables are generated (96 in the transaction); the entire candidate schema/business proof rolls back. This does not establish separate provider commits, app-role runtime, mounted HTTP/browser parity or S29 acceptance. Applied 0019 now requires the PR-6 runtime selector. S29-candidate detects the applied schema and refuses before opening historical 87-table rollback cases. Do not substitute this candidate command for full acceptance. See STATUS for the exact application/review gate and resume action.

S29 runtime commands (approved 0019 now applied locally):

```bash
npm run test:integration -- --case=PR-6
npm run test:browser -- --case=PR-6
node --env-file=.env.example scripts/worker.ts local --issue-waybill BOOKING_ID
node --env-file=.env.example scripts/worker.ts local --fail-waybill BOOKING_ID
node --env-file=.env.example scripts/worker.ts local --reconcile-shipping BOOKING_ID
node --env-file=.env.example scripts/worker.ts local --initialize-fulfillment ORDER_ID
```

BOOKING_ID is the returned shipment booking operation UUID. Shipment reads retain the original parcel UUID. Initialization uses an original actionable order and preserves its actionability, including an explicit missing-calendar exception; it never confirms payment or creates cash. Local source commands use synthetic signed evidence only. Browser API proof is separate from the pending visual gate.

Current S29 evidence: native PR-6 12/4 files, built Chromium PR-6 1/1 file, corrected production build OKibCFYTyt6e-KhnWguMp and readiness pass. Both isolated databases 96 tables/20 source-matching migrations,33 relevant TRUNCATE denials. Current cookie/MFA/warehouse scope, independent signed source commits, fresh-host lost-ack/exhaustion recovery, original per-parcel stock/one-benefit conservation, later payment and overdue/reschedule privacy are exercised. Affected native/built regressions and actual final combined independent review pass; full localhost and S21 visual acceptance remain incomplete.

Applied S29 regression refresh: native PR-5 24, T-26 17, PR-4 11, PR-12 7, PR-2 14, PR-11 12, PR-16 11 and foundation 24; built PR-5 2, T-26 2, PR-4 1, PR-12 1 and smoke 2. Current PR-6 native 12 and built 1 pass. Legacy one-shot worker tests require the documented actual ready-fixture drain; deterministic isolation remains S63, and it is not a production runtime guarantee. All 52 S29 paths across the original run and three declared continuations received actual final combined independent APPROVE; a continuation-only review would not accept earlier source.

S29 is accepted in RUN-20261016T160027Z-32424464; its exact combined review and historical checks remain in STATUS, BUILD-LOG and the canonical ledger.

### S30 reconciliation checkpoint

S30 has a reviewed applied schema and accepted executable localhost implementation in RUN-20261016T194052Z-6dfa4b01 after actual final combined independent review and bound closure. Test/local each have 105 app tables,21 source-matching migrations and 42 relevant TRUNCATE denials. Applied 0000–0020 SQL/snapshots and the original journal prefix are immutable. Current production-mode loopback build is LjQuXN6fhyhz-YzIVabtA at 127.0.0.1:3099; readiness 200 is executed.

The current finance selector covers immutable ledger/history, allocation and signed-source boundaries, current finance permissions/proofs, original COD/prepaid/recovery receivables, native cash/operation controls, five private API contracts, genuine process loss/exhaustion recovery, four actual PostgreSQL lock races and owned fixture isolation. Native 34 tests/15 files pass. The built selector covers original private order history and the complete new reconciliation flow; current 2/2 passes. Affected native worker 11, foundation 24, promotion 12, payment 24, signals 17 and checkout 11 pass; built payment 2, signals 2, fulfillment 1 and checkout 1 plus smoke 2 also pass. STATUS and the ledger retain the exact current evidence.

```bash
npm run test:integration -- --case=PR-12
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-12
npm run health -- ready
```

Five cookie/MFA-only resources implement list/detail/decision/historical-match/source reads under `/api/v1/admin/reconciliation` and `/api/v1/admin/settlements/{sourceId}`. Decisions require both finance.reconciliation permissions, a subject/session-bound fresh finance.reconcile proof, original statement UUID, expected head version and required nullable current match UUID. Only this decision endpoint permits 32KiB for 100 allocations; older endpoints retain 16KiB. Actor/key replay rechecks current authority and preserves the immutable original response. Unknown statement facts remain null; source signatures, credentials, customer contact and HPP are excluded.

Cash, authenticated fee expense and matching classification have separate immutable journals. Match correction reverses/replaces the original classification and any changed fees atomically; unmatch preserves cash/fees and stored historical allocation amounts. Authentic extra recovery funds are separate receivables and create no additional Purchase. Retained debit expenses can block parent fee correction; newer facts stay as an explicit finance exception under the selected separately evidenced S34 adjustment boundary.

Host commands are local/test simulators, implemented in `scripts/worker.ts`: `--observe-settlement` reads a bounded source object from JSON stdin; `--revise-settlement SOURCE_ID EXPECTED_VERSION` reads only the statement; `--reconcile-settlement SOURCE_ID` verifies existing deliveries and recovers the original callback jobs. The executable recovery/browser tests exercise these exact commands. No public source-writing endpoint or client bank/fee/paid flag exists. Real vendor adapters remain a later verified-provider gate.

Pre-application approval and evidence are preserved across original S30/C1: the final three-file owner-role native/operator/basis rollback gate passed 3/3 with no skipped/TODO/empty cases, unchanged predecessor integrity was checked, and exact reviewed 0020 was conditionally approved/applied to both isolated targets after rechecking 54 current/40 predecessor fingerprints and HEAD. The pre-application reviewer verified file fingerprints without recomputing the combined digest; the final reviewer subsequently independently verified the complete 56-file digest, boundary/event hashes,42 immutable files and original journal prefix. The historical `S30-candidate` selector refuses an applied schema and must never be used as applied runtime acceptance.

Accepted C2 RUN-20261016T194052Z-6dfa4b01 declared the necessary old promotion-fixture dependency before edits; final review covers original+C1+C2. Teardown follows immutable first-version actor provenance, including raw contract requests, retires only owned configurations through current authorized version writers, and preserves consumed reservations/lifetime budgets/history. An unrelated open fixture remains active in its regression. Exactly 105 already-closed synthetic author campaigns were separately retired in isolated test through audited normal writes, with unchanged original version hashes, budgets, finance journals and Purchases. The production 100-campaign review ceiling was not changed. The actual bounded default test worker drained 276 ready synthetic jobs; continuous supervision and fully deterministic queue isolation remain S63/S65.

The complete 68-slice localhost goal remains incomplete. Source-level financial/browser evidence does not accept the blocked public visual gate, later dashboard/HPP/period-close work, live providers or remote deployment. No commit or push is implied.


S31 quantity returns/inspection/refunds is accepted in RUN-20261018T190944Z-520bc988 after actual final independent full 73-object combined review and bound ledger PASS. S32 replacement/affiliate-rate implementation is active in continuation RUN-20261018T192545Z-1ece5a89. The initial inventory predecessor preflight failed on an omitted global-next-job fixture; that failure and unchanged diagnostic are retained. The actual runtime selector excludes all historical unapplied-schema candidates:

```bash
npm run test:integration -- --case=PR-7
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/snap/bin/chromium npm run test:browser -- --case=PR-7
```

The current registered native run passes 33 tests across 13 explicit files: policy/signatures/current authority/original collection, separately committed COD/prepaid lifecycle, scoped readers, actual 13-operation wire contracts, order/history projections, four uncertainty/recovery cases, four PostgreSQL contention cases and app-role native seals. Current build lqdvVaUI0ULANm_WiMvK_ passes the built Chromium/host case for all 13 success/denial contracts and actual buyer order/history progress, plus 9 affected built cases across 8 files. STATUS owns acceptance and the running artifact identity. Parent PR-7 remains incomplete until S32 replacement lineage and effective affiliate override costing are implemented and accepted.

Reviewed 0021 adds 19 tables; both isolated databases have 124 tables and 22 exact source-matching migrations,61 relevant app-role TRUNCATE denials,76 effective CRUD grants over the new tables and zero unvalidated new constraints. All 44 applied SQL/snapshot files and the 22-entry journal prefix are immutable. S31-candidate is historical rollback evidence and must never execute on either applied target. Its first DDL 42601 failure and actual superseding/renewed review remain preserved; corrected candidate 2/2 and the separately reviewed exact application gate passed before runtime testing.

Thirteen private cookie-only operations implement buyer return creation/list/detail/eligibility/refund/destination and scoped staff list/detail/decision/inspection/refund/reconciliation. Writes recheck current authority after waits; money commands need both refund grants and a fresh subject/session-bound finance.refund proof. Finite lists use UUID anchors. Staff readers expose only currently assigned warehouse units; finance read access does not grant CS/warehouse actions. History excludes contact, HPP, freeform internal reasons, signatures and recipient certificates.

Host worker commands receive/reconcile original parcel receipts, verify a synthetic COD destination, confirm/fail signed bank results and reconcile the original refund. Genuine fresh CLI processes exercise loss after provider creation/collection and same-identity recovery. Unknown effects preserve original attempt/job identity; a new attempt requires established zero-money failure and explicit finance authority. Obligations debit buyer_funds_liability/credit refund_payable; confirmed signed bank success alone debits refund_payable/credits company_cash. Original Purchase is never rewritten or repeated. A genuine fresh-cluster prefix 0000–0016 payment followed by exact 0017–0021 upgrade and original-buyer cash refund now passes 1/1, with zero Purchase/ad backfill. Its command is `node --env-file=.env.example --test tests/integration/return-upgrade.test.ts`; it creates a new uniquely owned private cluster and stops only that project, retaining temporary data/containers. The first missing-commercial-policy fixture failure and unchanged diagnostic remain recorded; the corrected prerequisite uses actual owner/MFA/fresh proof and guarded publication. Current runtime/build/shared evidence and final frozen combined-boundary approval are recorded; S31 closure PASS and the ledger chain are verified. Actual provider compatibility, UI composition and continuous supervision remain later owners.

S31 C2 adds an optional original job UUID to the existing host iteration: `node --env-file=.env.example scripts/worker.ts test --once JOB_ID`. The UUID is validated before readiness and passed through the existing database/lease/adapter filters. An unknown valid UUID is an idempotent no-op; selecting a completed job preserves attempts and effect identity. The unchanged no-ID mode uses the normal ready queue. Actual worker fixtures pass 8/8, including older unrelated pending work, two independent processes observed concurrently on the same targeted job, and process death while holding the real delivery transaction. Full foundation 25/5 now passes without draining unrelated work; static 30 and the exact V3 isolated legacy upgrade 1 also pass. Actual final full 73-object review, matching boundary approval and closure PASS are recorded; the ledger chain is verified. Continuous supervision/operational recovery remain S63/S65.


## S32–S68 completed runtime checkpoints and post-S68 audit remediation (`G1`–`G10`)

Historical pre-application `S32`/`S33` candidate and definition-only checkpoints are archived in [`docs/history/S32-S33-CHECKPOINTS-20261021-pre-audit.md`](docs/history/S32-S33-CHECKPOINTS-20261021-pre-audit.md); all 14 historical pre-migration test files are isolated under `tests/historical/`.

- **S32 (`--case=PR-7`):** Applied `0022_replacement_lineage.sql`; implements physical replacement lineage, stock-wait/intake/reserve, separate waybill/handover/receipt lifecycle, and owner-only effective affiliate override rate versioning.
- **S33–S34 (`--case=PR-21`, `--case=PR-19`, `--case=PR-12`):** Applied `0023_commerce_exceptions.sql` and `0024_remaining_domains.sql`; completes exception recovery (late-payment, stock shortage, COD refusal, mixed delivery, carrier cancellation) and realized contribution margin / period-close reporting.
- **S35–S40 (`--case=PR-8`, `--case=PR-9`, `--case=PR-10`):** Applied `0025_affiliate_ledger.sql`; implements 7-day non-extending referral attribution, production outbox-driven commission accrual/receipt/claim/void and H+10 maturity (`commission.accrue`, `commission.receipt`, `commission.claim`, `commission.void`, `commission.mature`), automatic IDR 99,000 payout queueing (`queueEligibleAffiliatePayouts`), double-entry finance postings (`Dr commission_expense / Cr affiliate_payable` on maturity; `Dr affiliate_payable / Cr company_cash` on verified payout), real `PUT /api/v1/admin/payouts/{payoutId}/evidence-uploads/{evidenceId}` byte upload with magic-byte sniffing and server-computed SHA-256, and `/affiliate` workspace.
- **S41–S45 (`--case=PR-22`, `--case=T-24`, `--case=T-25`):** Participant-scoped support chat, guest bootstrap/recovery with DB-backed rate limits and atomic 5-attempt challenge lockout, private image attachment scanning, internal notes, SSE stream, and `/support` + `/admin/support` workspaces.
- **S46–S48 (`--case=T-35`, `--case=PR-14`, `--case=T-32`, `--case=PR-24`):** Buyer account profile, address book, keyed-HMAC (`mac(identity, ...)`) contact verification and guest-order linking with zero plaintext OTP in `app.audit_event.details` and atomic `attempts < 5` lockout, real `PUT /api/v1/orders/{orderId}/returns/{returnId}/evidence-uploads/{uploadId}` byte upload with magic-byte sniffing, and `/account` + `/orders/{orderId}` receipt continuity.
- **S49–S55 (`--case=T-34`, `--case=PR-13`, `--case=T-36`, `--case=T-37`, `--case=PR-25`):** Role-scoped `/admin` workspaces, operational queues, KPI drilldowns, CSV-injection-safe exports, and `/admin/labels` private `TEST` watermark PDF print center (`100x150mm` thermal and `A4`).
- **S56–S60 (`--case=PR-15`, `--case=T-27`, `--case=T-28`, `--case=T-29`, `--case=T-30`, `--case=PR-23`):** Published-only `/api/v1/catalog/feeds/{channel}` feeds, Meta/Google/TikTok conversion adapters into the local sink, and `/admin/advertising` diagnostics with strict UUID `{destinationId}` controls.
- **S61–S68 (`--case=T-33`, `--case=T-38`, `--case=PR-16`, `--case=PR-18`, `--case=localhost-readiness`, `--case=all-current`):** Mobile navigation continuity, all 14 scenario contracts, public DB-backed rate limits, bidirectional OpenAPI parity across all 175 paths / 209 operations, multi-viewport browser journeys + `design-gate.py` (exit 0), and real `pg_dump -Fc` / `pg_restore` into a disposable database (`99ribu_restore_<uuid>`) with XID resealing and trigger immutability verification (`23514`).
