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
const [command, ...args] = process.argv.slice(2);
const usage = "Use: catalog dataset [out-dir] | catalog import local|test [dataset-dir] | catalog initial-stock local|test [dataset-dir] | catalog rehome local|test [--apply] | catalog withdraw local|test [--apply].";
const rawDirectory = () => {
  const directory = process.env.BERLAPAK_DATA_DIR || "/data/99ribu-berlapak-data";
  if (!existsSync(`${directory}/data-json`) || !existsSync(`${directory}/images`)) throw new Error(`Berlapak data directory not found: ${directory}. Set BERLAPAK_DATA_DIR.`, { cause: "visible" });
  return directory;
};
try {
  const { CatalogDatasetError } = await import("../src/modules/catalog/dataset.ts");
  const visible = (error: unknown) => { if (error instanceof CatalogDatasetError) throw new Error(error.message, { cause: "visible" }); throw error; };
  if (command === "dataset" && args.length <= 1) {
    const directory = rawDirectory();
    const { defaultDatasetDir, writeBerlapakDataset } = await import("../src/modules/local/berlapak-dataset.ts");
    console.log(JSON.stringify(writeBerlapakDataset(directory, args[0] ? resolve(args[0]) : defaultDatasetDir)));
  } else if (command === "import" && ["local", "test"].includes(args[0]) && (args.length === 1 || args.length === 2)) {
    const { importCatalog, readCatalogDataset } = await import("../src/modules/catalog/dataset.ts");
    const { defaultDatasetDir } = await import("../src/modules/local/berlapak-dataset.ts");
    const dataset = (() => { try { return readCatalogDataset(args[1] ? resolve(args[1]) : defaultDatasetDir); } catch (error) { return visible(error); } })();
    const { withSeedOwner } = await import("../src/modules/local/seed-runtime.ts");
    const summary = await withSeedOwner(args[0] as "local" | "test", "catalog-import", (request, identity, signal) =>
      importCatalog(request, identity, dataset, { signal }).catch(visible));
    console.log(JSON.stringify(summary));
  } else if (command === "initial-stock" && ["local", "test"].includes(args[0]) && (args.length === 1 || args.length === 2)) {
    const sourceDir = rawDirectory();
    const { loadInitialStock } = await import("../src/modules/local/berlapak-dataset.ts");
    const { withSeedOwner } = await import("../src/modules/local/seed-runtime.ts");
    const summary = await withSeedOwner(args[0] as "local" | "test", "catalog-stock", (request, identity, signal) =>
      loadInitialStock(request, identity, { sourceDir, datasetDir: args[1] ? resolve(args[1]) : undefined, signal }).catch(visible));
    console.log(JSON.stringify(summary));
  } else if (command === "rehome" && ["local", "test"].includes(args[0]) && (args.length === 1 || (args.length === 2 && args[1] === "--apply"))) {
    const { readCatalogDocument } = await import("../src/modules/catalog/dataset.ts");
    const { applyOriginTransition, defaultDatasetDir, planOriginTransition, summarizeTransition } = await import("../src/modules/local/berlapak-dataset.ts");
    const catalog = (() => { try { return readCatalogDocument(defaultDatasetDir); } catch (error) { return visible(error); } })();
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
  } else if (command === "withdraw" && ["local", "test"].includes(args[0]) && (args.length === 1 || (args.length === 2 && args[1] === "--apply"))) {
    const { readCatalogDocument, summarizeCandidates, withdrawCandidates, withdrawalCandidates } = await import("../src/modules/catalog/dataset.ts");
    const { defaultDatasetDir } = await import("../src/modules/local/berlapak-dataset.ts");
    const keep = (() => { try { return readCatalogDocument(defaultDatasetDir).products.flatMap((p) => p.offers.map((o) => o.sku)); } catch (error) { return visible(error); } })();
    const target = args[0] as "local" | "test";
    if (args[1] !== "--apply") {
      // Dry run is a read-only query: no temporary operator, no write.
      const { connectDatabase } = await import("../src/db/client.ts");
      const { sql } = connectDatabase(target);
      try { console.log(JSON.stringify({ mode: "dry-run", target, ...summarizeCandidates(await sql.begin("read only", (tx) => withdrawalCandidates(tx, keep))) })); }
      finally { await sql.end(); }
    } else {
      const { withSeedOwner } = await import("../src/modules/local/seed-runtime.ts");
      const summary = await withSeedOwner(target, "catalog-withdraw", async (request, identity, signal) => {
        const candidates = await withdrawalCandidates(identity.sql, keep);
        return { mode: "apply", target, ...summarizeCandidates(candidates),
          ...(await withdrawCandidates(request, identity, candidates, "Owner decision 2026-10-22: public storefront shows only the DEC-005 catalog", signal)) };
      });
      console.log(JSON.stringify(summary));
    }
  } else { console.error(usage); process.exitCode = 1; }
} catch (error) {
  if (error instanceof Error && error.cause === "visible") console.error(error.message);
  console.error("Catalog command refused or failed; verify the dataset, raw snapshot, target database, migrations and warehouse. No private values disclosed.");
  process.exitCode ??= 1;
}
