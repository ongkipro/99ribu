// Admin console detail URLs. Every admin detail page is addressed by the entity's `admin_no` (a short, stable,
// immutable number), never by its UUID; the API under /api/v1/admin keeps taking UUIDs. Pure and client-safe:
// links, redirects and the server-side canonical redirect all build their path here.
//
// No path here ever carries a user or auth_user id. Staff and buyers are addressed by username (none of them has a
// detail route yet); a user UUID in an admin URL is a defect.
export type AdminNumberKind =
	| "order"
	| "product"
	| "warehouse"
	| "return"
	| "refund"
	| "exception"
	| "payout"
	| "reconciliation"
	| "affiliate";

const BASE: Record<AdminNumberKind, string> = {
	order: "/admin/pesanan",
	product: "/admin/produk",
	warehouse: "/admin/produk/gudang",
	return: "/admin/pesanan/retur",
	refund: "/admin/keuangan/refund",
	exception: "/admin/pesanan/kendala",
	payout: "/admin/keuangan/komisi",
	reconciliation: "/admin/keuangan/rekonsiliasi",
	affiliate: "/admin/afiliasi",
};

/**
 * A well-formed UUID reserved for unresolved numbers. A missing or out-of-scope number yields this same page payload;
 * missing or out-of-scope UUID parameters instead pass through unchanged, without redirect. Their API reads answer 404.
 */
export const UNKNOWN_ADMIN_ID = "00000000-0000-4000-8000-000000000000";

export function adminPath(kind: AdminNumberKind, adminNo: number): string {
	if (!Number.isSafeInteger(adminNo) || adminNo < 1) throw new RangeError("admin_no is a positive integer");
	return `${BASE[kind]}/${adminNo}`;
}

/** Same, for a link that may lack its number (a read model that could not resolve it): null means "no link". */
export function adminPathOrNull(kind: AdminNumberKind, adminNo: number | null | undefined): string | null {
	return typeof adminNo === "number" ? adminPath(kind, adminNo) : null;
}
