import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server.js";
import { LEGACY_ADMIN_ROUTES, legacyAdminPath, proxy } from "../src/proxy.ts";

// S-U1 (redesign plan §4.2): English admin page paths moved to Indonesian slugs and answer 308.
const root = new URL("..", import.meta.url).pathname;
const consoleDir = join(root, "src/app/admin/(console)");
const origin = "http://127.0.0.1:3099";

test("S-U1 every old admin page path answers 308 to its new path, keeping the detail number and query", () => {
	for (const [from, to] of LEGACY_ADMIN_ROUTES) {
		for (const [suffix, expected] of [["", to], ["/1042?x=1&tab=semua", `${to}/1042?x=1&tab=semua`], ["?cari=a%20b", `${to}?cari=a%20b`]]) {
			const response = proxy(new NextRequest(`${origin}${from}${suffix}`));
			assert.equal(response.status, 308, from + suffix);
			const location = new URL(response.headers.get("location") ?? "", origin);
			assert.equal(location.pathname + location.search, expected, from + suffix);
		}
	}
	assert.equal(legacyAdminPath("/admin/orders/1042"), "/admin/pesanan/1042");
	assert.equal(legacyAdminPath("/admin/catalog/categories"), "/admin/produk/kategori");
	assert.equal(legacyAdminPath("/admin/catalog/77"), "/admin/produk/77");
	assert.equal(legacyAdminPath("/admin/inventory/transfers"), "/admin/produk/inventori/transfer");
	assert.equal(legacyAdminPath("/admin/finance/summary"), "/admin/keuangan");
	assert.equal(legacyAdminPath("/admin/account/security"), "/admin/akun/keamanan");
	assert.equal(legacyAdminPath("/admin/settings/advertising"), "/admin/pemasaran/iklan");
});

test("S-U1 new paths and non-page paths pass through without a redirect", () => {
	for (const path of ["/admin", "/admin/pesanan", "/admin/pesanan/1042", "/admin/produk/kategori", "/admin/ordersx", "/admin/banner", "/admin/keuangan"]) {
		assert.equal(legacyAdminPath(path), null, path);
		const response = proxy(new NextRequest(`${origin}${path}?a=1`));
		assert.equal(response.status, 200, path);
		assert.equal(response.headers.get("location"), null, path);
	}
});

test("S-U1 every redirect target is a built page and no target is itself an old path", () => {
	for (const [from, to] of LEGACY_ADMIN_ROUTES) {
		assert.ok(existsSync(join(consoleDir, to.slice("/admin/".length), "page.tsx")), `${to} has a page`);
		assert.equal(legacyAdminPath(to), null, `${from} -> ${to} does not loop`);
		assert.ok(!existsSync(join(consoleDir, from.slice("/admin/".length))), `${from} folder is gone`);
	}
});

test("S-U1 no file under src links to an old admin page path", () => {
	const escaped = LEGACY_ADMIN_ROUTES.map(([from]) => from.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&"));
	// Not preceded by a word character, dot or dash (excludes `components/admin/...` imports) nor by /api/v1.
	const old = new RegExp(`(?<![A-Za-z_.-])(?<!/api/v1)(${escaped.join("|")})(?![\\w-])`);
	const hits: string[] = [];
	const walk = (dir: string) => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) walk(path);
			else if (/\.(ts|tsx|js|mjs|css)$/.test(name) && path !== join(root, "src/proxy.ts")) {
				readFileSync(path, "utf8").split("\n").forEach((line, i) => {
					// Also catch encoded return paths such as /masuk?next=%2Fadmin%2Forders and escaped regex paths.
					const match = old.exec(line.replace(/%2F/gi, "/").replaceAll("\\/", "/"));
					if (match) hits.push(`${path.slice(root.length)}:${i + 1} ${match[1]}`);
				});
			}
		}
	};
	walk(join(root, "src"));
	assert.deepEqual(hits, []);
});
