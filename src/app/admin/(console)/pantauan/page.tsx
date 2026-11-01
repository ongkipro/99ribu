import { AccessDenied } from "../../../../components/admin/access-denied";
import { canOpen, MONITOR_CARDS } from "../../../../components/admin/admin-nav";
import { HubCards } from "../../../../components/admin/hub-cards";
import { AdminPage, PageHeader } from "../../../../components/admin/page-blocks";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pantauan · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Monitoring hub (plan §4.1): one entry point to the operational pages. Cards follow each page's own guard.
export default async function MonitorIndexPage() {
	const { roles, permissions } = await readStaffAccess();
	const cards = MONITOR_CARDS.filter((card) => canOpen(card.href, roles, permissions));
	if (cards.length === 0)
		return (
			<AccessDenied title="Pantauan" heading="Tidak ada halaman pantauan untuk peran Anda">
				Pantauan menggabungkan pesanan, katalog, stok, kendala dan retur sesuai izin peran Anda. Verifikasi
				dua langkah (MFA) harus aktif.
			</AccessDenied>
		);
	return (
		<AdminPage testId="monitor-index">
			<PageHeader title="Pantauan" description="Pesanan, katalog, stok, kendala dan retur dalam satu tempat." />
			<HubCards cards={cards} label="Daftar halaman pantauan" />
		</AdminPage>
	);
}
