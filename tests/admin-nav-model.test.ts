import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
	activeHref,
	canOpen,
	GUARDED_PAGES,
	highlightedRows,
	NAV_BY_LENS,
	type NavSection,
	navFor,
	SETTINGS_CARDS,
	UNBUILT_PAGES,
} from "../src/components/admin/admin-nav.ts";
import { catalogTabKey, catalogTabStatus } from "../src/components/admin/catalog-model.ts";
import { ORDER_TABS, orderFilterParams, readOrderTab, tabFilters } from "../src/components/admin/order-model.ts";

// S-V1 (redesign plan §4.1): the per-lens nav tree, filtered by the same rules as the page guards,
// with the unbuilt pages behind the built flag list and exactly one active row.
const consoleDir = join(new URL("..", import.meta.url).pathname, "src/app/admin/(console)");
const pageExists = (path: string) =>
	existsSync(join(consoleDir, path.replace(/^\/admin\/?/, ""), "page.tsx"));

type Shape = [label: string, href: string, children?: string[]][];
const shape = (sections: NavSection[]): Shape =>
	sections.flatMap((s) =>
		s.items.map((i): Shape[number] => (i.children ? [i.label, i.href, i.children.map((c) => c.label)] : [i.label, i.href])),
	);

const SETTINGS_ALL = [
	"Staf & Peran",
	"Kebijakan Komersial",
	"Pembayaran & COD",
	"Tarif Afiliasi",
	"Gudang",
	"Integrasi Iklan",
	"Log Audit",
	"Kesehatan Sistem",
];

test("S-V1 nav per role lens: exactly the plan §4.1 items each principal's grants open", () => {
	const cases: [string, Parameters<typeof navFor>, Shape][] = [
		[
			"owner (Pantauan keeps the existing pages until S-O1)",
			["owner", ["owner"], []],
			[
				["Beranda", "/admin"],
				["Pantauan", "/admin/pesanan", ["Pesanan", "Produk", "Stok", "Kendala Pengiriman", "Retur"]],
				["Keuangan", "/admin/keuangan", ["Laporan Keuangan", "Rekonsiliasi", "Komisi Afiliasi"]],
				["Pengaturan", "/admin/pengaturan", SETTINGS_ALL],
			],
		],
		[
			// Retur needs the returns read rule (owner, CS, warehouse, finance refunds); SKU & HPP needs finance.costs.read.
			"ecommerce_admin",
			["ecommerce_admin", ["ecommerce_admin"], ["orders.history.read"]],
			[
				["Beranda", "/admin"],
				["Pesanan", "/admin/pesanan?tab=perlu_dikirim", ["Semua Pesanan", "Input Resi", "Cetak Label"]],
				["Produk", "/admin/produk", ["Kategori", "Inventori", "Transfer Stok"]],
				["Promo", "/admin/promo/ongkir", ["Banner", "Segmen Pembeli"]],
				["Pengaturan", "/admin/pengaturan"],
			],
		],
		[
			// No order-history grant: the Pesanan row opens its first child.
			"warehouse",
			["warehouse", ["warehouse"], []],
			[
				["Beranda", "/admin"],
				["Pesanan", "/admin/pesanan/kirim", ["Input Resi", "Cetak Label", "Kendala Pengiriman", "Retur"]],
				["Produk", "/admin/produk/inventori", ["Transfer Stok"]],
				["Pengaturan", "/admin/pengaturan"],
			],
		],
		[
			"customer_service",
			["customer_service", ["customer_service"], ["orders.history.read"]],
			[
				["Beranda", "/admin"],
				["Obrolan", "/admin/obrolan"],
				["Pesanan", "/admin/pesanan", ["Kendala Pengiriman", "Retur"]],
				["Pelanggan", "/admin/pelanggan"],
				["Pengaturan", "/admin/pengaturan"],
			],
		],
		[
			// Without finance.summary.read the Keuangan row opens Pembayaran Masuk.
			"finance",
			["finance", ["finance"], ["orders.history.read", "finance.reconciliation.read", "finance.refunds.read"]],
			[
				["Beranda", "/admin"],
				[
					"Keuangan",
					"/admin/keuangan/pembayaran",
					["Pembayaran Masuk", "Setoran COD", "Rekonsiliasi", "Pengembalian Dana", "Komisi Afiliasi", "Tarif Afiliasi"],
				],
				["Pesanan", "/admin/pesanan"],
				["Pengaturan", "/admin/pengaturan"],
			],
		],
		[
			// A lens never widens: warehouse+CS viewed through the warehouse lens keeps warehouse grants.
			"warehouse lens of a warehouse+customer_service account",
			["warehouse", ["warehouse", "customer_service"], ["orders.history.read"]],
			[
				["Beranda", "/admin"],
				["Pesanan", "/admin/pesanan?tab=perlu_dikirim", ["Input Resi", "Cetak Label", "Kendala Pengiriman", "Retur"]],
				["Produk", "/admin/produk/inventori", ["Transfer Stok"]],
				["Pengaturan", "/admin/pengaturan"],
			],
		],
		["signed-out preview", ["owner", [], []], [["Beranda", "/admin"]]],
	];
	for (const [name, args, expected] of cases) assert.deepEqual(shape(navFor(...args)), expected, name);
});

