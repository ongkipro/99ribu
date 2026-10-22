import { AdminWorkspacesClient } from "../../../components/admin/admin-workspaces-client";
import { readStaffRoles } from "./staff-roles";

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
	const [staffRoles, params] = await Promise.all([
		readStaffRoles(),
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
			requestedWorkspace={workspace}
			requestedWarehouseId={warehouseId}
		/>
	);
}
