import { AdminWorkspacesClient } from "../../../../components/admin/admin-workspaces-client";
import { consoleAccess } from "../../../../components/admin/console-access";
import { canReadOrders } from "../../../../components/admin/order-model";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Antrean Kerja · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Admin mobile pass: the full work queue behind the dashboard's "Lihat semua" (phones show the
// first rows only). Same client, data source and grants as the dashboard queue; the work-queue
// API re-checks the workspace, warehouse scope and filter token on every page.
export default async function AdminQueuePage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const [{ roles: staffRoles, permissions }, params] = await Promise.all([readStaffAccess(), searchParams]);
	const text = (key: string) => (typeof params[key] === "string" ? params[key] : null);
	const workspace = text("workspace");
	const warehouseId = text("warehouse_id") ?? "";

	return (
		<AdminWorkspacesClient
			key={`${workspace ?? ""}:${warehouseId}:${text("queue") ?? ""}:${text("metric") ?? ""}:${text("window") ?? ""}`}
			view="queue"
			initialAuthenticated={staffRoles.length > 0}
			initialStaffRoles={staffRoles}
			canOrders={canReadOrders(staffRoles, permissions)}
			access={consoleAccess(staffRoles, permissions)}
			requestedWorkspace={workspace}
			requestedWarehouseId={warehouseId}
			requestedQueue={text("queue")}
			requestedMetric={text("metric")}
			requestedWindow={text("window")}
		/>
	);
}
