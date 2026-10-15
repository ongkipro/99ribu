# ADR-0005: Vultr hosting managed through Coolify

- **Status:** Accepted
- **Date:** 2026-10-15
- **Author:** Engineering owner
- **Owner:** Engineering owner
- **Deciders:** Paduka Ongki
- **Supersedes:** None

## 1. Context
The owner confirmed Vultr compute and Coolify management on 2026-10-15. Cloudflare edge remains the existing proposed integration direction. The static coming-soon site is deployed separately; no commerce VPS, region, storage, backup destination, origin route or paid plan is approved/provisioned by this planning pack.

Decision drivers: Predictable operation; private administration; web/worker lifecycle; persistent PostgreSQL; off-host restore; explicit public cache rules.

Non-goals: No provisioning, DNS cutover, live deploy, automatic data residency conclusion or approved recovery-time objective.

Authority: CTX-10, ARCH-1, DEL-1, SEC-1, PRIV-1. Owner-confirmed hosting selection; implementation confirmation remains a gate.

## 2. Considered Options
- **Option A — Vultr plus Coolify and Cloudflare:** Matches owner steering and supports persistent processes; puts OS/container/database/restore operation on the team.
- **Option B — Managed application, database and worker services:** Can reduce host-operation work, but requires cost, provider/runtime and background-job fit to be compared against actual needs.
- **Option C — Cloudflare-hosted commerce runtime:** Can align with the edge, but requires a separate runtime/database/job compatibility review; the static launch proves none of those commerce capabilities.

## 3. Decision
Chosen option: **Vultr compute managed through Coolify**. Cloudflare edge integration and its exact route remain proposed setup details.

Retain the proposed detailed topology: Cloudflare routes public commerce traffic to an origin managed through Coolify on Vultr; web/worker processes share transactional PostgreSQL through private connectivity and protected object storage. Exact database hosting, region, TLS/proxy-versus-Tunnel, monitoring and backup services remain unresolved. Cache only explicitly public catalog/media responses; never cache private/admin/checkout/order-capability responses. Protect the deployment control plane separately from public browsing.

## 4. Consequences
- **Positive:** An accepted hosting provider and deployment manager and separation of public edge, origin, data and management.
- **Negative:** A single host can be a failure domain; backups do not prove recoverability until restored. Actual costs and capacity remain unknown.
- **Neutral:** Canonical contracts and evidence remain in their owning documents; no implementation, provider call or deployment is established by this record.

## 5. Confirmation
Use DEL-1 rehearsal and the existing delivery checklist: isolated staging, private-response cache probes, reviewed migration, protected control-plane access, off-host restore and owner-approved commerce cutover. No live resource should be inferred from a diagram.

Document checks: the suite traceability checker must resolve this ADR, its canonical [decision index](../../DECISIONS.md) and Technical Design trace link. All runtime confirmation above is prospective.

## 6. More Information
Read [Product requirements](../spec/02-PRD.md), [Technical Design](../spec/03-TECHNICAL-DESIGN.md), [Architecture](../spec/04-SYSTEM-ARCHITECTURE.md), [Data Model](../spec/05-DATA-MODEL.md) and [Execution queue](../../TASKS.md).

Revisit on a changed business invariant, selected runtime/provider, demonstrated scale/ownership need, or failed confirmation scenario. Accepted ADR substance is immutable; a changed decision receives a new numbered ADR and supersession links. Proposed records may be revised until accepted. IDs are provisional until promotion/merge and must be re-scanned against the destination repository.

### Region confirmation — 2026-10-15
Paduka Ongki confirmed Singapore (sgp) for primary Vultr compute. Plan size remains a recommendation in Architecture; this records no purchase, provisioning or deployment. Backup/support locations and detailed routing remain open.

### Initial plan acceptance — 2026-10-15
After comparing Contabo and Vultr, Paduka Ongki accepted Vultr High Performance AMD `vhp-4c-8gb-amd`, 4 shared vCPU, 8 GB RAM and 180 GB NVMe in Singapore. Architecture owns the dated price reference and sizing limits. No resource purchase or provisioning was executed.
