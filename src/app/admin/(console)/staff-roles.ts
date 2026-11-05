import { cache } from "react";
import type { ConsoleLens } from "../../../components/admin/admin-nav";
import type { CanonicalWorkspace } from "../../../components/admin/admin-workspaces-client";
import { getLocalAuth } from "../../../modules/access/auth";
import { getPrincipal } from "../../../modules/access/policy";
import { storefrontRequest } from "../../../modules/storefront/browser";

const STAFF_ROLES: ConsoleLens[] = [
	"owner",
	"ecommerce_admin",
	"marketing",
	"warehouse",
	"customer_service",
	"finance",
];

/** Roles that have a work-queue dashboard (Beranda); marketing (S177) has none. */
export const dashboardRoles = (roles: readonly ConsoleLens[]) =>
	roles.filter((r): r is CanonicalWorkspace => r !== "marketing");

/** Staff roles and granted permissions of the current principal; empty when signed out. Deduped per request. */
export const readStaffAccess = cache(
	async (): Promise<{ roles: ConsoleLens[]; permissions: string[] }> => {
		try {
			const req = await storefrontRequest("GET", "/admin");
			const principal = await getPrincipal(req, getLocalAuth());
			return {
				roles: principal.roles.filter((r): r is ConsoleLens =>
					STAFF_ROLES.includes(r as ConsoleLens),
				),
				permissions: [...principal.permissions],
			};
		} catch {
			return { roles: [], permissions: [] };
		}
	},
);
