import { AccessDenied } from "../../../../components/admin/access-denied";
import {
	canOpen,
	MAINTAINED_CARDS,
	SETTINGS_CARDS,
} from "../../../../components/admin/admin-nav";
import { HubCards } from "../../../../components/admin/hub-cards";
import {
	AdminPage,
	PageHeader,
} from "../../../../components/admin/page-blocks";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Pengaturan · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S-V1 (plan §4.5, tokophi `/pengaturan`): one page of setting cards. A card shows only when its
// page's own guard opens it for this principal; every page and API re-checks on the server.
export default async function SettingsIndexPage() {
	const { roles, permissions } = await readStaffAccess();
	const cards = SETTINGS_CARDS.filter((card) =>
		canOpen(card.href, roles, permissions),
	);
	const maintained = MAINTAINED_CARDS.filter((card) =>
		canOpen(card.href, roles, permissions),
	);
	if (cards.length === 0)
		return (
			<AccessDenied
				title="Pengaturan"
				heading="Tidak ada pengaturan untuk peran Anda"
			>
				Pengaturan toko dikelola Super Admin. Keuangan membaca kebijakan
				pembayaran dan log audit; Gudang dan Admin E-Commerce membaca template
				label; Layanan Pelanggan mengelola balasan CS. Verifikasi dua langkah
				(MFA) harus aktif.
			</AccessDenied>
		);
	return (
		<AdminPage testId="settings-index">
			<PageHeader
				title="Pengaturan"
				description={
					roles.includes("owner")
						? "Aturan toko, staf, pembayaran dan integrasi. Setiap perubahan tercatat di log audit."
						: "Pengaturan yang dapat Anda buka dengan peran ini."
				}
			/>
			<HubCards cards={cards} label="Daftar pengaturan" />
			{maintained.length > 0 && (
				<section
					aria-labelledby="maintained-heading"
					className="flex flex-col gap-3"
				>
					<div className="flex flex-col gap-1">
						<h2 id="maintained-heading" className="text-base font-semibold">
							Fitur lain
						</h2>
						<p className="text-sm text-muted-foreground">
							Tetap berjalan, tidak dikembangkan lagi.
						</p>
					</div>
					<HubCards cards={maintained} label="Fitur lain" />
				</section>
			)}
		</AdminPage>
	);
}
