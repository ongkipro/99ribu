# Observability — Serba 99ribu

Adopted at repository root on 2026-10-16. Documents are canonical here; application implementation and localhost acceptance remain pending.

## Local probes to implement and record

Record actual safe command, expected result, owner and last evidence/run for each applicable probe during foundation and affected slices:

- Production-mode web health and PostgreSQL readiness without secrets/private records.
- Worker heartbeat, backlog/oldest age, leases, bounded retry and restart recovery.
- Stock conservation and money/collection/refund/payout reconciliation using synthetic fixtures.
- Private receipt/access denial, consent suppression and simulated destination diagnostics.
- Synthetic database/artifact restore into a separate disposable target with invariant checks.
- Rendered browser journeys and client failures under the selected mobile/desktop contracts.

Commands and numerical alert thresholds are pending actual implementation; do not treat this list as configured monitoring. Preserve event occurrence versus ingestion time and correlation IDs. Logs/diagnostics exclude credentials, raw matching identifiers, contact/address, support bodies and private label/bank evidence.

## Evidence and release scope

Keep structured executed probe results in `.delivery/` and the current resume summary in root `STATUS.md`. Local fake-adapter delivery is not vendor acceptance or attribution. Remote uptime, production alerts, off-host restore and real carrier scanning require their own configured environment and evidence. `release-check` is applicable only after actual probes and release context are configured; no empty-probe PASS constitutes acceptance.
