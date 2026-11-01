import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { UNBUILT_PAGES } from "../src/components/admin/admin-nav.ts";

// Drift guard: the admin page routes on disk and the "Admin screen map" in ARCHITECTURE.md must list the same
// paths. A page that is not built yet is allowed in the map only while admin-nav.ts lists it in UNBUILT_PAGES.
const root = "src/app/admin/(console)";

function pageRoutes(dir: string, found: string[] = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.isDirectory()) pageRoutes(join(dir, entry.name), found);
		else if (entry.name === "page.tsx") {
			const rel = relative(root, dir);
			found.push(rel ? `/admin/${rel.split("\\").join("/")}` : "/admin");
		}
	}
	return found;
}

function mappedRoutes() {
	const text = readFileSync("ARCHITECTURE.md", "utf8");
	const start = text.indexOf("### Admin screen map");
	const end = text.indexOf("## Worker and job registry");
	assert.ok(start >= 0 && end > start, "ARCHITECTURE.md must keep the '### Admin screen map' section");
	const paths = new Set<string>();
	for (const match of text.slice(start, end).matchAll(/`(\/admin(?:\/[^`\s,]*)?)`/g)) {
		// Worked examples with a real number (for example /admin/pesanan/1042) are not routes.
		if (match[1].split("/").some((part) => /^\d+$/.test(part))) continue;
		paths.add(match[1].replace(/\/$/, ""));
	}
	return paths;
}

test("every admin page is in the ARCHITECTURE.md screen map and every mapped path is a page or unbuilt", () => {
	const routes = new Set(pageRoutes(root));
	const mapped = mappedRoutes();
	const missingFromMap = [...routes].filter((route) => !mapped.has(route)).sort();
	const notPages = [...mapped].filter((path) => !routes.has(path) && !UNBUILT_PAGES.has(path)).sort();
	assert.deepEqual(
		missingFromMap,
		[],
		`Add these pages to the ARCHITECTURE.md "Admin screen map" table: ${missingFromMap.join(", ")}`,
	);
	assert.deepEqual(
		notPages,
		[],
		`These mapped paths are not pages and are not in UNBUILT_PAGES (admin-nav.ts); fix the map or the route: ${notPages.join(", ")}`,
	);
});

test("an unbuilt page in the nav model has no page on disk", () => {
	const routes = new Set(pageRoutes(root));
	const built = [...UNBUILT_PAGES].filter((path) => routes.has(path));
	assert.deepEqual(built, [], `Remove from UNBUILT_PAGES, the page exists: ${built.join(", ")}`);
});
