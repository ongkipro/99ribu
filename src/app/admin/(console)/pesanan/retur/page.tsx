import { AccessDenied } from "../../../../../components/admin/access-denied";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { ReturnListClient } from "../../../../../components/admin/return-list-client";
import { defaultTab, isReturnTab, returnAccess } from "../../../../../components/admin/return-model";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Retur & Penggantian · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the returns API re-checks role, MFA and warehouse scope on every call.
export default async function ReturnsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const [{ roles, permissions }, query] = await Promise.all([readStaffAccess(), searchParams]);
	if (!returnAccess(roles, permissions).read)
		return (
			<AccessDenied title="Retur & Penggantian" heading="Akses retur diperlukan">
				Halaman ini untuk Super Admin, Layanan Pelanggan, staf gudang (inspeksi barang di
				gudangnya) dan staf keuangan dengan izin baca refund. Verifikasi dua langkah harus aktif.
			</AccessDenied>
		);
	return (
		<AdminPage>
			<PageHeader
				title="Retur & Penggantian"
				description="Putuskan klaim pembeli, catat inspeksi barang retur, ajukan refund atau kirim barang pengganti."
			/>
			<ReturnListClient initialTab={isReturnTab(query.tahap) ? query.tahap : defaultTab(roles)} />
		</AdminPage>
	);
}
