import type { TransactionSql } from "postgres";
import { id, invalid } from "./validation.ts";
import type { SortDir } from "./sort-state.ts";

// S150: server-side sort of an admin list with a keyset cursor. The cursor is opaque and carries no
// authority (every page re-checks the grant); it encodes the sort tuple (column key, direction, value,
// id) so a cursor made for another sort is rejected, never silently misread. Without `sort` a list
// keeps its default order and its plain id cursor. Every sortable column is NOT NULL, so the tuple
// comparison needs no null handling; `id` breaks ties, in the same direction as the column.
export type SortKind = "text" | "int" | "stamp";
/** Allow-list of one list: sort key -> SQL column (trusted constant, may be qualified) and value type. */
export type SortColumns = Readonly<Record<string, { column: string; kind: SortKind }>>;
export type Sorting = { key: string; dir: SortDir; column: string; kind: SortKind };
export type SortPosition = { value: string; id: string };

const STAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/;
const checkValue = (kind: SortKind, value: unknown) => {
  if (typeof value !== "string" || !value.isWellFormed() || value.includes("\0") || value.length > 400) throw invalid();
  if (kind === "int" && !/^-?\d{1,18}$/.test(value)) throw invalid();
  if (kind === "stamp" && !STAMP.test(value)) throw invalid();
  return value;
};

/** `sort` and `dir` query parameters against the allow-list; null when `sort` is absent (`dir` alone is invalid). */
export function readSorting(params: URLSearchParams, columns: SortColumns): Sorting | null {
  const key = params.get("sort");
  const dir = params.get("dir");
  if (key === null) {
    if (dir !== null) throw invalid();
    return null;
  }
  if (!Object.hasOwn(columns, key) || (dir !== null && dir !== "asc" && dir !== "desc")) throw invalid();
  return { key, dir: dir ?? "asc", ...columns[key] };
}

/** `extra` is mixed into the payload (orders bind their filter fingerprint here); it must match on read. */
export function encodeSortCursor(sorting: Sorting, value: string, rowId: string, extra = ""): string {
  return Buffer.from(JSON.stringify({ s: sorting.key, d: sorting.dir, v: value, id: rowId, h: extra })).toString("base64url");
}

/** Position of a sorted page; null without a cursor. Throws 400 when the cursor was made for another sort or filter set. */
export function readSortCursor(raw: string | null, sorting: Sorting, extra = ""): SortPosition | null {
  if (raw === null) return null;
  if (!/^[A-Za-z0-9_-]{1,2000}$/.test(raw)) throw invalid();
  try {
    const p = JSON.parse(Buffer.from(raw, "base64url").toString());
    const keys = p && typeof p === "object" && !Array.isArray(p) ? Object.keys(p).sort().join() : "";
    if (keys !== "d,h,id,s,v" || p.s !== sorting.key || p.d !== sorting.dir || p.h !== extra) throw invalid();
    return { value: checkValue(sorting.kind, p.v), id: id(p.id) };
  } catch {
    throw invalid();
  }
}

/** Cursor of a page fetched with limit+1 rows, each carrying `sort_key` and `id`; null on the last page. */
export function nextSortCursor(sorting: Sorting, rows: readonly { sort_key: string; id: string }[], limit: number, extra = ""): string | null {
  const last = rows.length > limit ? rows[limit - 1] : null;
  return last ? encodeSortCursor(sorting, last.sort_key, String(last.id), extra) : null;
}

/** `<column>::text as sort_key`, to select beside the row (timestamps as the microsecond UTC stamp). */
export function sortKeySelect(tx: TransactionSql, sorting: Sorting, column = sorting.column) {
  return sorting.kind === "stamp"
    ? tx`to_char(${tx(column)} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as sort_key`
    : tx`${tx(column)}::text as sort_key`;
}

/** WHERE condition: rows after the cursor in the sorted order (true without a cursor). */
export function afterSortPosition(tx: TransactionSql, sorting: Sorting, idColumn: string, position: SortPosition | null) {
  if (!position) return tx`true`;
  const value = sorting.kind === "int" ? tx`${position.value}::bigint` : sorting.kind === "stamp" ? tx`${position.value}::timestamptz` : tx`${position.value}::text`;
  return tx`(${tx(sorting.column)},${tx(idColumn)}) ${sorting.dir === "asc" ? tx`>` : tx`<`} (${value},${position.id}::uuid)`;
}

/** ORDER BY body: the column, then the id as tie-breaker, both in the chosen direction (`column` when the sort runs over an outer select's output name). */
export function sortOrder(tx: TransactionSql, sorting: Sorting, idColumn: string, column = sorting.column) {
  const dir = sorting.dir === "asc" ? tx`asc` : tx`desc`;
  return tx`${tx(column)} ${dir}, ${tx(idColumn)} ${dir}`;
}

/** Cursor of a list in either mode: a sort cursor under `sorting`, the plain id cursor of the default order otherwise. */
export function listCursor(raw: string | null, sorting: Sorting | null, extra = ""): { id: string | null; position: SortPosition | null } {
  if (sorting) return { id: null, position: readSortCursor(raw, sorting, extra) };
  return { id: raw === null ? null : id(raw), position: null };
}
