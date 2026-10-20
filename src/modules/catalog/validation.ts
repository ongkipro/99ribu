import { AccessError } from "../access/policy.ts";

export const invalid = () => new AccessError(400, "INVALID_INPUT");
export function object(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !fields.includes(key))) throw invalid();
  return value as Record<string, unknown>;
}
export function text(value: unknown, maximum: number, empty = false) {
  if (typeof value !== "string" || !value.isWellFormed() || value.includes("\0") || Array.from(value).length > maximum || (!empty && !value.trim())) throw invalid();
  return empty ? value : value.trim();
}
export function integer(value: unknown, minimum: number, maximum = 2147483647) {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw invalid();
  return Number(value);
}
export function id(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw invalid();
  return value.toLowerCase();
}
export function sku(value: unknown) {
  if (typeof value !== "string" || !/^[A-Z0-9_-]{1,100}$/.test(value)) throw invalid();
  return value;
}
export function array<T>(value: unknown, parse: (value: unknown) => T, minimum = 0, maximum = 100): T[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw invalid();
  return value.map(parse);
}
export function image(value: unknown) {
  const data = object(value, ["url", "alt", "width", "height"]);
  const raw = text(data.url, 2000);
  if (raw !== data.url || /[^\x21-\x7e]/.test(raw)) throw invalid();
  let url: URL; try { url = new URL(raw); } catch { throw invalid(); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw invalid();
  return { url: url.href, alt: text(data.alt, 500), width: integer(data.width, 1, 20000), height: integer(data.height, 1, 20000) };
}
export function attributes(value: unknown) {
  const rows = array(value, (value) => {
    const data = object(value, ["key", "label", "values"]); const key = text(data.key, 100);
    if (key !== data.key || !/^[a-z][a-z0-9_]*$/.test(key)) throw invalid();
    const values = array(data.values, (v) => text(v, 500), 1, 50);
    if (new Set(values).size !== values.length) throw invalid();
    return { key, label: text(data.label, 200), values };
  }, 0, 50);
  if (new Set(rows.map((v) => v.key)).size !== rows.length) throw invalid();
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}
export function definitions(value: unknown) {
  const rows = array(value, (value) => {
    const data = object(value, ["key", "label", "value_type", "required", "allowed_values"]);
    const key = text(data.key, 100);
    if (key !== data.key || !/^[a-z][a-z0-9_]*$/.test(key) || typeof data.value_type !== "string" || !["text", "number", "boolean", "enum"].includes(data.value_type) || typeof data.required !== "boolean") throw invalid();
    const allowed = array(data.allowed_values, (v) => text(v, 500), 0, 50);
    if ((data.value_type === "enum") !== (allowed.length > 0) || new Set(allowed).size !== allowed.length) throw invalid();
    return { key, label: text(data.label, 200), value_type: data.value_type, required: data.required, allowed_values: allowed };
  }, 0, 50);
  if (new Set(rows.map((v) => v.key)).size !== rows.length) throw invalid();
  return rows.sort((a, b) => a.key.localeCompare(b.key));
}
export function offerInput(value: unknown, create: boolean) {
  const fields = ["label", "attributes", "weight_grams", "length_mm", "width_mm", "height_mm", "default_warehouse_id", "offer_kind", "contents", "image"];
  const data = object(value, create ? [...fields, "sku"] : fields);
  const contents = array(data.contents, (value) => {
    const row = object(value, ["stock_item_id", "name", "quantity"]);
    return { stock_item_id: id(row.stock_item_id), name: text(row.name, 200), quantity: integer(row.quantity, 1, 1000000) };
  }, 1);
  if (new Set(contents.map((v) => v.stock_item_id)).size !== contents.length) throw new AccessError(422, "DUPLICATE_COMPONENT");
  const kind = data.offer_kind;
  if (typeof kind !== "string" || !["unit", "multipack", "bundle"].includes(kind)) throw invalid();
  if ((kind === "unit" && (contents.length !== 1 || contents[0].quantity !== 1)) ||
    (kind === "multipack" && (contents.length !== 1 || contents[0].quantity < 2)) || (kind === "bundle" && contents.length < 2)) throw invalid();
  return { ...(create ? { sku: sku(data.sku) } : {}), label: text(data.label, 200), attributes: attributes(data.attributes),
    weight_grams: integer(data.weight_grams, 1, 1000000), length_mm: integer(data.length_mm, 1, 10000),
    width_mm: integer(data.width_mm, 1, 10000), height_mm: integer(data.height_mm, 1, 10000),
    default_warehouse_id: id(data.default_warehouse_id), offer_kind: kind,
    contents: contents.sort((a, b) => a.stock_item_id.localeCompare(b.stock_item_id)), image: data.image === undefined ? null : image(data.image) };
}
export function pageInput(url: URL) {
  if ([...url.searchParams.keys()].some((key) => !["cursor", "limit"].includes(key) || url.searchParams.getAll(key).length !== 1)) throw invalid();
  const raw = url.searchParams.get("limit") ?? "20";
  if (!/^\d{1,3}$/.test(raw)) throw invalid();
  return { limit: integer(Number(raw), 1, 100), cursor: url.searchParams.has("cursor") ? id(url.searchParams.get("cursor")) : null };
}
