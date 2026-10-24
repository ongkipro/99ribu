import { run } from "node:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { connectDatabase } from "../src/db/client.ts";

export async function checkFiles(files: readonly string[]) {
  if (files.length === 0) throw new Error("No test files selected.");
  const observed = new Map(files.map((file) => [resolve(file), 0]));
  let passed = 0;
  let failed = 0;
  let incomplete = 0;
  let summaryPassed = false;
  // forceExit: a timed-out test never reaches its finally, so a leaked browser or SQL pool would keep
  // the file's process (and this whole run) alive; the timeout is reported as a failure instead.
  for await (const event of run({ files, concurrency: false, isolation: "process", timeout: 30000, forceExit: true, execArgv: [] })) {
    if (event.type === "test:pass" || event.type === "test:fail") {
      const { data } = event;
      if (data.skip || data.todo) incomplete++;
      if (event.type === "test:fail") {
        failed++;
        const error = data.details.error as Error & { cause?: unknown };
        console.error(`FAIL ${data.name}`, error?.cause ?? error?.message ?? "");
      } else if (!data.skip && !data.todo && data.details.type !== "suite" && data.file && resolve(data.name) !== resolve(data.file)) {
        // Node reports an empty file as a passing test named after the file. It proves no assertion.
        const file = resolve(data.file);
        observed.set(file, (observed.get(file) ?? 0) + 1);
        passed++;
      }
    }
    if (event.type === "test:summary" && !event.data.file) {
      summaryPassed = event.data.success && event.data.counts.cancelled === 0 && event.data.counts.skipped === 0 && event.data.counts.todo === 0;
    }
  }
  const empty = [...observed.values()].filter((count) => count === 0).length;
  const ok = summaryPassed && failed === 0 && incomplete === 0 && empty === 0 && passed > 0;
  const result = { ok, files: files.length, passed, failed, incomplete, empty };
  console.log(JSON.stringify(result));
  return result;
}

// Full current regression: every file directly under tests/<mode>/. Historical pre-0020..0023 rollback
// candidates live in tests/historical/ and are reachable only through their refusing S29/S30/S31 selectors.
export function currentFiles(mode: "integration" | "browser") {
  return readdirSync(`tests/${mode}`).filter((name) => name.endsWith(".test.ts")).sort().map((name) => `tests/${mode}/${name}`);
}

