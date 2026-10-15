# Release — Serba 99ribu

Adopted at repository root on 2026-10-16. Documents are canonical here; application implementation and localhost acceptance remain pending.

Release-ID: UNSET
Base: UNSET
Environment: local
Declared-Risk: R3
Rollback-Ref: UNSET
Rollback-Command: UNSET
Backup-Proof: UNSET
Status: DRAFT
Local-Acceptance: NOT_RUN
Target: localhost production-mode application with synthetic data and simulated external effects

## Local acceptance boundary

Deliver all approved domains through real application/auth/PostgreSQL/worker code, with the S01+ slice acceptance and assembled regression in sole `TASKS.md`. Prove built production-mode web and worker startup, scoped access, financial/stock invariants, restart recovery, synthetic backup/restore and rendered responsive journeys. Record actual commands/artifact identities and separate-agent review against the final surface. No local acceptance result exists yet.

## Recovery and evidence

Rollback reference/command: pending actual application/migration design.
Synthetic backup and restore proof: pending.
Final boundary and independent review: pending.
Local production-mode build/start and health evidence: pending.

Do not run destructive restore against a working database; rehearse into a separate disposable target. Set exact recovery commands only after they exist and are tested.

## External release gates

Local completion does not authorize provision/deploy/DNS, live provider calls, credentials, real payments/shipments/messages, campaign spend, commit or push. Issued contracts, actual account consent/configuration, physical printer/scanner/carrier approval, remote backup/monitoring and explicit deployment authorization remain separate gates. Use production-gate/release-check only when their repository prerequisites and target are actually configured; never mark DEPLOYED from a localhost test.
