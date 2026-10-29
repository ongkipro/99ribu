import { AccessDenied } from "../../../../components/admin/access-denied";
import { CatalogListClient } from "../../../../components/admin/catalog-list-client";
import { catalogAccess, catalogTabStatus } from "../../../../components/admin/catalog-model";
import { readStaffAccess } from "../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Katalog Produk · Admin 99ribu",
	robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminCatalogPage({
	searchParams,
}: {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const [{ roles, permissions }, params] = await Promise.all([
		readStaffAccess(),
		searchParams,
	]);
	// Mirrors the catalog read authority; the API refuses on its own.
	const access = catalogAccess(roles, permissions);
	if (!access.read)
		return (
			<AccessDenied title="Katalog Produk" heading="Akses katalog diperlukan">
				Katalog dapat dibuka oleh Super Admin, Admin E-Commerce, staf gudang,
				atau staf keuangan yang memiliki izin baca biaya. Verifikasi dua langkah
				(MFA) harus aktif.
			</AccessDenied>
		);
	const one = (key: string) =>
		typeof params[key] === "string" ? (params[key] as string) : "";
	// `?tab=` (plan §4.3); `?status=` links from before the tabs still open the same view.
	const status = catalogTabStatus(one("tab"), one("status"));
	// `kursor` is the comma-separated cursor chain (product ids) reopening page `hal`.
	const cursors = one("kursor")
		.split(",")
		.filter((c) => UUID.test(c));
	return (
		// Keyed by tab: a tab link remounts the list on page 1 of that state.
		<CatalogListClient
			key={status}
			initial={{
				q: one("q"),
				category: one("kategori"),
				status,
				review: one("tinjauan") === "klaim",
				cursors: cursors.length <= 200 ? cursors : [],
			}}
			access={access}
		/>
	);
}
