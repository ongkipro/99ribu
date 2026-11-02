// S150: sort state shared by the list screens and the list APIs. No imports: client components use it too.
export type SortDir = "asc" | "desc";
export type SortState = { key: string; dir: SortDir };

/** Header press: another column starts ascending, ascending turns descending, descending returns to the default order. */
export function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, dir: "asc" };
  return current.dir === "asc" ? { key, dir: "desc" } : null;
}

/** `sort` and `dir` of a screen's URL, or null (default order) when absent or not in the screen's allow-list. */
export function readSortState(params: { get(name: string): string | null }, allowed: readonly string[], keyName = "sort", dirName = "dir"): SortState | null {
  const key = params.get(keyName);
  if (!key || !allowed.includes(key)) return null;
  return { key, dir: params.get(dirName) === "desc" ? "desc" : "asc" };
}

/** `{sort, dir}` entries for a URL or API query; empty for the default order. */
export function sortEntries(state: SortState | null, keyName = "sort", dirName = "dir"): Record<string, string> {
  return state ? { [keyName]: state.key, [dirName]: state.dir } : {};
}

/** aria-sort of a header cell. */
export function ariaSort(state: SortState | null, key: string): "ascending" | "descending" | "none" {
  return state?.key !== key ? "none" : state.dir === "asc" ? "ascending" : "descending";
}
