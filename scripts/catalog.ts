import { existsSync } from "node:fs";
import { resolve } from "node:path";

// DEC-005 catalog commands. `dataset` is host-only (needs the raw snapshot); `import` loads the
// committed dataset into the selected database through the real catalog/publication services.
// `initial-stock` reads the raw snapshot at run time and posts initial receive movements, HPP and
// default offer assumptions through the real inventory/finance services (nothing is committed).
// `withdraw` lists (default) or, with --apply, withdraws every current publication outside the
// committed catalog through the real publication service. `rehome` (DEC-006 transition) reports
// (default, read-only) or, with --apply, moves catalog stock held outside its origin warehouses
// through warehouse transfers; the next `import` rebinds offers to their origin warehouses.
// S87 production: import, initial-stock and withdraw act as the operator's own MFA-verified owner (email, password and
// current code typed on this terminal) instead of the synthetic seed operator; the raw snapshot comes only from an
// explicit, operator-uploaded BERLAPAK_DATA_DIR. `verify` is read-only and prints the counts the release checks.
// In the image run `node scripts/catalog.ts …` (the npm scripts read .env.example, which the image does not carry).
const [command, ...args] = process.argv.slice(2);
const usage = "Use: catalog dataset [out-dir] | catalog import local|test|production [dataset-dir] | catalog initial-stock local|test|production [dataset-dir] | catalog rehome local|test [--apply] | catalog withdraw local|test|production [--apply] | catalog verify local|test|production.";
type Target = "local" | "test" | "production";
const targets = ["local", "test", "production"];
const rawDirectory = (target?: string) => {
  if (target === "production" && !process.env.BERLAPAK_DATA_DIR) throw new Error("Set BERLAPAK_DATA_DIR to the uploaded raw snapshot (read-only, outside the image).", { cause: "visible" });
  const directory = process.env.BERLAPAK_DATA_DIR || "/data/99ribu-berlapak-data";
  if (!existsSync(`${directory}/data-json`) || !existsSync(`${directory}/images`)) throw new Error(`Berlapak data directory not found: ${directory}. Set BERLAPAK_DATA_DIR.`, { cause: "visible" });
  return directory;
};
// Local/test: the synthetic seed operator. Production: the operator's own owner session, signed out afterwards.
async function asOwner<T>(target: Target, namespace: string, run: (request: Request, identity: import("../src/modules/access/auth.ts").LocalAuth, signal: AbortSignal) => Promise<T>) {
  if (target !== "production") {
    const { withSeedOwner } = await import("../src/modules/local/seed-runtime.ts");
    return withSeedOwner(target, namespace, run);
  }
  const { createLocalAuth } = await import("../src/modules/access/auth.ts");
  const { ownerSession } = await import("../src/modules/access/operator.ts");
  const { AccessError } = await import("../src/modules/access/policy.ts");
  const { operatorPrompt } = await import("../src/ops/prompt.ts");
  const input = operatorPrompt(), identity = createLocalAuth("production");
  try {
    const email = await input.ask("Owner email: "), password = await input.ask("Password: ", true), code = await input.ask("6-digit code from the app: ");
    const browser = await ownerSession(identity, { email, password, code }).catch((error) => {
      throw error instanceof AccessError ? new Error(`Refused: ${error.code}.`, { cause: "visible" }) : error;
    });
    // Ctrl-C/SIGTERM stop at the next step boundary (each step is transactional and idempotent), as withSeedOwner does.
    const interruption = new AbortController();
    const stop = (code: number) => () => { process.exitCode = code; interruption.abort(new Error("Catalog command interrupted")); };
    const stopInt = stop(130), stopTerm = stop(143);
    process.once("SIGINT", stopInt); process.once("SIGTERM", stopTerm);
    try { return await run(browser.request(`/api/v1/admin/${namespace}`), identity, interruption.signal); }
    finally { process.off("SIGINT", stopInt); process.off("SIGTERM", stopTerm); await browser.auth("/sign-out", {}); }
  } finally { input.close(); await identity.sql.end(); }
}
try {
  const { CatalogDatasetError } = await import("../src/modules/catalog/dataset.ts");
  const visible = (error: unknown) => { if (error instanceof CatalogDatasetError) throw new Error(error.message, { cause: "visible" }); throw error; };
  if (command === "dataset" && args.length <= 1) {
    const directory = rawDirectory();
    const { defaultDatasetDir, writeBerlapakDataset } = await import("../src/modules/local/berlapak-dataset.ts");
    console.log(JSON.stringify(writeBerlapakDataset(directory, args[0] ? resolve(args[0]) : defaultDatasetDir)));
  } else if (command === "import" && targets.includes(args[0]) && (args.length === 1 || args.length === 2)) {
    const { importCatalog, inLocalScope, readCatalogDataset } = await import("../src/modules/catalog/dataset.ts");
    const { defaultDatasetDir } = await import("../src/modules/local/berlapak-dataset.ts");
    const dataset = (() => { try { const read = readCatalogDataset(args[1] ? resolve(args[1]) : defaultDatasetDir); return args[1] ? read : { ...read, catalog: inLocalScope(read.catalog) }; } catch (error) { return visible(error); } })();
    const summary = await asOwner(args[0] as Target, "catalog-import", (request, identity, signal) =>
      importCatalog(request, identity, dataset, { signal }).catch(visible));
    console.log(JSON.stringify(summary));
  } else if (command === "initial-stock" && targets.includes(args[0]) && (args.length === 1 || args.length === 2)) {
    const sourceDir = rawDirectory(args[0]);
    const { loadInitialStock } = await import("../src/modules/local/berlapak-dataset.ts");
    const { inLocalScope } = await import("../src/modules/catalog/dataset.ts");
    const summary = await asOwner(args[0] as Target, "catalog-stock", (request, identity, signal) =>
      loadInitialStock(request, identity, { sourceDir, datasetDir: args[1] ? resolve(args[1]) : undefined, signal, scope: args[1] ? undefined : inLocalScope }).catch(visible));
    console.log(JSON.stringify(summary));
  } else if (command === "rehome" && ["local", "test"].includes(args[0]) && (args.length === 1 || (args.length === 2 && args[1] === "--apply"))) {
    const { inLocalScope, readCatalogDocument } = await import("../src/modules/catalog/dataset.ts");
    const { applyOriginTransition, defaultDatasetDir, planOriginTransition, summarizeTransition } = await import("../src/modules/local/berlapak-dataset.ts");
    const catalog = (() => { try { return inLocalScope(readCatalogDocument(defaultDatasetDir)); } catch (error) { return visible(error); } })();
    const target = args[0] as "local" | "test";
    if (args[1] !== "--apply") {
      const { connectDatabase } = await import("../src/db/client.ts");
      const { sql } = connectDatabase(target);
      try { console.log(JSON.stringify({ mode: "dry-run", target, ...summarizeTransition(await sql.begin("read only", (tx) => planOriginTransition(tx, catalog))) })); }
      finally { await sql.end(); }
    } else {
      const { withSeedOwner } = await import("../src/modules/local/seed-runtime.ts");
      console.log(JSON.stringify({ target, ...(await withSeedOwner(target, "catalog-rehome", (request, identity, signal) => applyOriginTransition(request, identity, catalog, signal).catch(visible))) }));
    }
  } else if (command === "withdraw" && targets.includes(args[0]) && (args.length === 1 || (args.length === 2 && args[1] === "--apply"))) {
    const { inLocalScope, readCatalogDocument, summarizeCandidates, withdrawCandidates, withdrawalCandidates } = await import("../src/modules/catalog/dataset.ts");
    const { defaultDatasetDir } = await import("../src/modules/local/berlapak-dataset.ts");
    const keep = (() => { try { return inLocalScope(readCatalogDocument(defaultDatasetDir)).products.flatMap((p) => p.offers.map((o) => o.sku)); } catch (error) { return visible(error); } })();
    const target = args[0] as Target;
    if (args[1] !== "--apply") {
      // Dry run is a read-only query: no temporary operator, no write.
      const { connectDatabase } = await import("../src/db/client.ts");
      const { sql } = connectDatabase(target);
      try { console.log(JSON.stringify({ mode: "dry-run", target, ...summarizeCandidates(await sql.begin("read only", (tx) => withdrawalCandidates(tx, keep))) })); }
      finally { await sql.end(); }
    } else {
      const summary = await asOwner(target, "catalog-withdraw", async (request, identity, signal) => {
        const candidates = await withdrawalCandidates(identity.sql, keep);
        return { mode: "apply", target, ...summarizeCandidates(candidates),
          ...(await withdrawCandidates(request, identity, candidates, "Owner decision 2026-10-22: public storefront shows only the DEC-005 catalog", signal)) };
      });
      console.log(JSON.stringify(summary));
    }
  } else if (command === "verify" && targets.includes(args[0]) && args.length === 1) {
    const { verifyCatalog } = await import("../src/modules/catalog/verify.ts");
    console.log(JSON.stringify(await verifyCatalog(args[0] as Target)));
  } else { console.error(usage); process.exitCode = 1; }
} catch (error) {
  if (error instanceof Error && error.cause === "visible") console.error(error.message);
  // A refusal code (AccessError) names the domain rule without private values.
  else if (/^[A-Z][A-Z0-9_]{1,63}$/.test(String((error as { code?: unknown } | null)?.code ?? ""))) console.error(`Refused: ${(error as { code: string }).code}.`);
  console.error("Catalog command refused or failed; verify the dataset, raw snapshot, target database, migrations and warehouse. No private values disclosed.");
  process.exitCode ??= 1;
}
