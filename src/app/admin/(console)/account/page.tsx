import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { permissionLabel, roleLabel } from "../../../../components/admin/account-model";
import { AdminPage, DetailSection, PageHeader } from "../../../../components/admin/page-blocks";
import { ErrorState } from "../../../../components/admin/states";
import { Badge } from "@/components/ui/badge";
import { readProfile } from "./own-profile";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Profil · Admin 99ribu",
	robots: { index: false, follow: false },
};

// S129 (spec 17 B1): read-only profile. Roles, grants and warehouses change only through Staf & Peran (owner).
export default async function AccountPage() {
	const read = await readProfile();
	if (read.kind === "signed-out")
		return (
			<AdminPage testId="account-page">
				<PageHeader title="Profil" />
				<section className="flex max-w-2xl flex-col gap-3 rounded-lg border bg-card p-5" data-testid="account-signed-out">
					<h2 className="text-base font-semibold">Masuk sebagai staf untuk melihat profil</h2>
					<p className="text-sm text-muted-foreground">Profil hanya tersedia untuk akun staf dengan verifikasi dua langkah selesai.</p>
					<Button asChild className="self-start max-md:self-stretch">
						<a href="/masuk?next=%2Fadmin%2Faccount">Masuk sebagai staf</a>
					</Button>
				</section>
			</AdminPage>
		);
	if (read.kind === "unavailable")
		return (
			<AdminPage testId="account-page">
				<PageHeader title="Profil" />
				<ErrorState message="Profil belum dapat dimuat. Muat ulang halaman sebentar lagi. (kode: SERVICE_UNAVAILABLE)" />
			</AdminPage>
		);
	const { profile } = read;
	const owner = profile.roles.includes("owner");
	return (
		<AdminPage testId="account-page">
			<PageHeader
				title="Profil"
				description="Data akun Anda. Peran, akses tambahan dan gudang hanya dapat diubah Super Admin di Staf & Peran."
				actions={
					<Button asChild variant="outline">
						<a href="/admin/account/security" data-testid="account-security-link">
							<ShieldCheck data-icon="inline-start" aria-hidden="true" />
							Keamanan akun
						</a>
					</Button>
				}
			/>
			<div className="grid gap-4 md:grid-cols-2">
				<DetailSection id="account-identity" title="Akun" testId="account-identity">
					<dl className="grid gap-3 text-sm">
						<div className="flex flex-col gap-0.5">
							<dt className="text-xs text-muted-foreground">Nama</dt>
							<dd className="font-medium break-words" data-testid="account-name">
								{profile.name}
							</dd>
						</div>
						<div className="flex flex-col gap-0.5">
							<dt className="text-xs text-muted-foreground">Email</dt>
							<dd className="font-medium break-all" data-testid="account-email">
								{profile.email}
							</dd>
						</div>
					</dl>
				</DetailSection>
				<DetailSection id="account-roles" title="Peran" testId="account-roles">
					<ul className="flex flex-wrap gap-2" aria-label="Peran">
						{profile.roles.map((role) => (
							<li key={role}>
								<Badge variant="secondary">{roleLabel(role)}</Badge>
							</li>
						))}
					</ul>
				</DetailSection>
				<DetailSection id="account-grants" title="Akses tambahan" testId="account-grants">
					{owner ? (
						<p className="text-sm text-muted-foreground">Super Admin memiliki seluruh akses.</p>
					) : profile.permissions.length === 0 ? (
						<p className="text-sm text-muted-foreground">Tidak ada akses tambahan. Akses mengikuti peran.</p>
					) : (
						<ul className="flex flex-col gap-1 text-sm">
							{profile.permissions.map((permission) => (
								<li key={permission}>{permissionLabel(permission)}</li>
							))}
						</ul>
					)}
				</DetailSection>
				<DetailSection id="account-warehouses" title="Gudang" testId="account-warehouses">
					{owner ? (
						<p className="text-sm text-muted-foreground">Super Admin dapat mengakses semua gudang aktif.</p>
					) : profile.warehouses.length === 0 ? (
						<p className="text-sm text-muted-foreground">Belum ditugaskan ke gudang mana pun.</p>
					) : (
						<ul className="flex flex-col gap-1 text-sm">
							{profile.warehouses.map((warehouse) => (
								<li key={`${warehouse.name}:${warehouse.city}`}>
									{warehouse.name} <span className="text-muted-foreground">· {warehouse.city}</span>
								</li>
							))}
						</ul>
					)}
				</DetailSection>
			</div>
		</AdminPage>
	);
}
