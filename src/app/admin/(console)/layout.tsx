import type { Viewport } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "./admin.css";
import { AdminShell } from "../../../components/admin/admin-shell";
import type { CanonicalWorkspace } from "../../../components/admin/admin-workspaces-client";
import { readRuntimeConfig } from "../../../config/runtime";
import { getLocalAuth } from "../../../modules/access/auth";
import {
	CONSOLE_PATH_HEADER,
	consoleSignInRedirect,
} from "../../../modules/access/return-to";
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
	const requestHeaders = await headers();
	const session = await getLocalAuth()
		.auth.api.getSession({
			headers: requestHeaders,
			query: { disableCookieCache: true },
		})
		.catch(() => null);
	const user = session?.user.emailVerified ? session.user : null;
	// Spec 17 (S128): production sends a signed-out request to sign-in; local/test keep the preview.
	const signIn = consoleSignInRedirect(
		readRuntimeConfig().profile,
		user !== null,
		requestHeaders.get(CONSOLE_PATH_HEADER),
	);
	if (signIn) redirect(signIn);
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
				account={user && { name: user.name, email: user.email }}
			>
				{children}
			</AdminShell>
		</div>
	);
}
