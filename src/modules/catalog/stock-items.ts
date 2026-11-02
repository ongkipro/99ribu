import type { LocalAuth } from "../access/auth.ts";
import type { Principal } from "../access/policy.ts";
import { authority } from "./catalog.ts";
import { afterSortPosition, listCursor, nextSortCursor, readSorting, type SortColumns, sortKeySelect, sortOrder } from "./sort.ts";
import { integer, invalid } from "./validation.ts";

// S150: the physical-SKU dictionary list. Sortable by code or name; `q` is a literal, case-insensitive
// substring of either, applied over the whole dictionary (not only the rows a screen has loaded).
export const STOCK_ITEM_SORT: SortColumns = {
  sku: { column: "sku", kind: "text" },
  name: { column: "name", kind: "text" },
};

function stockItemInput(url: URL) {
  if ([...url.searchParams.keys()].some((key) => !["cursor", "limit", "q", "sort", "dir"].includes(key) || url.searchParams.getAll(key).length !== 1)) throw invalid();
  const raw = url.searchParams.get("limit") ?? "20";
  if (!/^\d{1,3}$/.test(raw)) throw invalid();
  const q = url.searchParams.get("q");
  if (q !== null && (!q.isWellFormed() || q.includes("\0") || !q.trim() || Array.from(q).length > 100)) throw invalid();
  const sorting = readSorting(url.searchParams, STOCK_ITEM_SORT);
  const cursor = listCursor(url.searchParams.get("cursor"), sorting);
  return {
    limit: integer(Number(raw), 1, 100),
    sorting,
    cursor: cursor.id,
    position: cursor.position,
    pattern: q === null ? null : `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
  };
}

export async function listStockItems(identity: LocalAuth, principal: Principal, url: URL) {
  const page = stockItemInput(url);
  return identity.sql.begin(async (tx) => {
    // The physical-SKU dictionary stays with catalog editors (read=false).
    await authority(tx, principal, false);
    const rows = await tx`select id,sku,name${page.sorting ? tx`, ${sortKeySelect(tx, page.sorting)}` : tx``} from app.stock_item
      where (${page.cursor}::uuid is null or id>${page.cursor}::uuid)
        and ${page.sorting ? afterSortPosition(tx, page.sorting, "id", page.position) : tx`true`}
        and (${page.pattern}::text is null or sku ilike ${page.pattern} or name ilike ${page.pattern})
      order by ${page.sorting ? sortOrder(tx, page.sorting, "id") : tx`id`} limit ${page.limit + 1}`;
    const data = rows.slice(0, page.limit).map((row) => ({ id: row.id as string, sku: row.sku as string, name: row.name as string }));
    return {
      data,
      pagination: { next_cursor: page.sorting ? nextSortCursor(page.sorting, rows as unknown as { sort_key: string; id: string }[], page.limit) : rows.length > page.limit ? data[page.limit - 1].id : null },
    };
  });
}
