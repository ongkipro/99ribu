import { CatalogListing } from "../../../components/storefront/sections/catalog-listing";
import { searchMetadata } from "../../../modules/storefront/seo";
export const dynamic = "force-dynamic";
// Search and filter results are noindex, follow (seo.ts routePolicy); crawlers may follow product links.
export const metadata = searchMetadata("Cari produk");

export default async function Search({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	return <CatalogListing raw={await searchParams} />;
}
