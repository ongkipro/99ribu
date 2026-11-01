import { AccessDenied } from "../../../../components/admin/access-denied";
import { canOpen, MARKETING_CARDS } from "../../../../components/admin/admin-nav";
import { HubCards } from "../../../../components/admin/hub-cards";
import { AdminPage, PageHeader } from "../../../../components/admin/page-blocks";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pemasaran · Admin 99ribu",
	robots: { index: false, follow: false },
};

// Hub for the marketing pages (plan §4.1). A card shows only when its page's own guard opens it for this
// principal; every page and API re-checks on the server.
export default async function MarketingIndexPage() {
	const { roles, permissions } = await readStaffAccess();
	const cards = MARKETING_CARDS.filter((card) => canOpen(card.href, roles, permissions));
	if (cards.length === 0)
		return (
			<AccessDenied title="Pemasaran" heading="Tidak ada halaman pemasaran untuk peran Anda">
				Promo ongkir, banner, segmen pembeli, afiliasi dan integrasi iklan dikelola Super Admin dan Admin
				E-Commerce. Verifikasi dua langkah (MFA) harus aktif.
			</AccessDenied>
		);
	return (
		<AdminPage testId="marketing-index">
			<PageHeader title="Pemasaran" description="Promo, banner beranda, segmen pembeli, afiliasi dan iklan." />
			<HubCards cards={cards} label="Daftar halaman pemasaran" />
		</AdminPage>
	);
}
