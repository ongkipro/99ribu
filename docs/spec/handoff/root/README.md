# Serba 99ribu — localhost application handoff

Staged merge material for repository-root `README.md`; no application repository, installed runtime or passing application checks are asserted here.

The selected application uses Next.js/TypeScript, PostgreSQL/Drizzle and Better Auth, with shared domain modules and a separate durable worker. The current delivery target is a complete localhost application running in production mode with synthetic data and simulated external effects. Remote hosting and live-provider activation have separate approval and acceptance gates.

Start with root `STATUS.md` and the next S01+ slice in root `TASKS.md`. Root `PRD.md` points to the canonical product requirements in `docs/spec/02-PRD.md`; `docs/spec/README.md` indexes the specification pack. Root `DECISIONS.md` is the reconciled sole decision index. The former Documents staging directory becomes a non-authoritative snapshot after promotion.

## Commands and evidence

No application setup/start/test command is verified yet. During foundation, record actual pinned Node/package-manager versions, safe local PostgreSQL provisioning, migrations/seed, web/worker startup and shutdown, production build/start, focused tests and browser checks here. Define commands before claiming them runnable. Never paste credentials into this file.

The planned helper `python3 docs/spec/scripts/development-task.py prompt S01` prints a bounded task prompt only; inspect its existence/help after promotion. It is not a task executor.

`STATUS.md` records current workflow and resume action. `BUILD-LOG.md` records durable verified changes. `.delivery/` stores ledger-generated execution evidence. `RELEASE.md` separates localhost acceptance from deployment, while `OBSERVABILITY.md` records actual health/worker/restore probes once implemented. A build or planning-schema PASS alone does not prove checkout, money, authentication or UI behavior.