test("S-V1 every unbuilt page is defined in the nav, hidden, and has no route yet; every shown page exists", () => {
	const defined = new Set(
		Object.values(NAV_BY_LENS).flatMap((sections) =>
			sections.flatMap((s) => s.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)])),
		),
	);
	for (const path of UNBUILT_PAGES) {
		assert.ok(defined.has(path), `${path} is defined in a nav tree`);
		assert.ok(!pageExists(path), `${path} has no page yet; remove it from UNBUILT_PAGES when it lands`);
		assert.equal(canOpen(path, ["owner"], []), false, path);
	}
	for (const path of defined) {
		const route = path.split("?")[0];
		if (!UNBUILT_PAGES.has(route)) assert.ok(pageExists(route), `${route} has a page`);
	}
	for (const card of SETTINGS_CARDS) assert.ok(pageExists(card.href), card.href);
});

test("S-V1 every guard-allowed page is reachable from the nav, except the listed deliberate omissions", () => {
	const lenses = ["owner", "ecommerce_admin", "warehouse", "customer_service", "finance"] as const;
	// [account, roles, grants, guard-allowed pages deliberately left out of every lens it may open]
	const cases: [string, string[], string[], string[]][] = [
		["owner", ["owner"], [], []],
		["ecommerce_admin", ["ecommerce_admin"], ["orders.history.read"], []],
		// Plan §4.1: the warehouse Produk row opens Inventori; the product list is catalog work.
		["warehouse", ["warehouse"], [], ["/admin/produk"]],
		["customer_service", ["customer_service"], ["orders.history.read"], []],
		// Plan §4.1: finance acts on refunds in Pengembalian Dana, not on the return/exception queues,
		// and its tree has no Produk row.
		[
			"finance (all finance grants)",
			["finance"],
			["orders.history.read", "finance.reconciliation.read", "finance.refunds.read", "finance.summary.read", "finance.costs.read"],
			["/admin/pesanan/kendala", "/admin/pesanan/retur", "/admin/produk"],
		],
	];
	for (const [name, roles, permissions, omitted] of cases) {
		// The layout gives the owner every lens and other staff their own roles.
		const own = roles.includes("owner") ? lenses : lenses.filter((l) => roles.includes(l));
		const reach = new Set(
			own.flatMap((lens) =>
				navFor(lens, roles, permissions).flatMap((s) =>
					s.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]).map((h) => h.split("?")[0]),
				),
			),
		);
		// The Pengaturan index lists every card the principal can open.
		if (reach.has("/admin/pengaturan"))
			for (const card of SETTINGS_CARDS) if (canOpen(card.href, roles, permissions)) reach.add(card.href);
		const missing = GUARDED_PAGES.filter((path) => canOpen(path, roles, permissions) && !reach.has(path));
		assert.deepEqual(missing, omitted, name);
	}
});

