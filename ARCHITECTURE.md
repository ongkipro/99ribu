# Architecture — Serba 99ribu

Adopted at repository root on 2026-10-16. Documents are canonical here; application implementation and localhost acceptance remain pending.

## Selected boundaries

One Next.js/TypeScript application contains role-scoped buyer/staff/affiliate surfaces and shared domain modules. PostgreSQL/Drizzle owns transactional stock, money, identity references and durable jobs. Better Auth supplies the selected identity foundation; exact supported session/recovery transport requires implementation verification. A separate worker processes committed outbox work outside database locks.

External payment/shipping/ads/notification/manual-transfer effects use deterministic local test adapters for current delivery. Production credentials and endpoints are not required for these simulators. Preserve real domain validation, authorization, idempotency, money allocation and restart recovery; fake adapters do not establish provider compatibility.

## Actual implementation

The documentation repository exists with root contracts, `docs/spec/`, six ADRs in `docs/adr/`, and a tool-generated `.delivery/` ledger. No application source, package manifest, installed runtime or service exists yet. After each verified slice, document actual components/paths, trust boundaries, persistence and worker interfaces here, linking the governing spec/ADR without duplicating it. Record deviations and supersede affected decisions explicitly. Package versions, migrations, auth behavior and local production-mode configuration are pending evidence.

## Acceptance boundary

Current acceptance targets a production-mode localhost web/worker with real disposable PostgreSQL and synthetic fixtures. Required proof includes public API behavior, durable stock/money effects, authorization negatives, restart/restore and rendered UI journeys. Provider sandbox/live acceptance, physical carrier-label approval and remote operations remain separate. A successful build alone proves none of those behaviors.
