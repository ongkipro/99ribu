import { run } from "node:test";
import { resolve } from "node:path";
import { connectDatabase } from "../src/db/client.ts";

export async function checkFiles(files: readonly string[]) {
  if (files.length === 0) throw new Error("No test files selected.");
  const observed = new Map(files.map((file) => [resolve(file), 0]));
  let passed = 0;
  let failed = 0;
  let incomplete = 0;
  let summaryPassed = false;
  for await (const event of run({ files, concurrency: false, isolation: "process", timeout: 30000, execArgv: [] })) {
    if (event.type === "test:pass" || event.type === "test:fail") {
      const { data } = event;
      if (data.skip || data.todo) incomplete++;
      if (event.type === "test:fail") {
        failed++;
        console.error(`FAIL ${data.name}`);
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

if (import.meta.main) {
  const [mode, selector, ...extra] = process.argv.slice(2);
  if (!["integration", "browser"].includes(mode) || !["--case=foundation", "--case=PR-1", "--case=PR-2", "--case=PR-11", "--case=PR-3", "--case=PR-4", "--case=PR-5", "--case=PR-6", "--case=PR-7", "--case=T-26", "--case=T-31", "--case=S29-candidate", "--case=S30-candidate", "--case=S31-candidate", "--case=PR-17", "--case=PR-12", "--case=PR-13", "--case=PR-18", "--case=PR-19", "--case=seed-foundation", "--case=seed-commerce", "--case=PR-16", "--case=PR-20"].includes(selector) || extra.length || (mode === "browser" && ["--case=seed-foundation", "--case=PR-16", "--case=PR-3", "--case=S29-candidate", "--case=S30-candidate", "--case=S31-candidate"].includes(selector))) {
    console.error("Use check-tests.ts integration|browser --case=foundation|--case=PR-1|--case=PR-2|--case=PR-4|--case=PR-5|--case=PR-6|--case=PR-7|--case=T-26|--case=T-31|--case=PR-11|--case=PR-12|--case=PR-13|--case=PR-17|--case=PR-18|--case=PR-19|--case=PR-20|--case=seed-commerce; integration also supports --case=seed-foundation|--case=PR-16|--case=PR-3|--case=S29-candidate|--case=S30-candidate|--case=S31-candidate (unapplied rollback-only proofs, not full parent acceptance). PR-5 proves S24/S28 prepaid and COD; T-26 proves S25/S28 first-party canonical signals. Unknown, missing and extra selectors are refused.");
    process.exitCode = 1;
  } else {
    const files = selector === "--case=T-31"
      ? mode === 'integration' ? ['tests/integration/storefront-checkout-contract.test.ts','tests/integration/storefront-checkout-runtime.test.ts','tests/integration/storefront-checkout-payment.test.ts','tests/integration/storefront-checkout-signals.test.ts','tests/integration/storefront-checkout-draft.test.ts'] : ['tests/browser/storefront-checkout.test.ts']
      : selector === "--case=S31-candidate"
      ? ["tests/integration/return-candidate.test.ts"]
      : selector === "--case=S30-candidate"
      ? ["tests/integration/settlement-candidate.test.ts","tests/integration/settlement-operator-candidate.test.ts","tests/integration/settlement-basis-candidate.test.ts"]
      : selector === "--case=PR-7"
      ? mode === 'integration' ? ['tests/integration/return-policy.test.ts','tests/integration/return-receipt-source.test.ts','tests/integration/return-authority.test.ts','tests/integration/return-access.test.ts','tests/integration/return-refund-source.test.ts','tests/integration/return-financial-basis.test.ts','tests/integration/return-lifecycle.test.ts','tests/integration/return-reads.test.ts','tests/integration/return-contract.test.ts','tests/integration/return-projections.test.ts','tests/integration/return-refund-recovery.test.ts','tests/integration/return-races.test.ts','tests/integration/return-native.test.ts','tests/integration/replacement-policy.test.ts','tests/integration/replacement-stock-policy.test.ts','tests/integration/replacement-receipt-policy.test.ts','tests/integration/replacement-shipping-policy.test.ts','tests/integration/affiliate-rate-policy.test.ts','tests/integration/affiliate-rate-cost-primitive.test.ts','tests/integration/affiliate-rate-authority.test.ts','tests/integration/replacement-lifecycle.test.ts','tests/integration/affiliate-rate-lifecycle.test.ts','tests/integration/replacement-history-races.test.ts','tests/integration/replacement-recovery.test.ts','tests/integration/replacement-native.test.ts','tests/integration/replacement-races.test.ts','tests/integration/replacement-refund.test.ts','tests/integration/replacement-contract.test.ts','tests/integration/affiliate-rate-contract.test.ts'] : ['tests/integration/return-http.test.ts','tests/integration/replacement-http.test.ts']
      : selector === "--case=PR-6"
      ? mode === 'integration' ? ['tests/integration/fulfillment-calendar.test.ts','tests/integration/fulfillment-contract.test.ts','tests/integration/fulfillment-recovery.test.ts','tests/integration/fulfillment-lifecycle.test.ts'] : ['tests/integration/fulfillment-http.test.ts']
      : selector === "--case=S29-candidate"
      ? ["tests/integration/fulfillment-calendar.test.ts","tests/integration/fulfillment-migration.test.ts","tests/integration/fulfillment-candidate.test.ts"]
      : selector === "--case=T-26"
      ? mode === 'integration' ? ['tests/integration/consent-policy.test.ts','tests/integration/consent-migration.test.ts','tests/integration/advertising-purchase-candidate.test.ts','tests/integration/advertising-cart-candidate.test.ts','tests/integration/advertising-funnel-input.test.ts','tests/integration/advertising-order-funnel-candidate.test.ts','tests/integration/advertising-purchase.test.ts','tests/integration/advertising-worker.test.ts','tests/integration/advertising-contract.test.ts','tests/integration/cod-collections.test.ts'] : ['tests/integration/advertising-http.test.ts','tests/integration/cod-http.test.ts']
      : selector === "--case=PR-5"
      ? mode === 'integration' ? ['tests/integration/payments-migration.test.ts','tests/integration/payment-worker.test.ts','tests/integration/payment-attempts.test.ts','tests/integration/payment-recovery.test.ts','tests/integration/payment-operator.test.ts','tests/integration/payment-deadline.test.ts','tests/integration/payment-default-worker.test.ts','tests/integration/payment-access.test.ts','tests/integration/payment-contract.test.ts','tests/integration/cod-candidate.test.ts','tests/integration/cod-checkout-candidate.test.ts','tests/integration/cod-collections.test.ts','tests/integration/cod-contract.test.ts'] : ['tests/integration/payment-http.test.ts','tests/integration/cod-http.test.ts']
      : selector === "--case=PR-12"
      ? mode === "integration" ? ["tests/integration/finance-ledger-migration.test.ts","tests/integration/finance-ledger-candidate.test.ts","tests/integration/finance-ledger.test.ts","tests/integration/finance-history-migration.test.ts","tests/integration/finance-history.test.ts","tests/integration/settlement-allocation.test.ts","tests/integration/settlement-source-contract.test.ts","tests/integration/settlement-body.test.ts","tests/integration/settlement-access.test.ts","tests/integration/settlement-receivables.test.ts","tests/integration/settlement-native.test.ts","tests/integration/settlement-contract.test.ts","tests/integration/settlement-recovery.test.ts","tests/integration/settlement-races.test.ts","tests/integration/settlement-fixture-isolation.test.ts"] : ["tests/integration/finance-history-http.test.ts","tests/integration/settlement-http.test.ts"]
      : selector === "--case=PR-17"
      ? mode === "integration" ? ["tests/integration/storefront.test.ts","tests/integration/storefront-contract.test.ts","tests/integration/storefront-offer-selection.test.ts","tests/integration/storefront-purchase.test.ts","tests/integration/storefront-cart-stock.test.ts","tests/integration/storefront-cart-runtime.test.ts"] : ["tests/integration/storefront-http.test.ts","tests/browser/storefront.test.ts","tests/browser/storefront-filter-recovery.test.ts","tests/browser/storefront-cart.test.ts"]
      : selector === "--case=PR-4"
      ? mode === "integration" ? ["tests/integration/checkout-migration.test.ts","tests/integration/checkout-core.test.ts","tests/integration/checkout-contract.test.ts","tests/integration/checkout-access.test.ts","tests/integration/checkout-races.test.ts","tests/integration/checkout-worker.test.ts"] : ["tests/integration/checkout-http.test.ts"]
      : selector === "--case=PR-3"
      ? ["tests/integration/shipping-address.test.ts","tests/integration/shipping.test.ts","tests/integration/shipping-contribution.test.ts"]
      : selector === "--case=seed-commerce"
      ? [mode === "integration" ? "tests/integration/commerce-fixture.test.ts" : "tests/integration/commerce-fixture-http.test.ts"]
      : selector === "--case=PR-11"
      ? mode === "integration" ? ["tests/integration/promotion-migration.test.ts","tests/integration/promotion.test.ts","tests/integration/promotion-worker.test.ts","tests/integration/promotion-contract.test.ts"] : ["tests/integration/promotion-http.test.ts"]
      : selector === "--case=PR-19"
      ? mode === "integration" ? ["tests/integration/finance-migration.test.ts", "tests/integration/finance-costs.test.ts", "tests/integration/finance-publication.test.ts", "tests/integration/finance-contract.test.ts"] : ["tests/integration/finance-http.test.ts"]
      : selector === "--case=PR-2"
      ? mode === "integration" ? ["tests/integration/inventory-migration.test.ts", "tests/integration/inventory.test.ts", "tests/integration/inventory-reservations.test.ts", "tests/integration/inventory-transfers.test.ts"] : ["tests/integration/inventory-http.test.ts"]
      : selector === "--case=PR-1"
      ? [mode === "integration" ? "tests/integration/catalog.test.ts" : "tests/integration/catalog-http.test.ts"]
      : selector === "--case=PR-20"
      ? [mode === "integration" ? "tests/integration/settings.test.ts" : "tests/integration/settings-http.test.ts"]
      : selector === "--case=PR-16"
      ? ["tests/integration/jobs.test.ts"]
      : selector === "--case=seed-foundation"
      ? ["tests/integration/fixtures.test.ts"]
      : selector === "--case=PR-18"
      ? [mode === "integration" ? "tests/contract/access.test.ts" : "tests/integration/access-http.test.ts"]
      : selector === "--case=PR-13"
      ? [mode === "integration" ? "tests/integration/access.test.ts" : "tests/integration/access-http.test.ts"]
      : mode === "integration"
      ? ["tests/database.test.ts", "tests/storage.test.ts", "tests/auth-key.test.ts", "tests/auth.test.ts", "tests/worker.test.ts"]
      : ["tests/smoke.test.ts", "tests/auth-http.test.ts"];
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
    finally { await connection.sql.end(); }
    if (!available) process.exitCode = 1;
    else if(!candidateAllowed)process.exitCode=1;
    else if (!(await checkFiles(files)).ok) process.exitCode = 1;
  }
}
