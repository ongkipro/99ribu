import { AdminWorkspacesClient } from "../../../components/admin/admin-workspaces-client";
import { canReadOrders } from "../../../components/admin/order-model";
import { readStaffAccess } from "./staff-roles";

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
	const [{ roles: staffRoles, permissions }, params] = await Promise.all([
		readStaffAccess(),
		searchParams,
	]);
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
			requestedWorkspace={workspace}
			requestedWarehouseId={warehouseId}
		/>
	);
}
