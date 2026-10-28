import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Sql } from "postgres";
import { privateDirectory } from "../config/local.ts";
import { scanImagePayload, sniffImageContentType, webpSize } from "./media-sniff.ts";

// Public catalog photos, content-addressed by SHA-256 (DEC-005). They live in the same
// owner-only storage root as private artifacts (`.local/catalog-media/`, identical locally and
// on the server), never under public/. Public URLs carry a readable name, `<title-slug>-<first
// 12 hex of the hash>.webp`; the route resolves the prefix back to exactly one stored file.
export const CATALOG_MEDIA_LIMIT = 512 * 1024;
const NAME = /^([0-9a-f]{64})\.webp$/;
const SHA256 = /^[0-9a-f]{64}$/;
// Public name: optional title slug (at most 80 chars) + 12 hex, or the legacy 64-hex name.
const PUBLIC_NAME = /^(?:(?=[a-z0-9-]{1,80}-[0-9a-f]{12}\.webp$)[a-z0-9]+(?:-[a-z0-9]+)*-)?([0-9a-f]{12})\.webp$/;

// SEO file name for a stored photo. The slug is the product title normalized to [a-z0-9-] (NFKD, accents stripped,
// at most 80 chars); an empty slug leaves the bare 12-hex prefix. It is independent of the product's public_slug.
export function catalogMediaFileName(title: string, sha256: string): string {
	if (!SHA256.test(sha256)) throw new Error("Catalog media hash must be 64 lowercase hex characters.");
	const slug = title.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80).replace(/^-+|-+$/g, "");
	return `${slug ? `${slug}-` : ""}${sha256.slice(0, 12)}.webp`;
}

export function catalogMediaName(bytes: Uint8Array) {
	if (bytes.byteLength > CATALOG_MEDIA_LIMIT || sniffImageContentType(bytes) !== "image/webp" || scanImagePayload(bytes) !== "ready") {
		throw new Error("Catalog photo must be a clean WebP image within the size limit.");
	}
	return { name: `${createHash("sha256").update(bytes).digest("hex")}.webp`, ...webpSize(bytes) };
}

// Idempotent: an existing file with the same name already holds the same verified bytes.
// Writes go to a unique temporary file and are hard-linked into place, so a reader never sees
// a partial photo and a concurrent writer of the same content loses harmlessly.
export async function saveCatalogMedia(bytes: Uint8Array) {
	const { name } = catalogMediaName(bytes);
	const directory = privateDirectory("catalog-media");
	try {
		await readCatalogMedia(name);
		return { name, created: false };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const temporary = join(directory, `.${randomUUID()}.tmp`);
	const file = await open(temporary, "wx", 0o600);
	try {
		await file.writeFile(bytes);
		await file.sync();
	} finally {
		await file.close();
	}
	try {
		await link(temporary, join(directory, name));
		return { name, created: true };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		await readCatalogMedia(name);
		return { name, created: false };
	} finally {
		await unlink(temporary);
	}
}

// Verifies name shape, ownership/permissions and that the bytes still hash to their name.
export async function readCatalogMedia(name: string, directory = privateDirectory("catalog-media")) {
	const match = NAME.exec(name);
	if (!match) throw new Error("Invalid catalog media name.");
	const file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await file.stat();
		if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.() || stat.size > CATALOG_MEDIA_LIMIT) {
			throw new Error("Catalog media permissions are invalid.");
		}
		const bytes = await file.readFile();
		if (createHash("sha256").update(bytes).digest("hex") !== match[1]) throw new Error("Catalog media content does not match its name.");
		return bytes;
	} finally {
		await file.close();
	}
}

// The stored hash a public name points at: the 12-hex prefix must match exactly one stored file
// (the legacy 64-hex name must match itself). Malformed, unknown or ambiguous names resolve to null.
// lazy: lists the directory per request (a few thousand names); an index is the upgrade path.
export async function resolveCatalogMedia(name: string, directory = privateDirectory("catalog-media")) {
	const legacy = NAME.exec(name)?.[1];
	const prefix = legacy ?? PUBLIC_NAME.exec(name)?.[1];
	if (!prefix) return null;
	const matches = (await readdir(directory)).filter((entry) => NAME.test(entry) && entry.startsWith(prefix));
	return matches.length === 1 ? (NAME.exec(matches[0]) as RegExpExecArray)[1] : null;
}

// Canonical public name: the file name a current (published, not withdrawn) product revision embeds
// for this photo; with several, the lexicographically smallest. Legacy 64-hex URLs are not canonical.
// lazy: scans current publication images per request (hundreds of rows); an index is the upgrade path.
export async function canonicalCatalogMediaName(sql: Sql, sha256: string) {
	const prefix = sha256.slice(0, 12);
	const rows = await sql<{ name: string }[]>`select distinct substring(i.image->>'url' from '/media/catalog/([^/?#]+)$') as name
		from app.publication_head h join app.publication_version v on v.product_id=h.product_id and v.revision=h.revision
		 join app.product_revision r on r.product_id=v.product_id and r.revision=v.product_revision
		 cross join lateral jsonb_array_elements(r.images) as i(image)
		where h.revision>0 and not exists (select 1 from app.publication_withdrawal w where w.publication_id=v.id)
		 and i.image->>'url' like ${`%/media/catalog/%${prefix}.webp`}`;
	return rows.map((row) => row.name).filter((name) => typeof name === "string" && !NAME.test(name) && PUBLIC_NAME.exec(name)?.[1] === prefix).sort()[0] ?? null;
}

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

// Public GET for `/media/catalog/<name>`. Unknown, malformed, ambiguous or tampered names are 404.
// A name that differs from the canonical one answers 308 to it (not cached immutably, since the
// canonical name follows the product title); without a current publication the bytes are served.
// Without `sql` no canonical lookup happens and any resolvable name is served. A failing database
// lookup is a server error, not a missing photo.
export async function serveCatalogMedia(name: string, { sql, directory }: { sql?: Sql; directory?: string } = {}) {
	let sha256: string | null;
	let bytes: Buffer;
	try {
		const root = directory ?? privateDirectory("catalog-media");
		sha256 = await resolveCatalogMedia(name, root);
		if (!sha256) return notFound();
		bytes = await readCatalogMedia(`${sha256}.webp`, root);
	} catch {
		return notFound();
	}
	const canonical = sql ? await canonicalCatalogMediaName(sql, sha256) : null;
	if (canonical && canonical !== name) {
		return new Response(null, { status: 308, headers: { location: `/media/catalog/${canonical}`, "cache-control": "no-store" } });
	}
	return new Response(new Uint8Array(bytes), {
		headers: {
			"content-type": "image/webp",
			"cache-control": "public, max-age=31536000, immutable",
			"x-content-type-options": "nosniff",
			"content-security-policy": "default-src 'none'; sandbox",
			"content-disposition": "inline",
		},
	});
}
