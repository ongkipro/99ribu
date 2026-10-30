import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { privateDirectory } from "../../config/local.ts";
import { connectDatabase, type DatabaseTarget } from "../../db/client.ts";

// S87 read-only release check (`catalog verify <target>`): the counts RELEASE.md step 10 compares with the import
// and initial-stock summaries, in one read-only transaction, plus every stored catalog photo hashing to its name.
export async function verifyCatalog(target: DatabaseTarget) {
  const { sql } = connectDatabase(target);
  try {
    const [counts] = await sql.begin("read only", (tx) => tx`select
      (select count(*)::int from app.category) as categories,
      (select count(*)::int from app.warehouse where origin_key is not null) as origin_warehouses,
      (select count(*)::int from app.stock_item where sku like 'B99\\_%') as stock_items,
      (select count(*)::int from app.offer where sku like 'B99\\_%\\_OFFER') as offers,
      (select count(*)::int from app.stock_movement m join app.inventory_balance b on b.id=m.balance_id join app.stock_item s on s.id=b.stock_item_id where m.kind='receive' and s.sku like 'B99\\_%') as receive_movements,
      (select count(*)::int from app.component_cost_version c join app.stock_item s on s.id=c.stock_item_id where s.sku like 'B99\\_%') as cost_versions,
      (select count(*)::int from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
        where not exists (select 1 from app.publication_withdrawal w where w.publication_id=v.id)) as published_products`);
    const directory = privateDirectory("catalog-media");
    const names = (await readdir(directory)).filter((name) => name.endsWith(".webp"));
    let mismatched = 0;
    for (const name of names) if (createHash("sha256").update(await readFile(join(directory, name))).digest("hex") !== name.slice(0, -5)) mismatched++;
    return { target, ...counts, photo_files: names.length, photo_hash_mismatches: mismatched };
  } finally {
    await sql.end();
  }
}
