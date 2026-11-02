import type { TransactionSql } from "postgres";
import type { LocalAuth } from "../access/auth.ts";
import { privateJson } from "../access/http.ts";
import { AccessError, type Principal } from "../access/policy.ts";
import { invalid } from "../catalog/validation.ts";
import { projectBuyerReturn } from "../returns/cases.ts";
import { parsePagination } from "./shared.ts";

// Orders the buyer owns or has claimed with a verified guest-order link (same rule as the order history):
// an unclaimed guest order never reaches this list (DEC-016).
const ownedOrder = (tx: TransactionSql, userId: string) => tx`(o.owner_user_id = ${userId} or exists (
	select 1 from app.buyer_identity_challenge c
	where c.user_id = ${userId} and c.kind = 'guest_order_link' and c.status = 'verified' and c.order_id = o.id))`;

export type BuyerReturnSummary = Awaited<ReturnType<typeof projectBuyerReturn>> & { order_number: string; product_names: string[] };
export type BuyerReturnList = { data: BuyerReturnSummary[]; pagination: { next_cursor: string | null } };

// The buyer projection of every return and replacement case on the buyer's own orders, newest first.
// projectBuyerReturn is the same staff-free projection the per-order endpoint serves; this adds only the
// order number and the product names so the list needs no second request.
export async function readBuyerReturnList(tx: TransactionSql, userId: string, paging: { limit: number; cursor: string | null }): Promise<BuyerReturnList> {
	const [position] = paging.cursor
		? await tx<{ stamp: string }[]>`select c.recorded_at::text stamp from app.return_case c join app.commerce_order o on o.id = c.order_id where c.id = ${paging.cursor} and ${ownedOrder(tx, userId)}`
		: [];
	if (paging.cursor && !position) throw invalid();
	const rows = await tx<{ id: string; number: string }[]>`
		select c.id, o.number from app.return_case c join app.commerce_order o on o.id = c.order_id
		where ${ownedOrder(tx, userId)}
			and (${paging.cursor}::uuid is null or (c.recorded_at, c.id) < (${position?.stamp ?? null}::timestamptz, ${paging.cursor}::uuid))
		order by c.recorded_at desc, c.id desc limit ${paging.limit + 1}`;
	const chosen = rows.slice(0, paging.limit);
	const data: BuyerReturnSummary[] = [];
	for (const row of chosen) {
		const projected = await projectBuyerReturn(tx, row.id);
		const ids = [...new Set(projected.items.map((item) => item.order_item_id))];
		const names = ids.length ? await tx<{ name: string }[]>`select distinct snapshot->>'name' as name from app.order_item where id in ${tx(ids)}` : [];
		data.push({ ...projected, order_number: row.number, product_names: names.map((n) => n.name).sort() });
	}
	return { data, pagination: { next_cursor: rows.length > paging.limit ? String(chosen.at(-1)?.id) : null } };
}

export async function handleBuyerReturnRoutes(request: Request, identity: LocalAuth, url: URL, principal: Principal): Promise<Response | undefined> {
	if (url.pathname !== "/api/v1/me/returns") return undefined;
	if (request.method !== "GET") throw new AccessError(404, "NOT_FOUND");
	return privateJson(await identity.sql.begin((tx) => readBuyerReturnList(tx, principal.id, parsePagination(url))), 200);
}
