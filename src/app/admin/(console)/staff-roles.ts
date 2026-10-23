import { cache } from "react";
import type { CanonicalWorkspace } from "../../../components/admin/admin-workspaces-client";
import { getLocalAuth } from "../../../modules/access/auth";
import { getPrincipal } from "../../../modules/access/policy";
import { storefrontRequest } from "../../../modules/storefront/browser";

const STAFF_ROLES: CanonicalWorkspace[] = [
	"owner",
	"ecommerce_admin",
	"warehouse",
	"customer_service",
	"finance",
];

/** Staff roles and granted permissions of the current principal; empty when signed out. Deduped per request. */
export const readStaffAccess = cache(
	async (): Promise<{ roles: CanonicalWorkspace[]; permissions: string[] }> => {
		try {
			const req = await storefrontRequest("GET", "/admin");
			const principal = await getPrincipal(req, getLocalAuth());
			return {
				roles: principal.roles.filter((r): r is CanonicalWorkspace =>
					STAFF_ROLES.includes(r as CanonicalWorkspace),
				),
				permissions: [...principal.permissions],
			};
		} catch {
			return { roles: [], permissions: [] };
		}
	},
);
