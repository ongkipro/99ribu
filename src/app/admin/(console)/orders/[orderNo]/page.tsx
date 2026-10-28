import { AccessDenied } from "../../../../../components/admin/access-denied";
import { canReadOrders } from "../../../../../components/admin/order-model";
import { OrderDetailClient } from "../../../../../components/admin/orders-client";
import { carrySearch } from "@/modules/access/admin-number";
import { resolveAdminId } from "@/modules/access/admin-number-page";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Detail Pesanan · Admin 99ribu",
	robots: { index: false, follow: false },
};

export default async function AdminOrderDetailPage({
	params,
	searchParams,
}: {
	params: Promise<{ orderNo: string }>;
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const [{ roles, permissions }, { orderNo }, query] = await Promise.all([
		readStaffAccess(),
		params,
		searchParams,
	]);
	if (!canReadOrders(roles, permissions))
		return (
			<AccessDenied title="Detail Pesanan" heading="Akses riwayat pesanan diperlukan">
				Detail pesanan dapat dibuka oleh Super Admin, serta Admin E-Commerce, Layanan
				Pelanggan dan Keuangan yang memiliki izin baca riwayat pesanan. Staf gudang
				memakai antrean pengiriman gudangnya. Verifikasi dua langkah (MFA) harus aktif.
			</AccessDenied>
		);
	const orderId = await resolveAdminId("order", orderNo, carrySearch(query, ["dari"]));
	// `dari` carries the list search back (only the known search keys survive).
	const from = new URLSearchParams(typeof query.dari === "string" ? query.dari : "");
	const back = new URLSearchParams();
	for (const key of ["jenis", "cari"]) {
		const value = from.get(key);
		if (value) back.set(key, value.slice(0, 100));
	}
	// Never carry phone digits back into a URL, even from a hand-made link.
	if (back.get("jenis") === "hp") back.delete("cari");
	return (
		<OrderDetailClient
			key={orderId}
			orderId={orderId}
			backHref={`/admin/orders${back.size ? `?${back}` : ""}`}
		/>
	);
}
