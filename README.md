# 99ribu

Indonesian commerce application planning repository. The accepted stack is Next.js/TypeScript, PostgreSQL/Drizzle and Better Auth, with shared domain modules and a separate durable worker.

The documentation pack was promoted on 2026-10-16. **Application implementation has not started.** The current delivery target is a complete localhost application running in production mode with synthetic data and simulated external effects.

## Start here

- [STATUS.md](STATUS.md): current state and exact resume action.
- [TASKS.md](TASKS.md): sole execution queue, 39 parent tasks and 68 ordered development slices.
- [PRD.md](PRD.md) and [specification index](docs/spec/README.md): accepted product, API, data, design and UX contracts.
- [AGENTS.md](AGENTS.md): repository instructions for AI terminal development.
- [DECISIONS.md](DECISIONS.md): sole decision index, linking six accepted ADRs.
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

No application install/start/build/test command is verified yet. Resume the native-scaffold portion of S01, then pin tools and implement S02–S06. Record actual commands here as they become executable. Documentation validation does not prove checkout, money, authentication or UI behavior.

[ARCHITECTURE.md](ARCHITECTURE.md) records what actually exists. [RELEASE.md](RELEASE.md) separates localhost acceptance from deployment. [OBSERVABILITY.md](OBSERVABILITY.md) records runtime probes once implemented. `.delivery/` contains tool-generated evidence.