test("S-V1 exactly one active row: longest path, query views, child over parent, Beranda only at home", () => {
	const ecommerce = navFor("ecommerce_admin", ["ecommerce_admin"], ["orders.history.read"]);
	const owner = navFor("owner", ["owner"], []);
	const finance = navFor("finance", ["finance"], ["finance.reconciliation.read"]);
	const at = (sections: NavSection[], url: string) => {
		const { pathname, searchParams } = new URL(url, "http://x");
		return activeHref(sections, pathname, searchParams);
	};
	assert.equal(at(ecommerce, "/admin/pesanan?tab=perlu_dikirim"), "/admin/pesanan?tab=perlu_dikirim");
	assert.equal(at(ecommerce, "/admin/pesanan"), "/admin/pesanan");
	assert.equal(at(ecommerce, "/admin/pesanan?tab=belum_bayar"), "/admin/pesanan");
	assert.equal(at(ecommerce, "/admin/pesanan/1042"), "/admin/pesanan");
	assert.equal(at(ecommerce, "/admin/produk/inventori/transfer"), "/admin/produk/inventori/transfer");
	assert.equal(at(ecommerce, "/admin/produk/inventori"), "/admin/produk/inventori");
	assert.equal(at(ecommerce, "/admin/produk/77"), "/admin/produk");
	assert.equal(at(ecommerce, "/admin?workspace=ecommerce_admin"), "/admin");
	assert.equal(at(ecommerce, "/admin/antrian"), "/admin");
	assert.equal(at(ecommerce, "/admin/akun/profil"), null);
	assert.equal(at(owner, "/admin/keuangan"), "/admin/keuangan");
	assert.equal(at(owner, "/admin/produk/gudang/3"), "/admin/produk/gudang");
	// Finance: the Keuangan row and its first child share a link; only the child is highlighted.
	assert.deepEqual(highlightedRows(finance, at(finance, "/admin/keuangan/pembayaran")), ["Keuangan > Pembayaran Masuk"]);
	assert.deepEqual(highlightedRows(owner, at(owner, "/admin/pesanan/7")), ["Pantauan > Pesanan"]);
	assert.deepEqual(highlightedRows(ecommerce, at(ecommerce, "/admin/pesanan?tab=perlu_dikirim")), ["Pesanan"]);
	// A query parent falls back to its path: the owner's warehouse lens lights Pesanan on other tabs and details.
	const warehouseLens = navFor("warehouse", ["owner"], []);
	assert.deepEqual(highlightedRows(warehouseLens, at(warehouseLens, "/admin/pesanan/1042")), ["Pesanan"]);
	assert.deepEqual(highlightedRows(warehouseLens, at(warehouseLens, "/admin/pesanan?tab=dikirim")), ["Pesanan"]);
	assert.deepEqual(highlightedRows(warehouseLens, at(warehouseLens, "/admin/pesanan/kirim")), ["Pesanan > Input Resi"]);
	// Beranda carries the lens for multi-workspace accounts; a different or missing workspace still lights it.
	const homeLens = [{ items: [{ label: "Beranda", href: "/admin?workspace=warehouse", icon: navFor("owner", [], [])[0].items[0].icon }] }];
	assert.equal(at(homeLens, "/admin?workspace=owner"), "/admin?workspace=warehouse");
	assert.equal(at(homeLens, "/admin/pesanan"), null);
	// Every visible href of every lens highlights exactly one row.
	for (const [lens, roles, permissions] of [
		["owner", ["owner"], []],
		["ecommerce_admin", ["ecommerce_admin"], ["orders.history.read"]],
		["warehouse", ["warehouse"], []],
		["customer_service", ["customer_service"], ["orders.history.read"]],
		["finance", ["finance"], ["orders.history.read", "finance.reconciliation.read", "finance.refunds.read"]],
	] as const) {
		const sections = navFor(lens, roles, permissions);
		for (const href of sections.flatMap((s) => s.items.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)])))
			assert.equal(highlightedRows(sections, at(sections, href)).length, 1, `${lens} ${href}`);
	}
});

test("S-V1 list tabs map to filters the APIs accept; old links open the matching tab", () => {
	assert.deepEqual(Object.keys(ORDER_TABS), ["semua", "belum_bayar", "perlu_dikirim", "dikirim", "dibatalkan"]);
	assert.equal(readOrderTab("belum_bayar", {}), "belum_bayar");
	assert.equal(readOrderTab("", { kirim: "packed" }), "perlu_dikirim");
	assert.equal(readOrderTab("", { kirim: "handed_over" }), "dikirim");
	assert.equal(readOrderTab("bogus", {}), "semua");
	assert.deepEqual(tabFilters("belum_bayar", { bayar: "confirmed", retur: "requested" }), { bayar: "pending", retur: "requested" });
	// Perlu Dikirim defaults to every stage before handover (the fulfillments_due predicate); chips narrow it.
	assert.deepEqual(tabFilters("perlu_dikirim", {}), {});
	assert.deepEqual(tabFilters("perlu_dikirim", { kirim: "exception" }), { kirim: "exception" });
	assert.deepEqual(tabFilters("perlu_dikirim", { kirim: "handed_over" }), {});
	assert.deepEqual(orderFilterParams("perlu_dikirim", tabFilters("perlu_dikirim", {})), [["fulfillment_group", "due"]]);
	assert.deepEqual(orderFilterParams("perlu_dikirim", { kirim: "packed", bayar: "pending" }), [
		["payment_status", "pending"],
		["fulfillment_status", "packed"],
		["fulfillment_group", "due"],
	]);
	assert.deepEqual(orderFilterParams("dikirim", tabFilters("dikirim", {})), [["fulfillment_status", "handed_over"]]);
	assert.deepEqual(tabFilters("semua", { kirim: "packed", status: "pending" }), { status: "pending" });
	assert.deepEqual(tabFilters("dibatalkan", {}), { status: "cancelled" });
	assert.equal(catalogTabStatus("diblokir", ""), "blocked");
	assert.equal(catalogTabStatus("", "withdrawn"), "withdrawn");
	assert.equal(catalogTabStatus("x", "x"), "");
	assert.equal(catalogTabKey("ready"), "siap");
	assert.equal(catalogTabKey(""), "semua");
});
