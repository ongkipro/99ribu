import { AdminWorkspacesClient } from "../../../components/admin/admin-workspaces-client";
import { consoleAccess } from "../../../components/admin/console-access";
import { canReadOrders } from "../../../components/admin/order-model";
import { redirect } from "next/navigation";
import { dashboardRoles, readStaffAccess } from "./staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Konsol Operasional · Admin 99ribu",
	robots: { index: false, follow: false },
};

export default async function AdminWorkspacesPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const [{ roles, permissions }, params] = await Promise.all([
		readStaffAccess(),
		searchParams,
	]);
	// S177: marketing has no work-queue dashboard; a marketing-only account starts at the Pemasaran hub.
	const staffRoles = dashboardRoles(roles);
	if (roles.length > 0 && staffRoles.length === 0) redirect("/admin/pemasaran");
	const workspace =
		typeof params.workspace === "string" ? params.workspace : null;
	const warehouseId =
		typeof params.warehouse_id === "string" ? params.warehouse_id : "";

	// Keyed so sidebar workspace links remount the client with fresh state.
	return (
		<AdminWorkspacesClient
			key={`${workspace ?? ""}:${warehouseId}`}
			initialAuthenticated={staffRoles.length > 0}
			initialStaffRoles={staffRoles}
			canOrders={canReadOrders(staffRoles, permissions)}
			access={consoleAccess(staffRoles, permissions)}
			requestedWorkspace={workspace}
			requestedWarehouseId={warehouseId}
		/>
	);
}
