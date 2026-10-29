import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { AccessDenied } from "../../../../components/admin/access-denied";
import { canOpen, SETTINGS_CARDS } from "../../../../components/admin/admin-nav";
import { AdminPage, PageHeader } from "../../../../components/admin/page-blocks";
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
	const cards = SETTINGS_CARDS.filter((card) => canOpen(card.href, roles, permissions));
	if (cards.length === 0)
		return (
			<AccessDenied title="Pengaturan" heading="Tidak ada pengaturan untuk peran Anda">
				Pengaturan toko dikelola Super Admin. Keuangan membaca kebijakan pembayaran dan log audit; Gudang
				dan Admin E-Commerce membaca template label; Layanan Pelanggan mengelola balasan CS. Verifikasi
				dua langkah (MFA) harus aktif.
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
			<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Daftar pengaturan">
				{cards.map(({ href, label, description, icon: Icon }) => (
					<li key={href}>
						<Link
							href={href}
							className="group flex h-full items-start gap-3 rounded-lg border bg-card p-5 outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
						>
							<span
								aria-hidden="true"
								className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground"
							>
								<Icon className="size-[18px]" />
							</span>
							<span className="flex min-w-0 flex-1 flex-col gap-1">
								<span className="text-sm font-semibold">{label}</span>
								<span className="text-sm text-muted-foreground">{description}</span>
							</span>
							<ChevronRight
								aria-hidden="true"
								className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
							/>
						</Link>
					</li>
				))}
			</ul>
		</AdminPage>
	);
}
