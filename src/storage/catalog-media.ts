import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, open, unlink } from "node:fs/promises";
import { join } from "node:path";
import { privateDirectory } from "../config/local.ts";
import { scanImagePayload, sniffImageContentType, webpSize } from "./media-sniff.ts";

// Public catalog photos, content-addressed by SHA-256 (DEC-005). They live in the same
// owner-only storage root as private artifacts (`.local/catalog-media/`, identical locally and
// on the server), never under public/, and are served only by exact hash name.
export const CATALOG_MEDIA_LIMIT = 512 * 1024;
const NAME = /^([0-9a-f]{64})\.webp$/;

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
export async function readCatalogMedia(name: string) {
	const match = NAME.exec(name);
	if (!match) throw new Error("Invalid catalog media name.");
	const file = await open(join(privateDirectory("catalog-media"), name), constants.O_RDONLY | constants.O_NOFOLLOW);
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

// Public GET for `/media/catalog/<sha256>.webp`. Unknown, malformed or tampered names are 404.
export async function serveCatalogMedia(name: string) {
	try {
		const bytes = await readCatalogMedia(name);
		return new Response(new Uint8Array(bytes), {
			headers: {
				"content-type": "image/webp",
				"cache-control": "public, max-age=31536000, immutable",
				"x-content-type-options": "nosniff",
			},
		});
	} catch {
		return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
	}
}
