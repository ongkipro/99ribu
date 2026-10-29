import { AccessDenied } from "../../../../components/admin/access-denied";
import { CustomerLookupClient } from "../../../../components/admin/customer-lookup-client";
import { AdminPage, PageHeader } from "../../../../components/admin/page-blocks";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Akun Pembeli · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S138 / spec 17 B29, DEC-018 Q5. Navigation gate only: the owner and customer service. The lookup API re-checks the
// current role, session and MFA in the database on every request, rate-limits per staff user and audits each lookup.
export default async function CustomersPage() {
	const { roles } = await readStaffAccess();
	if (!roles.includes("owner") && !roles.includes("customer_service"))
		return (
			<AccessDenied title="Akun Pembeli" heading="Akses layanan pelanggan diperlukan">
				Pencarian akun pembeli untuk Super Admin atau staf layanan pelanggan
				dengan verifikasi dua langkah aktif. Peran keuangan, gudang, dan admin
				e-commerce tidak membukanya.
			</AccessDenied>
		);
	return (
		<AdminPage testId="customers-page">
			<PageHeader
				title="Akun Pembeli"
				description="Cari akun dengan nomor HP atau email yang sama persis. Kontak tampil tersamar; setiap pencarian dicatat tanpa menyimpan kata kunci."
			/>
			<CustomerLookupClient />
		</AdminPage>
	);
}
