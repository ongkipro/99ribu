# ADR-0004: TypeScript web application and PostgreSQL stack

- **Status:** Accepted
- **Date:** 2026-10-15
- **Author:** Engineering owner
- **Owner:** Engineering owner
- **Deciders:** Paduka Ongki
- **Supersedes:** None

## 1. Context
The current proposal is Next.js App Router with TypeScript, PostgreSQL/Drizzle, Better Auth and React-capable admin components. The product combines searchable public commerce, dense staff workflows and dedicated mobile presentation. No repository, pinned compatibility set or accepted native authentication protocol exists.

Decision drivers: One domain implementation; transactional persistence; public catalog rendering; staff UX; terminal-first reproducible development.

Non-goals: No package installation, runtime claim, native framework selection or automatic replacement of the separate coming-soon site.

Authority: CTX-9, TD-1, ARCH-1, API-1. Accepted under the owner’s delegated technical selection on 2026-10-15; version compatibility and runtime confirmation remain implementation gates.

## 2. Considered Options
- **Option A — Next.js plus PostgreSQL in one application repository:** Fits the mixed commerce/operator scope and shared TypeScript boundary; requires server/client discipline and framework-specific cache/auth verification.
- **Option B — Astro public storefront with separate commerce/admin backend:** Can keep public pages lightweight, but adds routing, deployment and integration boundaries for the current shared application scope.
- **Option C — Dedicated backend framework plus separate frontend:** Provides a stronger service boundary, but adds another application and API integration surface before a demonstrated need.

## 3. Decision
Chosen option: **TypeScript application with Next.js and PostgreSQL tooling**.

Retain the recommended Next.js/TypeScript application, PostgreSQL with Drizzle, and Better Auth for identity primitives; use shadcn/ui for suitable React admin controls. Business authorization and money invariants remain application-owned. Selection is recorded under owner delegation; pin compatible stable versions and verify auth transport with actual local checks before implementation acceptance. This record does not select package versions or assert native-token support.

## 4. Consequences
- **Positive:** A coherent selected stack with shared domain types and relational transaction support.
- **Negative:** Framework/auth upgrades and runtime compatibility must be maintained; frontend rendering and API contracts are different concerns.
- **Neutral:** Canonical contracts and evidence remain in their owning documents; no implementation, provider call or deployment is established by this record.

## 5. Confirmation
At repository initialization, preserve this selection and pin compatible stable versions; setup must create actual type/lint/build and disposable-PostgreSQL checks. Run TEST-4/TEST-13 and prove session/CSRF/role scope, not just a green build.

Document checks: the suite traceability checker must resolve this ADR, its canonical [decision index](../../DECISIONS.md) and Technical Design trace link. All runtime confirmation above is prospective.

## 6. More Information
Read [Product requirements](../spec/02-PRD.md), [Technical Design](../spec/03-TECHNICAL-DESIGN.md), [Architecture](../spec/04-SYSTEM-ARCHITECTURE.md), [Data Model](../spec/05-DATA-MODEL.md) and [Execution queue](../../TASKS.md).

Revisit on a changed business invariant, selected runtime/provider, demonstrated scale/ownership need, or failed confirmation scenario. Accepted ADR substance is immutable; a changed decision receives a new numbered ADR and supersession links. Proposed records may be revised until accepted. IDs are provisional until promotion/merge and must be re-scanned against the destination repository.

### Delegated technical selection — 2026-10-15
The owner instructed engineering to perfect and select the recommended stack. The recorded modular application, Next.js/TypeScript/PostgreSQL/Drizzle/Better Auth and shared versioned client boundary are selected. This does not approve native binaries, claim working authentication/providers or authorize live deployment.
