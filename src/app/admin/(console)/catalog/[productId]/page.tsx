import { AccessDenied } from "../../../../../components/admin/access-denied";
import { catalogAccess } from "../../../../../components/admin/catalog-model";
import { CatalogProductClient } from "../../../../../components/admin/catalog-product-client";
import { readStaffAccess } from "../../staff-roles";

export const dynamic = "force-dynamic";
export const metadata = {
	title: "Detail Produk · Admin 99ribu",
	robots: { index: false, follow: false },
};

export default async function AdminCatalogProductPage({
	params,
	searchParams,
}: {
	params: Promise<{ productId: string }>;
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
	const [{ roles, permissions }, { productId }, query] = await Promise.all([
		readStaffAccess(),
		params,
		searchParams,
	]);
	const access = catalogAccess(roles, permissions);
	if (!access.read)
		return (
			<AccessDenied title="Detail Produk" heading="Akses katalog diperlukan">
				Detail produk dapat dibuka oleh Super Admin, Admin E-Commerce, staf
				gudang, atau staf keuangan yang memiliki izin baca biaya. Verifikasi dua
				langkah (MFA) harus aktif.
			</AccessDenied>
		);
	const back = typeof query.dari === "string" ? query.dari : "";
	return (
		<CatalogProductClient
			key={productId}
			productId={productId}
			access={access}
			backHref={`/admin/catalog${back ? `?${new URLSearchParams(back).toString()}` : ""}`}
		/>
	);
}
