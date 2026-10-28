import type { Sql } from "postgres";
import { type AdminNumberKind, UNKNOWN_ADMIN_ID } from "./admin-paths.ts";
import { hasPermission, type Principal } from "./policy.ts";

// Classifies the route parameter of an admin detail page (the database half; admin-number-page.ts applies the Next
// outcome). The page hands the client the row's UUID; the API keeps addressing rows by UUID. It runs only after the page's own role gate, so a staff role without
// access to the area is denied exactly as before and never reaches a lookup.
//
// - canonical number (`1042`, no leading zero, at most 15 digits): an indexed read on the unique admin_no,
//   restricted by the same object scope as the entity's API read. Unknown and out-of-scope numbers both yield
//   UNKNOWN_ADMIN_ID: neither the page payload nor its API read distinguishes them.
// - UUID: 308 to the canonical numeric URL only when the row is readable in the caller's scope. Unknown and
//   out-of-scope UUIDs pass through unchanged, without revealing a number; the API read answers 404 to both.
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

// Keep these predicates aligned with finance/history.ts, returns/reads.ts (staffScope), exceptions/routes.ts
// (authorizeExceptionRead), access/routes.ts (warehouse detail), and catalog/catalog.ts (authority + assertScope).
function readScope(sql: Sql, principal: Principal, kind: AdminNumberKind) {
	const owner = principal.roles.includes("owner");
	const finance = owner || hasPermission(principal, "finance.refunds.read");
	switch (kind) {
		case "order":
			return sql`e.revision > 0 and (${owner} or (
				exists(select 1 from app.order_shipment s where s.order_id=e.id)
				and not exists(select 1 from app.order_shipment s where s.order_id=e.id
					and not (s.warehouse_id=any(${principal.warehouseIds}::uuid[])))
				and not exists(select 1 from app.replacement_shipment s join app.return_case c on c.id=s.case_id
					where c.order_id=e.id and not (s.warehouse_id=any(${principal.warehouseIds}::uuid[])))))`;
		case "return":
			return sql`(${finance} or exists(select 1 from app.return_item scoped
				join app.fulfillment_item f on f.id=scoped.fulfillment_item_id
				join app.order_shipment s on s.id=f.shipment_id
				left join app.replacement_link link on link.id=scoped.replacement_link_id
				left join app.replacement_shipment parcel on parcel.id=link.shipment_id
				where scoped.case_id=e.id and coalesce(parcel.warehouse_id,s.warehouse_id)=any(${principal.warehouseIds}::uuid[])))`;
		case "exception": {
			const warehouses = sql`select coalesce(replacement.warehouse_id,original.warehouse_id) warehouse_id
				from app.exception_unit u join app.fulfillment_item f on f.id=u.fulfillment_item_id
				join app.order_shipment original on original.id=f.shipment_id
				left join app.replacement_link link on link.id=u.replacement_link_id
				left join app.replacement_shipment replacement on replacement.id=link.shipment_id
				where u.exception_id=e.id
				union all
				select s.warehouse_id from app.order_shipment s where s.order_id=e.order_id and e.kind='unallocated_collection'
					and (e.source_kind='payment_event' or (e.source_kind='cod_event' and exists(
						select 1 from app.local_cod_event event join app.local_cod_operation operation on operation.id=event.operation_id
						where event.id=e.source_id and operation.shipment_id=s.id)))`;
			return sql`e.status<>'preparing' and exists(select 1 from (${warehouses}) scoped)
				and (${finance} or not exists(select 1 from (${warehouses}) scoped
					where not (scoped.warehouse_id=any(${principal.warehouseIds}::uuid[]))))`;
		}
		case "warehouse":
			return sql`e.active and (${owner} or exists(select 1 from app.warehouse_membership m
				where m.user_id=${principal.id} and m.warehouse_id=e.id))`;
		case "product":
			return sql`exists(select 1 from app.product_revision r where r.product_id=e.id and r.revision=e.revision)
				and (${owner || hasPermission(principal, "finance.costs.read")} or not exists(
					select 1 from app.offer_revision v where v.product_id=e.id and v.revision=e.revision and not v.retired
						and not (v.default_warehouse_id=any(${principal.warehouseIds}::uuid[]))))`;
		default:
			// Finance and affiliate detail pages have role/permission gates, not object-level warehouse scope.
			return sql`true`;
	}
}

/** The database half of the resolver (no framework): classifies one route parameter. */
export async function classifyAdminParam(sql: Sql, principal: Principal, kind: AdminNumberKind, param: string): Promise<AdminParam> {
	if (!NUMBER.test(param) && !UUID.test(param)) return { kind: "missing" };
	const table = sql(`app.${TABLE[kind]}`);
	const scope = readScope(sql, principal, kind);
	if (NUMBER.test(param)) {
		const [row] = await sql<{ id: string }[]>`select e.id from ${table} e where e.admin_no = ${param}::bigint and ${scope}`;
		return { kind: "id", id: row?.id ?? UNKNOWN_ADMIN_ID };
	}
	if (UUID.test(param)) {
		const id = param.toLowerCase();
		const [row] = await sql<{ admin_no: string }[]>`select e.admin_no::text as admin_no from ${table} e where e.id = ${id}::uuid and ${scope}`;
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
