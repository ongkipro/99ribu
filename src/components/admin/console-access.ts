// Console navigation and control gates for the staff roles and grants that readStaffAccess returns
// (a staff principal there already passed MFA). Mirrors modules/access/policy.ts hasPermission and
// the destination APIs; display only, every page and API re-checks. Shared by the server pages and
// the client shell, so this module must stay free of "use client" and server-only imports.
export type ConsoleAccess = {
	/** finance.reconciliation.read: Pembayaran and Setoran COD pages. */
	reconcileRead: boolean;
	/** finance.reconciliation.write: confirm transfers/payments and record COD statements. */
	reconcileWrite: boolean;
	/** exports.download: create and download CSV exports. */
	exportDownload: boolean;
	/** Manual fulfillment page. */
	ship: boolean;
	/** Label print center (documents/labels.ts assertLabel*Permission). */
	print: boolean;
	/** Customer support inbox. */
	support: boolean;
	/** Stok Gudang and Transfer Stok pages (inventory page guard). */
	inventory: boolean;
	/** Promo Ongkir page (promotions/shipping page guard). */
	shippingPromo: boolean;
};

export function consoleAccess(
	roles: readonly string[],
	permissions: readonly string[],
): ConsoleAccess {
	const owner = roles.includes("owner");
	const any = (...wanted: string[]) => wanted.some((r) => roles.includes(r));
	const finance = (permission: string) =>
		owner || (roles.includes("finance") && permissions.includes(permission));
	return {
		reconcileRead: finance("finance.reconciliation.read"),
		reconcileWrite: finance("finance.reconciliation.write"),
		exportDownload:
			owner || (roles.length > 0 && permissions.includes("exports.download")),
		ship: owner || any("ecommerce_admin", "warehouse"),
		// Owner decision (UI-controls audit #9): ecommerce_admin prints like the labels API allows.
		print: owner || any("warehouse", "ecommerce_admin"),
		support: owner || roles.includes("customer_service"),
		inventory: owner || any("ecommerce_admin", "warehouse"),
		shippingPromo: owner || roles.includes("ecommerce_admin"),
	};
}
