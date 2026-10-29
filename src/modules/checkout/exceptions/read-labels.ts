import type { Sql, TransactionSql } from "postgres";

type Projection = Record<string, unknown> & {
	id: string;
	order_id: string;
	units: (Record<string, unknown> & {
		order_item_id: string;
		warehouse_id: string;
	})[];
};

// Display references for the staff GET list/detail only. Mutation responses stay the
// exact sealed projection (replays compare them byte for byte), so these labels are
// attached after the authorized projection and never stored. A reader of a case already
// holds every affected warehouse; the printed order number and the purchased offer's
// snapshot name carry no contact, address or money. The admin numbers (this case and its order) are the handles
// the console links by; they are display data too and are never part of a sealed projection.
export async function labelExceptions(
	tx: TransactionSql,
	sealed: Record<string, unknown>[],
) {
	const projections = sealed as Projection[];
	if (!projections.length) return projections;
	const orderIds = [...new Set(projections.map((row) => row.order_id))];
	const itemIds = [
		...new Set(projections.flatMap((row) => row.units.map((u) => u.order_item_id))),
	];
	const warehouseIds = [
		...new Set(projections.flatMap((row) => row.units.map((u) => u.warehouse_id))),
	];
	const orders = new Map(
		(
			await tx<{ id: string; number: string; admin_no: string }[]>`
        select id,number,admin_no from app.commerce_order where id in ${tx(orderIds)}`
		).map((row) => [row.id, row]),
	);
	const cases = new Map(
		(
			await tx<{ id: string; admin_no: string }[]>`
        select id,admin_no from app.commerce_exception where id in ${tx(projections.map((row) => row.id))}`
		).map((row) => [row.id, Number(row.admin_no)]),
	);
	const items = itemIds.length
		? new Map(
				(
					await tx<
						{
							id: string;
							product_name: string | null;
							variant_label: string | null;
						}[]
					>`
            select id,snapshot->>'name' product_name,snapshot->'offer'->>'label' variant_label
              from app.order_item where id in ${tx(itemIds)}`
				).map((row) => [row.id, row]),
			)
		: new Map();
	const warehouses = warehouseIds.length
		? new Map(
				(
					await tx<{ id: string; name: string }[]>`
            select id,name from app.warehouse where id in ${tx(warehouseIds)}`
				).map((row) => [row.id, row.name]),
			)
		: new Map();
	return projections.map((row) => ({
		...row,
		admin_no: cases.get(row.id) ?? null,
		order_number: orders.get(row.order_id)?.number ?? null,
		order_admin_no: orders.has(row.order_id) ? Number(orders.get(row.order_id)?.admin_no) : null,
		units: row.units.map((unit) => ({
			...unit,
			product_name: items.get(unit.order_item_id)?.product_name ?? null,
			variant_label: items.get(unit.order_item_id)?.variant_label ?? null,
			warehouse_name: warehouses.get(unit.warehouse_id) ?? null,
		})),
	}));
}

/** A just-created case answers with its admin number so the console can open `/admin/pesanan/kendala/{admin_no}`. */
export async function numberException(sql: Sql, created: Record<string, unknown>) {
	const [row] = await sql<{ admin_no: string }[]>`select admin_no from app.commerce_exception where id=${String(created.id)}`;
	return row ? { ...created, admin_no: Number(row.admin_no) } : created;
}
