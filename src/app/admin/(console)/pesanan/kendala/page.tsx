import { AccessDenied } from "../../../../../components/admin/access-denied";
import { ExceptionListClient } from "../../../../../components/admin/exception-list-client";
import { KINDS, STATUSES } from "../../../../../components/admin/exception-model";
import { AdminPage, PageHeader } from "../../../../../components/admin/page-blocks";
import { returnAccess } from "../../../../../components/admin/return-model";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Masalah Pengiriman · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Navigation gate only; the exceptions API re-checks role, MFA and warehouse scope on every call.
export default async function ExceptionsPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const [{ roles, permissions }, query] = await Promise.all([readStaffAccess(), searchParams]);
	const access = returnAccess(roles, permissions);
	if (!access.read)
		return (
			<AccessDenied title="Masalah Pengiriman" heading="Akses kasus pengiriman diperlukan">
				Halaman ini untuk Super Admin, Layanan Pelanggan, staf gudang (kasus di gudangnya) dan staf
				keuangan dengan izin baca refund. Verifikasi dua langkah harus aktif.
			</AccessDenied>
		);
	const status = STATUSES.find((value) => value === query.status) ?? null;
	const kind = KINDS.find((value) => value === query.jenis) ?? null;
	return (
		<AdminPage testId="exceptions-screen">
			<PageHeader
				title="Masalah Pengiriman"
				description="Selisih stok, pembayaran terlambat, COD ditolak dan paket gagal antar. Putuskan penanganan, catat barang kembali, lalu ajukan refund dari pembayaran asal."
			/>
			<ExceptionListClient access={access} initialStatus={status} initialKind={kind} />
		</AdminPage>
	);
}
