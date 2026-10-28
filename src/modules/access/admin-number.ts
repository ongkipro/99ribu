import type { Sql } from "postgres";
import { type AdminNumberKind, UNKNOWN_ADMIN_ID } from "./admin-paths.ts";

// Classifies the route parameter of an admin detail page (the database half; admin-number-page.ts applies the Next
// outcome). The page hands the client the row's UUID; the API keeps addressing rows by UUID. It runs only after the page's own role gate, so a staff role without
// access to the area is denied exactly as before and never reaches a lookup.
//
// - canonical number (`1042`, no leading zero, at most 15 digits): one indexed read on the unique admin_no.
//   An unknown number yields UNKNOWN_ADMIN_ID, a well-formed id that no row has: the page then renders exactly what
//   it renders for a UUID the API cannot find or a row outside the caller's scope (the API answers 404 to both), so
//   a scoped staff role cannot tell "no such number" from "not yours" by the page.
// - UUID: 308 to the canonical numeric URL, so old bookmarks and notification links keep working. An unknown UUID
//   keeps the old behaviour (the API's 404 state). The redirect shows the number to someone who already holds the
//   row's 128-bit id, which is no new information.
// - anything else (`abc`, `007`, `1e3`, a user id): not found, no lookup.
const TABLE: Record<AdminNumberKind, string> = {
	order: "commerce_order",
	product: "product",
	warehouse: "warehouse",
	return: "return_case",
	refund: "refund",
	exception: "commerce_exception",
	payout: "affiliate_payout",
	reconciliation: "provider_settlement",
	affiliate: "affiliate_account",
};

const NUMBER = /^[1-9][0-9]{0,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AdminParam =
	| { kind: "id"; id: string }
	| { kind: "redirect"; adminNo: number }
	| { kind: "missing" };

/** The database half of the resolver (no framework): classifies one route parameter. */
export async function classifyAdminParam(sql: Sql, kind: AdminNumberKind, param: string): Promise<AdminParam> {
	const table = sql(`app.${TABLE[kind]}`);
	if (NUMBER.test(param)) {
		const [row] = await sql<{ id: string }[]>`select id from ${table} where admin_no = ${param}::bigint`;
		return { kind: "id", id: row?.id ?? UNKNOWN_ADMIN_ID };
	}
	if (UUID.test(param)) {
		const id = param.toLowerCase();
		const [row] = await sql<{ admin_no: string }[]>`select admin_no::text as admin_no from ${table} where id = ${id}::uuid`;
		return row ? { kind: "redirect", adminNo: Number(row.admin_no) } : { kind: "id", id };
	}
	return { kind: "missing" };
}

/** Query string for the redirect from a Next `searchParams` record (only the keys a page actually reads). */
export function carrySearch(query: { [key: string]: string | string[] | undefined }, keys: readonly string[]): string {
	const kept = new URLSearchParams();
	for (const key of keys) {
		const value = query[key];
		if (typeof value === "string" && value) kept.set(key, value);
	}
	return kept.size ? `?${kept}` : "";
}
