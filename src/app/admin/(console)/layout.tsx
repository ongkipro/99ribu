import type { Viewport } from "next";
import "./admin.css";
import { AdminShell } from "../../../components/admin/admin-shell";
import type { CanonicalWorkspace } from "../../../components/admin/admin-workspaces-client";
import { AdminSessionBar } from "./session-bar";
import { readStaffAccess } from "./staff-roles";

// Console only (the storefront keeps the root viewport): safe-area insets apply to the sticky
// bars and page gutters (admin.css).
export const viewport: Viewport = { viewportFit: "cover" };

const ALL_WORKSPACES: CanonicalWorkspace[] = [
	"owner",
	"ecommerce_admin",
	"warehouse",
	"customer_service",
	"finance",
];

// Navigation only; every page and API re-checks authorization server-side.
export default async function AdminConsoleLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const { roles, permissions } = await readStaffAccess();
	// Owner and the signed-out local preview see every workspace (unchanged S08 behavior).
	const workspaces =
		roles.length === 0 || roles.includes("owner")
			? ALL_WORKSPACES
			: ALL_WORKSPACES.filter((ws) => roles.includes(ws));
	return (
		<div className="admin-app">
			<AdminShell
				workspaces={workspaces}
				roles={roles}
				permissions={permissions}
			>
				<AdminSessionBar />
				{children}
			</AdminShell>
		</div>
	);
}
