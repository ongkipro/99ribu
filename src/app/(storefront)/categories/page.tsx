import Link from "next/link";
import { redirect } from "next/navigation";
import {
	type Department,
	Departments,
} from "../../../components/storefront/departments";
import { Icon, Shell } from "../../../components/storefront/shell";
import { getLocalAuth } from "../../../modules/access/auth";
import { AccessError } from "../../../modules/access/policy";
import {
	featuredDepartments,
	listCategories,
} from "../../../modules/storefront/catalog";
export const dynamic = "force-dynamic";
export const metadata = { title: "Kategori produk" };
export default async function Categories({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const raw = await searchParams,
		params = new URLSearchParams({ limit: "100" });
	if (typeof raw.cursor === "string") params.set("cursor", raw.cursor);
	if (
		Object.keys(raw).some((key) => key !== "cursor") ||
		Array.isArray(raw.cursor)
	)
		redirect("/404");
	const identity = getLocalAuth();
	let result: Awaited<ReturnType<typeof listCategories>>;
	try {
		result = await listCategories(identity, params);
	} catch (error) {
		if (error instanceof AccessError && error.status === 400) redirect("/404");
		throw error;
	}
	const categories = result.data as Department[];
	const featured = await featuredDepartments(identity, 4);
	const others = categories.filter((c) => !featured.some((f) => f.id === c.id));
	return (
		<Shell active="category">
			<main id="main" className="wrap categories-main">
				<h1>Kategori produk</h1>
				<p>Pilih kategori untuk melihat isi dan harga setiap pilihan.</p>
				<Departments categories={featured} />
				{others.length > 0 && (
					<details className="other-departments">
						<summary>
							Kategori lainnya
							<Icon name="chevron" />
						</summary>
						<ul>
							{others.map((c) => (
								<li key={c.id}>
									<Link href={`/category/${c.slug}`}>{c.name}</Link>
								</li>
							))}
						</ul>
					</details>
				)}
				{result.pagination.next_cursor && (
					<Link
						className="button secondary"
						href={`/categories?cursor=${result.pagination.next_cursor}`}
					>
						Kategori berikutnya
					</Link>
				)}
			</main>
		</Shell>
	);
}
