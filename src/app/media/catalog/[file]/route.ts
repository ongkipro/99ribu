import { getLocalAuth } from "@/modules/access/auth";
import { serveCatalogMedia } from "@/storage/catalog-media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Catalog photos (DEC-005) under SEO names `<title-slug>-<12 hex>.webp`; the storage module resolves
// the prefix to one stored file, verifies its bytes and redirects stale names to the canonical one.
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
	return serveCatalogMedia((await params).file, { sql: getLocalAuth().sql });
}