if (import.meta.main) {
  const raw = process.argv.slice(2);
  const [mode, selector, ...rawExtra] = raw.length === 1 && raw[0] === "--case=T-32" ? ["integration", "--case=T-32"] : raw;
  const extra = mode === "browser" ? rawExtra.filter((arg) => arg !== "--project=mobile" && arg !== "--project=desktop") : rawExtra;
  const validSelectors = [
    "--case=foundation", "--case=PR-1", "--case=PR-2", "--case=PR-3", "--case=PR-4", "--case=PR-5", "--case=PR-6", "--case=PR-7",
    "--case=PR-8", "--case=PR-9", "--case=PR-10", "--case=PR-11", "--case=PR-12", "--case=PR-13", "--case=PR-15", "--case=PR-16",
    "--case=PR-17", "--case=PR-18", "--case=PR-19", "--case=PR-20", "--case=PR-21", "--case=PR-22",
    "--case=T-26", "--case=T-27", "--case=T-28", "--case=T-29", "--case=T-30", "--case=T-31", "--case=T-32", "--case=T-33",
    "--case=T-34", "--case=T-35", "--case=T-36", "--case=T-37", "--case=T-38", "--case=localhost-readiness",
    "--case=S29-candidate", "--case=S30-candidate", "--case=S31-candidate", "--case=seed-foundation", "--case=seed-commerce",
    "--case=seed-berlapak", "--case=demo-orders", "--case=manual-fulfillment", "--case=cod-remittance", "--case=payment-methods", "--case=autolaris-payments", "--case=consignment-payments", "--case=admin-ui-controls", "--case=production-profile", "--case=backup-restore", "--case=admin-orders", "--case=db-hygiene", "--case=admin-kpi-parity", "--case=guest-order-lookup", "--case=sign-in", "--case=ops-screens", "--case=all-current",
  ];
  const integrationOnlySelectors = ["--case=backup-restore", "--case=seed-foundation", "--case=seed-berlapak", "--case=demo-orders", "--case=manual-fulfillment", "--case=admin-orders", "--case=db-hygiene", "--case=admin-kpi-parity", "--case=guest-order-lookup", "--case=cod-remittance", "--case=payment-methods", "--case=autolaris-payments", "--case=production-profile", "--case=PR-3", "--case=S29-candidate", "--case=S30-candidate", "--case=S31-candidate", "--case=T-38"];
  if (!["integration", "browser"].includes(mode) || !validSelectors.includes(selector) || extra.length || (mode === "browser" && integrationOnlySelectors.includes(selector)) || (mode === "integration" && ["--case=consignment-payments", "--case=admin-ui-controls", "--case=sign-in"].includes(selector))) {
    console.error("Use check-tests.ts integration|browser with a registered --case=... selector. Unknown, missing and extra selectors are refused.");
    process.exitCode = 1;
  } else {
    const files = selector === "--case=all-current"
      ? currentFiles(mode as "integration" | "browser")
      : selector === "--case=T-32"
      ? mode === "integration" ? ["tests/integration/storefront-order-receipt.test.ts"] : ["tests/browser/storefront-order-receipt.test.ts"]
      : selector === "--case=T-31"
      ? mode === "integration" ? ["tests/integration/storefront-checkout-contract.test.ts","tests/integration/storefront-checkout-runtime.test.ts","tests/integration/storefront-checkout-payment.test.ts","tests/integration/storefront-checkout-signals.test.ts","tests/integration/storefront-checkout-draft.test.ts"] : ["tests/browser/storefront-checkout.test.ts"]
      : selector === "--case=PR-21"
      ? mode === "integration"
        ? [
            "tests/integration/exception-application-policy.test.ts",
            "tests/integration/exception-callback-basis.test.ts",
            "tests/integration/exception-cancellation-source.test.ts",
            "tests/integration/exception-cod-basis.test.ts",
            "tests/integration/exception-collection.test.ts",
            "tests/integration/exception-fulfillment-authority.test.ts",
            "tests/integration/exception-migration-declarations.test.ts",
            "tests/integration/exception-policy.test.ts",
            "tests/integration/exception-promotion-basis.test.ts",
            "tests/integration/exception-proposals.test.ts",
            "tests/integration/exception-recovery-claims.test.ts",
            "tests/integration/exception-recovery-queue-policy.test.ts",
            "tests/integration/exception-recovery-source.test.ts",
            "tests/integration/exception-replacement-claims.test.ts",
            "tests/integration/exception-shipment-read-race.test.ts",
            "tests/integration/exception-shipping-recovery.test.ts",
            "tests/integration/exception-stock-policy.test.ts",
            "tests/integration/exception-unit-progress.test.ts",
            "tests/integration/exception-waybill-projection.test.ts",
            "tests/integration/exception-routes.test.ts",
            "tests/integration/recovery-refund-worker.test.ts",
            "tests/integration/recovery-refund-recovery.test.ts",
          ]
        : ["tests/integration/exception-routes.test.ts"]
      : selector === "--case=PR-8"
      ? mode === "integration" ? ["tests/integration/affiliate-referral.test.ts"] : ["tests/browser/affiliate-workspace.test.ts"]
      : selector === "--case=PR-9"
      ? mode === "integration" ? ["tests/integration/commission-maturity.test.ts"] : ["tests/browser/affiliate-workspace.test.ts"]
      : selector === "--case=PR-10"
      ? mode === "integration" ? ["tests/integration/affiliate-payouts.test.ts"] : ["tests/browser/affiliate-workspace.test.ts"]
      : selector === "--case=PR-15"
      ? ["tests/integration/catalog-feed.test.ts", "tests/integration/catalog-feed-policy.test.ts", "tests/integration/storefront-seo.test.ts"]
      : selector === "--case=PR-22"
      ? mode === "integration" ? ["tests/integration/support-chat.test.ts"] : ["tests/browser/support-chat.test.ts", "tests/browser/support-live.test.ts"]
      : selector === "--case=T-27"
      ? ["tests/integration/advertising-meta-capi.test.ts"]
      : selector === "--case=T-28"
      ? ["tests/integration/advertising-google-offline-clicks.test.ts"]
      : selector === "--case=T-29"
      ? ["tests/integration/advertising-tiktok-events-api.test.ts"]
      : selector === "--case=T-30"
      ? mode === "integration" ? ["tests/integration/advertising-diagnostics.test.ts"] : ["tests/browser/admin-workspaces.test.ts"]
      : selector === "--case=T-33"
      ? mode === "integration" ? ["tests/integration/storefront.test.ts","tests/integration/storefront-contract.test.ts","tests/integration/storefront-offer-selection.test.ts","tests/integration/storefront-purchase.test.ts","tests/integration/storefront-cart-stock.test.ts","tests/integration/storefront-cart-runtime.test.ts"] : ["tests/browser/storefront.test.ts","tests/browser/storefront-filter-recovery.test.ts","tests/browser/storefront-cart.test.ts","tests/browser/storefront-continuity.test.ts"]
      : selector === "--case=T-34"
      ? mode === "integration" ? ["tests/integration/admin-reporting.test.ts","tests/integration/admin-kpis.test.ts","tests/integration/audit-trail.test.ts"] : ["tests/browser/admin-workspaces.test.ts"]
      : selector === "--case=T-35"
      ? mode === "integration" ? ["tests/integration/buyer-account.test.ts"] : ["tests/browser/buyer-account.test.ts"]
      : selector === "--case=T-36"
      ? ["tests/integration/shipping-labels.test.ts"]
      : selector === "--case=T-37"
      ? mode === "integration" ? ["tests/integration/shipping-labels.test.ts"] : ["tests/browser/shipping-print-center.test.ts"]
      : selector === "--case=T-38"
      ? ["tests/integration/scenarios-14.test.ts"]
      : selector === "--case=localhost-readiness"
      ? mode === "integration" ? ["tests/integration/localhost-readiness.test.ts","tests/integration/tailnet-origin.test.ts"] : ["tests/browser/localhost-readiness.test.ts"]
      : selector === "--case=S31-candidate"
      ? ["tests/historical/return-candidate.test.ts"]
      : selector === "--case=S30-candidate"
      ? ["tests/historical/settlement-candidate.test.ts","tests/historical/settlement-operator-candidate.test.ts","tests/historical/settlement-basis-candidate.test.ts"]
      : selector === "--case=PR-7"
      ? mode === 'integration' ? ['tests/integration/return-policy.test.ts','tests/integration/return-receipt-source.test.ts','tests/integration/return-authority.test.ts','tests/integration/return-access.test.ts','tests/integration/return-refund-source.test.ts','tests/integration/return-financial-basis.test.ts','tests/integration/return-lifecycle.test.ts','tests/integration/return-reads.test.ts','tests/integration/return-contract.test.ts','tests/integration/return-projections.test.ts','tests/integration/return-refund-recovery.test.ts','tests/integration/return-races.test.ts','tests/integration/return-native.test.ts','tests/integration/replacement-policy.test.ts','tests/integration/replacement-stock-policy.test.ts','tests/integration/replacement-receipt-policy.test.ts','tests/integration/replacement-shipping-policy.test.ts','tests/integration/affiliate-rate-policy.test.ts','tests/integration/affiliate-rate-cost-primitive.test.ts','tests/integration/affiliate-rate-authority.test.ts','tests/integration/replacement-lifecycle.test.ts','tests/integration/affiliate-rate-lifecycle.test.ts','tests/integration/replacement-history-races.test.ts','tests/integration/replacement-recovery.test.ts','tests/integration/replacement-native.test.ts','tests/integration/replacement-races.test.ts','tests/integration/replacement-refund.test.ts','tests/integration/replacement-contract.test.ts','tests/integration/affiliate-rate-contract.test.ts'] : ['tests/integration/return-http.test.ts','tests/integration/replacement-http.test.ts']
      : selector === "--case=PR-6"
      ? mode === 'integration' ? ['tests/integration/fulfillment-calendar.test.ts','tests/integration/fulfillment-contract.test.ts','tests/integration/fulfillment-recovery.test.ts','tests/integration/fulfillment-lifecycle.test.ts'] : ['tests/integration/fulfillment-http.test.ts']
      : selector === "--case=S29-candidate"
      ? ["tests/integration/fulfillment-calendar.test.ts","tests/historical/fulfillment-migration.test.ts","tests/historical/fulfillment-candidate.test.ts"]
      : selector === "--case=T-26"
      ? mode === 'integration' ? ['tests/integration/consent-policy.test.ts','tests/integration/consent-migration.test.ts','tests/integration/advertising-purchase-candidate.test.ts','tests/integration/advertising-cart-candidate.test.ts','tests/integration/advertising-funnel-input.test.ts','tests/integration/advertising-order-funnel-candidate.test.ts','tests/integration/advertising-purchase.test.ts','tests/integration/advertising-worker.test.ts','tests/integration/advertising-contract.test.ts','tests/integration/cod-collections.test.ts'] : ['tests/integration/advertising-http.test.ts','tests/integration/cod-http.test.ts']
      : selector === "--case=PR-5"
      ? mode === 'integration' ? ['tests/integration/payments-migration.test.ts','tests/integration/payment-worker.test.ts','tests/integration/payment-attempts.test.ts','tests/integration/payment-recovery.test.ts','tests/integration/payment-operator.test.ts','tests/integration/payment-deadline.test.ts','tests/integration/payment-default-worker.test.ts','tests/integration/payment-access.test.ts','tests/integration/payment-contract.test.ts','tests/integration/cod-candidate.test.ts','tests/integration/cod-checkout-candidate.test.ts','tests/integration/cod-collections.test.ts','tests/integration/cod-contract.test.ts','tests/integration/payment-methods.test.ts','tests/integration/autolaris-payments.test.ts'] : ['tests/integration/payment-http.test.ts','tests/integration/cod-http.test.ts']
      : selector === "--case=PR-12"
      ? mode === "integration" ? ["tests/integration/finance-ledger-migration.test.ts","tests/integration/finance-ledger.test.ts","tests/integration/finance-history-migration.test.ts","tests/integration/finance-history.test.ts","tests/integration/settlement-allocation.test.ts","tests/integration/settlement-source-contract.test.ts","tests/integration/settlement-body.test.ts","tests/integration/settlement-access.test.ts","tests/integration/settlement-receivables.test.ts","tests/integration/settlement-native.test.ts","tests/integration/settlement-contract.test.ts","tests/integration/settlement-recovery.test.ts","tests/integration/settlement-races.test.ts","tests/integration/settlement-fixture-isolation.test.ts"] : ["tests/integration/finance-history-http.test.ts","tests/integration/settlement-http.test.ts"]
      : selector === "--case=PR-17"
      ? mode === "integration" ? ["tests/integration/storefront.test.ts","tests/integration/storefront-contract.test.ts","tests/integration/storefront-offer-selection.test.ts","tests/integration/storefront-purchase.test.ts","tests/integration/storefront-cart-stock.test.ts","tests/integration/storefront-cart-runtime.test.ts"] : ["tests/integration/storefront-http.test.ts","tests/browser/storefront.test.ts","tests/browser/storefront-filter-recovery.test.ts","tests/browser/storefront-cart.test.ts","tests/browser/storefront-listing.test.ts","tests/browser/storefront-controls.test.ts"]
      : selector === "--case=PR-4"
      ? mode === "integration" ? ["tests/integration/checkout-migration.test.ts","tests/integration/checkout-core.test.ts","tests/integration/checkout-contract.test.ts","tests/integration/checkout-access.test.ts","tests/integration/guest-context-cleanup.test.ts","tests/integration/checkout-races.test.ts","tests/integration/checkout-worker.test.ts"] : ["tests/integration/checkout-http.test.ts"]
      : selector === "--case=PR-3"
      ? ["tests/integration/shipping-address.test.ts","tests/integration/shipping.test.ts","tests/integration/shipping-contribution.test.ts"]
      : selector === "--case=seed-berlapak"
      ? ["tests/integration/berlapak-import.test.ts"]
      : selector === "--case=demo-orders"
      ? ["tests/integration/demo-orders.test.ts"]
      : selector === "--case=manual-fulfillment"
      ? ["tests/integration/manual-fulfillment.test.ts"]
      : selector === "--case=admin-orders"
      ? ["tests/integration/admin-orders.test.ts"]
      : selector === "--case=admin-kpi-parity"
      ? ["tests/integration/admin-kpi-parity.test.ts"]
      : selector === "--case=guest-order-lookup"
      ? ["tests/integration/guest-order-lookup.test.ts"]
      : selector === "--case=db-hygiene"
      ? ["tests/integration/db-hygiene.test.ts", "tests/integration/retention.test.ts"]
      : selector === "--case=cod-remittance"
      ? ["tests/integration/cod-remittance.test.ts"]
      : selector === "--case=payment-methods"
      ? ["tests/integration/payment-methods.test.ts"]
      : selector === "--case=production-profile"
      ? ["tests/integration/production-environment.test.ts", "tests/production-database.test.ts"]
      : selector === "--case=autolaris-payments"
      ? ["tests/integration/autolaris-payments.test.ts"]
      : selector === "--case=backup-restore"
      ? ["tests/integration/backup-restore.test.ts"]
      : selector === "--case=ops-screens"
      ? mode === "integration" ? ["tests/integration/ops-screens.test.ts", "tests/integration/catalog-import.test.ts"] : ["tests/browser/admin-ops-screens.test.ts"]
      : selector === "--case=admin-ui-controls"
      ? ["tests/browser/admin-ui-controls.test.ts"]
      : selector === "--case=consignment-payments"
      ? ["tests/browser/consignment-payments.test.ts"]
      : selector === "--case=sign-in"
      ? ["tests/browser/sign-in.test.ts", "tests/browser/sign-in-flows.test.ts"]
      : selector === "--case=seed-commerce"
      ? [mode === "integration" ? "tests/integration/commerce-fixture.test.ts" : "tests/integration/commerce-fixture-http.test.ts"]
      : selector === "--case=PR-11"
      ? mode === "integration" ? ["tests/integration/promotion-migration.test.ts","tests/integration/promotion.test.ts","tests/integration/promotion-worker.test.ts","tests/integration/promotion-contract.test.ts"] : ["tests/integration/promotion-http.test.ts"]
      : selector === "--case=PR-19"
      ? mode === "integration" ? ["tests/integration/finance-migration.test.ts", "tests/integration/finance-costs.test.ts", "tests/integration/finance-publication.test.ts", "tests/integration/finance-contract.test.ts", "tests/integration/finance-realized-contribution.test.ts"] : ["tests/integration/finance-http.test.ts"]
      : selector === "--case=PR-2"
      ? mode === "integration" ? ["tests/integration/inventory-migration.test.ts", "tests/integration/inventory.test.ts", "tests/integration/inventory-reservations.test.ts", "tests/integration/inventory-transfers.test.ts"] : ["tests/integration/inventory-http.test.ts"]
      : selector === "--case=PR-1"
      ? mode === "integration" ? ["tests/integration/catalog.test.ts", "tests/integration/catalog-import.test.ts", "tests/integration/catalog-summary.test.ts", "tests/integration/catalog-media.test.ts"] : ["tests/integration/catalog-http.test.ts"]
      : selector === "--case=PR-20"
      ? [mode === "integration" ? "tests/integration/settings.test.ts" : "tests/integration/settings-http.test.ts"]
      : selector === "--case=PR-16"
      ? ["tests/integration/jobs.test.ts", "tests/integration/public-rate-limits.test.ts", "tests/integration/worker-guest-cleanup.test.ts"]
      : selector === "--case=seed-foundation"
      ? ["tests/integration/fixtures.test.ts"]
      : selector === "--case=PR-18"
      ? mode === "integration" ? ["tests/contract/access.test.ts", "tests/contract/openapi-parity.test.ts"] : ["tests/integration/access-http.test.ts"]
      : selector === "--case=PR-13"
      ? [mode === "integration" ? "tests/integration/access.test.ts" : "tests/integration/access-http.test.ts"]
      : mode === "integration"
      ? ["tests/database.test.ts", "tests/storage.test.ts", "tests/auth-key.test.ts", "tests/auth.test.ts", "tests/worker.test.ts"]
      : ["tests/smoke.test.ts", "tests/auth-http.test.ts", "tests/browser/sign-in.test.ts"];
    const connection = connectDatabase(mode === "integration" ? "test" : "local");
    let available = false;
    let candidateAllowed = true;
    try {
      await connection.sql`select 1`; available = true;
      if(selector==='--case=S31-candidate'){
        const [state]=await connection.sql`select to_regclass('app.refund') is null unapplied`;
        candidateAllowed=state.unapplied;if(!candidateAllowed)console.error('S31-candidate requires unapplied0021; use PR-7 for the applied runtime. No historical candidate case was executed.');
      }else if(selector==='--case=S30-candidate'){
        const [state]=await connection.sql`select to_regclass('app.local_settlement_operation') is null unapplied`;
        candidateAllowed=state.unapplied;if(!candidateAllowed)console.error('S30-candidate requires unapplied0020; use PR-12 for the applied runtime. No historical candidate case was executed.');
      }else if(selector==='--case=S29-candidate'){
        const [state]=await connection.sql`select to_regclass('app.fulfillment') is null unapplied`;
        candidateAllowed=state.unapplied;if(!candidateAllowed)console.error('S29-candidate requires unapplied0019; use PR-6 for the applied runtime. No historical candidate case was executed.');
      }
    }
    catch { available=false;console.error("Required isolated database is unavailable; no acceptance result can pass."); }
    try {
      if (!available) process.exitCode = 1;
      else if(!candidateAllowed)process.exitCode=1;
      else {
        // Runs sharing one database must not interleave: another run's untargeted drains take this run's
        // jobs and its sign-in buckets. The session lock is released when the connection ends.
        const lock = await connection.sql.reserve();
        let waited = false;
        while (!(await lock`select pg_try_advisory_lock(hashtext('99ribu:check-tests')) ok`)[0].ok) {
          if (!waited) console.error("Another test run holds this database; waiting for it to finish.");
          waited = true;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        try {
          if (mode === "integration" && selector !== "--case=S29-candidate" && selector !== "--case=S30-candidate" && selector !== "--case=S31-candidate") {
            const { ensureCommercialBaseline } = await import("../tests/integration/commercial-baseline.ts");
            if (await ensureCommercialBaseline()) console.error("Created the commercial policy baseline in the empty test database.");
          }
          if (selector !== "--case=S29-candidate" && selector !== "--case=S30-candidate" && selector !== "--case=S31-candidate") {
            // Under this lock no fixture is alive, so an owned campaign still running was leaked by an interrupted run.
            const { closeLeakedShippingCampaigns } = await import("../tests/integration/checkout-fixture.ts");
            const closed = await closeLeakedShippingCampaigns();
            if (closed) console.error(`Closed ${closed} owned checkout campaign(s) left active by an interrupted test run.`);
          }
          // Browser suites and the integration *-http files share the owner's LOCAL database and built storefront:
          // publications this run's synthetic principals made are withdrawn afterwards (pass or fail) so fixtures never stay public.
          const [started] = await connection.sql`select clock_timestamp()::text as at`;
          try { if (!(await checkFiles(files)).ok) process.exitCode = 1; }
          finally {
            if (started) {
              try {
                const { withdrawTestPublications } = await import("../src/modules/local/seed-runtime.ts");
                console.log(JSON.stringify({ teardown: "test-publications", ...(await withdrawTestPublications("local", started.at)) }));
              } catch (error) { process.exitCode = 1; console.error("Test publication teardown failed; run `npm run catalog:withdraw -- local` to inspect.", error instanceof Error ? error.message : ""); }
            }
          }
        }
        finally { lock.release(); }
      }
    } finally { await connection.sql.end(); }
  }
}
