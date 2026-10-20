# Architecture Decision Index

Owner: Engineering owner. Updated: 2026-10-16. This is the sole repository decision index. The six accepted ADRs were promoted to `docs/adr/` with their IDs and decision substance preserved. Technical Design contains trace links only. The Documents staging copy and retained handoff templates are historical inputs.

Accepted records capture approved business/data/finance invariants and the owner-confirmed Vultr/Coolify hosting choice. Proposed records are recommendations, not evidence that the owner selected a stack or purchased hosting. Runtime confirmations link executed evidence without implying remote deployment.

| Record | Status | Decision | Authority |
|---|---|---|---|
| [ADR-0001](docs/adr/ADR-0001-modular-application-boundary.md) | Accepted | One modular application with shared web and worker domains | Owner-delegated technical selection 2026-10-15; runtime confirmation pending |
| [ADR-0002](docs/adr/ADR-0002-sellable-offers-physical-inventory.md) | Accepted | Derive sellable offer availability from physical component stock | Existing owner requirements; scope recorded, runtime pending |
| [ADR-0003](docs/adr/ADR-0003-immutable-financial-postings.md) | Accepted | Preserve financial history with immutable postings and allocations | Existing owner requirements; scope recorded, runtime pending |
| [ADR-0004](docs/adr/ADR-0004-typescript-next-postgres-stack.md) | Accepted | TypeScript web application and PostgreSQL stack | Owner-delegated technical selection 2026-10-15; runtime confirmation pending |
| [ADR-0005](docs/adr/ADR-0005-vultr-coolify-cloudflare-hosting.md) | Accepted | Vultr hosting managed through Coolify | Owner confirmation 2026-10-15; detailed topology and runtime checks pending |
| [ADR-0006](docs/adr/ADR-0006-versioned-client-api-boundary.md) | Accepted | One versioned business API for independent clients | Owner-delegated technical selection 2026-10-15; runtime confirmation pending |
| [ADR-0007](docs/adr/ADR-0007-guest-commerce-capabilities.md) | Accepted | HttpOnly browser BFF and separate guest cart/order capabilities | Owner-delegated selection; S20 actual runtime/R3/ledger confirmation2026-10-16 |

Routine UI spacing, defaults and task progress stay in their canonical documents rather than receiving extra ADRs. Follow [the delivery contract](docs/spec/15-DEVOPS-CICD-MIGRATIONS.md) for promotion, real acceptance checks and release authorization.

2026-10-15: ADR-0001, ADR-0004 and ADR-0006 accepted through owner-delegated technical selection. Package versions, runtime confirmation and native authentication issuance are implementation gates, not reopened stack choices.
