import Link from "next/link";
import { redirect } from "next/navigation";
import {
	CategoryGrid,
	type Department,
} from "../../../components/storefront/sections/category-grid";
import { departmentTint } from "../../../components/storefront/sections/category-pills";
import { sameOrigin } from "../../../modules/storefront/format";
import { departmentPhotos } from "../../../modules/storefront/department-photos";
import { Shell } from "../../../components/storefront/shell";
import { getLocalAuth } from "../../../modules/access/auth";
import { AccessError } from "../../../modules/access/policy";
import {
	featuredDepartments,
	listCategories,
} from "../../../modules/storefront/catalog";
import { siteConfig } from "../../../config/site";
import {
	categoriesDescription,
	categoriesTitle,
	publicMetadata,
} from "../../../modules/storefront/seo";
export const dynamic = "force-dynamic";
// ?cursor pages are noindex, follow; tracking parameters are ignored, so the clean URL stays canonical.
export async function generateMetadata({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	return publicMetadata(siteConfig(), {
		path: "/kategori",
		title: categoriesTitle,
		description: categoriesDescription,
		indexable: !("cursor" in (await searchParams)),
	});
}
export default async function Categories({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const raw = await searchParams,
		params = new URLSearchParams({ limit: "100" });
	if (typeof raw.cursor === "string") params.set("cursor", raw.cursor);
	if (Array.isArray(raw.cursor)) redirect("/404");
	const identity = getLocalAuth();
	let result: Awaited<ReturnType<typeof listCategories>>;
	try {
		result = await listCategories(identity, params);
	} catch (error) {
		if (error instanceof AccessError && error.status === 400) redirect("/404");
		throw error;
	}
	const categories = result.data as Department[];
	// Every top-level department is a tile; subcategories stay visible as links.
	const departments = await featuredDepartments(identity, 100);
	// Same tile and same curated photo as the home grid and the header pills.
	const photos = await departmentPhotos(identity, departments);
	const tiles = departments.map((department, index) => {
		const photo = photos.get(department.id);
		return {
			department,
			tint: departmentTint(department.name, index),
			photo: photo
				? { src: sameOrigin(photo.url), width: photo.width, height: photo.height }
				: null,
		};
	});
	const others = categories.filter(
		(c) => !departments.some((d) => d.id === c.id),
	);
	return (
		<Shell active="category">
			<main id="main" className="wrap categories-main">
				<h1>Kategori produk</h1>
				<p>Pilih kategori untuk melihat isi dan harga setiap pilihan.</p>
				<CategoryGrid tiles={tiles} />
				{others.length > 0 && (
					<section
						className="subcategories"
						aria-labelledby="subcategories-heading"
					>
						<h2 id="subcategories-heading">Subkategori</h2>
						<ul>
							{others.map((c) => (
								<li key={c.id}>
									<Link href={`/kategori/${c.slug}`}>{c.name}</Link>
								</li>
							))}
						</ul>
					</section>
				)}
				{result.pagination.next_cursor && (
					<Link
						className="button secondary"
						href={`/kategori?cursor=${result.pagination.next_cursor}`}
					>
						Kategori berikutnya
					</Link>
				)}
			</main>
		</Shell>
	);
}
