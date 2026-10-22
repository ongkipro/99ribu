import { serveCatalogMedia } from "@/storage/catalog-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Content-addressed catalog photos (DEC-005); the storage module validates the name and bytes.
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
	return serveCatalogMedia((await params).file);
}
